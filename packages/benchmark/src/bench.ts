import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend, BackendType } from "@aztec/bb.js";
import type { InputMap } from "@noir-lang/noirc_abi";
import { performance } from "perf_hooks";

export interface BenchResult {
  run: number;
  witnessGenerationMs: number;
  proofGenerationMs: number;
  totalMs: number;
}

export interface BenchOutput {
  barretenbergInitMs: number;
  results: BenchResult[];
}

export async function runBenchmark(
  circuit: CompiledCircuit,
  inputs: InputMap,
  runs: number,
): Promise<BenchOutput> {
  // Initialize Barretenberg once — measure this separately
  // Force WASM backend to match browser proving performance
  const initStart = performance.now();
  const api = await Barretenberg.new({ backend: BackendType.Wasm });
  const barretenbergInitMs = performance.now() - initStart;

  try {
    const results: BenchResult[] = [];

    for (let i = 0; i < runs; i++) {
      const totalStart = performance.now();

      // Witness generation
      const witnessStart = performance.now();
      const noir = new Noir(circuit);
      const { witness } = await noir.execute(inputs);
      const witnessGenerationMs = performance.now() - witnessStart;

      // Proof generation
      const proofStart = performance.now();
      const backend = new UltraHonkBackend(circuit.bytecode, api);
      await backend.generateProof(witness, { verifierTarget: "evm" });
      const proofGenerationMs = performance.now() - proofStart;

      const totalMs = performance.now() - totalStart;

      results.push({
        run: i + 1,
        witnessGenerationMs,
        proofGenerationMs,
        totalMs,
      });
    }

    return { barretenbergInitMs, results };
  } finally {
    await api.destroy();
  }
}
