use merkle::compute_merkle_root;
use poseidon::poseidon::bn254;

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
    // Sparse depth-32 tree: address at index 0, all siblings zero.
    // Compute the root by hashing up all 32 levels.
    let address = 0x00000000000000000000000000000000000000000000000000000068694a6f7373;
    let hash_path = [0; 32];

    // Walk up the tree: at each level, hash(current, 0)
    let mut current = address;
    for i in 0..32 {
        current = bn254::hash_2([current, hash_path[i]]);
    }
    let root = current;

    main(address, 0, hash_path, root);
}

#[test(should_fail)]
fn test_membership_fails_wrong_root() {
    let address = 0x00000000000000000000000000000000000000000000000000000068694a6f7373;
    let hash_path = [0; 32];
    let wrong_root = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;

    main(address, 0, hash_path, wrong_root);
}
