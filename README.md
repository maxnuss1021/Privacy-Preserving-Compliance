# Privacy-Preserving-Compliance
Prototype implementation of masters thesis framework `Privacy Preserving Compliance`.  The current draft of my thesis can be found at [https://github.com/JossDuff/thesis](https://github.com/JossDuff/thesis).

This code is for demonstration purposes only.  It is not audited and should not be used in production environments.

## Framework Overview

This repository contains the implementation of a framework for composable privacy preserving compliance on blockchain systems. The framework enables regulatory bodies to publish compliance definitions, applications to require compliance proofs, and users to prove compliance without revealing private transaction data.

This framework is distinguished by its composability and generality, designed explicitly for a global ecosystem with many regulatory bodies whose requirements evolve over time.  Compliance definitions are chain-agnostic, modular with respect to privacy mechanisms, versioned to accommodate regulatory updates, and can be combined arbitrarily which allows applications to satisfy multiple jurisdictions simultaneously.

### General framework diagram
This is the general interaction between actors in this framework, not specific to this implementation.
![High level framework diagram](thesis-impl-broad.png)

### Framework implementation diagram
The specific implementation of the framework that this repository holds.
![Repo specific framework implementation diagram](thesis-impl.png)

### Key Features

- **No Deanonymization**: Users prove compliance without revealing transaction histories or balances
- **Proactive Compliance**: Non-compliant actors are blocked before transactions, not detected after
- **Rich Compliance Language**: Express complex requirements logically over on-chain data
- **Multiple Compliance**: Support for requirements from multiple regulatory jurisdictions
- **Chain Agnostic**: Works on any blockchain with smart contracts and ZK proof verification
- **Modular Privacy**: Compatible with any privacy protocol

---

## Framework Actors

The framework supports three types of actors:

1. **Regulators**: Create and publish compliance definitions
2. **Applications**: Select relevant compliance definitions and require proofs from users
3. **Users**: Generate ZK proofs demonstrating compliance without revealing private data

### System Components
```
┌─────────────┐
│  Regulator  │
│    CLI      │
└──────┬──────┘
       │ publishes
       ▼
┌─────────────────────┐
│ ComplianceDefinition│
│   Verifier Contract │◄────────┐
└──────┬──────────────┘         │
       │                        │ requires
       │                        │
       ▼                   ┌────┴─────┐
┌─────────────┐            │   Dapp   │
│    User     │            │ Contract │
│Proof Manager│───────────►│          │
└─────────────┘  submits   └──────────┘
                  proof
```

# What's in this repository
This repository contains an implementation of the tools described in the thesis document and a demo that uses those tools.

## tool: `regulator-cli`
Command line Rust binary to be used by regulators to construct a compliance definition, upload it to IPFS as a noir circuit, and publish a verifier contract on-chain.  

This tool lives in `regulator-cli/`.  See `REGULATOR_CLI_README.md` for more details.

## tool: `proof manager sdk`
TypeScript SDK used in the frontend of integrating applications.  This SDK takes a compliance definition contract as input, fetches the compliance definition (noir circuit) from IPFS, constructs inputs for the proof, and generates the zk proof of that compliance definition.  It also stores previously-proved compliance definitions for re-use.

This tool lives in `packages/sdk/`.  See `PROOF_MANAGER_README.md` for more details.

## Demo
The demo uses the `regulator-cli` to construct multiple compliance definitions, deploys example stub applications (ERC-20) that require a proof of those compliance definitions, and generates proofs of them using the `proof manager sdk`.

This demo lives in `sdk/demo/`.  See `DEMO_README.md` for more details.

## Auxillary tool: `build-merkle`
Builds a poseidon2 Merkle tree using a TypeScript library compatible with Noir's poseidon2.  This is just a helper tool to easily generate Merkle trees and roots for input to the regulator-cli when creating the demo.  This tool is specifically used for generating inputs to the `circuits/membership` and `circuits/non_membership` Noir verifiers.

This tool lives in `packages/build-merkle`.  See `BUILD_MERKLE.md` for more details.

# Benchmarks
> For information on running benchmarks, see `BENCHMARK_README.md`.

Proof generation in this framework relies on Noir's Barretenberg proving library, which supports two execution modes: a native binary backend and a WebAssembly (WASM) backend. These two modes execute the same cryptographic prover but in fundamentally different runtime environments, producing meaningfully different performance characteristics. Our framework makes no requirements on whether proofs should be generated locally (native) or in-browser (WASM), so we present benchmarks for both options.

- **Native**: The native backend runs Barretenberg as a platform-specific binary, leveraging native CPU instructions and OS-level threading. This represents the fastest possible proving performance on a given machine.
- **WASM**: The WASM backend runs Barretenberg as WebAssembly, which is how proofs are generated in browser-based applications. WASM execution incurs overhead from the sandboxed runtime, and browser environments introduce additional constraints: Web Worker threading coordination, competition with the DOM for resources, and tighter memory limits.

Both backends use identical circuit inputs, the same compiled circuit artifacts, and the same measurement methodology: timing witness generation and proof generation as separate phases. This controlled comparison isolates the performance impact of the runtime environment from the circuit complexity itself.

Barretenberg initialization time is the one-time cost of booting the proving runtime and is recorded separately. This cost is negligible for the native backend but averages 1.11 seconds for WASM, as it includes loading and compiling the WASM module. In a browser context, users pay this cost only on their first proof in a browser session.  This initialization time is not included in the below benchmark data.

## `circuits/membership`

The circuit for the membership constraint is a single Merkle proof of a tree of height 32.

|                    | Native Mean | Native Min | Native Max | Native Std Dev | WASM Mean | WASM Min | WASM Max | WASM Std Dev |
|--------------------|:-----------:|:----------:|:----------:|:--------------:|:---------:|:--------:|:--------:|:------------:|
| Witness Generation | 0.01        | 0.00       | 0.03       | 0.01           | 0.01      | 0.01     | 0.01     | 0.00         |
| Proof Generation   | 0.20        | 0.18       | 0.27       | 0.02           | 0.39      | 0.35     | 0.45     | 0.03         |
| **Total**          | **0.21**    | 0.19       | 0.30       | 0.03           | **0.40**  | 0.36     | 0.46     | 0.03         |

*Benchmark results for membership circuit (times in seconds, n=10 runs).*

## `circuits/non_membership`

Similarly, the circuit for the non-membership constraint uses 2 Merkle proofs of adjacent leaves on a sorted Merkle tree of height 32 to prove an address does not exist between them. We see it takes roughly twice the time of `MEM` because it makes twice the Merkle proofs.

|                    | Native Mean | Native Min | Native Max | Native Std Dev | WASM Mean | WASM Min | WASM Max | WASM Std Dev |
|--------------------|:-----------:|:----------:|:----------:|:--------------:|:---------:|:--------:|:--------:|:------------:|
| Witness Generation | 0.02        | 0.02       | 0.06       | 0.01           | 0.02      | 0.02     | 0.02     | 0.00         |
| Proof Generation   | 0.45        | 0.42       | 0.49       | 0.03           | 0.83      | 0.77     | 0.89     | 0.03         |
| **Total**          | **0.48**    | 0.44       | 0.55       | 0.03           | **0.85**  | 0.79     | 0.91     | 0.03         |

*Benchmark results for non membership circuit (times in seconds, n=10 runs).*


# Contributing
All contributions must be made by opening a PR to main and requires a review to be merged.  Include sufficient tests with any code implemented.

This is a master's thesis project and feedback and suggestions are welcome. Please open issues for bugs or feature requests.


# Building to host
pnpm --filter @ppc/sdk build && pnpm --filter @ppc/demo build && cp -r packages/demo/dist/* /path/to/your-username.github.io/ppc-demo/

# Developing
> The section below is just a personal cheat sheet and should be moved elsewhere.

```bash
```
# NOIR CIRCUITS
cd circuits/hello_world
nargo check
# Add circuit input to circuits/hello_world/Prover.toml
# Then execute to generate the witness
nargo execute
# generate proof and write the verification key to a file
bb prove -b ./target/hello_world.json -w ./target/hello_world.gz --write_vk -o target
# verify the proof using the vk
bb verify -p ./target/proof -k ./target/vk

# DEPLOYING NOIR CIRCUIT VERIFIER
# Generate the verification key. You need to pass the `--oracle_hash keccak` flag when generating vkey and proving
# to instruct bb to use keccak as the hash function, which is more optimal in Solidity
bb write_vk -b ./target/hello_world.json -o ./target --oracle_hash keccak
# Generate the Solidity verifier from the vkey
bb write_solidity_verifier -k ./target/vk -o ./target/Verifier.sol
```



