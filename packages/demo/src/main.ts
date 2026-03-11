import initACVM from "@noir-lang/acvm_js";
import initNoirC from "@noir-lang/noirc_abi";
import {
  ProofManager,
  computeMerkleProof,
  computeMerkleProofForLeaf,
  type InputFormatter,
  type ProofResult,
} from "@ppc/sdk";
import { createPublicClient, createWalletClient, custom, http, formatEther } from "viem";
import { sepolia } from "viem/chains";
import { CompliantTokenABI } from "./abi";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

// -- Config from env vars --------------------------------------------------

const RPC_URL = import.meta.env.VITE_RPC_URL as string;
const IPFS_GATEWAY_URL = import.meta.env.VITE_IPFS_GATEWAY_URL as string;
const SANCTION_CD = import.meta.env.VITE_SANCTION_CD_ADDRESS as `0x${string}`;
const WHITELIST_CD = import.meta.env.VITE_WHITELIST_CD_ADDRESS as `0x${string}`;
const TOKEN_1 = import.meta.env.VITE_TOKEN_1_ADDRESS as `0x${string}`;
const TOKEN_2 = import.meta.env.VITE_TOKEN_2_ADDRESS as `0x${string}`;
const TOKEN_3 = import.meta.env.VITE_TOKEN_3_ADDRESS as `0x${string}`;

// -- Panel definitions -----------------------------------------------------

interface PanelConfig {
  id: string;
  name: string;
  cdAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  type: "non-membership" | "membership";
}

const panels: PanelConfig[] = [
  { id: "app1", name: "SafeSwap",     cdAddress: SANCTION_CD,  tokenAddress: TOKEN_1, type: "non-membership" },
  { id: "app2", name: "CleanMixer",   cdAddress: SANCTION_CD,  tokenAddress: TOKEN_2, type: "non-membership" },
  { id: "app3", name: "VerifiedLend", cdAddress: WHITELIST_CD, tokenAddress: TOKEN_3, type: "membership" },
];

// -- DOM helpers -----------------------------------------------------------

function $(panelId: string, ref: string): HTMLElement {
  return document.querySelector(`#${panelId} [data-ref="${ref}"]`)!;
}

function $btn(panelId: string, ref: string): HTMLButtonElement {
  return $(panelId, ref) as HTMLButtonElement;
}

// -- WASM init -------------------------------------------------------------

let wasmReady = false;

async function ensureWasm() {
  if (wasmReady) return;
  await Promise.all([initACVM(), initNoirC()]);
  wasmReady = true;
}

// -- Shared state ----------------------------------------------------------

const pm = new ProofManager({ rpcUrl: RPC_URL, ipfsGatewayUrl: IPFS_GATEWAY_URL });
let walletAddress: `0x${string}` | null = null;
const panelProofs = new Map<string, ProofResult>();

// -- Helpers ---------------------------------------------------------------

function toHex(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

// -- Token helpers (demo-local, not in SDK) --------------------------------

async function mintWithProof(
  tokenAddress: `0x${string}`,
  proof: ProofResult,
): Promise<`0x${string}`> {
  if (!window.ethereum) throw new Error("No wallet found");
  const accounts = (await window.ethereum.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];

  const walletClient = createWalletClient({
    account: accounts[0],
    chain: sepolia,
    transport: custom(window.ethereum),
  });
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });

  await publicClient.simulateContract({
    address: tokenAddress,
    abi: CompliantTokenABI,
    functionName: "mint",
    args: [proof.proof],
    account: accounts[0],
  });

  const txHash = await walletClient.writeContract({
    address: tokenAddress,
    abi: CompliantTokenABI,
    functionName: "mint",
    args: [proof.proof],
    account: accounts[0],
    chain: sepolia,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

async function getTokenBalance(
  tokenAddress: `0x${string}`,
  account: `0x${string}`,
): Promise<string> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });
  const balance = await publicClient.readContract({
    address: tokenAddress,
    abi: CompliantTokenABI,
    functionName: "balanceOf",
    args: [account],
  }) as bigint;
  return formatEther(balance);
}

