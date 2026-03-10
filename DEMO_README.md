# Unified Demo

A single-page application with 3 side-by-side demo apps, each backed by an ERC-20 token (`CompliantToken`) that requires a zero-knowledge compliance proof before minting. The demo shows how different applications integrate the privacy-preserving compliance framework, and how proof reuse works when multiple apps share the same ComplianceDefinition.

## Demo apps

| Panel | Name | Color | ComplianceDefinition | Circuit | Description |
|-------|------|-------|---------------------|---------|-------------|
| 1 | SafeSwap | Red | Sanction list | non_membership | DEX that proves users are not on a sanction list |
| 2 | CleanMixer | Green | Sanction list | non_membership | Compliant mixer that proves users are not sanctioned |
| 3 | VerifiedLend | Blue | Whitelist | membership | Lending protocol that proves users are on a whitelist |

SafeSwap and CleanMixer share the same ComplianceDefinition. When a user generates a proof for one, the SDK caches it and reuses it instantly for the other.

## Architecture

```
  +-----------------------+             +-----------------------+
  | ComplianceDefinition  |             | ComplianceDefinition  |
  | (sanction list)       |             | (whitelist)           |
  | 0xAAA...             |             | 0xBBB...             |
  +----------+------------+             +----------+------------+
       |           |                               |
       v           v                               v
  +----------+ +------------+             +-----------------+
  | SafeSwap | | CleanMixer |             | VerifiedLend    |
  | Token T1 | | Token T2   |             | Token T3        |
  +----------+ +------------+             +-----------------+
```

Each `CompliantToken` contract has a single entrypoint:

```solidity
function mint(bytes calldata proof) external
```

It calls `ComplianceDefinition.verify(proof)` atomically -- if the proof is invalid, the transaction reverts. On success, it mints 1 token (1e18) to `msg.sender`.

## Prerequisites

