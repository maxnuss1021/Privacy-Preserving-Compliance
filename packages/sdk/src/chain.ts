import { createPublicClient, http, type PublicClient, type WalletClient } from "viem";
import { ComplianceDefinitionABI } from "./abi/ComplianceDefinition";
import type { ComplianceVersion, ProofResult } from "./types";

export async function getName(
  rpcUrl: string,
  contractAddress: `0x${string}`,
): Promise<string> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  return client.readContract({
    address: contractAddress,
    abi: ComplianceDefinitionABI,
    functionName: "name",
  }) as Promise<string>;
}

export async function getActiveVersion(
  rpcUrl: string,
  contractAddress: `0x${string}`,
): Promise<ComplianceVersion> {
  const client = createPublicClient({ transport: http(rpcUrl) });

  const result = await client.readContract({
    address: contractAddress,
    abi: ComplianceDefinitionABI,
    functionName: "getActiveVersion",
  });

  return {
    verifier: result.verifier,
    merkleRoot: result.merkleRoot,
    tStart: result.tStart,
    tEnd: result.tEnd,
    metadataHash: result.metadataHash,
    leavesHash: result.leavesHash,
  };
}

export async function verifyProof(
  walletClient: WalletClient,
  publicClient: PublicClient,
  contractAddress: `0x${string}`,
  result: ProofResult,
): Promise<{ txHash: `0x${string}` }> {
  const account = walletClient.account;
  if (!account) throw new Error("WalletClient has no account");

  await publicClient.simulateContract({
    address: contractAddress,
    abi: ComplianceDefinitionABI,
    functionName: "verify",
    args: [result.proof],
    account,
  });

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: ComplianceDefinitionABI,
    functionName: "verify",
    args: [result.proof],
    account,
    chain: walletClient.chain,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return { txHash };
}
