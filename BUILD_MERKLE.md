# build-merkle

Builds a Poseidon2 sparse merkle tree (depth 32) from Ethereum addresses. Outputs the merkle root to stdout and writes the leaves to a JSON file compatible with the regulator CLI and proof manager SDK.

Uses the same `@zkpassport/poseidon2` hash as the SDK and Noir circuits, so roots and proofs are guaranteed to be compatible.

## Prerequisites

From the repository root:

```bash
pnpm install
```

## Usage

```bash
npx tsx packages/build-merkle/index.ts [options] <address> [address...]
```

### Options

| Flag | Description |
|------|-------------|
| `-o <file>` | Output leaves JSON file (default: `leaves.json`) |
| `-f <file>` | Read addresses from a file (one per line, `#` comments ignored) |
| `--sorted` | Sort leaves numerically before building the tree (required for non-membership proofs) |
| `-h` | Show help |

### Membership vs non-membership

The `--sorted` flag controls the leaf ordering in the tree:

- **Without `--sorted`** (default) — leaves are placed in the order they are provided. Use this for **membership** proofs, where the circuit only needs to verify that a leaf exists at some position in the tree.

- **With `--sorted`** — leaves are sorted numerically (ascending) before being placed at indices 0, 1, 2, ... in the tree. Use this for **non-membership** proofs, where the circuit verifies that two adjacent leaves sandwich the target address. Sorting guarantees that adjacent leaves in the tree are also adjacent in value, so no valid address can exist in the gap between them.

### Examples

Build a tree for membership proofs:

```bash
npx tsx packages/build-merkle/index.ts \
  0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
```

Build a sorted tree for non-membership proofs:

```bash
npx tsx packages/build-merkle/index.ts --sorted \
  0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
```

Read from a file:

```bash
npx tsx packages/build-merkle/index.ts --sorted -f addresses.txt -o leaves.json
```

Where `addresses.txt` contains:

```
# Sanctioned addresses
0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B
```

## Output

- **stdout** — Merkle root as a `0x`-prefixed 64-character hex string.
- **stderr** — Status message indicating the number of leaves written and whether sorting was applied.
- **leaves.json** (or path given by `-o`) — JSON array of hex address strings, in tree order.

Example sorted leaves file:

```json
[
  "0x0000000000000000000000000000000000000001",
  "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
  "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"
]
```

## Using with the regulator CLI

For a membership compliance definition:

```bash
ROOT=$(npx tsx packages/build-merkle/index.ts -o leaves.json -f addresses.txt)

regulator-cli new-compliance-definition \
  --merkle-root "$ROOT" \
  --leaves-file leaves.json \
  # ... other flags
```

For a non-membership compliance definition (e.g. sanctions list):

```bash
ROOT=$(npx tsx packages/build-merkle/index.ts --sorted -o leaves.json -f sanctioned.txt)

regulator-cli new-compliance-definition \
  --merkle-root "$ROOT" \
  --leaves-file leaves.json \
  # ... other flags
```

The regulator CLI uploads `leaves.json` to IPFS and stores both the merkle root and the leaves CID on-chain. The proof manager SDK then fetches the leaves from IPFS and computes merkle proofs for individual users.