// -- InputFormatter factories ----------------------------------------------

function createNonMembershipFormatter(
  userAddr: string,
  setStatus: (msg: string) => void,
): InputFormatter {
  return async (ctx) => {
    setStatus("Fetching merkle leaves from IPFS...");
    const leaves = await ctx.proofManager.fetchLeaves(ctx.definition.leavesHash);

    if (leaves.length === 0) {
      throw new Error("No leaves in the compliance set.");
    }

    const target = BigInt(userAddr);

    if (leaves.some((l) => l === target)) {
      throw new Error("Address IS in the compliance set -- cannot prove non-membership.");
    }

    setStatus("Generating proof... (approx. 30-60 seconds)");

    if (target < leaves[0]) {
      const upperProof = computeMerkleProof(leaves, 0);
      return {
        address: userAddr,
        root: ctx.definition.merkleRoot,
        lower_leaf: toHex(0n),
        upper_leaf: toHex(leaves[0]),
        lower_index: "0",
        upper_index: upperProof.index,
        lower_hash_path: upperProof.hashPath,
        upper_hash_path: upperProof.hashPath,
        proof_type: "1",
      };
    } else if (target > leaves[leaves.length - 1]) {
      const lastIdx = leaves.length - 1;
      const lowerProof = computeMerkleProof(leaves, lastIdx);
      const leavesWithEmpty = [...leaves, 0n];
      const emptyProof = computeMerkleProof(leavesWithEmpty, leaves.length);
      return {
        address: userAddr,
        root: ctx.definition.merkleRoot,
        lower_leaf: toHex(leaves[lastIdx]),
        upper_leaf: toHex(0n),
        lower_index: lowerProof.index,
        upper_index: "0",
        lower_hash_path: lowerProof.hashPath,
        upper_hash_path: emptyProof.hashPath,
        proof_type: "2",
      };
    } else {
      const upperIdx = leaves.findIndex((leaf) => leaf > target);
      const lowerIdx = upperIdx - 1;
      const lowerProof = computeMerkleProof(leaves, lowerIdx);
      const upperProof = computeMerkleProof(leaves, upperIdx);
      return {
        address: userAddr,
        root: ctx.definition.merkleRoot,
        lower_leaf: toHex(leaves[lowerIdx]),
        upper_leaf: toHex(leaves[upperIdx]),
        lower_index: lowerProof.index,
        upper_index: upperProof.index,
        lower_hash_path: lowerProof.hashPath,
        upper_hash_path: upperProof.hashPath,
        proof_type: "0",
      };
    }
  };
}

function createMembershipFormatter(
  userAddr: string,
  setStatus: (msg: string) => void,
): InputFormatter {
  return async (ctx) => {
    setStatus("Fetching merkle leaves from IPFS...");
    const leaves = await ctx.proofManager.fetchLeaves(ctx.definition.leavesHash);

    const proof = computeMerkleProofForLeaf(leaves, BigInt(userAddr));

    setStatus("Generating proof... (approx. 30-60 seconds)");

    return {
      address: userAddr,
      root: ctx.definition.merkleRoot,
      index: proof.index,
      hash_path: proof.hashPath,
    };
  };
}

// -- Fetch and display compliance info for each panel ----------------------

async function loadComplianceInfo(panel: PanelConfig) {
  const cdAddrEl = $(panel.id, "cdAddr");
  const cdNameEl = $(panel.id, "cdName");
  const tokenAddrEl = $(panel.id, "tokenAddr");

  cdAddrEl.textContent = panel.cdAddress;
  tokenAddrEl.textContent = panel.tokenAddress;

  try {
    const name = await pm.getName(panel.cdAddress);
    cdNameEl.textContent = name;
  } catch {
    cdNameEl.textContent = "Error loading";
  }
}

// -- Wire up a single panel ------------------------------------------------

