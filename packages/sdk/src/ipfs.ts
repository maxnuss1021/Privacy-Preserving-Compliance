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

  // List directory contents via the gateway's UnixFS directory listing.
  // Try multiple response formats for broad gateway compatibility.
  let links: { Name: string; Hash: string; Size: number }[];
  try {
    // First try dag-json (Kubo gateways)
    let lsRes = await fetch(`${baseUrl}/ipfs/${cid}/?format=dag-json`, {
      headers: { Accept: "application/vnd.ipld.dag-json" },
    });

    if (lsRes.ok) {
      const dag = await lsRes.json();
      links = (dag.Links ?? []).map(
        (l: { Name: string; Hash: { "/": string }; Tsize: number }) => ({
          Name: l.Name,
          Hash: l.Hash["/"],
          Size: l.Tsize,
        }),
      );
    } else {
      // Fall back to Accept: application/json (ipfs.io, Pinata, etc.)
      lsRes = await fetch(`${baseUrl}/ipfs/${cid}/`, {
        headers: { Accept: "application/json" },
      });
      if (!lsRes.ok) {
        throw new Error(`HTTP ${lsRes.status}`);
      }
      const contentType = lsRes.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await lsRes.json();
        // Handle UnixFS directory JSON format (used by ipfs.io)
        if (json.Links) {
          links = json.Links.map(
            (l: { Name: string; Hash: string; Size: number }) => l,
          );
        } else {
          throw new Error("Unexpected JSON format from gateway");
        }
      } else {
        // Gateway returned HTML directory listing; parse file links from it
        const html = await lsRes.text();
        const matches = [...html.matchAll(/href="([^"]+\.json)"/g)];
        if (matches.length === 0) {
          throw new Error("Could not find .json files in directory listing");
        }
        links = matches.map((m) => ({
          Name: m[1].replace(/^\.\//, ""),
          Hash: "",
          Size: 0,
        }));
      }
    }
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
      throw new Error(`HTTP ${catRes.status}`);
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
