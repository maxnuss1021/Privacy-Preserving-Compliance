# Proof Manager (`@ppc/sdk`)

The Proof Manager is a TypeScript SDK that lets browser-based applications generate and verify zero-knowledge compliance proofs. It orchestrates three steps: reading a compliance definition from an on-chain contract, fetching the corresponding Noir circuit from IPFS, and generating an UltraHonk proof that can be verified on-chain — all running client-side via WASM.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   ProofManager                      │
│            (orchestrator / public API)              │
├────────────┬────────────────┬───────────────────────┤
│  chain.ts  │    ipfs.ts     │       prove.ts        │
│  (viem)    │ (fetch API)    │ (Noir.js + bb.js)     │
│            │                │                       │
│ Read the   │ Fetch compiled │ Execute circuit,      │
│ contract,  │ Noir circuit   │ generate UltraHonk    │
│ submit     │ artifact from  │ proof targeting EVM   │
│ verify tx  │ IPFS (Kubo)    │                       │
└─────┬──────┴───────┬────────┴──────────┬────────────┘
      │              │                   │
  Ethereum       IPFS Node        WASM runtimes
  JSON-RPC      (Kubo API)      (acvm, noirc_abi,
                                 barretenberg)
```

### Data flow

1. **Read contract** — `getActiveVersion()` calls the `ComplianceDefinition` contract via viem to get the active `ComplianceVersion` struct (verifier address, params root, IPFS metadata hash, validity window).
2. **Fetch circuit** — `fetchCircuit()` uses the metadata hash (an IPFS CID) to list the directory on a Kubo node, find the compiled `.json` artifact, and download it.
3. **Generate proof** — `generateProof()` initializes the Barretenberg WASM backend, executes the Noir circuit to produce a witness, then generates an UltraHonk proof with `verifierTarget: "evm"`.
4. **Verify on-chain** (optional) — `verifyProof()` simulates then submits a transaction calling `ComplianceDefinition.verify(proof, publicInputs)` through the user's browser wallet.

## File tree

```
packages/sdk/
├── package.json              # Package config, dependencies
├── tsconfig.json             # TypeScript compiler options (ES2022, strict)
├── tsup.config.ts            # Bundler config — ESM + CJS dual output
├── dist/                     # Build output (generated)
│   ├── index.js              #   ESM bundle
│   ├── index.cjs             #   CommonJS bundle
│   ├── index.d.ts            #   Type declarations
│   └── *.map                 #   Source maps
└── src/
    ├── index.ts              # Barrel exports — public API surface
    ├── types.ts              # Core interfaces: ProofManagerConfig,
    │                         #   ComplianceVersion, ProofInputs, ProofResult
    ├── ProofManager.ts       # Orchestrator class tying chain + IPFS + prove
    ├── chain.ts              # getActiveVersion() — contract read via viem
    │                         # verifyProof() — simulate + submit verify tx
    ├── ipfs.ts               # fetchCircuit() — Kubo RPC, directory listing,
    │                         #   artifact download, validation
    ├── prove.ts              # generateProof() — Noir witness execution +
    │                         #   Barretenberg UltraHonk proof generation
    └── abi/
        └── ComplianceDefinition.ts
                              # Solidity ABI (getActiveVersion, verify, etc.)

packages/demo/
├── package.json              # Demo app deps (SDK, Noir WASM, viem, Vite)
├── tsconfig.json             # TypeScript config
├── vite.config.ts            # Vite dev server — COEP/COOP headers for
│                             #   SharedArrayBuffer, WASM exclusions
├── index.html                # Single-page UI with input fields, proof
│                             #   output areas, verify button
└── src/
    ├── main.ts               # App logic — wires UI to SDK, handles wallet
    │                         #   connection and on-chain verification
    └── vite-env.d.ts         # Vite type shims
```

## Key types

```typescript
interface ProofManagerConfig {
  rpcUrl: string;    // Ethereum JSON-RPC endpoint (e.g. Sepolia Infura)
  ipfsUrl: string;   // Kubo RPC API URL (e.g. http://localhost:5001)
}

interface ProofResult {
  proof: `0x${string}`;          // Hex-encoded proof bytes
  publicInputs: `0x${string}`[]; // Hex-encoded public inputs array
}

interface ComplianceVersion {
  verifier: `0x${string}`;    // On-chain verifier contract address
  paramsRoot: `0x${string}`;  // Merkle root of compliance parameters
  tStart: bigint;              // Validity start block
  tEnd: bigint;                // Validity end block
  metadataHash: string;        // IPFS CID pointing to compiled circuit
}
```

## Prerequisites

- **Node.js** >= 18
- **pnpm** (workspace manager)
- **IPFS node** — a running [Kubo](https://docs.ipfs.tech/install/command-line/) instance with the RPC API exposed (default `http://localhost:5001`). CORS must be configured if the demo runs in a browser:
  ```sh
  ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
  ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'
  ```
