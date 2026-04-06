# Privacy-Preserving Compliance (PPC) Framework Specification

**Version**: 1.0-draft  
**Date**: 2026-04-02  
**Author**: Joss Duff

---

## 1. Introduction

### 1.1 Purpose

This document is the authoritative specification for the Privacy-Preserving Compliance (PPC) framework. It defines the contracts, data formats, proof requirements, and interaction protocols that enable three independent actor types — Regulators, Applications, and Users — to interoperate without direct communication.

Any party in one of these three roles MUST be able to implement their part of the framework using only this document, and their implementation MUST interoperate with implementations built by the other two actors.

This document is not a thesis or motivational argument. For the theoretical foundations, design rationale, and security analysis, see the accompanying thesis document *Privacy Preserving Compliance* by Joss Duff.

### 1.2 Key Words

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt):

- **MUST** / **REQUIRED** / **SHALL**: absolute requirement.
- **MUST NOT** / **SHALL NOT**: absolute prohibition.
- **SHOULD** / **RECOMMENDED**: there may be valid reasons to ignore, but implications must be understood.
- **MAY** / **OPTIONAL**: truly optional; implementations must interoperate whether or not the feature is present.

### 1.3 Scope

This specification covers:

- The actor model and each actor's responsibilities.
- The constraint system for expressing compliance logic.
- On-chain contract interfaces for compliance definitions and proof verification.
- Proof system requirements (abstracted from any specific proving system).
- Off-chain artifact storage requirements.
- Interaction protocols and the compliance lifecycle.
- Versioning and update semantics.

This specification does NOT cover:

- Choice of ZK proving system, circuit language, or hash function.
- Choice of content-addressable storage system.
- Choice of blockchain or smart contract language.
- Application-specific business logic beyond the compliance gate.

### 1.4 Reference Implementation

