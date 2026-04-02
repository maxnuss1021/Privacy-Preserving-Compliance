# Benchmark Suite Implementation Plan

## Goal

Create a TypeScript CLI tool that benchmarks proof generation times for Noir circuits.
Currently supports `membership` and `non_membership` circuits (which only need merkle data).
Designed to accommodate future circuits that may require on-chain data fetching.

## Architecture

### Package Location

`packages/benchmark/` — a new pnpm workspace member.

### Dependencies

- `@noir-lang/noir_js` (1.0.0-beta.18) — circuit witness execution
- `@noir-lang/acvm_js` (1.0.0-beta.18) — ACVM WASM init
- `@noir-lang/noirc_abi` (1.0.0-beta.18) — ABI WASM init
- `@aztec/bb.js` (3.0.0-nightly.20260106) — Barretenberg proof generation
- `@zkpassport/poseidon2` (^0.6.2) — Poseidon2 hashing for merkle trees
- `@ppc/sdk` (workspace:*) — reuse `computeMerkleProof`, `computeMerkleProofForLeaf`, `MerkleProof` types

All versions match the existing SDK to avoid version conflicts.

### CLI Interface

```
pnpm bench --circuit <circuit_name> --runs <N> [--leaves <count>] [--skip-compile]
```

- `--circuit` (required): Circuit identifier (`membership` or `non_membership`)
- `--runs` (required): Number of benchmark iterations
- `--leaves` (optional, default: 10): Number of leaves in the test merkle tree
- `--skip-compile` (optional): Skip `nargo compile` and use existing artifacts

### Output

Results go to `benchmark-data/` at the project root (gitignored).
Each run produces a timestamped JSON file:

```
benchmark-data/membership-20260318T120000.json
benchmark-data/non_membership-20260318T120530.json
```

#### Output Schema

```json
{
  "circuit": "membership",
  "timestamp": "2026-03-18T12:00:00.000Z",
  "config": {
    "runs": 5,
    "leaves": 10
  },
  "system": {
    "platform": "linux",
    "arch": "x64",
    "nodeVersion": "v22.x.x"
  },
  "barretenbergInitMs": 2300,
  "results": [
    {
      "run": 1,
      "witnessGenerationMs": 1234,
      "proofGenerationMs": 5678,
      "totalMs": 6912
    }
  ],
  "aggregate": {
    "witnessGeneration": { "mean": 1200, "min": 1100, "max": 1400, "stddev": 80 },
    "proofGeneration": { "mean": 5600, "min": 5400, "max": 5800, "stddev": 120 },
    "total": { "mean": 6800, "min": 6500, "max": 7200, "stddev": 190 }
  }
}
```

---

## Implementation Steps

### Step 1: Project Setup

Create `packages/benchmark/` with:

1. `package.json` — name `@ppc/benchmark`, type `module`, deps matching SDK versions, scripts: `"bench": "tsx src/index.ts"`
2. `tsconfig.json` — ES2022, bundler resolution, strict mode (match SDK config)
3. Add `"packages/benchmark"` to root `pnpm-workspace.yaml` if it exists, or verify pnpm workspace glob already covers it
4. Add `"bench": "pnpm --filter @ppc/benchmark bench"` script to root `package.json`
5. Add `benchmark-data/` to root `.gitignore`

### Step 2: Circuit Registry (`src/circuits.ts`)

A registry mapping circuit names to their configuration. Each entry defines:

```ts
interface CircuitConfig {
  /** Circuit identifier matching the Nargo package name */
  name: string;
  /** Path to the compiled circuit JSON, relative to project root */
  artifactPath: string;
  /** Generate test inputs for benchmarking (no on-chain data needed) */
  generateInputs: (leaves: bigint[], address: bigint) => InputMap;
  /** Generate a set of test leaves for this circuit */
  generateTestData: (leafCount: number) => { leaves: bigint[]; address: bigint };
}
```

**Why this pattern matters for future circuits:**
Future circuits that need on-chain data can extend `generateInputs` to accept additional context (e.g., fetched events). The registry pattern means adding a new circuit is just adding a new entry — no changes to the benchmark runner itself.

Implement two entries:

