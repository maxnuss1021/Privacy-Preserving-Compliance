import initACVM from "@noir-lang/acvm_js";
import initNoirC from "@noir-lang/noirc_abi";
import { ProofManager, verifyProof, type ProofResult } from "@ppc/sdk";
import { createPublicClient, createWalletClient, custom, http } from "viem";
import { sepolia } from "viem/chains";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

// ── DOM refs ─────────────────────────────────────────────────────────
const $contract = document.getElementById("contract") as HTMLInputElement;
const $contractName = document.getElementById("contractName")!;
const $rpc = document.getElementById("rpc") as HTMLInputElement;
const $ipfs = document.getElementById("ipfs") as HTMLInputElement;
const $userAddr = document.getElementById("userAddr") as HTMLInputElement;
const $btn = document.getElementById("generate") as HTMLButtonElement;
const $status = document.getElementById("status")!;
const $proof = document.getElementById("proof") as HTMLTextAreaElement;
const $publicInputs = document.getElementById(
  "publicInputs",
) as HTMLTextAreaElement;
const $copyProof = document.getElementById("copyProof") as HTMLButtonElement;
const $copyInputs = document.getElementById("copyInputs") as HTMLButtonElement;
const $verify = document.getElementById("verify") as HTMLButtonElement;
const $verifyStatus = document.getElementById("verifyStatus")!;
const $connectWallet = document.getElementById("connectWallet") as HTMLButtonElement;

// ── WASM init ────────────────────────────────────────────────────────
let wasmReady = false;

async function ensureWasm() {
  if (wasmReady) return;
  await Promise.all([initACVM(), initNoirC()]);
  wasmReady = true;
}

// ── Helpers ──────────────────────────────────────────────────────────
function setStatus(msg: string) {
  $status.textContent = msg;
}

$copyProof.addEventListener("click", () => {
  navigator.clipboard.writeText($proof.value);
});
$copyInputs.addEventListener("click", () => {
  navigator.clipboard.writeText($publicInputs.value);
});

// ── Fetch contract name on address change ───────────────────────────
let nameDebounce: ReturnType<typeof setTimeout>;
$contract.addEventListener("input", () => {
  clearTimeout(nameDebounce);
  $contractName.textContent = "";
  const addr = $contract.value.trim();
  if (!addr.match(/^0x[0-9a-fA-F]{40}$/)) return;

  nameDebounce = setTimeout(async () => {
    try {
      const pm = new ProofManager({
        rpcUrl: $rpc.value.trim(),
        ipfsGatewayUrl: $ipfs.value.trim(),
      });
      const name = await pm.getName(addr as `0x${string}`);
      $contractName.textContent = name;
    } catch {
      $contractName.textContent = "";
    }
  }, 400);
});

// ── Connect wallet ──────────────────────────────────────────────────
$connectWallet.addEventListener("click", async () => {
  if (!window.ethereum) {
    setStatus("No wallet found. Install MetaMask or another browser wallet.");
    return;
  }
  try {
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as `0x${string}`[];
    $userAddr.value = accounts[0];
    $connectWallet.textContent = "Connected";
  } catch (err) {
    setStatus(`Wallet connection failed: ${err instanceof Error ? err.message : err}`);
  }
});

// ── State ────────────────────────────────────────────────────────────
let lastProofResult: ProofResult | null = null;

