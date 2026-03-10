use alloy::primitives::{Address, FixedBytes, U256};
use alloy::providers::Provider;
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
pub struct UpdateCircuitData {
    pub project_dir: String,
    pub bytecode_path: String,
    pub vk_path: String,
    pub verifier_path: String,
    pub cid: String,
    pub ipfs_size: String,
    pub merkle_root: String,
    pub verifier_address: String,
    pub deploy_tx_hash: String,
    pub compliance_definition: String,
    pub update_tx_hash: String,
    pub verification_status: String,
    pub leaves_cid: String,
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    project_dir: PathBuf,
    verifier_output: Option<PathBuf>,
    ipfs_rpc_url: &str,
    rpc_url: &str,
    private_key: &str,
    compliance_definition: &str,
    contract_dir: &Path,
    merkle_root: &str,
    t_start: &str,
    t_end: &str,
    leaves_file: Option<PathBuf>,
    receipts_dir: &Path,
    verify: &VerifyArgs,
) -> Result<()> {
    if !project_dir.is_dir() {
        bail!("not a directory: {}", project_dir.display());
    }

    if !project_dir.join("Nargo.toml").exists() {
        bail!(
            "no Nargo.toml found in {} -- is this a Noir project?",
            project_dir.display()
        );
    }

    let source_file = nargo::find_source_file(&project_dir)?;

    // 1. Validate circuit
    eprintln!("validating circuit...");
    nargo::check(&project_dir)
        .with_context(|| format!("circuit validation failed for {}", project_dir.display()))?;
    eprintln!("circuit validated successfully");

    // 2. Compile the circuit
    eprintln!("compiling circuit...");
    let bytecode_path = nargo::compile(&project_dir)?;
    eprintln!("circuit compiled successfully");

    // 3. Generate verification key
    let target_dir = project_dir.join("target");
    eprintln!("generating verification key...");
    let vk_path = bb::write_vk(&bytecode_path, &target_dir)?;
    eprintln!("verification key generated");

    // 4. Generate Solidity verifier
    let verifier_path = verifier_output.unwrap_or_else(|| target_dir.join("Verifier.sol"));
    eprintln!("generating Solidity verifier...");
    bb::write_solidity_verifier(&vk_path, &verifier_path)?;
    eprintln!("Solidity verifier generated");

    // 5. Upload circuit source and compiled output to IPFS
    eprintln!("uploading circuit files to IPFS...");
    let response = ipfs::add_directory(
        ipfs_rpc_url,
        &[source_file.as_path(), bytecode_path.as_path()],
    )
    .await
    .with_context(|| {
        format!("failed to upload circuit files to IPFS at {ipfs_rpc_url}")
    })?;
    eprintln!("uploaded to IPFS");

    // 5b. Upload leaves file if provided
    let leaves_cid = if let Some(ref leaves_path) = leaves_file {
        eprintln!("uploading leaves file {}...", leaves_path.display());
        let leaves_response = ipfs::add_file(ipfs_rpc_url, leaves_path)
            .await
            .with_context(|| {
                format!("failed to upload leaves file to IPFS at {ipfs_rpc_url}")
            })?;
        eprintln!("leaves uploaded to IPFS: {}", leaves_response.hash);
        leaves_response.hash
    } else {
        String::new()
    };

    // 6. Temporarily copy Verifier.sol into the Foundry project so forge can compile it
    let deploy_verifier_path = contract_dir.join("src/Verifier.sol");
    std::fs::copy(&verifier_path, &deploy_verifier_path).with_context(|| {
        format!(
            "failed to copy Verifier.sol to {}",
            deploy_verifier_path.display()
        )
    })?;

    // 7. Build the Foundry project with the new Verifier.sol
    eprintln!("compiling verifier contract...");
    forge::build(contract_dir)?;
    eprintln!("verifier contract compiled");

    // 8. Deploy the HonkVerifier contract
    let provider = eth::create_provider(rpc_url, private_key)?;
    let artifact = forge::artifact_path(contract_dir, "Verifier.sol", "HonkVerifier");

    eprintln!("deploying HonkVerifier...");
    let deploy_result = eth::deploy_from_artifact(&provider, &artifact, None).await?;
    eprintln!("HonkVerifier deployed to {}", deploy_result.deployed_to);

    // Verify via Etherscan API (needs Verifier.sol still present for standard JSON input)
    let chain_id = provider.get_chain_id().await
        .context("failed to query chain ID from RPC")?;
    let verification = etherscan::verify_contract(
        contract_dir,
        &artifact,
        chain_id,
        &deploy_result.deployed_to.to_string(),
        "src/Verifier.sol:HonkVerifier",
        None,
        verify,
        "",
    )
    .await;

    // Clean up the temporarily copied Verifier.sol
    let _ = std::fs::remove_file(&deploy_verifier_path);

    let verification = verification?;

    // 9. Call updateCircuit on the ComplianceDefinition contract
    let cid = &response.hash;
    let cd_addr: Address = compliance_definition
        .parse()
        .with_context(|| format!("invalid compliance definition address: {compliance_definition}"))?;
    let merkle_root_bytes: FixedBytes<32> = merkle_root
        .parse()
        .with_context(|| format!("invalid merkle_root (expected bytes32): {merkle_root}"))?;
    let t_start_val: U256 = t_start
        .parse()
        .with_context(|| format!("invalid t_start (expected uint256): {t_start}"))?;
    let t_end_val: U256 = t_end
        .parse()
        .with_context(|| format!("invalid t_end (expected uint256): {t_end}"))?;

    eprintln!("registering compliance version...");
    let update_tx_hash = eth::call_update_circuit(
        &provider,
        cd_addr,
        deploy_result.deployed_to,
        merkle_root_bytes,
        t_start_val,
        t_end_val,
        cid.to_string(),
        leaves_cid.clone(),
    )
    .await?;
    eprintln!("compliance version registered");

    println!("verifier_address={}", deploy_result.deployed_to);
    println!("deploy_tx_hash={}", deploy_result.transaction_hash);
    println!("update_tx_hash={update_tx_hash}");
    println!("cid={cid}");
    println!("merkle_root={merkle_root}");
    println!("chain_id={chain_id}");
    println!("verification={verification}");

    let data = UpdateCircuitData {
        project_dir: project_dir.display().to_string(),
        bytecode_path: bytecode_path.display().to_string(),
        vk_path: vk_path.display().to_string(),
        verifier_path: verifier_path.display().to_string(),
        cid: cid.to_string(),
        ipfs_size: response.size,
        merkle_root: merkle_root.to_string(),
        verifier_address: deploy_result.deployed_to.to_string(),
        deploy_tx_hash: deploy_result.transaction_hash.to_string(),
        compliance_definition: compliance_definition.to_string(),
        update_tx_hash: update_tx_hash.to_string(),
        verification_status: verification.to_string(),
        leaves_cid,
    };

    let receipt = Receipt::new("update-circuit", data);
    receipt.write_to_dir(receipts_dir)?;

    Ok(())
}
