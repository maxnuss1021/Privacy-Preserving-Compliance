# Unified Demo Plan

## Overview

A single-page application with 3 side-by-side "app" panels, demonstrating how different applications integrate the privacy-preserving compliance framework. Each app is backed by its own ERC-20 token contract that requires a valid compliance proof before minting tokens to the caller.

### Demo apps

| Panel | Name | Color | ComplianceDefinition | Circuit |
|-------|------|-------|---------------------|---------|
| 1 | SafeSwap | Red | Sanction list (shared w/ App 2) | non_membership |
| 2 | CleanMixer | Green | Sanction list (shared w/ App 1) | non_membership |
| 3 | VerifiedLend | Blue | Whitelist | membership |

Apps 1 and 2 share the same ComplianceDefinition (non-membership / sanction list), so a proof generated for one is valid for the other. The SDK caches proofs by `<ComplianceDefinitionAddress>:<versionCount>`, so the user only pays the 30-60s proof generation cost once for both.

### Architecture

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

     [Single ProofManager instance with in-memory proof cache]
```

### Key proof reuse flow

```
User clicks "Generate Proof" on SafeSwap (App 1):
  1. ProofManager checks cache for key "0xAAA:3" (address:versionCount) -- miss
  2. Fetches definition, circuit, leaves from IPFS
  3. Generates proof (~30-60s)
  4. Caches result under "0xAAA:3"
  5. Returns proof -> App 1 enables "Mint" button

User clicks "Generate Proof" on CleanMixer (App 2):
  1. ProofManager checks cache for key "0xAAA:3" -- HIT
  2. Returns cached proof instantly
  3. App 2 enables "Mint" button
```

### Environment variables

All configurable via `.env` (Vite `VITE_` prefix):

| Variable | Description |
|----------|-------------|
| `VITE_RPC_URL` | Sepolia JSON-RPC endpoint |
| `VITE_IPFS_GATEWAY_URL` | IPFS gateway (e.g., `http://localhost:8080`) |
| `VITE_SANCTION_CD_ADDRESS` | ComplianceDefinition address for non-membership (Apps 1+2) |
| `VITE_WHITELIST_CD_ADDRESS` | ComplianceDefinition address for membership (App 3) |
| `VITE_TOKEN_1_ADDRESS` | SafeSwap token contract address |
| `VITE_TOKEN_2_ADDRESS` | CleanMixer token contract address |
| `VITE_TOKEN_3_ADDRESS` | VerifiedLend token contract address |

---

## Steps

### Step 1: Write CompliantToken.sol

**Goal:** A minimal ERC-20 that gates minting behind a compliance proof.

**Location:** `contracts/src/CompliantToken.sol`

