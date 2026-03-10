# Regulator CLI

The Regulator CLI is a Rust command-line tool for managing on-chain compliance definitions. It handles the full lifecycle: deploying a new `ComplianceDefinition` contract with an initial Noir circuit, updating the circuit when compliance logic changes, and updating public parameters (e.g., sanction lists) without changing the circuit. Each command compiles circuits, uploads artifacts to IPFS, deploys Solidity verifier contracts, and writes a JSON receipt for auditability.

## Architecture

```
regulator-cli/src/
├── main.rs           # CLI entry point (clap subcommands + dispatch)
├── commands/
│   ├── mod.rs
│   ├── new_compliance_definition.rs   # Deploy contract + first circuit
│   ├── update_circuit.rs              # New circuit on existing contract
│   └── update_params.rs               # New params on existing contract
├── eth.rs            # Ethereum interactions (alloy): deploy, updateCircuit, updateParams
├── ipfs.rs           # IPFS uploads (reqwest): add_file, add_directory
├── nargo.rs          # Noir compiler: check, compile, find source
├── bb.rs             # Barretenberg: write_vk, write_solidity_verifier
├── forge.rs          # Foundry: build, artifact_path
├── etherscan.rs      # Block explorer contract verification
└── receipt.rs        # JSON receipt generation
```

### Data flow (new-compliance-definition)

1. **Build contracts** -- compile the Foundry project containing `ComplianceDefinition.sol`.
2. **Deploy ComplianceDefinition** -- deploy the contract with the regulator address and name as constructor args.
3. **Compile Noir circuit** -- validate (`nargo check`) and compile (`nargo compile`) the circuit.
4. **Generate verifier** -- produce a verification key and Solidity verifier via Barretenberg.
5. **Upload to IPFS** -- upload circuit source and compiled artifact as a directory; optionally upload leaves file separately.
6. **Deploy HonkVerifier** -- copy the generated `Verifier.sol` into the Foundry project, build, and deploy.
7. **Register version** -- call `updateCircuit()` on the ComplianceDefinition contract with the verifier address, merkle root, time bounds, and IPFS CIDs.
8. **Write receipt** -- write a JSON receipt to the receipts directory.

## Prerequisites

