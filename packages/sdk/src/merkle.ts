import { poseidon2Hash } from "@zkpassport/poseidon2";

const TREE_DEPTH = 32;

export interface MerkleProof {
  index: string;
  hashPath: string[];
  root: string;
}

function hash2(left: bigint, right: bigint): bigint {
  return poseidon2Hash([left, right]);
}

/** Precomputed hash of an empty subtree at each level (level 0 = 0n). */
const EMPTY_HASHES: bigint[] = new Array(TREE_DEPTH + 1);
EMPTY_HASHES[0] = 0n;
for (let i = 1; i <= TREE_DEPTH; i++) {
  EMPTY_HASHES[i] = hash2(EMPTY_HASHES[i - 1], EMPTY_HASHES[i - 1]);
}

/**
 * Compute a depth-32 sparse Poseidon2 merkle proof for a leaf at `leafIndex`.
 *
 * Uses a sparse `Map<number, bigint>` so we only store non-empty nodes.
 * Compatible with Noir's `compute_merkle_root` using `poseidon::poseidon2::Poseidon2::hash`.
 */
export function computeMerkleProof(
  leaves: bigint[],
  leafIndex: number,
): MerkleProof {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw new Error(
      `Leaf index ${leafIndex} out of range [0, ${leaves.length})`,
    );
  }

  // Build tree bottom-up, level by level, using sparse storage.
  // At each level, store only nodes that differ from the empty subtree hash.
  let currentLevel = new Map<number, bigint>();
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i] !== 0n) {
      currentLevel.set(i, leaves[i]);
    }
  }

  const hashPath: bigint[] = [];

  let idx = leafIndex;
  for (let level = 0; level < TREE_DEPTH; level++) {
    // Sibling index
    const siblingIdx = idx ^ 1;
    const sibling = currentLevel.get(siblingIdx) ?? EMPTY_HASHES[level];
    hashPath.push(sibling);

    // Build next level
    const nextLevel = new Map<number, bigint>();
    const visited = new Set<number>();
    for (const [nodeIdx, nodeVal] of currentLevel) {
      const parentIdx = nodeIdx >> 1;
      if (visited.has(parentIdx)) continue;
      visited.add(parentIdx);

      const leftIdx = parentIdx << 1;
      const rightIdx = leftIdx + 1;
      const left = currentLevel.get(leftIdx) ?? EMPTY_HASHES[level];
      const right = currentLevel.get(rightIdx) ?? EMPTY_HASHES[level];
      const parentHash = hash2(left, right);

      if (parentHash !== EMPTY_HASHES[level + 1]) {
        nextLevel.set(parentIdx, parentHash);
      }
    }

    currentLevel = nextLevel;
    idx = idx >> 1;
  }

  // Root is the single remaining node, or the empty tree hash
  const root = currentLevel.get(0) ?? EMPTY_HASHES[TREE_DEPTH];

  return {
    index: leafIndex.toString(),
    hashPath: hashPath.map((h) => "0x" + h.toString(16).padStart(64, "0")),
    root: "0x" + root.toString(16).padStart(64, "0"),
  };
}

/**
 * Compute a merkle proof for a leaf by its value.
 * Throws if the leaf value is not found in the leaves array.
 */
export function computeMerkleProofForLeaf(
  leaves: bigint[],
  leafValue: bigint,
): MerkleProof {
  const index = leaves.indexOf(leafValue);
  if (index === -1) {
    throw new Error(
      `Leaf value 0x${leafValue.toString(16)} not found in leaves array`,
    );
  }
  return computeMerkleProof(leaves, index);
}
