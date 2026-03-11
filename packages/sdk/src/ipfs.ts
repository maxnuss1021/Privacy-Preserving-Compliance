import type { CompiledCircuit } from "@noir-lang/noir_js";

/**
 * Fetch a compiled Noir circuit artifact from an IPFS gateway.
 *
 * Expects the CID to point to a directory containing a `.json` compiled
 * circuit artifact (the output of `nargo compile`).  The directory is
 * fetched via the gateway's default response (typically HTML), and the
 * first `.json` file link is extracted and fetched.
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

  // Fetch the directory listing from the gateway.
  // Use a plain request (no special format parameter) so we hit the
  // gateway's cache and get whatever format it naturally returns.
  let jsonFileName: string;
  try {
    const dirRes = await fetch(`${baseUrl}/ipfs/${cid}/`);
    if (!dirRes.ok) {
      throw new Error(`HTTP ${dirRes.status}`);
    }

    const contentType = dirRes.headers.get("content-type") || "";

    if (contentType.includes("application/vnd.ipld.dag-json")) {
      // dag-json response (some Kubo gateways)
      const dag = await dirRes.json();
      const link = (dag.Links ?? []).find(
        (l: { Name: string }) => l.Name.endsWith(".json"),
      );
      if (!link) throw new Error("No .json file in dag-json directory listing");
      jsonFileName = link.Name;
    } else if (contentType.includes("application/json")) {
      // JSON directory listing
      const json = await dirRes.json();
      if (json.Links) {
        const link = json.Links.find(
          (l: { Name: string }) => l.Name.endsWith(".json"),
        );
        if (!link) throw new Error("No .json file in JSON directory listing");
        jsonFileName = link.Name;
      } else {
        throw new Error("Unexpected JSON format from gateway");
      }
    } else {
      // HTML directory listing (most public gateways)
      const html = await dirRes.text();
      const matches = [...html.matchAll(/href="([^"]*\.json)"/g)];
      if (matches.length === 0) {
        throw new Error("No .json file found in HTML directory listing");
      }
      // Extract just the filename from the href (may be a full path)
      const href = matches[0][1];
      jsonFileName = href.split("/").pop()!;
    }
  } catch (err) {
    throw new Error(
      `Failed to list IPFS directory ${cid} from ${baseUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Fetch the compiled circuit JSON via the gateway
  let circuit: CompiledCircuit;
  try {
    const catRes = await fetch(`${baseUrl}/ipfs/${cid}/${jsonFileName}`);
    if (!catRes.ok) {
      throw new Error(`HTTP ${catRes.status}`);
    }
    circuit = await catRes.json();
  } catch (err) {
    throw new Error(
      `Failed to fetch ${jsonFileName} from IPFS (${cid}): ${err instanceof Error ? err.message : err}`,
    );
  }

  if (!circuit.bytecode || !circuit.abi) {
    throw new Error(
      `${jsonFileName} in CID ${cid} is not a compiled circuit artifact (missing bytecode or abi). ` +
        `Ensure the regulator uploaded the compiled JSON from nargo compile, not the .nr source.`,
    );
  }

  return circuit;
}

/**
 * Fetch a leaves JSON file from IPFS (a single file, not a directory).
 *
 * Expects the CID to point to a JSON array of hex strings: `["0x...", ...]`.
 * Returns the parsed array as `bigint[]`.
 */
export async function fetchLeaves(
  gatewayUrl: string,
  leavesCid: string,
): Promise<bigint[]> {
  const baseUrl = gatewayUrl.replace(/\/+$/, "");
  const cid = leavesCid.startsWith("/ipfs/") ? leavesCid.slice(6) : leavesCid;

  const res = await fetch(`${baseUrl}/ipfs/${cid}`);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch leaves from IPFS (${cid}): HTTP ${res.status}`,
    );
  }

  const arr: string[] = await res.json();
  if (!Array.isArray(arr)) {
    throw new Error(`Leaves CID ${cid} did not contain a JSON array`);
  }

  return arr.map((v) => BigInt(v));
}