function initPanel(panel: PanelConfig) {
  const proofBtn = $btn(panel.id, "proofBtn");
  const proofStatus = $(panel.id, "proofStatus");
  const mintBtn = $btn(panel.id, "mintBtn");
  const mintStatus = $(panel.id, "mintStatus");

  const appendProofStatus = (msg: string) => {
    if (proofStatus.textContent) {
      proofStatus.textContent += "\n" + msg;
    } else {
      proofStatus.textContent = msg;
    }
  };
  const setProofStatus = (msg: string) => { proofStatus.textContent = msg; };
  const setMintStatus = (msg: string) => { mintStatus.textContent = msg; };

  // Enable proof button once wallet is connected
  if (walletAddress) proofBtn.disabled = false;

  // Generate proof
  proofBtn.addEventListener("click", async () => {
    if (!walletAddress) {
      setProofStatus("Connect wallet first.");
      return;
    }

    proofBtn.disabled = true;
    mintBtn.disabled = true;
    setProofStatus("");

    try {
      appendProofStatus("Initializing WASM...");
      await ensureWasm();

      // Check if SDK cache will hit (for status message)
      const cached = pm.getCachedProof(panel.cdAddress);

      if (cached) {
        setProofStatus("Already generated!");
        const result = await pm.generateComplianceProof(panel.cdAddress,
          panel.type === "non-membership"
            ? createNonMembershipFormatter(walletAddress, appendProofStatus)
            : createMembershipFormatter(walletAddress, appendProofStatus));
        panelProofs.set(panel.id, result);
        mintBtn.disabled = false;
      } else {
        const formatter = panel.type === "non-membership"
          ? createNonMembershipFormatter(walletAddress, appendProofStatus)
          : createMembershipFormatter(walletAddress, appendProofStatus);

        const result = await pm.generateComplianceProof(panel.cdAddress, formatter);

        panelProofs.set(panel.id, result);
        appendProofStatus("Proof generated!");
        mintBtn.disabled = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found in leaves array")) {
        appendProofStatus("Your address is not on the whitelist. Only whitelisted addresses can generate a membership proof.");
      } else if (msg.includes("IS in the compliance set")) {
        appendProofStatus("Your address is on the sanction list. Cannot prove non-membership.");
      } else {
        appendProofStatus(`Error: ${msg}`);
      }
      console.error(err);
    } finally {
      proofBtn.disabled = false;
    }
  });

  // Mint
  mintBtn.addEventListener("click", async () => {
    const proof = panelProofs.get(panel.id);
    if (!proof || !walletAddress) return;

    mintBtn.disabled = true;
    setMintStatus("Submitting transaction... (confirm in wallet)");

    try {
      const txHash = await mintWithProof(panel.tokenAddress, proof);
      const balance = await getTokenBalance(panel.tokenAddress, walletAddress);
      setMintStatus(`Minted! Balance: ${balance} | tx: ${txHash}`);
    } catch (err) {
      setMintStatus(`Error: ${err instanceof Error ? err.message : err}`);
      console.error(err);
    } finally {
      mintBtn.disabled = false;
    }
  });
}

// -- Wallet connection -----------------------------------------------------

const $connectBtn = document.getElementById("connectWallet") as HTMLButtonElement;
const $walletAddr = document.getElementById("walletAddr")!;

$connectBtn.addEventListener("click", async () => {
  if (!window.ethereum) {
    $walletAddr.textContent = "No wallet found. Install MetaMask.";
    return;
  }

  try {
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as `0x${string}`[];

    walletAddress = accounts[0];
    $walletAddr.textContent = walletAddress;
    $connectBtn.textContent = "Connected";

    // Update all panels with the wallet address and enable proof buttons
    for (const panel of panels) {
      $(panel.id, "userAddr").textContent = walletAddress;
      $btn(panel.id, "proofBtn").disabled = false;
    }
  } catch (err) {
    $walletAddr.textContent = `Connection failed: ${err instanceof Error ? err.message : err}`;
  }
});

// -- Init ------------------------------------------------------------------

for (const panel of panels) {
  loadComplianceInfo(panel);
  initPanel(panel);
}
