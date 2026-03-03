import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import type { ProofResult } from "./types";

function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}

export async function generateProof(
  circuit: CompiledCircuit,
  inputs: Record<string, string>,
): Promise<ProofResult> {
  const api = await Barretenberg.new();
  try {
    const noir = new Noir(circuit);
    const backend = new UltraHonkBackend(circuit.bytecode, api);

    const { witness } = await noir.execute(inputs);
    const { proof, publicInputs } = await backend.generateProof(witness, {
      verifierTarget: "evm",
    });

    return {
      proof: toHex(proof),
      publicInputs: publicInputs.map((input) => input as `0x${string}`),
    };
  } finally {
    await api.destroy();
  }
}