A reference implementation accompanies this specification at [github.com/JossDuff/Privacy-Preserving-Compliance](https://github.com/JossDuff/Privacy-Preserving-Compliance). It makes the following implementation choices:

| Concern | Reference Implementation Choice |
|---|---|
| Smart contracts | Solidity on EVM (Sepolia testnet) |
| Circuit language | Noir |
| Proving system | Barretenberg (UltraHonk) |
| Content-addressable storage | IPFS (Kubo) |
| Hash function (Merkle trees) | Poseidon2 |
| Ethereum library (regulator CLI) | alloy (Rust) |
| Ethereum library (SDK) | viem (TypeScript) |
| Public parameter commitment | Sparse Merkle tree, depth 32 |

These choices are illustrative. Conformant implementations MAY use any technologies that satisfy the requirements in this specification.

---

## 2. Framework Overview

### 2.1 Problem

Blockchain privacy and regulatory compliance present a fundamental tension: privacy requires that only the individual knows certain information, while compliance traditionally requires revealing information. This framework resolves this conflict by enabling users to prove compliance cryptographically — using zero-knowledge proofs — without revealing private transaction data.

### 2.2 Design Goals

The framework is designed to satisfy the following properties:

| Property | Definition |
|---|---|
| **No deanonymization** | No entity has the ability to reveal private information about a user's address, balances, or transaction history. |
| **Proactive compliance** | Non-compliant actions are prevented before execution, not detected afterward. |
| **Rich compliance language** | Compliance definitions may reference any on-chain data: transaction histories, contract states, fund origins, user secrets, etc. |
| **Multiple compliance** | Applications can require proofs of multiple compliance definitions simultaneously, supporting multi-jurisdictional requirements. |
| **Secret inputs** | Users may supply private arguments to the compliance evaluation that are never revealed to any other party. |
| **Verifiable compliance** | Compliance criteria are publicly viewable and a user's compliance status is cryptographically verifiable on-chain. |
| **Chain agnostic** | The framework operates on any blockchain with smart contracts and ZK proof verification capability. |
| **Modular privacy** | The framework is independent of any specific privacy mechanism and can be applied to any privacy protocol. |

### 2.3 Actor Model

The framework defines three actor types. Each operates independently; there is no direct communication between actors.

```
┌─────────────┐     publishes      ┌─────────────────────┐
│  Regulator  │───────────────────►│ ComplianceDefinition │
└─────────────┘                    │      Contract        │◄────────────┐
                                   └──────────┬───────────┘             │
                                              │                   requires
                                              │                         │
                                              ▼                  ┌──────┴──────┐
                                   ┌──────────────────┐          │ Application │
                                   │      User        │─────────►│  Contract   │
                                   │  (Proof Manager) │ submits  └─────────────┘
                                   └──────────────────┘  proof
```

**Regulator**: Creates and publishes compliance definitions. Responsible for maintaining and updating definitions over time (e.g., updating sanction lists). Publishing is permissionless — any entity MAY act as a regulator. In practice, regulators are expected to be government agencies, blockchain analytics companies, or other entities with compliance expertise.

**Application**: An on-chain smart contract that selects one or more compliance definitions and gates entry-point functions behind proof verification. Applications reference compliance definitions by contract address.

**User**: Generates zero-knowledge proofs demonstrating compliance and submits them as transaction arguments when interacting with compliance-requiring applications. Users are responsible for locally managing proof generation and caching.

### 2.4 Composability

The framework is composable along three dimensions:

1. **Definition reuse**: A single compliance definition can be required by any number of applications.
2. **Multiple requirements**: An application can require proofs of multiple compliance definitions.
3. **Constraint sharing**: When multiple compliance definitions share constraints, a user who has proved the shared constraint for one definition can reuse that proof for the other, reducing computation (see §4.5).

---

## 3. Terminology

| Term | Definition |
|---|---|
| **Constraint** | A boolean predicate over blockchain state. The atomic unit of compliance logic. |
| **Compliance Definition** | A boolean combination of constraints with a time-validity window. Expressed as a ZK circuit. |
| **Compliance Version** | A snapshot of a compliance definition at a point in time, capturing the verifier, public parameter commitment, time bounds, and artifact references. |
| **Verifier Contract** | A smart contract that verifies zero-knowledge proofs. Contains the verification key for a specific circuit. |
| **ComplianceDefinition Contract** | The stable on-chain representation of a compliance definition. Its address remains constant across updates. |
| **Public Input** | A value visible to both the prover and verifier, passed to the verifier during proof verification. |
| **Private Input** | A value known only to the prover (the user), used during proof generation but never revealed. |
| **Content-Addressable Storage** | A storage system where data is referenced by a hash of its content (e.g., IPFS, Arweave). |
| **Circuit** | A program expressed as a ZK-provable function `f(x, w) → {True, False}`, where `x` is the public input and `w` is the private input. |

---

## 4. Constraint System

### 4.1 Constraint Definition

A **constraint** is a boolean predicate that evaluates blockchain state. A constraint `C` is expressed in the general form:

```
C = Q x ∈ D(s, i) : P(x, p)
```

where:

- **Quantifier** (`Q ∈ {∀, ∃, ...}`): The logical quantifier over the domain.

- **Chain State** (`i`): The blockchain state(s) from which the domain is evaluated:
  - *Atomic states*: A single block `B_k` or a block range `[B_i, B_j]`.
  - *State sets*: Parameterized windows with implicit universal quantification, e.g., `{[B_i, B_j] ⊆ [B_0, B_current] : condition}`.

- **Subject** (`s`): The root blockchain entity from which the domain is derived. Examples:
  - `sender(txn)` — the address that initiated the transaction.
  - `recipient(txn)` — the address that received the transaction.
  - `balance(addr)` — an account balance.
  - `result(contract_fn)` — the result of a contract call.
  - `payload(txn)` — a transaction's payload.

- **Domain** (`D(s, i) → {x, ...}`): A function mapping a subject and chain state to a collection of blockchain entities over which the quantifier ranges. Examples:
  - Singleton: `D(s, i) = {s}` (evaluates a single subject).
  - Transaction history: `D(addr, i) = history(addr, i)`.
  - Filtered collections: `D(s, i) = {x ∈ D'(s, i) : filter(x)}`.

- **Parameter** (`p`): Values against which domain elements are evaluated:
  - Public parameters `p_pub` — provided by the regulator (e.g., sanction lists, threshold values).
  - Private inputs `p_priv` — provided by the user (e.g., secrets, identifying information).

- **Predicate** (`P → {true, false}`): A boolean function applied to domain elements:
  - On individual elements: comparison operations `P(x, p) = (x φ p)` where `φ ∈ {=, ≠, <, ≤, >, ≥, ∈, ∉, ...}`.
  - On entire collections: aggregate comparisons `P(X, p) = (agg(X) φ p)` where `agg ∈ {Σ, count, max, min, ...}`.
  - Nested constraints: `P(x, p) = C'(x, p', i')`.

### 4.2 Predicate Constraints

For constraints independent of historic chain state, a simplified notation called **predicate constraints** is used:

```
C = s φ p
```

where `φ ∈ {=, ≠, <, ≤, >, ≥, ∈, ∉, ...}`, `p` is the parameter, and `s` is the subject. When predicate constraint notation is used, the chain state is assumed to be the current block.

### 4.3 Compliance Definition

A **compliance definition** is a boolean combination of constraints with a time-validity window. Given constraints `C_1, ..., C_k`:

```
R = C_1 ∘ C_2 ∘ ... ∘ C_k,  [t_start, t_end]
```

where:
- `∘` denotes arbitrary boolean operators (`∧`, `∨`, `¬`, and parentheses for grouping).
- `t_start` and `t_end` are block heights defining the validity period.

A compliance definition `R` is **active** at time `t` if and only if `t_start ≤ t ≤ t_end`. Open-ended validity is expressed with `t_end = ∞`.

### 4.4 Example Constraints

**Non-Membership (NON-MEM)**: Sender is not on a sanction list.
```
C_non-mem = sender(txn) ∉ p_sanctioned
```

**Membership (MEM)**: Sender is on an allow-list.
```
C_mem = sender(txn) ∈ p_allowlist
```

**Protocol Interaction (INTERACT)**: Sender has interacted with a specific protocol.
```
C_interact = ∃ t ∈ txn_history(sender(txn), [B_0, B_current]) : recipient(t) = p_protocol
```

**Protocol Avoidance (AVOID)**: Sender has never interacted with a specific protocol.
```
C_avoid = ∀ t ∈ txn_history(sender(txn), [B_0, B_current]) : recipient(t) ≠ p_protocol
```

**Account Age (AGE)**: Sender's account is at least a certain age.
```
C_age = ∃ t ∈ txn_history(sender(txn), [B_0, B_current - p_min-age]) : sender(t) = sender(txn)
```

**Anti-Structuring (STRUCTURE)**: Sender has not structured transactions to evade reporting thresholds.
```
C_structure = ∀ r ∈ recipients(sender(txn), {[B_j, B_k] ⊆ [B_0, B_current] : (B_k - B_j) ≤ p_window}) :
              Σ_{txn→r} amount(txn) < p_threshold
```

### 4.5 Constraint Sharing and Proof Reuse

When multiple compliance definitions require the same constraint, that constraint MAY be proved once and applied across definitions:

**Example**: An application requires `R_1 = C_1 ∧ C_2` and `R_2 = C_1`. A user proving `R_1` also proves `R_2`, since `R_1`'s constraints are a superset of `R_2`'s.

**Example**: An application requires `R_1 = C_1 ∧ C_2` and `R_2 = C_2 ∧ C_3`. A user needs to prove only three constraints total (`C_1`, `C_2`, `C_3`), reusing the proof of `C_2` across both definitions.

---

## 5. On-Chain Contracts

This section specifies the on-chain contract interfaces that all implementations MUST provide. Interfaces are expressed in Solidity syntax as the canonical reference, but implementations MAY use any smart contract language that provides equivalent functionality.

### 5.1 IVerifier Interface

Every ZK verifier contract MUST implement the following interface:

```solidity
interface IVerifier {
    /// @notice Verifies a zero-knowledge proof against the given public inputs.
    /// @param _proof The serialized proof bytes.
    /// @param _publicInputs The public inputs to the verification circuit.
    /// @return True if the proof is valid.
    function verify(
        bytes calldata _proof,
        bytes32[] calldata _publicInputs
    ) external returns (bool);
}
```

**Requirements**:
- The `verify` function MUST return `true` if and only if the proof is valid for the given public inputs.
- The `verify` function MUST NOT revert on an invalid proof; it MUST return `false`.
- The serialization format of `_proof` is determined by the proving system used.
- The contents of `_publicInputs` are defined by the circuit. Different circuits MAY have different numbers and types of public inputs.

### 5.2 ComplianceDefinition Contract

The `ComplianceDefinition` contract is the stable on-chain representation of a compliance definition. Applications reference this contract's address, which MUST remain constant across all updates to the compliance definition.

#### 5.2.1 ComplianceVersion Struct

Each version of a compliance definition is captured as a `ComplianceVersion`:

```solidity
struct ComplianceVersion {
    address verifier;       // Address of the ZK verifier contract for this version
    bytes32 paramsCommitment; // On-chain commitment to public parameters
    uint256 tStart;         // Block height at which this version becomes active
    uint256 tEnd;           // Block height at which this version expires
    string  circuitRef;     // Content-addressable reference to the circuit artifacts
    string  paramsRef;      // Content-addressable reference to the full public parameters
}
```

**Field semantics**:

| Field | Description |
|---|---|
| `verifier` | Address of a contract implementing `IVerifier`. Changes on circuit updates; remains the same on parameter-only updates. |
| `paramsCommitment` | An on-chain commitment to the public parameters used in proof verification. The form of this commitment is circuit-specific (e.g., a Merkle root, a hash). This value MUST be included as a public input during verification so the verifier can confirm the proof was generated against the correct parameter set. Compliance definitions that do not use off-chain public parameters MAY set this to `bytes32(0)`. |
| `tStart` | Block height at which this version becomes active. MAY be set in the future to publish a version before it takes effect. |
| `tEnd` | Block height at which this version expires. Set to `type(uint256).max` for no expiration. |
| `circuitRef` | A content-addressable identifier (e.g., an IPFS CID) pointing to the circuit artifacts required for proof generation. |
| `paramsRef` | A content-addressable identifier pointing to the full public parameter data, enabling users to reconstruct proof inputs locally. MAY be empty if the compliance definition has no off-chain public parameters. |

#### 5.2.2 Storage

```solidity
ComplianceVersion[] public versions;  // Append-only version history
address public regulator;             // Address authorized to update this definition
string public name;                   // Human-readable name
```

The `versions` array MUST be append-only. Implementations MUST NOT modify or delete existing entries.

#### 5.2.3 Functions

**Constructor**

```solidity
constructor(address _regulator, string memory _name)
```

Deploys a new compliance definition. The contract is deployed with no versions; the regulator MUST call `updateCircuit` to publish the first version.

**verify**

```solidity
function verify(bytes calldata proof) external returns (bool)
```

Verifies a user's proof against the currently active version. This is the function that applications call to gate access.

The implementation of `verify` MUST:
1. Retrieve the active version via `getActiveVersion()`.
2. Construct the public inputs array. The contents of this array are circuit-specific. At minimum, implementations SHOULD include:
   - A binding to the transaction signer (to prevent proof replay).
   - The `paramsCommitment` from the active version (if the circuit uses public parameters).
3. Call `IVerifier(activeVersion.verifier).verify(proof, publicInputs)`.
4. Return the result.

> **Note on public inputs**: The public inputs passed to the verifier are determined by the circuit that the regulator published. The framework does not prescribe a fixed set of public inputs. Regulators define what public inputs their circuit requires, and the `verify` function constructs them accordingly. Common patterns include binding the proof to the prover's address and to the public parameter commitment, but these are not universal requirements.

**updateCircuit**

```solidity
function updateCircuit(
    address newVerifier,
    bytes32 newParamsCommitment,
    uint256 tStart,
    uint256 tEnd,
    string calldata circuitRef,
    string calldata paramsRef
) external
```

Publishes a new version with an updated circuit and verifier. Used when the compliance logic itself changes. MUST be callable only by the `regulator` address. MUST append a new `ComplianceVersion` to the `versions` array.

**updateParams**

```solidity
function updateParams(
    bytes32 newParamsCommitment,
    string calldata newParamsRef
) external
```

Publishes a new version with updated public parameters, reusing the current verifier. Used when only parameters change (e.g., adding an address to a sanction list). MUST be callable only by the `regulator` address. MUST append a new `ComplianceVersion` that copies the current version's `verifier`, `tStart`, `tEnd`, and `circuitRef`, replacing only `paramsCommitment` and `paramsRef`.

**getActiveVersion**

```solidity
function getActiveVersion() public view returns (ComplianceVersion memory)
```

Returns the most recently published version whose validity window contains the current block height (`tStart ≤ block.number ≤ tEnd`). MUST revert if no version is currently active.

**getVersionAt**

```solidity
function getVersionAt(uint256 blockHeight) external view returns (ComplianceVersion memory)
```

Returns the most recently published version whose validity window contains the given block height. Enables historical verification. MUST revert if no version was active at the given block height.

**getVersionCount**

```solidity
function getVersionCount() external view returns (uint256)
```

Returns the total number of versions in the history. Useful for enumerating the audit trail and for proof cache invalidation.

#### 5.2.4 Errors

Implementations MUST revert with descriptive errors in the following cases:

| Condition | Error |
|---|---|
| Non-regulator calls a regulator-only function | `NotRegulator()` |
| No version is active at the current block | `NoActiveVersion()` |
| No version was active at a queried block height | `NoVersionAtBlock(uint256 blockHeight)` |

### 5.3 Application Integration Pattern

Applications integrate with the framework by referencing one or more `ComplianceDefinition` contracts and gating entry-point functions behind proof verification.

**Minimal integration pattern**:

```solidity
contract CompliantApplication {
    ComplianceDefinition public immutable complianceDefinition;

    constructor(address _complianceDefinition) {
        complianceDefinition = ComplianceDefinition(_complianceDefinition);
    }

    function protectedAction(bytes calldata proof, /* other args */) external {
        require(complianceDefinition.verify(proof), "Compliance check failed");
        // ... application logic ...
    }
}
```

**Requirements**:
- Applications MUST call `complianceDefinition.verify(proof)` and revert if it returns `false`.
- Applications SHOULD store the `ComplianceDefinition` reference as `immutable` to prevent the reference from being changed after deployment.
- Applications requiring multiple compliance definitions MUST verify a proof for each.
- The `proof` argument MUST be passed through from the user's transaction calldata.

**Multiple compliance example**:

```solidity
function protectedAction(
    bytes calldata proofA,
    bytes calldata proofB
) external {
    require(complianceDefinitionA.verify(proofA), "Compliance A failed");
    require(complianceDefinitionB.verify(proofB), "Compliance B failed");
    // ... application logic ...
}
```

---

## 6. Proof System Requirements

### 6.1 General Requirements

The framework is agnostic to the specific zero-knowledge proving system used. Implementations MAY use any proving system that satisfies:

1. **Soundness**: It MUST be computationally infeasible to generate a valid proof for a false statement.
2. **Zero-knowledge**: The proof MUST NOT reveal the prover's private inputs.
3. **Non-interactivity**: Proofs MUST be non-interactive — the prover generates the proof without communication with the verifier.
4. **On-chain verifiability**: Proofs MUST be verifiable by a smart contract via the `IVerifier` interface.

### 6.2 Trusted Setup Considerations

Proof systems that require a per-circuit trusted setup (e.g., Groth16) are permitted but impractical for this framework. Because compliance definitions are updated over time — potentially changing the underlying circuit — a new trusted setup ceremony would be required for each update.

Implementations SHOULD use a proof system with one of:
- **No trusted setup** (e.g., STARKs).
- **Universal/updatable trusted setup** (e.g., PLONK, UltraHonk) — a single setup ceremony can be reused across all circuits.

### 6.3 Public Inputs

Public inputs are values visible to both the prover and verifier. They are circuit-specific and defined by the regulator who publishes the compliance definition.

**Common patterns** (RECOMMENDED but not required by the framework):

- **Prover identity binding**: Including the prover's address as a public input prevents proof replay — a proof generated by one user cannot be submitted by another. The mechanism for obtaining the prover's address on-chain is implementation-specific (e.g., `tx.origin`, `msg.sender`, or a signed message).
- **Parameter commitment**: Including the `paramsCommitment` from the active `ComplianceVersion` as a public input binds the proof to the correct public parameter set. This is REQUIRED for any circuit that uses off-chain public parameters, as it is the mechanism by which the verifier confirms that the proof was generated against the authentic parameters.
- **Historical state commitments**: For circuits that make statements over an account's transaction history or other historical data, a public input MUST be provided that allows the verifier to confirm the correctness of the historical data used in the proof (e.g., a state root, a block hash).

### 6.4 Proof Format

The serialization format of proofs is determined by the proving system and MUST match what the deployed `IVerifier` contract expects. The proof is passed as an opaque `bytes` blob through the `ComplianceDefinition.verify()` function to the underlying `IVerifier.verify()` function.

### 6.5 Proof Generation

Proof generation occurs locally on the user's device. The general process is:

1. **Witness generation**: Execute the circuit with the user's inputs to produce a witness.
2. **Proof generation**: Use the witness and proving key to generate a proof.

The framework does not prescribe whether proofs are generated natively or in a browser (WASM) environment.

### 6.6 Proof Caching

Users SHOULD cache previously generated proofs locally. A proof remains valid as long as the compliance definition version it was generated against is still active. Implementations SHOULD key cached proofs by the compliance definition contract address and the version count at the time of generation.

When the version count changes (indicating an update by the regulator), cached proofs MUST be invalidated for that compliance definition.

---

## 7. Off-Chain Artifact Storage

### 7.1 General Requirements

Compliance definitions reference off-chain artifacts via content-addressable identifiers stored on-chain in the `ComplianceVersion` struct. Implementations MAY use any content-addressable storage system (IPFS, Arweave, or others) provided that:

1. **Content integrity**: The identifier MUST be derived from the content itself (e.g., a content hash), ensuring that data retrieved by the identifier matches what was originally published.
2. **Public availability**: Artifacts MUST be publicly retrievable by any user who needs to generate a proof. Regulators SHOULD ensure artifacts remain available for the lifetime of the compliance definition.
3. **Immutability**: Once published, artifacts at a given identifier MUST NOT change. Updates are handled by publishing new versions with new identifiers.

### 7.2 Circuit Artifacts

The `circuitRef` field in `ComplianceVersion` points to the compiled circuit artifacts needed for proof generation. The artifact MUST contain sufficient information for a user to:

1. Determine the circuit's public and private input schema.
2. Generate a witness.
3. Generate a proof.

The specific format of circuit artifacts depends on the proving system. For Noir/Barretenberg, this is a JSON file containing `bytecode` and `abi` fields. Other proving systems will have their own artifact formats.

### 7.3 Public Parameter Data

The `paramsRef` field in `ComplianceVersion` points to the full public parameter data. This allows users to reconstruct whatever data structures are needed for proof generation (e.g., Merkle trees for membership proofs).

The format of public parameter data is circuit-specific. The regulator MUST document the expected format as part of the compliance definition.

If a compliance definition does not use off-chain public parameters, `paramsRef` MAY be empty.

### 7.4 On-Chain Commitment to Public Parameters

When a compliance definition uses off-chain public parameters, the `paramsCommitment` field MUST contain an on-chain commitment to those parameters. This commitment serves as a public input during proof verification, binding the proof to the correct parameter set.

The form of the commitment is circuit-specific:
- For set membership/non-membership: a Merkle root of the set.
- For other parameter types: a hash or other binding commitment.

The commitment MUST have the property that a user cannot generate a valid proof against a different parameter set than the one committed to on-chain.

---

## 8. Interaction Protocols

This section specifies the complete lifecycle of a compliance definition, from creation through proof verification.

### 8.1 Regulator: Publish a New Compliance Definition

A regulator publishes a new compliance definition by performing the following steps:

1. **Define constraints**: Express the compliance logic as one or more constraints (§4.1). Document the constraints in their formal notation.
2. **Write circuit**: Implement the compliance logic as a ZK circuit in the chosen circuit language. The circuit MUST define which inputs are public and which are private.
3. **Compile circuit**: Compile the circuit into the artifact format required by the chosen proving system.
4. **Generate verification key**: Generate the verification key from the compiled circuit.
5. **Generate verifier contract**: Produce a smart contract that implements `IVerifier` (§5.1) using the verification key.
6. **Prepare public parameters** (if applicable): Construct the off-chain public parameter data and compute the on-chain commitment (e.g., build a Merkle tree, compute its root).
7. **Upload artifacts to content-addressable storage**:
   - Upload the compiled circuit → obtain `circuitRef`.
   - Upload the public parameter data (if applicable) → obtain `paramsRef`.
8. **Deploy verifier contract**: Deploy the `IVerifier` implementation on-chain.
9. **Deploy ComplianceDefinition contract**: Deploy a new `ComplianceDefinition` contract with the regulator's address and a human-readable name.
10. **Publish first version**: Call `updateCircuit()` on the deployed contract with:
    - `newVerifier`: address of the deployed verifier contract.
    - `newParamsCommitment`: the on-chain commitment (or `bytes32(0)` if none).
    - `tStart`: block height at which this version becomes active.
    - `tEnd`: block height at which this version expires (or `type(uint256).max`).
    - `circuitRef`: the content-addressable identifier of the circuit artifacts.
    - `paramsRef`: the content-addressable identifier of the public parameters (or empty).

**Result**: The `ComplianceDefinition` contract is live at a stable address. Applications can reference it. Users can begin generating proofs once `tStart` is reached.

### 8.2 Regulator: Update Public Parameters

When only public parameters change (e.g., adding an address to a sanction list):

1. Prepare updated public parameters and compute the new on-chain commitment.
2. Upload the updated parameter data → obtain `newParamsRef`.
3. Call `updateParams(newParamsCommitment, newParamsRef)` on the existing `ComplianceDefinition` contract.

The circuit and verifier remain unchanged. Users who have cached proofs MUST re-generate proofs for constraints affected by the parameter change, but MAY reuse proofs for unaffected constraints.

### 8.3 Regulator: Update Circuit (Constraint Update)

When the compliance logic itself changes (e.g., adding or removing a constraint):

1. Write, compile, and generate a new verification key for the updated circuit.
2. Generate and deploy a new verifier contract.
3. Upload the new circuit artifacts → obtain new `circuitRef`.
4. Prepare updated public parameters if needed → obtain new `paramsRef`.
5. Call `updateCircuit(newVerifier, newParamsCommitment, tStart, tEnd, circuitRef, paramsRef)` on the existing `ComplianceDefinition` contract.

The `ComplianceDefinition` contract address remains stable. Applications require no changes.

### 8.4 Application: Integrate Compliance

An application integrates with the framework by:

1. **Select compliance definitions**: Identify one or more `ComplianceDefinition` contracts that match the application's regulatory requirements.
2. **Store references**: Store the `ComplianceDefinition` contract address(es) in the application contract, preferably as `immutable`.
3. **Gate entry points**: Modify entry-point functions to accept a `proof` parameter (one per required compliance definition) and call `complianceDefinition.verify(proof)` before executing application logic. Revert if verification fails.

**After integration**: All future users of the application are guaranteed to be compliant. The application requires no further action unless it wishes to change which compliance definitions it enforces.

### 8.5 User: Generate and Submit a Compliance Proof

A user interacts with a compliance-requiring application by:

1. **Identify requirements**: Determine which `ComplianceDefinition` contract(s) the application requires. Read the contract address(es) from the application contract.
2. **Read active version**: Call `getActiveVersion()` on each required `ComplianceDefinition` to obtain the `circuitRef`, `paramsRef`, `paramsCommitment`, and `verifier` address.
3. **Check cache**: If a valid cached proof exists for this compliance definition at the current version count, skip to step 7.
4. **Fetch artifacts**: Retrieve the circuit artifacts from content-addressable storage using `circuitRef`. If the circuit uses public parameters, retrieve them using `paramsRef`.
5. **Construct inputs**: Prepare the circuit's public and private inputs:
   - Public inputs as defined by the circuit (e.g., the user's address, the `paramsCommitment`).
   - Private inputs as required (e.g., Merkle proof paths, user secrets).
6. **Generate proof**: Execute the circuit to generate a witness, then produce the ZK proof.
7. **Submit proof**: Call the application's entry-point function, passing the proof(s) as calldata arguments.
8. **Cache proof**: Store the generated proof locally, keyed by the compliance definition address and version count, for future reuse.

### 8.6 Lifecycle Sequence

```
  Regulator              Blockchain             Application            User
     │                       │                       │                   │
     │  deploy Verifier      │                       │                   │
     │──────────────────────►│                       │                   │
     │  deploy CompDef       │                       │                   │
     │──────────────────────►│                       │                   │
     │  updateCircuit(v1)    │                       │                   │
     │──────────────────────►│                       │                   │
     │                       │                       │                   │
     │                       │  deploy App(CompDef)  │                   │
     │                       │◄──────────────────────│                   │
     │                       │                       │                   │
     │                       │                       │  getActiveVersion()
     │                       │◄──────────────────────┼───────────────────│
     │                       │────────────────────────┼──────────────────►│
     │                       │                       │                   │
     │                       │                       │   fetch circuit   │
     │                       │                       │   from storage    │
     │                       │                       │    ◄──────────────│
     │                       │                       │                   │
     │                       │                       │  generate proof   │
     │                       │                       │    ◄──────────────│
     │                       │                       │                   │
     │                       │                       │  app.action(proof)│
     │                       │                       │◄──────────────────│
     │                       │  CompDef.verify(proof) │                  │
     │                       │◄──────────────────────│                   │
     │                       │  Verifier.verify()    │                   │
     │                       │──────────────────────►│                   │
     │                       │       true            │                   │
     │                       │◄──────────────────────│                   │
     │                       │  execute action       │                   │
     │                       │──────────────────────►│                   │
     │                       │                       │   success         │
     │                       │                       │──────────────────►│
```

---

## 9. Versioning and Update Semantics

### 9.1 Append-Only History

The `versions` array in a `ComplianceDefinition` contract is append-only. Each call to `updateCircuit` or `updateParams` appends a new `ComplianceVersion`. Previous versions are never modified or deleted.

This provides:
- A complete audit trail of all changes to the compliance definition.
- The ability to verify proofs against historical versions.
- Transparency — any update (including potentially malicious ones) is publicly visible.

### 9.2 Time-Bounded Validity

Each `ComplianceVersion` has a validity window defined by `[tStart, tEnd]` in block heights. This enables:

- **Scheduled activation**: A regulator MAY publish a version with a future `tStart`, allowing applications and users to prepare before it takes effect.
- **Graceful expiration**: Setting `tEnd` allows versions to expire automatically.
- **Cross-chain updates**: Publishing updates ahead of `tStart` allows time for the update transaction to finalize on all chains before the new version takes effect, mitigating cross-chain synchronization issues.

### 9.3 Post-Update Re-proving

When a regulator updates a compliance definition, users with cached proofs MUST re-evaluate their proofs:

- **Parameter update**: Users MUST re-prove constraints affected by the parameter change. Proofs for unaffected constraints MAY be reused.
- **Circuit update**: Users MUST re-prove all constraints in the new circuit, as the verifier has changed.
- **Aggregate proof**: In both cases, the aggregate compliance definition proof MUST be regenerated.

Regulators SHOULD prefer small, targeted updates (e.g., updating only a parameter list) over full circuit updates, as this minimizes re-proving cost for users.

### 9.4 Regulatory Arbitrage Window

There exists a brief period between when an address becomes non-compliant (e.g., gets sanctioned) and when the compliance definition's parameters are updated to reflect this. This window is inherent to any system that relies on parameter updates and is not unique to this framework.

Regulators SHOULD minimize this window by updating parameters promptly. Applications that require stronger guarantees MAY implement additional mechanisms such as deposit delays that require users to prove compliance for a period after their initial interaction.

---

## 10. Security Considerations

### 10.1 Proof Replay Prevention

A proof generated by one user SHOULD NOT be usable by another. Implementations SHOULD bind proofs to the prover's identity by including the prover's address as a public input to the circuit. The mechanism for obtaining the prover's address on-chain is implementation-specific.

Without prover identity binding, an attacker could observe a compliant user's proof on-chain and replay it in their own transaction.

### 10.2 Regulator Trust

Publishing compliance definitions is permissionless. Applications MUST exercise due diligence in selecting compliance definitions from reputable sources. A malicious regulator could:

- Publish an update that censors specific addresses.
- Publish incorrect parameters.
- Fail to update parameters promptly.

The framework mitigates this through transparency: all compliance definitions and their updates are public on-chain. Any malicious update is observable. Additionally, because publishing is permissionless, applications that lose trust in a regulator MAY switch to or publish their own compliance definition.

### 10.3 No Deanonymization Guarantee

The framework guarantees that no entity can learn a user's private inputs from their proof. The proof is zero-knowledge — it reveals nothing beyond the truth of the compliance statement.

However, metadata outside the framework (e.g., transaction timing, gas patterns, IP addresses) may reduce privacy. These concerns are outside the scope of this specification.

### 10.4 Artifact Availability

If circuit artifacts or public parameter data become unavailable from content-addressable storage, users cannot generate new proofs. Regulators SHOULD ensure artifacts are pinned or replicated across multiple storage providers for the lifetime of the compliance definition.

### 10.5 On-Chain Parameter Commitment Integrity

For compliance definitions that use off-chain public parameters, the on-chain `paramsCommitment` is the sole mechanism by which the verifier confirms the proof was generated against the authentic parameter set. If this commitment is not included as a public input, a user could generate a valid proof against fabricated parameters.

Circuit authors MUST ensure that any off-chain data used in the proof is bound to an on-chain commitment provided as a public input.

---

## 11. Interoperability Requirements

### 11.1 Cross-Implementation Interoperability

The framework achieves interoperability through shared on-chain interfaces. Two implementations are interoperable if:

1. The regulator's `ComplianceDefinition` contract conforms to §5.2.
2. The regulator's verifier contract conforms to §5.1.
3. The application calls `verify()` per §5.3.
4. The user generates proofs that satisfy the deployed verifier.

No direct communication between actors is required. The blockchain and content-addressable storage serve as the shared coordination layer.

### 11.2 Chain Requirements

The framework can be deployed on any blockchain that provides:

1. Smart contracts with sufficient expressiveness to implement the interfaces in §5.
2. The ability to verify ZK proofs on-chain (either natively or via a precompile/library).
3. A block height or equivalent monotonic ordering for time-bounded validity windows.

### 11.3 Privacy Mechanism Independence

The framework is independent of any specific privacy mechanism. Compliance definitions operate over whatever data is available to the circuit — whether from a transparent chain, a mixer, a private state system, or any other privacy protocol.

Applications using this framework MAY simultaneously use any privacy protocol. The framework does not interfere with or depend on the privacy mechanism.

---

## Appendix A: Reference Implementation Contract ABI

The following is the Solidity ABI for the reference implementation's `ComplianceDefinition` contract. Note that the reference implementation names the `paramsCommitment` field `merkleRoot` and the `paramsRef` field `leavesHash`, reflecting its use of Merkle trees for parameter commitments.

```solidity
// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.21;

interface IComplianceDefinition {
    struct ComplianceVersion {
        address verifier;
        bytes32 merkleRoot;     // paramsCommitment in the spec
        uint256 tStart;
        uint256 tEnd;
        string  metadataHash;   // circuitRef in the spec
        string  leavesHash;     // paramsRef in the spec
    }

    function name() external view returns (string memory);
    function regulator() external view returns (address);
    function versions(uint256 index) external view returns (
        address verifier,
        bytes32 merkleRoot,
        uint256 tStart,
        uint256 tEnd,
        string memory metadataHash,
        string memory leavesHash
    );

    function verify(bytes calldata proof) external returns (bool);

    function updateCircuit(
        address newVerifier,
        bytes32 newMerkleRoot,
        uint256 tStart,
        uint256 tEnd,
        string calldata metadataHash,
        string calldata leavesHash
    ) external;

    function updateParams(
        bytes32 newMerkleRoot,
        string calldata newLeavesHash
    ) external;

    function getActiveVersion() external view returns (ComplianceVersion memory);
    function getVersionAt(uint256 blockHeight) external view returns (ComplianceVersion memory);
    function getVersionCount() external view returns (uint256);

    error NotRegulator();
    error NoActiveVersion();
    error NoVersionAtBlock(uint256 blockHeight);
}
```

The reference implementation constructs two public inputs in `verify()`:

| Index | Value | Purpose |
|---|---|---|
| 0 | `bytes32(uint256(uint160(tx.origin)))` | Binds the proof to the transaction signer, preventing replay. |
| 1 | `merkleRoot` from the active version | Binds the proof to the current public parameter set. |

---

## Appendix B: Reference Implementation Circuit Input Schemas

The reference implementation includes two constraint circuits. Both use sparse Poseidon2 Merkle trees of depth 32 with leaves stored as `Field` elements.

### B.1 Membership Circuit

Proves that a value exists in a set committed to by a Merkle root.

| Input | Visibility | Type | Description |
|---|---|---|---|
| `address` | Public | `Field` | The value to prove membership for (e.g., user address). |
| `root` | Public | `Field` | The Merkle root of the set. |
| `index` | Private | `Field` | The leaf index of `address` in the tree. |
| `hash_path` | Private | `[Field; 32]` | The Merkle proof sibling hashes from leaf to root. |

**Verification logic**: Computes the Merkle root from `address`, `index`, and `hash_path`. Asserts the computed root equals the public `root`.

### B.2 Non-Membership Circuit

Proves that a value does NOT exist in a sorted set committed to by a Merkle root. Uses a sorted Merkle tree where the absence of a value is proved by showing it falls between two adjacent leaves, is below the minimum, or is above the maximum.

| Input | Visibility | Type | Description |
|---|---|---|---|
| `address` | Public | `Field` | The value to prove non-membership for. |
| `root` | Public | `Field` | The Merkle root of the sorted set. |
| `lower_leaf` | Private | `Field` | The leaf value immediately below `address` (or 0). |
| `upper_leaf` | Private | `Field` | The leaf value immediately above `address` (or 0). |
| `lower_index` | Private | `Field` | Leaf index of `lower_leaf`. |
| `upper_index` | Private | `Field` | Leaf index of `upper_leaf`. |
| `lower_hash_path` | Private | `[Field; 32]` | Merkle proof for `lower_leaf`. |
| `upper_hash_path` | Private | `[Field; 32]` | Merkle proof for `upper_leaf`. |
| `proof_type` | Private | `u8` | Proof mode: 0 = sandwich, 1 = below minimum, 2 = above maximum. |

**Proof types**:
- **Type 0 (Sandwich)**: `lower_leaf < address < upper_leaf`, and the two leaves are adjacent (`upper_index == lower_index + 1`).
- **Type 1 (Below minimum)**: `address < upper_leaf`, and `upper_leaf` is at index 0 (the smallest element in the set).
- **Type 2 (Above maximum)**: `lower_leaf < address`, and the position after `lower_leaf` is empty (value 0), meaning `lower_leaf` is the largest element.
