/** Configuration for the ProofManager */
export interface ProofManagerConfig {
  /** Ethereum JSON-RPC URL (e.g., Sepolia Infura endpoint) */
  rpcUrl: string;
  /** IPFS gateway URL (e.g., http://localhost:8080) */
  ipfsGatewayUrl: string;
}

/** On-chain ComplianceVersion struct */
export interface ComplianceVersion {
  verifier: `0x${string}`;
  merkleRoot: `0x${string}`;
  tStart: bigint;
  tEnd: bigint;
  metadataHash: string;
  leavesHash: string;
}

/** Inputs for proof generation */
export interface ProofInputs {
  /** Public inputs visible to verifier (address, params, etc.) */
  publicInputs: Record<string, string>;
  /** Private inputs known only to prover */
  privateInputs: Record<string, string>;
}

/** Result of proof generation */
export interface ProofResult {
  /** Proof bytes, hex-encoded, ready for on-chain submission */
  proof: `0x${string}`;
  /** Public inputs array, hex-encoded, for the verifier contract */
  publicInputs: `0x${string}`[];
}