- **Ethereum RPC** — an endpoint for Sepolia (e.g. Infura, Alchemy)
- **Browser wallet** — MetaMask or compatible injected wallet (only needed for on-chain verification)

## Build

From the repository root:

```sh
pnpm install    # Install all workspace dependencies
pnpm build      # Build SDK (tsup) then demo (Vite)
```

To build only the SDK:

```sh
pnpm --filter @ppc/sdk build
```

## Run the demo

```sh
pnpm dev        # Starts Vite dev server (typically http://localhost:5173)
```

The demo UI provides fields for:

| Field | Description | Default |
|-------|-------------|---------|
| ComplianceDefinition Address | Deployed contract on Sepolia | `0x3e05...961a` |
| RPC URL | Ethereum JSON-RPC endpoint | Sepolia Infura |
| IPFS URL | Kubo RPC API URL | `http://localhost:5001` |
| User Address | Optional — auto-fills the `address` circuit input | — |

### Generate a proof

1. Fill in the fields (defaults work for the deployed hello_world circuit).
2. Click **Generate Proof**.
3. The app will prompt for any circuit inputs not covered by the User Address field.
4. Wait 30–60 seconds for WASM initialization and proof generation.
5. The proof and public inputs appear in the output text areas.

### Verify on-chain

1. After proof generation, a green **Verify On-Chain** button appears.
2. Click it — MetaMask will prompt to connect and then to confirm a transaction.
3. The SDK first simulates the `verify()` call to catch invalid proofs before spending gas.
4. On success, the transaction hash is displayed.

## Use the SDK programmatically

### End-to-end (recommended)

```typescript
import { ProofManager } from "@ppc/sdk";

const pm = new ProofManager({
  rpcUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
  ipfsUrl: "http://localhost:5001",
});

const result = await pm.generateComplianceProof(
  "0x3e05D540B05F6379A11F3ed61B2065C01e22961a",
  { address: "0xYourAddress", secret: "42" },
);

console.log(result.proof);         // 0x...
console.log(result.publicInputs);  // [0x..., ...]
```

### Step-by-step

```typescript
import { ProofManager } from "@ppc/sdk";

const pm = new ProofManager({ rpcUrl, ipfsUrl });

// 1. Read contract
const version = await pm.getActiveDefinition(contractAddress);

// 2. Fetch circuit from IPFS
const circuit = await pm.fetchCircuit(version.metadataHash);

// 3. Generate proof
const result = await pm.prove(circuit, inputs);
```

### On-chain verification

```typescript
import { verifyProof } from "@ppc/sdk";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { sepolia } from "viem/chains";

const walletClient = createWalletClient({
  account: "0xYourAddress",
  chain: sepolia,
  transport: custom(window.ethereum),
});

const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

const { txHash } = await verifyProof(
  walletClient,
  publicClient,
  contractAddress,
  proofResult,
);
```

### Individual functions

Every internal module is also exported for advanced use:

```typescript
import {
  getActiveVersion,   // Read contract directly (no ProofManager needed)
  fetchCircuit,       // Fetch from IPFS directly
  generateProof,      // Generate proof from a CompiledCircuit + inputs
  verifyProof,        // Submit verify transaction on-chain
  ComplianceDefinitionABI,  // Raw Solidity ABI
} from "@ppc/sdk";
```

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@noir-lang/noir_js` | 1.0.0-beta.18 | Noir circuit execution (witness generation) |
| `@noir-lang/acvm_js` | 1.0.0-beta.18 | Arithmetic Circuit VM (WASM) |
| `@noir-lang/noirc_abi` | 1.0.0-beta.18 | Noir ABI encoding/decoding |
| `@aztec/bb.js` | 3.0.0-nightly | Barretenberg backend (UltraHonk proofs) |
| `viem` | ^2.0.0 | Ethereum JSON-RPC client |

## Testing

There are no automated tests yet. To verify the system manually:

1. **Build check** — `pnpm build` should complete with no errors for both SDK and demo.
2. **Contract read** — Run the demo, click Generate Proof, and confirm the status shows a verifier address from the contract.
3. **IPFS fetch** — Confirm the circuit is fetched (requires a running Kubo node with the circuit pinned).
4. **Proof generation** — Confirm proof hex and public inputs appear in the output.
5. **On-chain verification** — Click Verify On-Chain with a connected MetaMask on Sepolia and confirm the transaction succeeds.

## Browser requirements

Barretenberg uses `SharedArrayBuffer` for multi-threaded WASM proving. The dev server (Vite) is configured to send the required headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If you deploy the demo, your hosting must also send these headers.
