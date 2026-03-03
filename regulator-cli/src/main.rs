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

#[derive(Subcommand)]
enum Commands {
    /// Deploy a new ComplianceDefinition contract and publish a Noir circuit verifier to it
    NewComplianceDefinition {
        /// Path to the Noir project directory (containing Nargo.toml)
        #[arg(value_name = "DIR")]
        path: PathBuf,

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

        /// File containing public parameters to upload to IPFS
        #[arg(long, value_name = "FILE")]
        public_params: Option<PathBuf>,

        /// Block height when this version becomes active
        #[arg(long, default_value = "0")]
        t_start: String,

        /// Block height when this version expires
        #[arg(long, default_value = UINT256_MAX)]
        t_end: String,
    },
    /// Initialize a new Noir compliance definition project
    Init {
        /// Name for the new project
        name: String,
    },
    /// Validate, compile, deploy a Noir circuit verifier, and register it with a ComplianceDefinition
    Publish {
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

        /// File containing public parameters to upload to IPFS
        #[arg(long, value_name = "FILE")]
        public_params: Option<PathBuf>,

        /// Block height when this version becomes active
        #[arg(long, default_value = "0")]
        t_start: String,

        /// Block height when this version expires
        #[arg(long, default_value = UINT256_MAX)]
        t_end: String,
    },
    /// Update an existing compliance definition TODO
    Update,
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
            rpc_url,
            private_key,
            regulator,
            contract_dir,
            verifier_output,
            public_params,
            t_start,
            t_end,
        } => {
            commands::new_compliance_definition::run(
                path,
                verifier_output,
                &ipfs_url,
                &rpc_url,
                &private_key,
                &regulator,
                &contract_dir,
                public_params,
                &t_start,
                &t_end,
                &receipts_dir,
                &verify,
            )
            .await
        }
        Commands::Init { name } => commands::init::run(&name).await,
        Commands::Publish {
            path,
            rpc_url,
            private_key,
            compliance_definition,
            verifier_output,
            contract_dir,
            public_params,
            t_start,
            t_end,
        } => {
            commands::publish::run(
                path,
                verifier_output,
                &ipfs_url,
                &rpc_url,
                &private_key,
                &compliance_definition,
                &contract_dir,
                public_params,
                &t_start,
                &t_end,
                &receipts_dir,
                &verify,
            )
            .await
        }
        Commands::Update => commands::update::run().await,
    }
}
