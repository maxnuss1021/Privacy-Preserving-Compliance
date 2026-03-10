use anyhow::Result;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

mod bb;
mod commands;
mod eth;
mod etherscan;
mod forge;
mod ipfs;
mod nargo;
mod receipt;

#[derive(Parser)]
#[command(name = "regulator-cli")]
#[command(about = "CLI for managing privacy-preserving compliance definitions")]
struct Cli {
    /// IPFS RPC endpoint URL
    #[arg(long, global = true, env = "IPFS_RPC_URL")]
    ipfs_rpc_url: Option<String>,

    /// Directory for JSON receipts (one per command run)
    #[arg(long, global = true, value_name = "DIR")]
    receipts_dir: Option<PathBuf>,

    /// Etherscan API key -- when set, deployed contracts are verified on the block explorer
    #[arg(long, global = true, env = "ETHERSCAN_API_KEY")]
    etherscan_api_key: Option<String>,

    /// Block explorer verification URL (for non-Etherscan explorers like Blockscout)
    #[arg(long, global = true, env = "VERIFIER_URL")]
    verifier_url: Option<String>,

    #[command(subcommand)]
    command: Commands,
}

const UINT256_MAX: &str =
    "115792089237316195423570985008687907853269984665640564039457584007913129639935";
const BYTES32_ZERO: &str = "0x0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Subcommand)]
enum Commands {
    /// Deploy a new ComplianceDefinition contract and publish a Noir circuit verifier to it
    NewComplianceDefinition {
        /// Path to the Noir project directory (containing Nargo.toml)
        #[arg(value_name = "DIR")]
        path: PathBuf,

        /// Human-readable name for this compliance definition
        #[arg(long)]
        name: String,

        /// RPC URL of the target chain
        #[arg(long, env = "RPC_URL")]
        rpc_url: String,

        /// Private key for the deployer account
        #[arg(long, env = "PRIVATE_KEY")]
        private_key: String,

        /// Address of the regulator that will control the compliance definition
        #[arg(long, env = "PUBLIC_KEY")]
        regulator: String,

        /// Path to the Foundry project containing ComplianceDefinition.sol
        #[arg(long, default_value = "verifier-base-contract", value_name = "DIR")]
        contract_dir: PathBuf,

        /// Path to write the generated Solidity verifier [default: <DIR>/target/Verifier.sol]
        #[arg(long, value_name = "FILE")]
        verifier_output: Option<PathBuf>,

        /// Merkle root of the compliance membership set (bytes32)
        #[arg(long, default_value = BYTES32_ZERO)]
        merkle_root: String,

        /// Block height when this version becomes active
        #[arg(long, default_value = "0")]
        t_start: String,

        /// Block height when this version expires
        #[arg(long, default_value = UINT256_MAX)]
        t_end: String,

        /// JSON file containing merkle tree leaves to upload to IPFS
        #[arg(long, value_name = "FILE")]
        leaves_file: Option<PathBuf>,
    },
    /// Update the circuit of an existing ComplianceDefinition: compile, deploy a new verifier, and register it
    UpdateCircuit {
        /// Path to the Noir project directory (containing Nargo.toml)
        #[arg(value_name = "DIR")]
        path: PathBuf,

        /// RPC URL of the target chain
        #[arg(long, env = "RPC_URL")]
        rpc_url: String,

        /// Private key for the deployer account
        #[arg(long, env = "PRIVATE_KEY")]
        private_key: String,

        /// Address of the deployed ComplianceDefinition contract
        #[arg(long)]
        compliance_definition: String,

        /// Path to write the generated Solidity verifier [default: <DIR>/target/Verifier.sol]
        #[arg(long, value_name = "FILE")]
        verifier_output: Option<PathBuf>,

        /// Path to the Foundry project for deploying the verifier
        #[arg(long, default_value = "verifier-base-contract", value_name = "DIR")]
        contract_dir: PathBuf,

        /// Merkle root of the compliance membership set (bytes32)
        #[arg(long, default_value = BYTES32_ZERO)]
        merkle_root: String,

        /// Block height when this version becomes active
        #[arg(long, default_value = "0")]
        t_start: String,

        /// Block height when this version expires
        #[arg(long, default_value = UINT256_MAX)]
        t_end: String,

        /// JSON file containing merkle tree leaves to upload to IPFS
        #[arg(long, value_name = "FILE")]
        leaves_file: Option<PathBuf>,
    },
    /// Update the public parameters of an existing ComplianceDefinition
    UpdateParams {
        /// Address of the deployed ComplianceDefinition contract
        #[arg(long)]
        compliance_definition: String,

        /// RPC URL of the target chain
        #[arg(long, env = "RPC_URL")]
        rpc_url: String,

        /// Private key for the regulator account
        #[arg(long, env = "PRIVATE_KEY")]
        private_key: String,

        /// New Merkle root of the public parameter set (bytes32)
        #[arg(long)]
        merkle_root: String,

        /// JSON file containing the new merkle tree leaves to upload to IPFS
        #[arg(long, value_name = "FILE")]
        leaves_file: PathBuf,
    },
}

const DEFAULT_IPFS_RPC_URL: &str = "http://localhost:5001";
const DEFAULT_RECEIPTS_DIR: &str = "receipts";

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env file if present (before clap parses, so env vars are available).
    dotenv::dotenv().ok();

    let cli = Cli::parse();

    let ipfs_url = cli
        .ipfs_rpc_url
        .unwrap_or_else(|| DEFAULT_IPFS_RPC_URL.to_string());

    let receipts_dir = cli
        .receipts_dir
        .unwrap_or_else(|| PathBuf::from(DEFAULT_RECEIPTS_DIR));

    let verify = etherscan::VerifyArgs {
        etherscan_api_key: cli.etherscan_api_key,
        verifier_url: cli.verifier_url,
    };

    match cli.command {
        Commands::NewComplianceDefinition {
            path,
            name,
            rpc_url,
            private_key,
            regulator,
            contract_dir,
            verifier_output,
            merkle_root,
            t_start,
            t_end,
            leaves_file,
        } => {
            commands::new_compliance_definition::run(
                path,
                &name,
                verifier_output,
                &ipfs_url,
                &rpc_url,
                &private_key,
                &regulator,
                &contract_dir,
                &merkle_root,
                &t_start,
                &t_end,
                leaves_file,
                &receipts_dir,
                &verify,
            )
            .await
        }
        Commands::UpdateCircuit {
            path,
            rpc_url,
            private_key,
            compliance_definition,
            verifier_output,
            contract_dir,
            merkle_root,
            t_start,
            t_end,
            leaves_file,
        } => {
            commands::update_circuit::run(
                path,
                verifier_output,
                &ipfs_url,
                &rpc_url,
                &private_key,
                &compliance_definition,
                &contract_dir,
                &merkle_root,
                &t_start,
                &t_end,
                leaves_file,
                &receipts_dir,
                &verify,
            )
            .await
        }
        Commands::UpdateParams {
            compliance_definition,
            rpc_url,
            private_key,
            merkle_root,
            leaves_file,
        } => {
            commands::update_params::run(
                &compliance_definition,
                &ipfs_url,
                &rpc_url,
                &private_key,
                &merkle_root,
                leaves_file,
                &receipts_dir,
            )
            .await
        }
    }
}