#### `membership`
- `artifactPath`: `circuits/membership/target/membership.json`
- `generateTestData`: Create `leafCount` random addresses, pick one as the test address
- `generateInputs`: Use SDK's `computeMerkleProofForLeaf` to compute the merkle proof, then format as `{ address, root, index, hash_path }`

#### `non_membership`
- `artifactPath`: `circuits/non_membership/target/non_membership.json`
- `generateTestData`: Create `leafCount` sorted random addresses, pick a value NOT in the set as the test address
- `generateInputs`: Determine proof type (sandwich/below-min/above-max), compute merkle proofs, format as `{ address, root, lower_leaf, upper_leaf, lower_index, upper_index, lower_hash_path, upper_hash_path, proof_type }`
  - Use the sandwich proof type since it exercises both merkle paths
  - Reuse the same logic as `packages/demo-non-membership/src/main.ts` (the `nonMembershipFormatter`)

### Step 3: Benchmark Runner (`src/bench.ts`)

The core benchmarking logic:

```ts
interface BenchResult {
  run: number;
  witnessGenerationMs: number;
  proofGenerationMs: number;
  totalMs: number;
}

async function runBenchmark(
  circuit: CompiledCircuit,
  inputs: InputMap,
  runs: number,
): Promise<BenchResult[]>
```

**Implementation details:**

1. Initialize Barretenberg once, reuse across all runs (avoid measuring init overhead)
2. For each run:
   a. Start total timer (`performance.now()`)
   b. Create `Noir` instance, call `noir.execute(inputs)` — time this as witness generation
   c. Create `UltraHonkBackend`, call `backend.generateProof(witness)` — time this as proof generation
   d. Record total time
   e. Destroy the backend between runs to avoid state leakage, but keep the Barretenberg API instance alive
3. Optionally run one warmup iteration (not counted) to JIT-warm the WASM
4. Return array of `BenchResult`

**Splitting witness vs proof generation:**
The SDK's `prove.ts` bundles both into one call. The benchmark needs them split:
- Witness generation: `new Noir(circuit).execute(inputs)` — this compiles and executes the ACIR
- Proof generation: `new UltraHonkBackend(bytecode, api).generateProof(witness, { verifierTarget: "evm" })` — this runs the cryptographic prover

### Step 4: Stats and Output (`src/stats.ts`, `src/output.ts`)

#### `stats.ts`
- `computeStats(values: number[]): { mean, min, max, stddev }`
- Simple math, no external deps needed

#### `output.ts`
- `writeResult(data: BenchmarkOutput): void`
- Writes JSON to `benchmark-data/<circuit>-<ISO_TIMESTAMP>.json`
- Creates `benchmark-data/` directory if it doesn't exist
- Collects system info: `process.platform`, `process.arch`, `process.version`

### Step 5: CLI Entry Point (`src/index.ts`)

Parse CLI args (use simple manual parsing like `build-merkle/index.ts` to avoid adding clap/yargs deps):

1. Parse `--circuit`, `--runs`, `--leaves`, `--skip-compile` from `process.argv`
2. Validate circuit name exists in registry
3. Compile the circuit via `compileCircuit(config.projectDir)` (unless `--skip-compile`)
4. Init WASM (`initACVM()`, `initNoirC()`)
5. Load compiled circuit JSON from `artifactPath`
6. Generate test data via circuit config's `generateTestData(leafCount)`
7. Generate inputs via circuit config's `generateInputs(leaves, address)`
8. Run benchmark via `runBenchmark(circuit, inputs, runs)`
9. Compute aggregate stats
10. Write output file
11. Print summary table to stdout

**stdout output example:**
```
Benchmarking: membership (10 leaves, 5 runs)

  Run 1: witness=1.2s  proof=5.6s  total=6.8s
  Run 2: witness=1.1s  proof=5.4s  total=6.5s
  Run 3: witness=1.3s  proof=5.8s  total=7.1s
  Run 4: witness=1.2s  proof=5.5s  total=6.7s
  Run 5: witness=1.1s  proof=5.3s  total=6.4s

  Aggregate (5 runs):
    Witness:  mean=1.18s  min=1.1s  max=1.3s  stddev=0.08s
    Proof:    mean=5.52s  min=5.3s  max=5.8s  stddev=0.19s
    Total:    mean=6.70s  min=6.4s  max=7.1s  stddev=0.27s

Results saved to benchmark-data/membership-20260318T120000.json
```

