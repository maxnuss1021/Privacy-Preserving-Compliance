# Development and planning document

# Table of Contents

- [Tech Stack](#tech-stack)
- [Components](#components)
  - [1. Regulator Cli](#1-regulator-cli)
  - [2. User Proof Manager](#2-user-proof-manager)
  - [3. Example Applications](#3-example-applications)
- [MVP Tasks](#mvp-tasks)
  - [Milestone 1: Regulator Stack](#milestone-1-regulator-stack)
  - [Milestone 2: User Proof Manager](#milestone-2-user-proof-manager)
  - [Milestone 3: Example Application - Compliant Stablecoin](#milestone-3-example-application---compliant-stablecoin)
  - [Milestone 4: Benchmarking](#milestone-4-benchmarking)
- [Post-MVP](#post-mvp)
  - [Proof aggregation](#proof-aggregation)
  - [Compliant Transaction Mixer](#compliant-transaction-mixer)
- [Extensions and future work](#extensions-and-future-work)
  - [More complex example constraints](#more-complex-example-constraints)
  - [Constraint Logical Inference](#constraint-logical-inference)
  - [Constraint DSL](#constraint-dsl)
  - [Web Applications](#web-applications)
  - [Alternative Demo Applications](#alternative-demo-applications)

## Tech Stack

### Smart Contracts
- **Solidity** - Verifier contracts and example applications
- **EVM** - deployments will be made to the Sepolia testnet

### Zero-Knowledge Proofs
- **Noir** - ZK circuit DSL for compliance definitions

### Backend/Tooling
- **Rust** - Regulator CLI
- **js** - proof manager
- **IPFS** - Decentralized storage for compliance definitions

---

## Components

### 1. Regulator Cli

Enable regulators to create, publish, and update compliance definitions

**Deliverables**:
- CLI for compliance definition management
- Example compliance circuits (sanctions list, account age, etc.)
- Verifier contract deployment system
- IPFS publishing integration

**Key Functionality**:
- Sign compliance definitions with regulator private key
- Deploy verifier contracts with aggregation support
- Update existing compliance definitions (constraints or parameters)
- Upload to IPFS and manage metadata

### 2. User Proof Manager

Enable users to generate compliance proofs efficiently

**Deliverables**:
- Use Noir js library for proof generation
- Transaction history indexing
- Constraint inference engine
- Proof caching system

**Key Functionality**:
- Fetch compliance definition from IPFS or direct input
- Index user transaction history
- Fetch public proof inputs from verifier contract
- Generate individual constraint proofs
- Aggregate proofs into compliance definition proof
- Cache and reuse previously generated proofs

### 3. Example Applications

Demonstrate framework integration

**Deliverables**:
- Compliant ERC20 Stablecoin or Compliant Transaction Mixer (Tornado Cash fork)
- Example frontend

**Integration Pattern**:
```solidity
function transfer(address recipient, uint256 amount, bytes proof) {
    require(verifierContract.verify(proof), "Not compliant");
    // ... rest of transfer logic
}
```

---

## MVP Tasks

### Milestone 1: Regulator Stack

#### Core CLI Development (regulator-cli/)
- [x] `new-compliance-definition` command
  - [x] Take Noir circuit input
  - [x] Upload to IPFS 
  - [x] Deploy verifier contract
- [x] `update-circuit` command
- [x] `update-parameters` command

#### Verifier Contract Development (contracts/src/ComplianceDefinition.sol)
- [x] Add version tracking
- [x] Implement parameter update functions
- [x] Add metadata storage (IPFS hash)
- [x] Ownable pattern for updates

#### Example Compliance Circuits (circuits/)
- [x] Sanctions list check (NON-MEM)
- [x] Allow-list check (MEM)
- [ ] Account age constraint (AGE)

### Milestone 2: User Proof Manager

#### Circuit handling
- [x] Input verifier contract address
- [x] Fetch Noir code and compiled circuit of compliance definition from IPFS
- [ ] Maybe: compile .nr code and verify it matches the compiled circuit on IPFS

#### Indexing System
- [ ] Fetch on-chain data required for proof generation
- [ ] Indexing chain data
- [ ] Query verifier contract for public inputs

#### Proof Generation 
- [x] Input preparation
  - [x] Format public inputs from contract
  - [x] Handle private user inputs
  - [ ] Prepare witness data from tx history
- [x] Proof generation
  -[x] Interface with Noir proving system
- [x] Proof storage system

### Milestone 3: Example Application - Compliant Stablecoin

- [x] Base ERC20 implementation
- [x] Mint requires proof
- [x] Simple frontend (in Demo)

### Milestone 4: Benchmarking

### Performance Metrics
- [x] Proof generation time per constraint type
- [ ] Transaction history size scaling

---
## Post-MVP
Still required, but we should focus on the MVP first

#### More constraints
- [ ] Address age constraint
- [ ] Interact constraint
- [ ] non-interact constraint
- [ ] structuring constraint
- [ ] Valid ZK passport constraint

#### Non-membership proof Noir optimization 
- [ ] Explore using an indexed Merkle tree instead of the ordered Merkle tree for non-membership proofs.
- [ ] Benchmark the proof generation speedup/slowdown
- [ ] Benchmark the client-side tree generation speedup/slowdown (for when the regulator has to add an address or multiple to the sanction list)

#### Proof aggregation (constraints)
- [ ] Modify verifier contract to aggregate and verify multiple proofs
- [ ] Example compliance definition that requires multiple constraints
- [ ] Modify proof manager CLI to generate proofs of multiple constraints

#### Compliant Transaction Mixer
- [ ] Fork Tornado Cash or similar
- [ ] Add compliance checks
  - [ ] Require proof on deposit
  - [ ] Verify proof on withdrawal
- [ ] Deploy demo frontend

#### Prettier demo
- [ ] Make demo nicer for public sharing
- [ ] Maybe: visualization of deployed compliance definitions and applications that use them.  Would look like a DAG.  And have this either dynamically updatable or render with the demo.

---
## Extensions and future work

#### More complex example constraints
- [ ] Protocol interaction requirements (INTERACT/AVOID)
- [ ] Anti-structuring constraint (STRUCTURE)

#### Constraint Logical Inference
- [ ] In-circuit logical implication detection
  - [ ] Identify previously proven constraints
  - [ ] Determine minimal proof set needed
- [ ] Proof reuse across definitions
- [ ] Load and fetch minimal amount of on-chain state based on constraint overlap

#### Constraint DSL
- [ ] Design readable constraint syntax
  - [ ] Transpiler to Noir
- [ ] Example constraints in DSL

#### Benchmark improvements
- [ ] Per browser benchmarks.  Investigate proof generation in chrome, firefox, safari, etc

#### Web Applications
- [ ] Proof manager web UI
  - [ ] Browser-based proof generation
  - [ ] Wallet integration
  - [ ] Proof status dashboard
- [ ] Regulator web interface
  - [ ] Compliance definition builder
  - [ ] Visual constraint composer
  - [ ] Deployment wizard

#### Alternative Demo Applications
- **Airdrops**: Require specific on-chain activity proofs
- **Off-chain Computation**: Prove invariants instead of executing on-chain
- **Credential Systems**: Prove eligibility without revealing attributes
- **Supply Chain**: B2B privacy on public chains