// ── Main flow ────────────────────────────────────────────────────────
$btn.addEventListener("click", async () => {
  $btn.disabled = true;
  $proof.value = "";
  $publicInputs.value = "";
  $copyProof.style.display = "none";
  $copyInputs.style.display = "none";
  $verify.style.display = "none";
  $verifyStatus.textContent = "";
  lastProofResult = null;

  try {
    setStatus("Initializing WASM...");
    await ensureWasm();

    const pm = new ProofManager({
      rpcUrl: $rpc.value.trim(),
      ipfsGatewayUrl: $ipfs.value.trim(),
    });

    const contractAddr = $contract.value.trim() as `0x${string}`;

    setStatus("Reading contract...");
    const definition = await pm.getActiveDefinition(contractAddr);
    setStatus(
      `Got version: verifier=${definition.verifier.slice(0, 10)}... metadataHash=${definition.metadataHash.slice(0, 12)}...`,
    );

    setStatus("Fetching circuit from IPFS...");
    const circuit = await pm.fetchCircuit(definition.metadataHash);

    // Build inputs from circuit ABI
    const inputs: Record<string, string | string[]> = {};
    const userAddr = $userAddr.value.trim();
    if (!userAddr) {
      setStatus("Connect your wallet first — your address is used as a public input.");
      return;
    }

    // Auto-compute merkle proof if leaves are published
    let merkleProof: { index: string; hashPath: string[]; root: string } | null = null;
    if (definition.leavesHash) {
      setStatus("Fetching merkle leaves from IPFS...");
      try {
        merkleProof = await pm.computeMerkleProof(
          definition.leavesHash,
          BigInt(userAddr),
        );
      } catch {
        setStatus("Your address was not found in the compliance set.");
        return;
      }
    }

    for (const param of circuit.abi.parameters) {
      if (param.name === "address") {
        inputs[param.name] = userAddr;
      } else if (param.name === "root") {
        inputs[param.name] = definition.merkleRoot;
      } else if (param.name === "index" && merkleProof) {
        inputs[param.name] = merkleProof.index;
      } else if (param.name === "hash_path" && merkleProof) {
        inputs[param.name] = merkleProof.hashPath;
      } else {
        const val = prompt(
          `Enter value for "${param.name}" (${param.visibility}, ${param.type.kind}):`,
        );
        if (val === null) {
          setStatus("Cancelled.");
          return;
        }
        inputs[param.name] = val;
      }
    }

    setStatus("Generating proof... (this may take 30-60 seconds)");
    const result = await pm.prove(circuit, inputs);

    $proof.value = result.proof;
    $publicInputs.value = result.publicInputs.join("\n");
    $copyProof.style.display = "inline-block";
    $copyInputs.style.display = "inline-block";
    lastProofResult = result;
    $verify.style.display = "inline-block";
    setStatus("Done! You can now verify the proof on-chain.");
  } catch (err) {
    setStatus(`Error: ${err instanceof Error ? err.message : err}`);
    console.error(err);
  } finally {
    $btn.disabled = false;
  }
});

// ── Verify on-chain ──────────────────────────────────────────────────
$verify.addEventListener("click", async () => {
  if (!lastProofResult) return;
  if (!window.ethereum) {
    $verifyStatus.textContent = "No wallet found. Install MetaMask or another browser wallet.";
    return;
  }

  $verify.disabled = true;
  $verifyStatus.textContent = "Connecting wallet...";

  try {
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as `0x${string}`[];

    // The contract verifies against msg.sender, so the wallet must match the proof address
    const proofAddr = $userAddr.value.trim().toLowerCase();
    if (accounts[0].toLowerCase() !== proofAddr) {
      $verifyStatus.textContent = `Wallet mismatch: proof was generated for ${proofAddr}, but wallet is ${accounts[0]}. The contract will reject this.`;
      return;
    }

    const walletClient = createWalletClient({
      account: accounts[0],
      chain: sepolia,
      transport: custom(window.ethereum),
    });

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http($rpc.value.trim()),
    });

    const contractAddr = $contract.value.trim() as `0x${string}`;

    $verifyStatus.textContent = "Simulating transaction...";
    $verifyStatus.textContent = "Submitting transaction... (confirm in wallet)";

    const { txHash } = await verifyProof(
      walletClient,
      publicClient,
      contractAddr,
      lastProofResult,
    );

    $verifyStatus.textContent = `Verified! tx: ${txHash}`;
  } catch (err) {
    $verifyStatus.textContent = `Verification failed: ${err instanceof Error ? err.message : err}`;
    console.error(err);
  } finally {
    $verify.disabled = false;
  }
});
