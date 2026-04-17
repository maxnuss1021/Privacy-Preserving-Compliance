use merkle::compute_merkle_root;
use poseidon::poseidon2::Poseidon2;

// Merkle membership proof.
// Proves that `address` is a leaf in the Merkle tree with the given `root`,
// without revealing the address or its position.
//
// Public inputs:  address, root, root2
// Private inputs: index, hash_path, hash_path2
fn main(
    // user address
    address: pub Field,
    // index of the address in the merkle tree, for the merkle proof
    index: Field,
    // path of sibling nodes for the merkle proof
    hash_path: [Field; 32],
    // merkle root
    root: pub Field,
    //index of the address in the second merkle tree
    index2: Field,
    // path to the sibling nodes of the second merkle proof
    hash_path2: [Field; 32],
    // second merkle root
    root2: pub Field,
) {
    let computed_root = compute_merkle_root(address, index, hash_path);
    let computed_root2 = compute_merkle_root(address, index2, hash_path2);
    assert(computed_root2 == root2);
    assert(computed_root == root);
}

#[test]
fn test_membership() {
    // Sparse depth-32 tree: address at index 0, all siblings zero.
    // Compute the root by hashing up all 32 levels.
    let address = 0x00000000000000000000000000000000000000000000000000000068694a6f7373;
    let hash_path = [0; 32];

    // Walk up the tree: at each level, hash(current, 0)
    let mut current = address;
    for i in 0..32 {
        current = Poseidon2::hash([current, hash_path[i]], 2);
    }
    let root = current;
}

#[test(should_fail)]
fn test_membership_fails_wrong_root() {
    let address = 0x00000000000000000000000000000000000000000000000000000068694a6f7373;
    let hash_path = [0; 32];
    let wrong_root = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;

\
}
