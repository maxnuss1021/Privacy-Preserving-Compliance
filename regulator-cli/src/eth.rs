use alloy::{
    hex,
    network::{Ethereum, EthereumWallet, TransactionBuilder},
    primitives::{Address, Bytes, FixedBytes, U256},
    providers::{Provider, ProviderBuilder},
    signers::local::PrivateKeySigner,
    sol,
};
use anyhow::{Context, Result};
use std::path::Path;

sol! {
    #[sol(rpc)]
    contract ComplianceDefinition {
        function updateConstraint(
            address newVerifier,
            bytes32 newMerkleRoot,
            uint256 tStart,
            uint256 tEnd,
            string calldata metadataHash,
            string calldata leavesHash
        ) external;
    }
}

pub struct DeployOutput {
    pub deployed_to: Address,
    pub transaction_hash: FixedBytes<32>,
}

pub fn create_provider(
    rpc_url: &str,
    private_key: &str,
) -> Result<impl Provider<Ethereum> + Clone> {
    let signer: PrivateKeySigner = private_key
        .parse()
        .context("failed to parse private key")?;

    let url: reqwest::Url = rpc_url
        .parse()
        .with_context(|| format!("invalid RPC URL: {rpc_url}"))?;

    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(url);

    Ok(provider)
}

/// Deploy a contract by reading its bytecode from a forge artifact JSON file.
/// If `constructor_args` is provided, it is appended to the bytecode.
///
/// Automatically detects and deploys any unlinked libraries referenced in the
/// artifact's `linkReferences`, then links them into the bytecode before deploying
/// the main contract (similar to how Remix IDE handles library dependencies).
pub async fn deploy_from_artifact(
    provider: &(impl Provider<Ethereum> + Clone),
    artifact_path: &Path,
    constructor_args: Option<Bytes>,
) -> Result<DeployOutput> {
    let artifact_bytes = std::fs::read(artifact_path)
        .with_context(|| format!("failed to read artifact: {}", artifact_path.display()))?;

    let artifact: serde_json::Value = serde_json::from_slice(&artifact_bytes)
        .with_context(|| format!("failed to parse artifact JSON: {}", artifact_path.display()))?;

    let mut bytecode_hex = artifact
        .get("bytecode")
        .and_then(|b| b.get("object"))
        .and_then(|o| o.as_str())
        .with_context(|| {
            format!(
                "missing bytecode.object in artifact: {}",
                artifact_path.display()
            )
        })?
        .to_string();

    // Auto-deploy any unlinked libraries and link them into the bytecode.
    if let Some(link_refs) = artifact.pointer("/bytecode/linkReferences") {
        if let Some(obj) = link_refs.as_object() {
            let artifact_dir = artifact_path
                .parent()
                .and_then(|p| p.parent())
                .context("cannot determine artifact output directory")?;

            for (sol_file, libs) in obj {
                let Some(libs) = libs.as_object() else {
                    continue;
                };
                for lib_name in libs.keys() {
                    // linkReferences uses source paths like "src/Verifier.sol",
                    // but forge stores artifacts by filename: "out/Verifier.sol/".
                    let sol_filename = Path::new(sol_file)
                        .file_name()
                        .unwrap_or(sol_file.as_ref());
                    let lib_artifact_path = artifact_dir
                        .join(sol_filename)
                        .join(format!("{lib_name}.json"));

                    eprintln!("  deploying library {lib_name}...");
                    let lib_deploy = Box::pin(deploy_from_artifact(
                        provider,
                        &lib_artifact_path,
                        None,
                    ))
                    .await?;
                    eprintln!("  {lib_name} deployed to {}", lib_deploy.deployed_to);

                    let fq_name = format!("{sol_file}:{lib_name}");
                    let placeholder = library_placeholder(&fq_name);
                    let addr_hex = hex::encode(lib_deploy.deployed_to);
                    bytecode_hex = bytecode_hex.replace(&placeholder, &addr_hex);
                }
            }
        }
    }

    let raw = bytecode_hex.strip_prefix("0x").unwrap_or(&bytecode_hex);
    let mut bytecode = hex::decode(raw).with_context(|| {
        format!(
            "invalid hex in bytecode.object of artifact: {}",
            artifact_path.display()
        )
    })?;

    if let Some(args) = constructor_args {
        bytecode.extend_from_slice(&args);
    }

    let tx = <Ethereum as alloy::network::Network>::TransactionRequest::default()
        .with_deploy_code(Bytes::from(bytecode));

    let pending_tx = provider
        .send_transaction(tx)
        .await
        .context("failed to broadcast contract deployment")?;

    let tx_hash = *pending_tx.tx_hash();

    let receipt = pending_tx
        .get_receipt()
        .await
        .context("contract deployment transaction failed")?;

    let deployed_to = receipt
        .contract_address
        .context("no contract address in deployment receipt")?;

    Ok(DeployOutput {
        deployed_to,
        transaction_hash: tx_hash,
    })
}

/// Compute the `__$<hash>$__` placeholder that Solidity uses for an unlinked library.
/// `fully_qualified_name` is e.g. `"src/Verifier.sol:ZKTranscriptLib"`.
fn library_placeholder(fully_qualified_name: &str) -> String {
    let hash = alloy::primitives::keccak256(fully_qualified_name.as_bytes());
    let hash_hex = hex::encode(hash);
    format!("__${}$__", &hash_hex[..34])
}

pub async fn call_update_constraint(
    provider: &(impl Provider<Ethereum> + Clone),
    compliance_definition_addr: Address,
    new_verifier: Address,
    merkle_root: FixedBytes<32>,
    t_start: U256,
    t_end: U256,
    metadata_uri: String,
    leaves_hash: String,
) -> Result<FixedBytes<32>> {
    let contract = ComplianceDefinition::new(compliance_definition_addr, provider);

    let pending_tx = contract
        .updateConstraint(new_verifier, merkle_root, t_start, t_end, metadata_uri, leaves_hash)
        .send()
        .await
        .context("failed to broadcast updateConstraint transaction")?;

    let tx_hash = *pending_tx.tx_hash();

    pending_tx
        .get_receipt()
        .await
        .context("updateConstraint transaction failed")?;

    Ok(tx_hash)
}
