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
      ipfsUrl: $ipfs.value.trim(),
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
    const inputs: Record<string, string> = {};
    const userAddr = $userAddr.value.trim();
    for (const param of circuit.abi.parameters) {
      if (userAddr && param.name === "address") {
        inputs[param.name] = userAddr;
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
