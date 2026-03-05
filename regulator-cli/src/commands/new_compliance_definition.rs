use alloy::primitives::{Address, Bytes, FixedBytes, U256};
use alloy::providers::Provider;
use alloy::sol_types::SolValue;
use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::bb;
use crate::eth;
use crate::etherscan;
use crate::etherscan::VerifyArgs;
use crate::forge;
use crate::ipfs;
use crate::nargo;
use crate::receipt::Receipt;

#[derive(Debug, Serialize)]
pub struct NewComplianceDefinitionData {
    pub name: String,
    pub compliance_definition_address: String,
    pub compliance_definition_tx: String,
    pub compliance_definition_verification: String,
    pub regulator: String,
    pub chain_id: u64,
    pub rpc_url: String,
    pub source_file: String,
    pub cid: String,
    pub ipfs_size: String,
    pub merkle_root: String,
    pub verifier_address: String,
    pub verifier_tx: String,
    pub verifier_verification: String,
    pub update_tx: String,
    pub leaves_cid: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    path: PathBuf,
    name: &str,
    verifier_output: Option<PathBuf>,
    ipfs_rpc_url: &str,
    rpc_url: &str,
    private_key: &str,
    regulator: &str,
    contract_dir: &Path,
    merkle_root: &str,
    t_start: &str,
    t_end: &str,
    leaves_file: Option<PathBuf>,
    receipts_dir: &Path,
    verify: &VerifyArgs,
) -> Result<()> {
    if !path.is_dir() {
        bail!("not a directory: {}", path.display());
    }
    if !path.join("Nargo.toml").exists() {
        bail!(
            "no Nargo.toml found in {} -- is this a Noir project?",
            path.display()
        );
    }

    let regulator_addr: Address = regulator
        .parse()
        .with_context(|| format!("invalid regulator address: {regulator}"))?;

    let source_file = nargo::find_source_file(&path)?;

    let provider = eth::create_provider(rpc_url, private_key)?;
    let chain_id = provider
        .get_chain_id()
        .await
        .context("failed to query chain ID from RPC")?;
    let network = etherscan::network_name(chain_id);

    // ── ComplianceDefinition Contract ────────────────────────────────
    eprintln!("\nComplianceDefinition Contract");
    eprintln!("  Compiling contracts...");
    forge::build(contract_dir)?;

    let cd_artifact =
        forge::artifact_path(contract_dir, "ComplianceDefinition.sol", "ComplianceDefinition");
    let constructor_args = Bytes::from((regulator_addr, name.to_string()).abi_encode_params());

    eprintln!("  Deploying to {network}...");
    let cd_result =
        eth::deploy_from_artifact(&provider, &cd_artifact, Some(constructor_args)).await?;

    let cd_verification = etherscan::verify_contract(
        contract_dir,
        &cd_artifact,
        chain_id,
        &cd_result.deployed_to.to_string(),
        "src/ComplianceDefinition.sol:ComplianceDefinition",
        Some(&alloy::hex::encode((regulator_addr, name.to_string()).abi_encode_params())),
        verify,
        "  ",
    )
    .await?;

    eprintln!("  Address:      {}", cd_result.deployed_to);
    eprintln!("  Transaction:  {}", cd_result.transaction_hash);
    eprintln!("  Chain ID:     {chain_id}");
    eprintln!("  Verification: {cd_verification}");

    // ── Noir Circuit (<source_file>) ─────────────────────────────────
    eprintln!("\nNoir Circuit ({})", source_file.display());
    eprintln!("  Validating...");
    nargo::check(&path)
        .with_context(|| format!("circuit validation failed for {}", path.display()))?;

    eprintln!("  Compiling...");
    let bytecode_path = nargo::compile(&path)?;

    let target_dir = path.join("target");
    eprintln!("  Generating verification key...");
    let vk_path = bb::write_vk(&bytecode_path, &target_dir)?;

    let verifier_path = verifier_output.unwrap_or_else(|| target_dir.join("Verifier.sol"));
    eprintln!("  Generating Solidity verifier...");
    bb::write_solidity_verifier(&vk_path, &verifier_path)?;

    // ── IPFS Upload ──────────────────────────────────────────────────
    eprintln!("\nIPFS Upload");
    eprintln!("  Uploading {} and compiled output...", source_file.display());
    let ipfs_response = ipfs::add_directory(
        ipfs_rpc_url,
        &[source_file.as_path(), bytecode_path.as_path()],
    )
    .await
    .with_context(|| {
        format!("failed to upload circuit files to IPFS at {ipfs_rpc_url}")
    })?;
    eprintln!("  CID: {}", ipfs_response.hash);

    // ── Leaves Upload ────────────────────────────────────────────────
    let leaves_cid = if let Some(ref leaves_path) = leaves_file {
        eprintln!("  Uploading leaves file {}...", leaves_path.display());
        let leaves_response = ipfs::add_file(ipfs_rpc_url, leaves_path)
            .await
            .with_context(|| {
                format!("failed to upload leaves file to IPFS at {ipfs_rpc_url}")
            })?;
        eprintln!("  Leaves CID: {}", leaves_response.hash);
        leaves_response.hash
    } else {
        String::new()
    };

    // ── HonkVerifier Contract ────────────────────────────────────────
    eprintln!("\nHonkVerifier Contract");
    let deploy_verifier_path = contract_dir.join("src/Verifier.sol");
    std::fs::copy(&verifier_path, &deploy_verifier_path).with_context(|| {
        format!(
            "failed to copy Verifier.sol to {}",
            deploy_verifier_path.display()
        )
    })?;

    eprintln!("  Compiling...");
    forge::build(contract_dir)?;

    let verifier_artifact = forge::artifact_path(contract_dir, "Verifier.sol", "HonkVerifier");

    eprintln!("  Deploying to {network}...");
    let verifier_result =
        eth::deploy_from_artifact(&provider, &verifier_artifact, None).await?;

    let verifier_verification = etherscan::verify_contract(
        contract_dir,
        &verifier_artifact,
        chain_id,
        &verifier_result.deployed_to.to_string(),
        "src/Verifier.sol:HonkVerifier",
        None,
        verify,
        "  ",
    )
    .await;

    let _ = std::fs::remove_file(&deploy_verifier_path);
    let verifier_verification = verifier_verification?;

    eprintln!("  Address:      {}", verifier_result.deployed_to);
    eprintln!("  Transaction:  {}", verifier_result.transaction_hash);
    eprintln!("  Verification: {verifier_verification}");

    // ── Compliance Registration ──────────────────────────────────────
    eprintln!("\nCompliance Registration");
    let cid = &ipfs_response.hash;
    let cd_addr = cd_result.deployed_to;
    let merkle_root_bytes: FixedBytes<32> = merkle_root
        .parse()
        .with_context(|| format!("invalid merkle_root (expected bytes32): {merkle_root}"))?;
    let t_start_val: U256 = t_start
        .parse()
        .with_context(|| format!("invalid t_start (expected uint256): {t_start}"))?;
    let t_end_val: U256 = t_end
        .parse()
        .with_context(|| format!("invalid t_end (expected uint256): {t_end}"))?;

    eprintln!("  Registering verifier on {cd_addr}...");
    let update_tx_hash = eth::call_update_constraint(
        &provider,
        cd_addr,
        verifier_result.deployed_to,
        merkle_root_bytes,
        t_start_val,
        t_end_val,
        cid.to_string(),
        leaves_cid.clone(),
    )
    .await?;
    eprintln!("  Transaction:  {update_tx_hash}");

    // ── Done ─────────────────────────────────────────────────────────
    eprintln!();
    println!("compliance_definition={cd_addr}");
    println!("verifier_address={}", verifier_result.deployed_to);
    println!("cid={cid}");
    println!("merkle_root={merkle_root}");
    println!("chain_id={chain_id}");

    let data = NewComplianceDefinitionData {
        name: name.to_string(),
        compliance_definition_address: cd_addr.to_string(),
        compliance_definition_tx: cd_result.transaction_hash.to_string(),
        compliance_definition_verification: cd_verification.to_string(),
        regulator: regulator.to_string(),
        chain_id,
        rpc_url: rpc_url.to_string(),
        source_file: source_file.display().to_string(),
        cid: cid.to_string(),
        ipfs_size: ipfs_response.size.clone(),
        merkle_root: merkle_root.to_string(),
        verifier_address: verifier_result.deployed_to.to_string(),
        verifier_tx: verifier_result.transaction_hash.to_string(),
        verifier_verification: verifier_verification.to_string(),
        update_tx: update_tx_hash.to_string(),
        leaves_cid,
    };

    let receipt = Receipt::new("new-compliance-definition", data);
    receipt.write_to_dir(receipts_dir)?;

    Ok(())
}
