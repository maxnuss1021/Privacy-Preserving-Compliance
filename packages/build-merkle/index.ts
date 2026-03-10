#!/usr/bin/env npx tsx

import { poseidon2Hash } from "@zkpassport/poseidon2";
import { readFileSync, writeFileSync } from "fs";

const TREE_DEPTH = 32;

function hash2(left: bigint, right: bigint): bigint {
  return poseidon2Hash([left, right]);
}

// Precompute empty subtree hashes (level 0 = leaf = 0n)
const EMPTY_HASHES: bigint[] = new Array(TREE_DEPTH + 1);
EMPTY_HASHES[0] = 0n;
for (let i = 1; i <= TREE_DEPTH; i++) {
  EMPTY_HASHES[i] = hash2(EMPTY_HASHES[i - 1], EMPTY_HASHES[i - 1]);
}

function computeMerkleRoot(leaves: bigint[]): bigint {
  let currentLevel = new Map<number, bigint>();
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i] !== 0n) {
      currentLevel.set(i, leaves[i]);
    }
  }

  for (let level = 0; level < TREE_DEPTH; level++) {
    const nextLevel = new Map<number, bigint>();
    const visited = new Set<number>();
    for (const [nodeIdx] of currentLevel) {
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
  }

  return currentLevel.get(0) ?? EMPTY_HASHES[TREE_DEPTH];
}

// ── CLI ──────────────────────────────────────────────────────────────

function usage(): never {
  console.error(
    `Usage: build-merkle [options] <address> [address...]

Options:
  -o <file>   Output leaves JSON file (default: leaves.json)
  -f <file>   Read addresses from file (one per line)
  --sorted    Sort leaves numerically before building the tree.
              Required for non-membership proofs, which assume
              adjacent leaves sandwich missing values.

Computes a Poseidon2 sparse merkle tree (depth 32) from the given
Ethereum addresses. Prints the merkle root to stdout and writes the
leaves array to a JSON file suitable for the regulator CLI --leaves-file.`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
let outputFile = "leaves.json";
let sorted = false;
const addresses: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-o" && i + 1 < args.length) {
    outputFile = args[++i];
  } else if (args[i] === "-f" && i + 1 < args.length) {
    const content = readFileSync(args[++i], "utf-8");
    addresses.push(
      ...content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    );
  } else if (args[i] === "--sorted") {
    sorted = true;
  } else if (args[i].startsWith("0x") || args[i].startsWith("0X")) {
    addresses.push(args[i]);
  } else if (args[i] === "-h" || args[i] === "--help") {
    usage();
  } else {
    console.error(`Unknown argument: ${args[i]}`);
    usage();
  }
}

if (addresses.length === 0) usage();

// Convert addresses to bigint leaves
const leaves = addresses.map((addr) => BigInt(addr));

if (sorted) {
  leaves.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// Format leaves as hex strings for the JSON file
const leavesHex = leaves.map(
  (l) => "0x" + l.toString(16).padStart(40, "0"),
);

// Compute root
const root = computeMerkleRoot(leaves);
const rootHex = "0x" + root.toString(16).padStart(64, "0");

// Write leaves file
writeFileSync(outputFile, JSON.stringify(leavesHex, null, 2) + "\n");

// Output root to stdout, status to stderr
console.log(rootHex);
const sortLabel = sorted ? " (sorted)" : "";
console.error(`Wrote ${leaves.length} leaves${sortLabel} to ${outputFile}`);
