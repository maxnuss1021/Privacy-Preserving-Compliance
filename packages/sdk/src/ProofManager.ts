import type { CompiledCircuit } from "@noir-lang/noir_js";
import { getName, getActiveVersion } from "./chain";
import { fetchCircuit, fetchLeaves } from "./ipfs";
import { computeMerkleProofForLeaf, type MerkleProof } from "./merkle";
import { generateProof } from "./prove";
import type { InputMap } from "@noir-lang/noirc_abi";
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

  async getName(contractAddress: `0x${string}`): Promise<string> {
    return getName(this.config.rpcUrl, contractAddress);
  }

  async getActiveDefinition(
    contractAddress: `0x${string}`,
  ): Promise<ComplianceVersion> {
    return getActiveVersion(this.config.rpcUrl, contractAddress);
  }

  async fetchCircuit(metadataHash: string): Promise<CompiledCircuit> {
    return fetchCircuit(this.config.ipfsGatewayUrl, metadataHash);
  }

  async prove(
    circuit: CompiledCircuit,
    inputs: InputMap,
  ): Promise<ProofResult> {
    return generateProof(circuit, inputs);
  }

  async fetchLeaves(leavesCid: string): Promise<bigint[]> {
    return fetchLeaves(this.config.ipfsGatewayUrl, leavesCid);
  }

  async computeMerkleProof(
    leavesCid: string,
    leafValue: bigint,
  ): Promise<MerkleProof> {
    const leaves = await this.fetchLeaves(leavesCid);
    return computeMerkleProofForLeaf(leaves, leafValue);
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