### Step 6: Compile Circuit Before Benchmarking (`src/compile.ts`)

The benchmark automatically recompiles the circuit before each benchmark run to ensure artifacts are up to date.

```ts
async function compileCircuit(circuitDir: string): Promise<void>
```

**Implementation details:**

1. Resolve the circuit's Nargo project directory from the `CircuitConfig` (e.g., `circuits/membership/`)
2. Run `nargo compile` in that directory using `child_process.execSync` (or `execFileSync`)
3. Stream stdout/stderr so the user sees compilation progress
4. If compilation fails (non-zero exit code), throw with the nargo error output and abort the benchmark
5. Log a message: `Compiling circuit: membership...` / `Compilation complete.`

**CircuitConfig gains a new field:**
```ts
interface CircuitConfig {
  // ... existing fields ...
  /** Path to the Nargo project directory (contains Nargo.toml) */
  projectDir: string;
}
```

- `membership`: `projectDir: "circuits/membership"`
- `non_membership`: `projectDir: "circuits/non_membership"`

The compilation step runs in Step 5 (CLI entry point) after arg parsing but before loading the artifact JSON. This guarantees the artifact matches the current circuit source code.

**Adding `--skip-compile` flag:**
For repeated runs where the circuit hasn't changed, the user can pass `--skip-compile` to skip recompilation and use the existing artifact. In this case the benchmark checks that the artifact file exists and errors if not.

---

## File Tree (final state)

```
packages/benchmark/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts          # CLI entry point
    ├── circuits.ts       # Circuit registry (membership, non_membership configs)
    ├── compile.ts        # nargo compile wrapper
    ├── bench.ts          # Benchmark runner (witness + proof timing)
    ├── stats.ts          # Statistical computations (mean, min, max, stddev)
    └── output.ts         # Result serialization and file writing
```

---

## Future Extension Points

### Adding a new circuit that needs on-chain data

1. Add a new entry to the circuit registry in `circuits.ts`
2. Extend `CircuitConfig` if needed with an optional `fetchOnChainData` method:
   ```ts
   interface CircuitConfig {
     // ... existing fields ...
     /** Optional: fetch on-chain data needed for input generation */
     fetchOnChainData?: (rpcUrl: string) => Promise<unknown>;
   }
   ```
3. Add optional `--rpc-url` CLI flag that's required only when the selected circuit needs on-chain data
4. The benchmark runner passes fetched data to `generateInputs`

### Adding leaf count sweeps

A future enhancement could run the benchmark across multiple leaf counts to produce a performance curve:
```
pnpm bench --circuit membership --runs 5 --leaves 10,100,1000
```

This would produce one output file with results grouped by leaf count.

### Browser-based benchmarking

The current benchmark runs in Node.js. Since the end application is browser-based, a browser benchmark harness would capture real-world performance more accurately. Node.js and Chrome share V8, so proving times should be similar for Chrome users. However, differences may arise from:

- **Threading model** — Node.js `worker_threads` vs browser Web Workers + SharedArrayBuffer
- **Memory constraints** — browsers have tighter WASM memory limits and compete with the DOM
- **Cross-browser variance** — Firefox (SpiderMonkey) and Safari (JavaScriptCore) have different WASM engines and may show meaningfully different proving times

A browser harness could use a minimal Vite page (similar to the existing demos) that runs the proving loop and posts results back via `postMessage` or writes them to a download. This would also capture the `initACVM()`/`initNoirC()` WASM bootstrap cost, which the Node.js benchmark skips since those modules auto-initialize in Node.

---

## Assumptions

- Node.js >= 20 (for top-level await, `performance.now()`, native fetch)
- `nargo` is installed and available on PATH (used for automatic circuit compilation)
- The benchmark runs in Node.js, not the browser (SharedArrayBuffer available by default in Node)
- tsx is used to run TypeScript directly (matches build-merkle pattern)
