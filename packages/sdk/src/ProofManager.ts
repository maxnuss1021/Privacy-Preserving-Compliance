import type { CompiledCircuit } from "@noir-lang/noir_js";
import { getActiveVersion } from "./chain";
import { fetchCircuit } from "./ipfs";
import { generateProof } from "./prove";
import type {
  ProofManagerConfig,
  ComplianceVersion,
  ProofResult,
} from "./types";

export class ProofManager {
  private config: ProofManagerConfig;

  constructor(config: ProofManagerConfig) {
    this.config = config;
  }

  async getActiveDefinition(
    contractAddress: `0x${string}`,
  ): Promise<ComplianceVersion> {
    return getActiveVersion(this.config.rpcUrl, contractAddress);
  }

  async fetchCircuit(metadataHash: string): Promise<CompiledCircuit> {
    return fetchCircuit(this.config.ipfsUrl, metadataHash);
  }

  async prove(
    circuit: CompiledCircuit,
    inputs: Record<string, string>,
  ): Promise<ProofResult> {
    return generateProof(circuit, inputs);
  }

  async generateComplianceProof(
    contractAddress: `0x${string}`,
    inputs: Record<string, string>,
  ): Promise<ProofResult> {
    const definition = await this.getActiveDefinition(contractAddress);
    const circuit = await this.fetchCircuit(definition.metadataHash);
    return this.prove(circuit, inputs);
  }
}
