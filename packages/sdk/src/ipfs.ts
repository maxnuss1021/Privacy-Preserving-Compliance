import type { CompiledCircuit } from "@noir-lang/noir_js";

interface IpfsLsResponse {
  Objects: { Links: { Name: string; Hash: string; Size: number }[] }[];
}

async function ipfsPost(ipfsUrl: string, endpoint: string): Promise<Response> {
  const url = `${ipfsUrl}${endpoint}`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST" });
  } catch (err) {
    throw new Error(
      `IPFS node unreachable at ${ipfsUrl}: ${err instanceof Error ? err.message : err}`,
    );
  }
  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      detail = body.Message ?? JSON.stringify(body);
    } catch {
      detail = await res.text();
    }
    throw new Error(`IPFS ${endpoint} failed: ${detail}`);
  }
  return res;
}

export async function fetchCircuit(
  ipfsUrl: string,
  metadataHash: string,
): Promise<CompiledCircuit> {
  const baseUrl = ipfsUrl.replace(/\/+$/, "");

  // Strip /ipfs/ prefix if present
  const cid = metadataHash.startsWith("/ipfs/")
    ? metadataHash.slice(6)
    : metadataHash;

  // List directory contents to find the compiled .json artifact
  const lsRes = await ipfsPost(baseUrl, `/api/v0/ls?arg=${cid}`);
  const listing: IpfsLsResponse = await lsRes.json();
  const links = listing.Objects?.[0]?.Links ?? [];
  const jsonFile = links.find((l) => l.Name.endsWith(".json"));

  if (!jsonFile) {
    throw new Error(
      `No .json circuit artifact found in IPFS directory ${cid}. ` +
        `Contents: ${links.map((l) => l.Name).join(", ") || "(empty)"}`,
    );
  }

  // Fetch the compiled circuit JSON
  const catRes = await ipfsPost(
    baseUrl,
    `/api/v0/cat?arg=${cid}/${jsonFile.Name}`,
  );
  const circuit: CompiledCircuit = await catRes.json();

  if (!circuit.bytecode || !circuit.abi) {
    throw new Error(
      `${jsonFile.Name} in CID ${cid} is not a compiled circuit artifact (missing bytecode or abi). ` +
        `Ensure the regulator uploaded the compiled JSON from nargo compile, not the .nr source.`,
    );
  }

  return circuit;
}
