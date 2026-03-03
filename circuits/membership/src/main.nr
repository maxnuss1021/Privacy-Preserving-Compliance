use dep::merkle::compute_merkle_root;

// Merkle membership proof.
// Proves that `address` is a leaf in the Merkle tree with the given `root`,
// without revealing the address or its position.
//
// Public inputs:  root
// Private inputs: address, index, hash_path
fn main(
    address: Field,
    index: Field,
    hash_path: [Field; 32],
    root: pub Field,
) {
    let computed_root = compute_merkle_root(address, index, hash_path);
    assert(computed_root == root);
}

#[test]
fn test_membership() {
    use dep::std::hash::poseidon;

    // Build a depth-1 tree: two leaves, root = hash(leaf0, leaf1)
    let address = 0x00000000000000000000000000000000000000000000000000000068694a6f7373;
    let sibling = 0x0000000000000000000000000000000000000000000000000000000000000000;

    let root = poseidon::bn254::hash_2([address, sibling]);

    // Pad hash_path to 32 with zeros (only first element matters for depth-1)
    let mut hash_path = [0; 32];
    hash_path[0] = sibling;

    main(address, 0, hash_path, root);
}

#[test(should_fail)]
fn test_membership_fails_wrong_root() {
    let address = 0x00000000000000000000000000000000000000000000000000000068694a6f7373;
    let hash_path = [0; 32];
    let wrong_root = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;

    main(address, 0, hash_path, wrong_root);
}
