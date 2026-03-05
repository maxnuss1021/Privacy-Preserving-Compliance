export { ProofManager } from "./ProofManager";
export { ComplianceDefinitionABI } from "./abi/ComplianceDefinition";
export { getActiveVersion, verifyProof } from "./chain";
export { fetchCircuit, fetchLeaves } from "./ipfs";
export { computeMerkleProof, computeMerkleProofForLeaf } from "./merkle";
export type { MerkleProof } from "./merkle";
export { generateProof } from "./prove";
export type { CompiledCircuit } from "@noir-lang/noir_js";
export type {
  ProofManagerConfig,
  ComplianceVersion,
  ProofInputs,
  ProofResult,
} from "./types";
