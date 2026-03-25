# Proof Manager (`@ppc/sdk`)

The Proof Manager is a TypeScript SDK that lets browser-based applications generate and verify zero-knowledge compliance proofs. It orchestrates three steps: reading a compliance definition from an on-chain contract, fetching the corresponding Noir circuit from IPFS, and generating an UltraHonk proof that can be verified on-chain — all running client-side via WASM.

**Input formatting is the application's responsibility.** The SDK provides generic building blocks (chain reads, IPFS fetches, merkle utilities, proof generation) and an `InputFormatter` callback pattern that lets each application define how raw data is transformed into circuit inputs. This allows the SDK to support any circuit without modification.

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
  JSON-RPC     (Kubo gateway)   (acvm, noirc_abi,
                                 barretenberg)

┌─────────────────────────────────────────────────────┐
│                  Application Layer                  │
│                                                     │
│  Each app provides an InputFormatter callback that  │
│  transforms raw data into circuit-specific inputs.  │
│                                                     │
│  ┌──────────────────┐  ┌─────────────────────────┐  │
│  │ demo-membership  │  │ demo-non-membership     │  │
│  │                  │  │                          │  │
│  │ Fetches leaves,  │  │ Fetches leaves, finds   │  │
│  │ computes 1       │  │ sandwich leaves,         │  │
│  │ merkle proof     │  │ computes 2 merkle proofs │  │
│  └──────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Data flow

1. **Read contract** — `getActiveVersion()` calls the `ComplianceDefinition` contract via viem to get the active `ComplianceVersion` struct (verifier address, merkle root, IPFS metadata hash, leaves hash, validity window).
2. **Fetch circuit** — `fetchCircuit()` uses the metadata hash (an IPFS CID) to list the directory on a Kubo gateway, find the compiled `.json` artifact, and download it.
3. **Format inputs** — the application's `InputFormatter` callback receives the definition, circuit, and ProofManager, then fetches any additional data it needs (e.g. leaves from IPFS) and returns the circuit's `InputMap`.
4. **Generate proof** — `generateProof()` initializes the Barretenberg WASM backend, executes the Noir circuit to produce a witness, then generates an UltraHonk proof with `verifierTarget: "evm"`.
5. **Verify on-chain** (optional) — `verifyProof()` simulates then submits a transaction calling `ComplianceDefinition.verify(proof)` through the user's browser wallet.

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
    │                         #   ComplianceVersion, FormatterContext,
    │                         #   InputFormatter, ProofResult
    ├── ProofManager.ts       # Orchestrator class tying chain + IPFS + prove
    │                         #   Accepts InputFormatter for generateComplianceProof()
    ├── chain.ts              # getActiveVersion() — contract read via viem
    │                         # verifyProof() — simulate + submit verify tx
    ├── ipfs.ts               # fetchCircuit() — Kubo gateway, directory listing,
    │                         #   artifact download, validation
    │                         # fetchLeaves() — fetch merkle leaves JSON from IPFS
    ├── merkle.ts             # computeMerkleProof() — sparse Poseidon2 merkle tree
    │                         # computeMerkleProofForLeaf() — proof by leaf value
    ├── prove.ts              # generateProof() — Noir witness execution +
    │                         #   Barretenberg UltraHonk proof generation
    └── abi/
        └── ComplianceDefinition.ts
                              # Solidity ABI (getActiveVersion, verify, etc.)

packages/demo-membership/
├── package.json              # Demo app deps (SDK, Noir WASM, viem, Vite)
├── tsconfig.json             # TypeScript config
├── vite.config.ts            # Vite dev server — COEP/COOP headers for
│                             #   SharedArrayBuffer, WASM exclusions
├── index.html                # Single-page UI
└── src/
    ├── main.ts               # Membership formatter: fetches leaves, computes
    │                         #   one merkle inclusion proof, maps to circuit inputs
    └── vite-env.d.ts         # Vite type shims

packages/demo-non-membership/
├── package.json              # Same deps as demo-membership
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── main.ts               # Non-membership formatter: fetches leaves, finds
    │                         #   sandwich leaves, computes two merkle proofs
    └── vite-env.d.ts
```

## Key types

```typescript
interface ProofManagerConfig {
  rpcUrl: string;          // Ethereum JSON-RPC endpoint (e.g. Sepolia Infura)
  ipfsGatewayUrl: string;  // IPFS gateway URL (e.g. http://localhost:8080)
}

interface ComplianceVersion {
  verifier: `0x${string}`;    // On-chain verifier contract address
  merkleRoot: `0x${string}`;  // Merkle root of the compliance set
  tStart: bigint;              // Validity start block
  tEnd: bigint;                // Validity end block
  metadataHash: string;        // IPFS CID pointing to compiled circuit
  leavesHash: string;          // IPFS CID pointing to leaves JSON
}

interface ProofResult {
  proof: `0x${string}`;          // Hex-encoded proof bytes
  publicInputs: `0x${string}`[]; // Hex-encoded public inputs array
}

/** Context passed to an InputFormatter */
interface FormatterContext {
  definition: ComplianceVersion;  // Active compliance definition
  circuit: CompiledCircuit;       // Compiled Noir circuit (includes ABI)
  proofManager: ProofManager;     // For calling fetchLeaves(), etc.
}