- **Node.js** >= 18
- **pnpm** (workspace manager)
- **IPFS node** -- a running [Kubo](https://docs.ipfs.tech/install/command-line/) instance with the gateway exposed (default `http://localhost:8080`). CORS must be configured:
  ```sh
  ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
  ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'
  ipfs config --json Gateway.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
  ```
- **Ethereum RPC** -- a Sepolia endpoint (e.g., Infura, Alchemy)
- **Browser wallet** -- MetaMask or compatible injected wallet with Sepolia ETH

## On-chain setup

Before running the demo, you need 5 deployed contracts on Sepolia: 2 ComplianceDefinitions and 3 CompliantTokens.

### 1. Build the merkle trees

Use the build-merkle tool to construct leaves files and compute merkle roots. The sanction list must be sorted (required by the non-membership circuit):

```sh
# Sanction list (must be sorted for non-membership proofs)
npx tsx packages/build-merkle/index.ts \
  -f sanction_addresses.txt \
  -o sanction_leaves.json \
  --sorted

# Whitelist
npx tsx packages/build-merkle/index.ts \
  -f whitelist_addresses.txt \
  -o whitelist_leaves.json
```

The tool outputs the merkle root for each tree. Use these as `--merkle-root` in the next step.

### 2. Deploy ComplianceDefinitions

Use the regulator CLI to deploy two ComplianceDefinitions -- one for the non-membership (sanction list) circuit and one for the membership (whitelist) circuit. The leaves files and merkle roots from step 1 are inputs here:

```sh
# Sanction list (non-membership) -- used by SafeSwap and CleanMixer
cargo run --release -p regulator-cli -- new-compliance-definition \
  --circuit-dir ./circuits/non_membership \
  --name "Sanction List" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --regulator $PUBLIC_KEY \
  --merkle-root $SANCTION_MERKLE_ROOT \
  --leaves-file ./sanction_leaves.json

# Whitelist (membership) -- used by VerifiedLend
cargo run --release -p regulator-cli -- new-compliance-definition \
  --circuit-dir ./circuits/membership \
  --name "Whitelist" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --regulator $PUBLIC_KEY \
  --merkle-root $WHITELIST_MERKLE_ROOT \
  --leaves-file ./whitelist_leaves.json
```

Each command outputs a receipt with the deployed ComplianceDefinition address.

### 3. Deploy CompliantToken contracts

Deploy 3 token contracts using `forge create`. Each takes a ComplianceDefinition address, name, and symbol. Add `--verify` and `--etherscan-api-key` to verify the source code on Etherscan at deploy time:

```sh
cd contracts

# SafeSwap token
forge create src/CompliantToken.sol:CompliantToken \
  --broadcast \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $SANCTION_CD_ADDRESS "SafeSwap" "SAFE" \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# CleanMixer token
forge create src/CompliantToken.sol:CompliantToken \
  --broadcast \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $SANCTION_CD_ADDRESS "CleanMixer" "CMIX" \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY

# VerifiedLend token
forge create src/CompliantToken.sol:CompliantToken \
  --broadcast \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args $WHITELIST_CD_ADDRESS "VerifiedLend" "VLEND" \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

If you already deployed without `--verify`, you can verify after the fact:

```sh
forge verify-contract $TOKEN_ADDRESS \
  src/CompliantToken.sol:CompliantToken \
  --constructor-args $(cast abi-encode "constructor(address,string,string)" $CD_ADDRESS "SafeSwap" "SAFE") \
  --rpc-url $RPC_URL \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

## Configuration

Copy the env example and fill in the deployed addresses:

```sh
cp packages/demo/.env.example packages/demo/.env
```

Edit `packages/demo/.env`:

```env
VITE_RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
VITE_IPFS_GATEWAY_URL=http://localhost:8080
VITE_SANCTION_CD_ADDRESS=0x...    # ComplianceDefinition for sanction list
VITE_WHITELIST_CD_ADDRESS=0x...   # ComplianceDefinition for whitelist
VITE_TOKEN_1_ADDRESS=0x...        # SafeSwap token
VITE_TOKEN_2_ADDRESS=0x...        # CleanMixer token
VITE_TOKEN_3_ADDRESS=0x...        # VerifiedLend token
```

## Run

```sh
pnpm install
pnpm build          # Build SDK first, then all demos
pnpm dev:demo       # Start dev server (http://localhost:5173)
```

## Usage

### 1. Connect wallet

Click **Connect Wallet** in the header. MetaMask will prompt for account access. The connected address populates all 3 panels.

### 2. Generate a proof

Click **Generate Proof** on any panel. The flow:
1. Initializes WASM runtimes (first time only)
2. Fetches the active ComplianceDefinition from the contract
3. Downloads the compiled Noir circuit from IPFS
4. Fetches merkle tree leaves from IPFS
5. Computes merkle proofs and formats circuit inputs
6. Generates an UltraHonk proof (~30-60 seconds)
7. Caches the proof in memory

### 3. Proof reuse

After generating a proof for SafeSwap, click **Generate Proof** on CleanMixer. Because both apps use the same ComplianceDefinition, the cached proof is returned instantly with the status "Already generated!".

### 4. Mint tokens

After proof generation, the **Mint** button enables. Click it to:
1. Simulate the `mint(proof)` call on the token contract
2. Submit the transaction (MetaMask confirmation)
3. Wait for the transaction receipt
4. Display the updated token balance

## File structure

```
packages/demo/
├── .env.example         # Environment variable template
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript config
├── vite.config.ts       # Vite dev server config (COEP/COOP headers, WASM)
├── index.html           # Single-page layout with 3 panels
└── src/
    ├── main.ts          # Application logic (wallet, formatters, mint)
    ├── abi.ts           # CompliantToken ABI
    └── vite-env.d.ts    # Vite type shims

contracts/src/
├── CompliantToken.sol   # ERC-20 with compliance-gated mint
├── ComplianceDefinition.sol
└── IVerifier.sol
```

## How proof caching works

The SDK's `ProofManager` maintains an in-memory cache keyed by `<ComplianceDefinitionAddress>:<versionCount>`:

```
generateComplianceProof("0xAAA...", formatter)
  -> cache key: "0xaaa...:3"
  -> miss: generate proof, store in cache, return
  -> next call with same CD: hit, return cached proof
```

When the regulator publishes a new version (via `updateCircuit` or `updateParams`), the version count increments and old cached proofs are naturally invalidated.

## Browser requirements

Barretenberg uses `SharedArrayBuffer` for multi-threaded WASM proving. The Vite dev server sends the required headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If deploying to production, your hosting must also send these headers.
