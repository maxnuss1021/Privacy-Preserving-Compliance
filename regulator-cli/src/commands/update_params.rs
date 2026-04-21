use alloy::primitives::{Address, FixedBytes};
use anyhow::{Context, Result};
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::eth;
use crate::ipfs;
use crate::receipt::Receipt;

#[derive(Debug, Serialize)]
pub struct UpdateParamsData {
    pub compliance_definition: String,
    pub merkle_root_1: String,
    pub merkle_root_2: String,
    pub leaves_file_1: String,
    pub leaves_file_2: String,
    pub leaves_cid_1: String,
    pub leaves_cid_2: String,
    pub update_tx_hash: String,
}

pub async fn run(
    compliance_definition: &str,
    ipfs_rpc_url: &str,
    rpc_url: &str,
    private_key: &str,
    merkle_root_1: &str,
    merkle_root_2: &str,
    leaves_file_1: PathBuf,
    leaves_file_2: PathBuf,
    receipts_dir: &Path,
) -> Result<()> {
    // 1. Upload leaves files to IPFS
    eprintln!("uploading leaves file 1 {}...", leaves_file_1.display());
    let leaves_response_1 = ipfs::add_file(ipfs_rpc_url, &leaves_file_1)
        .await
        .with_context(|| {
            format!("failed to upload leaves file 1 to IPFS at {ipfs_rpc_url}")
        })?;
    let leaves_cid_1 = &leaves_response_1.hash;
    eprintln!("leaves 1 uploaded to IPFS: {leaves_cid_1}");

    eprintln!("uploading leaves file 2 {}...", leaves_file_2.display());
    let leaves_response_2 = ipfs::add_file(ipfs_rpc_url, &leaves_file_2)
        .await
        .with_context(|| {
            format!("failed to upload leaves file 2 to IPFS at {ipfs_rpc_url}")
        })?;
    let leaves_cid_2 = &leaves_response_2.hash;
    eprintln!("leaves 2 uploaded to IPFS: {leaves_cid_2}");

    // 2. Call updateParams on the ComplianceDefinition contract
    let cd_addr: Address = compliance_definition
        .parse()
        .with_context(|| format!("invalid compliance definition address: {compliance_definition}"))?;
    let merkle_root_1_bytes: FixedBytes<32> = merkle_root_1
        .parse()
        .with_context(|| format!("invalid merkle_root_1 (expected bytes32): {merkle_root_1}"))?;
    let merkle_root_2_bytes: FixedBytes<32> = merkle_root_2
        .parse()
        .with_context(|| format!("invalid merkle_root_2 (expected bytes32): {merkle_root_2}"))?;

    let provider = eth::create_provider(rpc_url, private_key)?;

    eprintln!("calling updateParams...");
    let update_tx_hash = eth::call_update_params(
        &provider,
        cd_addr,
        merkle_root_1_bytes,
        merkle_root_2_bytes,
        leaves_cid_1.to_string(),
        leaves_cid_2.to_string(),
    )
    .await?;
    eprintln!("updateParams succeeded");

    println!("compliance_definition={compliance_definition}");
    println!("merkle_root_1={merkle_root_1}");
    println!("merkle_root_2={merkle_root_2}");
    println!("leaves_cid_1={leaves_cid_1}");
    println!("leaves_cid_2={leaves_cid_2}");
    println!("update_tx_hash={update_tx_hash}");

    let data = UpdateParamsData {
        compliance_definition: compliance_definition.to_string(),
        merkle_root_1: merkle_root_1.to_string(),
        merkle_root_2: merkle_root_2.to_string(),
        leaves_file_1: leaves_file_1.display().to_string(),
        leaves_file_2: leaves_file_2.display().to_string(),
        leaves_cid_1: leaves_cid_1.to_string(),
        leaves_cid_2: leaves_cid_2.to_string(),
        update_tx_hash: update_tx_hash.to_string(),
    };

    let receipt = Receipt::new("update-params", data);
    receipt.write_to_dir(receipts_dir)?;

    Ok(())
}