/** User-provided function that builds circuit inputs from application data */
type InputFormatter = (ctx: FormatterContext) => Promise<InputMap>;
```

## Prerequisites

- **Node.js** >= 18
- **pnpm** (workspace manager)
- **IPFS node** — a running [Kubo](https://docs.ipfs.tech/install/command-line/) instance with the gateway exposed (default `http://localhost:8080`). CORS must be configured if the demo runs in a browser:
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
pnpm build      # Build SDK (tsup) then both demos (Vite)
```

To build only the SDK:

```sh
pnpm --filter @ppc/sdk build
```

## Run the demos

```sh
pnpm dev:membership        # Membership demo (http://localhost:5173)
pnpm dev:non-membership    # Non-membership demo (http://localhost:5173)
```

Both demos share the same UI layout: contract address, RPC URL, IPFS gateway, wallet connection, proof generation, and on-chain verification. They differ only in their `InputFormatter` implementation.

### Generate a proof

1. Enter a ComplianceDefinition contract address deployed on Sepolia.
2. Connect your wallet — your address is used as a public circuit input.
3. Click **Generate Proof**.
4. Wait 30–60 seconds for WASM initialization and proof generation.
5. The proof and public inputs appear in the output text areas.

### Verify on-chain

1. After proof generation, a green **Verify On-Chain** button appears.
2. Click it — MetaMask will prompt to confirm a transaction.
3. The SDK first simulates the `verify()` call to catch invalid proofs before spending gas.
4. On success, the transaction hash is displayed.

## Use the SDK programmatically

### With an InputFormatter (recommended)

```typescript
import { ProofManager, computeMerkleProofForLeaf, type InputFormatter } from "@ppc/sdk";

const pm = new ProofManager({
  rpcUrl: "https://sepolia.infura.io/v3/YOUR_KEY",
  ipfsGatewayUrl: "http://localhost:8080",
});

// Define how your circuit's inputs are built
const membershipFormatter: InputFormatter = async (ctx) => {
  const leaves = await ctx.proofManager.fetchLeaves(ctx.definition.leavesHash);
  const proof = computeMerkleProofForLeaf(leaves, BigInt(userAddress));
  return {
    address: userAddress,
    root: ctx.definition.merkleRoot,
    index: proof.index,
    hash_path: proof.hashPath,
  };
};

const result = await pm.generateComplianceProof(contractAddress, membershipFormatter);
console.log(result.proof);         // 0x...
console.log(result.publicInputs);  // [0x..., ...]
```

### Step-by-step

```typescript
import { ProofManager } from "@ppc/sdk";

const pm = new ProofManager({ rpcUrl, ipfsGatewayUrl });

// 1. Read contract
const version = await pm.getActiveDefinition(contractAddress);

// 2. Fetch circuit from IPFS
const circuit = await pm.fetchCircuit(version.metadataHash);

// 3. Build inputs (your logic here)
const inputs = { address: "0x...", root: version.merkleRoot, ... };

// 4. Generate proof
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
  getActiveVersion,          // Read contract directly (no ProofManager needed)
  fetchCircuit,              // Fetch from IPFS directly
  fetchLeaves,               // Fetch merkle leaves from IPFS
  computeMerkleProof,        // Compute merkle proof by leaf index
  computeMerkleProofForLeaf, // Compute merkle proof by leaf value
  generateProof,             // Generate proof from a CompiledCircuit + inputs
  verifyProof,               // Submit verify transaction on-chain
  ComplianceDefinitionABI,   // Raw Solidity ABI
} from "@ppc/sdk";
```

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@noir-lang/noir_js` | 1.0.0-beta.18 | Noir circuit execution (witness generation) |
| `@noir-lang/acvm_js` | 1.0.0-beta.18 | Arithmetic Circuit VM (WASM) |
| `@noir-lang/noirc_abi` | 1.0.0-beta.18 | Noir ABI encoding/decoding |
| `@aztec/bb.js` | 3.0.0-nightly | Barretenberg backend (UltraHonk proofs) |
| `@zkpassport/poseidon2` | ^0.6.2 | Poseidon2 hash for merkle tree computation |
| `viem` | ^2.0.0 | Ethereum JSON-RPC client |

## Testing

There are no automated tests yet. To verify the system manually:

1. **Build check** — `pnpm build` should complete with no errors for SDK and both demos.
2. **Contract read** — Run a demo, click Generate Proof, and confirm the status shows a verifier address from the contract.
3. **IPFS fetch** — Confirm the circuit is fetched (requires a running Kubo node with the circuit pinned).
4. **Proof generation** — Confirm proof hex and public inputs appear in the output.
5. **On-chain verification** — Click Verify On-Chain with a connected MetaMask on Sepolia and confirm the transaction succeeds.

## Browser requirements

Barretenberg uses `SharedArrayBuffer` for multi-threaded WASM proving. The dev server (Vite) is configured to send the required headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

If you deploy the demos, your hosting must also send these headers.

## Future Work

### Persistent Barretenberg instance

Currently, `prove.ts` creates a new `Barretenberg` API instance (`Barretenberg.new()`) and destroys it on every proof generation call. In the browser, Barretenberg initialization (loading and compiling the WASM module) takes several seconds. This means users pay the full init cost on every proof, even if they generate multiple proofs in the same session.

The `ProofManager` could instead hold a `Barretenberg` instance as a class field, initialized lazily on the first `prove()` call and reused for all subsequent calls. Since applications already create a single `ProofManager` per page, this would make the WASM init a one-time cost per browser session with no changes to application code.
