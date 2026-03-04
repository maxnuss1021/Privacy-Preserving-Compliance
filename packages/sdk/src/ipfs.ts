import type { CompiledCircuit } from "@noir-lang/noir_js";

/**
 * Fetch a compiled Noir circuit artifact from an IPFS gateway.
 *
 * Expects the CID to point to a directory containing a `.json` compiled
 * circuit artifact (the output of `nargo compile`).  The directory is
 * listed via the gateway's built-in JSON directory listing, and the first
 * `.json` file found is fetched and validated.
 */
export async function fetchCircuit(
  gatewayUrl: string,
  metadataHash: string,
): Promise<CompiledCircuit> {
  const baseUrl = gatewayUrl.replace(/\/+$/, "");

  // Strip /ipfs/ prefix if present
  const cid = metadataHash.startsWith("/ipfs/")
    ? metadataHash.slice(6)
    : metadataHash;

  // List directory contents via the gateway's JSON directory listing
  let links: { Name: string; Hash: string; Size: number }[];
  try {
    const lsRes = await fetch(
      `${baseUrl}/ipfs/${cid}/?format=dag-json`,
      {
        headers: { Accept: "application/vnd.ipld.dag-json" },
      },
    );
    if (!lsRes.ok) {
      throw new Error(`HTTP ${lsRes.status}: ${await lsRes.text()}`);
    }
    const dag = await lsRes.json();
    links = (dag.Links ?? []).map(
      (l: { Name: string; Hash: { "/": string }; Tsize: number }) => ({
        Name: l.Name,
        Hash: l.Hash["/"],
        Size: l.Tsize,
      }),
    );
  } catch (err) {
    throw new Error(
      `Failed to list IPFS directory ${cid} from ${baseUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }

  const jsonFile = links.find((l) => l.Name.endsWith(".json"));
  if (!jsonFile) {
    throw new Error(
      `No .json circuit artifact found in IPFS directory ${cid}. ` +
        `Contents: ${links.map((l) => l.Name).join(", ") || "(empty)"}`,
    );
  }

  // Fetch the compiled circuit JSON via the gateway
  let circuit: CompiledCircuit;
  try {
    const catRes = await fetch(`${baseUrl}/ipfs/${cid}/${jsonFile.Name}`);
    if (!catRes.ok) {
      throw new Error(`HTTP ${catRes.status}: ${await catRes.text()}`);
    }
    circuit = await catRes.json();
  } catch (err) {
    throw new Error(
      `Failed to fetch ${jsonFile.Name} from IPFS (${cid}): ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!circuit.bytecode || !circuit.abi) {
    throw new Error(
      `${jsonFile.Name} in CID ${cid} is not a compiled circuit artifact (missing bytecode or abi). ` +
        `Ensure the regulator uploaded the compiled JSON from nargo compile, not the .nr source.`,
    );
  }

  return circuit;
}