**Contract design:**
- Inherits from a minimal ERC-20 implementation (write inline -- no OpenZeppelin dependency since the Foundry project doesn't have it)
- Constructor: `constructor(address _complianceDefinition, string memory _name, string memory _symbol)`
- Storage: `address public complianceDefinition`
- Single entrypoint: `mint(bytes calldata proof) external`
  - Calls `ComplianceDefinition(complianceDefinition).verify(proof)` which returns bool
  - Reverts if false: `require(success, "Compliance check failed")`
  - Mints exactly 1e18 (1 token with 18 decimals) to `msg.sender`
- Need a small interface `IComplianceDefinition` with `function verify(bytes calldata proof) external returns (bool)`
- Standard ERC-20 view functions: `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `transfer`, `approve`, `allowance`, `transferFrom`

**Tests:** `contracts/test/CompliantToken.t.sol`
- Test mint succeeds with MockVerifier (always returns true)
- Test mint reverts with MockFailVerifier (always returns false)
- Test minted amount is 1e18
- Test balanceOf updates correctly
- Test ERC-20 transfer works after minting

**Files to create:**
- `contracts/src/CompliantToken.sol`
- `contracts/test/CompliantToken.t.sol`

**Files to modify:** None

---

### Step 2: Add proof caching to ProofManager SDK

**Goal:** ProofManager caches generated proofs in-memory so that two apps using the same ComplianceDefinition skip redundant proof generation.

**Cache key format:** `${complianceDefinitionAddress.toLowerCase()}:${versionCount}`

- `versionCount` (from `getVersionCount()`) acts as a cache-buster: when the regulator publishes a new version (updateCircuit or updateParams), versionCount increments and old cached proofs are naturally invalidated.

**Changes to `packages/sdk/src/chain.ts`:**
- Add `getVersionCount(rpcUrl, contractAddress)` function that reads `getVersionCount()` from the contract (ABI entry already exists)

**Changes to `packages/sdk/src/ProofManager.ts`:**
- Add `private proofCache = new Map<string, ProofResult>()`
- Add public method `getVersionCount(contractAddress)` that calls chain.getVersionCount
- Modify `generateComplianceProof()`:
  ```
  1. Fetch versionCount from contract
  2. Build cache key: `${contractAddress.toLowerCase()}:${versionCount}`
  3. If cache has key, return cached ProofResult
  4. Otherwise: fetch definition, fetch circuit, format inputs, generate proof
  5. Store result in cache under key
  6. Return result
  ```
- Add public method `getCachedProof(contractAddress, versionCount?)` for manual cache lookups
- Add public method `clearProofCache()` to clear all cached proofs

**Changes to `packages/sdk/src/index.ts`:**
- Export `getVersionCount` from chain

**Files to modify:**
- `packages/sdk/src/chain.ts`
- `packages/sdk/src/ProofManager.ts`
- `packages/sdk/src/index.ts`

---

### Step 3: Create the unified demo package

**Goal:** New Vite app at `packages/demo/` with proper config.

**New files:**
- `packages/demo/package.json` -- deps: `@ppc/sdk`, `viem`, `@noir-lang/acvm_js`, `@noir-lang/noirc_abi`, Vite, TS
- `packages/demo/tsconfig.json`
- `packages/demo/vite.config.ts` -- COEP/COOP headers, node polyfills, WASM exclusions (same pattern as existing demos)
- `packages/demo/.env.example` -- all 7 env vars with placeholder values
- `packages/demo/src/vite-env.d.ts`

**Changes to root `package.json`:**
- Add script: `"dev:demo": "pnpm --filter @ppc/demo dev"`

---

### Step 4: Build the HTML layout

**Goal:** Single page with dark theme, header explanation area, and 3 side-by-side app panels matching the wireframe.

**File:** `packages/demo/index.html`

**Layout (from wireframe):**
```
+------------------------------------------------------------------+
|         Background explanation and information on demo            |
+------------------------------------------------------------------+
|                                                                    |
|  +--[red]--------+  +--[green]------+  +--[blue]--------+        |
|  | SafeSwap      |  | CleanMixer    |  | VerifiedLend      |        |
|  |               |  |               |  |                |        |
|  | [address/     |  | [address/     |  | [address/      |        |
|  |  wallet]      |  |  wallet]      |  |  wallet]       |        |
|  |               |  |               |  |                |        |
|  | [compliance   |  | [compliance   |  | [compliance    |        |
|  |  info]        |  |  info]        |  |  info]         |        |
|  |               |  |               |  |                |        |
|  | [generate     |  | [generate     |  | [generate      |        |
|  |  proof]       |  |  proof]       |  |  proof]        |        |
|  |               |  |               |  |                |        |
|  | [mint]        |  | [mint]        |  | [mint]         |        |
|  +---------------+  +---------------+  +----------------+        |
+------------------------------------------------------------------+
```

**Design:**
- Dark background (`#0a0a0a` or similar)
- Header section: brief explanation of the demo, what the 3 apps are, and how proof reuse works
- 3 panels in a CSS Grid or flexbox row
- Each panel has a colored border (red `#ef4444`, green `#22c55e`, blue `#3b82f6`)
- Panel sections separated by inner boxes with slightly lighter backgrounds
- Each panel contains:
  1. **App name + description** (token address)
  2. **Wallet section** -- shared wallet connection (connect once, all 3 use it), display address
  3. **Compliance info** -- auto-fetched: definition name, merkle root (truncated), ComplianceDefinition address
  4. **Generate proof button** -- status text below, shows "Already generated!" when proof is reused
  5. **Mint button** -- disabled until proof exists, calls token contract, shows tx hash + updated balance
- Wallet connection is shared: one "Connect Wallet" button in the header area, all 3 panels read from it

---

### Step 5: Build the demo application logic

**File:** `packages/demo/src/main.ts`

**Structure:**

```typescript
// 1. WASM init (same as existing demos)
// 2. Read env vars for addresses
// 3. Single ProofManager instance (shared across all 3 panels)
// 4. Single wallet connection (shared)
// 5. Per-panel state: proofResult, balance, status

// Panel config array:
const panels = [
  {
    id: "app1",
    name: "SafeSwap",
    color: "red",
    cdAddress: VITE_SANCTION_CD_ADDRESS,
    tokenAddress: VITE_TOKEN_1_ADDRESS,
    type: "non-membership",
  },
  {
    id: "app2",
    name: "CleanMixer",
    color: "green",
    cdAddress: VITE_SANCTION_CD_ADDRESS,   // same CD as app1
    tokenAddress: VITE_TOKEN_2_ADDRESS,
    type: "non-membership",
  },
  {
    id: "app3",
    name: "VerifiedLend",
    color: "blue",
    cdAddress: VITE_WHITELIST_CD_ADDRESS,
    tokenAddress: VITE_TOKEN_3_ADDRESS,
    type: "membership",
  },
];
```

**InputFormatter functions (defined in the demo, not in the SDK):**
- `nonMembershipFormatter` -- same logic as existing `demo-non-membership/src/main.ts` (3 proof types: sandwich, below-min, above-max)
- `membershipFormatter` -- same logic as existing `demo-membership/src/main.ts` (single merkle inclusion proof)
- Each panel picks the correct formatter based on its `type`

**Token interaction (defined in the demo, not in the SDK):**
- CompliantToken ABI defined locally in the demo (e.g., `packages/demo/src/abi.ts`)
- `mintWithProof()` helper function in the demo that calls the token contract's `mint(proof)` via viem
- `getTokenBalance()` helper that reads `balanceOf` via viem
- These are demo-specific concerns and do not belong in the generic SDK

**Generate proof flow per panel:**
1. User clicks "Generate Proof" on panel N
2. Call `pm.generateComplianceProof(cdAddress, formatter)`
   - SDK checks cache internally -- if Apps 1+2 share the same CD, the second call returns instantly
3. Display proof status: "Generating proof..." or "Already generated!"
4. Store proofResult in panel state
5. Enable Mint button

**Mint flow per panel:**
1. User clicks "Mint" on panel N
2. Call demo-local `mintWithProof(walletClient, publicClient, tokenAddress, proofResult)` using viem directly
3. Display status: "Submitting tx..." -> "Minted! tx: 0x..."
4. Refresh and display token balance

---

### Step 6: Test and verify

**Solidity tests:**
```sh
cd contracts && forge test
```
- CompliantToken.t.sol tests pass

**SDK build:**
```sh
pnpm --filter @ppc/sdk build
```
- No type errors, exports are correct

**Demo dev server:**
```sh
pnpm dev:demo
```
- Page loads with 3 panels
- Wallet connects
- Compliance info auto-populates
- Proof generation works for all 3 panels
- Proof reuse works (App 2 is instant after App 1)
- Mint works on all 3 panels

---

## File change summary

### New files
| File | Description |
|------|-------------|
| `contracts/src/CompliantToken.sol` | ERC-20 with compliance-gated mint |
| `contracts/test/CompliantToken.t.sol` | Forge tests for CompliantToken |
| `packages/demo/package.json` | Unified demo package config |
| `packages/demo/tsconfig.json` | TypeScript config |
| `packages/demo/vite.config.ts` | Vite config with WASM headers |
| `packages/demo/index.html` | Single-page layout with 3 panels |
| `packages/demo/src/main.ts` | Demo application logic |
| `packages/demo/src/abi.ts` | CompliantToken ABI (demo-local, not in SDK) |
| `packages/demo/src/vite-env.d.ts` | Vite type shims |
| `packages/demo/.env.example` | Environment variable template |

### Modified files
| File | Change |
|------|--------|
| `packages/sdk/src/chain.ts` | Add `getVersionCount` |
| `packages/sdk/src/ProofManager.ts` | Add proof cache, modify `generateComplianceProof` |
| `packages/sdk/src/index.ts` | Export `getVersionCount` |
| `package.json` (root) | Add `dev:demo` script |

### Unchanged
- `packages/demo-membership/` -- kept as standalone example
- `packages/demo-non-membership/` -- kept as standalone example
- SDK has no token-specific code -- all CompliantToken interaction lives in the demo

---

## Execution order

1. **Step 1** -- CompliantToken contract + tests (standalone, no SDK dependency)
2. **Step 2** -- SDK proof caching (standalone SDK change, testable in isolation)
3. **Step 3** -- Demo package scaffolding (depends on Step 2 for SDK API)
4. **Step 4** -- HTML layout (independent of logic, can be done alongside Step 3)
5. **Step 5** -- Demo application logic (depends on Steps 3+4)
6. **Step 6** -- Integration testing (depends on all previous steps)