- **Rust** >= 1.85 (edition 2024)
- **Nargo** -- the [Noir](https://noir-lang.org/) compiler, available on `PATH`
- **Barretenberg (`bb`)** -- the proving backend CLI, available on `PATH`
- **Foundry (`forge`)** -- the [Foundry](https://book.getfoundry.sh/) Solidity toolkit, available on `PATH`
- **IPFS node** -- a running [Kubo](https://docs.ipfs.tech/install/command-line/) instance with the RPC API exposed (default `http://localhost:5001`)
- **Ethereum RPC** -- an endpoint for your target chain (e.g., Sepolia via Infura/Alchemy)
- **Funded account** -- a private key with ETH on the target chain for deploying contracts

## Build

From the repository root:

```sh
cargo build --release
```

The binary is at `target/release/regulator-cli`.

## Configuration

All commands support layered configuration: CLI flag > environment variable > default value. Common environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `IPFS_RPC_URL` | IPFS Kubo RPC endpoint | `http://localhost:5001` |
| `RPC_URL` | Ethereum JSON-RPC endpoint | (required) |
| `PRIVATE_KEY` | Deployer/regulator private key | (required) |
| `PUBLIC_KEY` | Regulator Ethereum address | (required for `new-compliance-definition`) |
| `ETHERSCAN_API_KEY` | Enables block explorer verification when set | (optional) |
| `VERIFIER_URL` | Custom block explorer URL (e.g., Blockscout) | (optional) |

You can place these in a `.env` file in the working directory -- it is loaded automatically.

## Commands

### `new-compliance-definition`

Deploy a new `ComplianceDefinition` contract and register an initial Noir circuit verifier.

```sh
regulator-cli new-compliance-definition ./circuits/my_circuit \
  --name "US AML Compliance" \
  --rpc-url https://sepolia.infura.io/v3/YOUR_KEY \
  --private-key 0xYOUR_PRIVATE_KEY \
  --regulator 0xYOUR_ADDRESS \
  --merkle-root 0xabcdef...1234 \
  --t-start 0 \
  --t-end 999999999 \
  --leaves-file ./leaves.json
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<DIR>` (positional) | yes | Path to the Noir project directory |
| `--name` | yes | Human-readable compliance definition name |
| `--rpc-url` | yes | Target chain RPC endpoint |
| `--private-key` | yes | Deployer private key |
| `--regulator` | yes | Regulator address (contract owner) |
| `--contract-dir` | no | Foundry project path (default: `verifier-base-contract`) |
| `--verifier-output` | no | Custom output path for generated `Verifier.sol` |
| `--merkle-root` | no | Merkle root of public parameters (default: `0x00...00`) |
| `--t-start` | no | Version activation block height (default: `0`) |
| `--t-end` | no | Version expiration block height (default: `uint256.max`) |
| `--leaves-file` | no | JSON file of merkle tree leaves to upload to IPFS |

### `update-circuit`

Update the circuit of an existing `ComplianceDefinition`. Compiles the new Noir circuit, deploys a new `HonkVerifier`, and calls `updateCircuit()` on the contract.

```sh
regulator-cli update-circuit ./circuits/updated_circuit \
  --compliance-definition 0xDEPLOYED_ADDRESS \
  --rpc-url https://sepolia.infura.io/v3/YOUR_KEY \
  --private-key 0xYOUR_PRIVATE_KEY \
  --merkle-root 0xabcdef...1234 \
  --t-start 100 \
  --t-end 999999999 \
  --leaves-file ./leaves.json
```

| Argument | Required | Description |
|----------|----------|-------------|
| `<DIR>` (positional) | yes | Path to the Noir project directory |
| `--compliance-definition` | yes | Address of the existing ComplianceDefinition contract |
| `--rpc-url` | yes | Target chain RPC endpoint |
| `--private-key` | yes | Regulator private key |
| `--contract-dir` | no | Foundry project path (default: `verifier-base-contract`) |
| `--verifier-output` | no | Custom output path for generated `Verifier.sol` |
| `--merkle-root` | no | Merkle root of public parameters (default: `0x00...00`) |
| `--t-start` | no | Version activation block height (default: `0`) |
| `--t-end` | no | Version expiration block height (default: `uint256.max`) |
| `--leaves-file` | no | JSON file of merkle tree leaves to upload to IPFS |

### `update-params`

Update only the public parameters (e.g., refresh a sanction list) without changing the circuit or deploying a new verifier.

```sh
regulator-cli update-params \
  --compliance-definition 0xDEPLOYED_ADDRESS \
  --rpc-url https://sepolia.infura.io/v3/YOUR_KEY \
  --private-key 0xYOUR_PRIVATE_KEY \
  --merkle-root 0xNEW_MERKLE_ROOT \
  --leaves-file ./updated_leaves.json
```

| Argument | Required | Description |
|----------|----------|-------------|
| `--compliance-definition` | yes | Address of the existing ComplianceDefinition contract |
| `--rpc-url` | yes | Target chain RPC endpoint |
| `--private-key` | yes | Regulator private key |
| `--merkle-root` | yes | New merkle root (bytes32) |
| `--leaves-file` | yes | JSON file of updated merkle tree leaves to upload to IPFS |

## Typical flow

A regulator's lifecycle with a compliance definition:

```
1. Write a Noir circuit            circuits/sanction_check/src/main.nr
                                          |
2. Deploy                          regulator-cli new-compliance-definition ...
                                          |
                                   ComplianceDefinition deployed at 0xABC...
                                   HonkVerifier deployed at 0xDEF...
                                   Circuit uploaded to IPFS (CID: Qm...)
                                          |
3. Applications integrate          require(complianceDefinition.verify(proof))
                                          |
4. Sanction list changes           regulator-cli update-params ...
                                          |
                                   New merkle root registered on-chain
                                   Updated leaves uploaded to IPFS
                                          |
5. Compliance logic changes        regulator-cli update-circuit ...
                                          |
                                   New circuit compiled and uploaded to IPFS
                                   New HonkVerifier deployed
                                   New version registered on-chain
```

## Global flags

These flags apply to all commands:

| Flag | Env Variable | Description |
|------|-------------|-------------|
| `--ipfs-rpc-url` | `IPFS_RPC_URL` | IPFS Kubo RPC endpoint (default: `http://localhost:5001`) |
| `--receipts-dir` | -- | Directory for JSON receipt files (default: `receipts/`) |
| `--etherscan-api-key` | `ETHERSCAN_API_KEY` | Enables contract verification on block explorers |
| `--verifier-url` | `VERIFIER_URL` | Custom block explorer verification URL (e.g., Blockscout) |

## Receipts

Every command writes a timestamped JSON receipt to the receipts directory (default `receipts/`). Receipts contain all output data: deployed addresses, transaction hashes, IPFS CIDs, and verification status. Example:

```
receipts/
├── new-compliance-definition-20260309T143022.json
├── update-circuit-20260315T091500.json
└── update-params-20260401T120000.json
```
