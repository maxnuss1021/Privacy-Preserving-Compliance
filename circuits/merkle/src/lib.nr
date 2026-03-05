use poseidon::poseidon2::Poseidon2;

pub fn compute_merkle_root<let N: u32>(leaf: Field, index: Field, hash_path: [Field; N]) -> Field {
    let index_bits: [u1; N] = index.to_le_bits();
    let mut current = leaf;
    for i in 0..N {
        let path_bit = index_bits[i] != 0;
        let (hash_left, hash_right) = if path_bit {
            (hash_path[i], current)
        } else {
            (current, hash_path[i])
        };
        current = Poseidon2::hash([hash_left, hash_right], 2);
    }
    current
}

#[test]
fn test_compute_merkle_root_simple() {
    let index = 0;
    let leaf = 1;
    let leaf_neighbor = 0;

    let real_root = Poseidon2::hash([leaf, leaf_neighbor], 2);
    let hash_path = [0];

    let computed_root = compute_merkle_root(leaf, index, hash_path);
    assert(computed_root == real_root);
}
