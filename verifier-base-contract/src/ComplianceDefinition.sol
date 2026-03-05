// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.21;

import {IVerifier} from "./IVerifier.sol";

contract ComplianceDefinition {
    struct ComplianceVersion {
        address verifier;
        bytes32 merkleRoot;
        uint256 tStart;
        uint256 tEnd;
        string metadataHash;
        string leavesHash;
    }

    ComplianceVersion[] public versions;
    address public regulator;
    string public name;

    error NotRegulator();
    error NoActiveVersion();
    error NoVersionAtBlock(uint256 blockHeight);

    modifier onlyRegulator() {
        if (msg.sender != regulator) revert NotRegulator();
        _;
    }

    constructor(address _regulator, string memory _name) {
        regulator = _regulator;
        name = _name;
    }

    function verify(bytes calldata proof) external returns (bool) {
        ComplianceVersion memory v = getActiveVersion();
        bytes32[] memory publicInputs = new bytes32[](2);
        publicInputs[0] = bytes32(uint256(uint160(msg.sender)));
        publicInputs[1] = v.merkleRoot;
        return IVerifier(v.verifier).verify(proof, publicInputs);
    }

    function updateConstraint(
        address newVerifier,
        bytes32 newMerkleRoot,
        uint256 tStart,
        uint256 tEnd,
        string calldata metadataHash,
        string calldata leavesHash
    ) external onlyRegulator {
        versions.push(
            ComplianceVersion({
                verifier: newVerifier,
                merkleRoot: newMerkleRoot,
                tStart: tStart,
                tEnd: tEnd,
                metadataHash: metadataHash,
                leavesHash: leavesHash
            })
        );
    }

    function updateParams(
        bytes32 newMerkleRoot,
        uint256 tStart,
        uint256 tEnd,
        string calldata metadataHash,
        string calldata leavesHash
    ) external onlyRegulator {
        ComplianceVersion memory current = getActiveVersion();
        versions.push(
            ComplianceVersion({
                verifier: current.verifier,
                merkleRoot: newMerkleRoot,
                tStart: tStart,
                tEnd: tEnd,
                metadataHash: metadataHash,
                leavesHash: leavesHash
            })
        );
    }

    function getActiveVersion() public view returns (ComplianceVersion memory) {
        uint256 len = versions.length;
        for (uint256 i = len; i > 0; i--) {
            ComplianceVersion memory v = versions[i - 1];
            if (v.tStart <= block.number && block.number <= v.tEnd) {
                return v;
            }
        }
        revert NoActiveVersion();
    }

    function getVersionAt(
        uint256 blockHeight
    ) external view returns (ComplianceVersion memory) {
        uint256 len = versions.length;
        for (uint256 i = len; i > 0; i--) {
            ComplianceVersion memory v = versions[i - 1];
            if (v.tStart <= blockHeight && blockHeight <= v.tEnd) {
                return v;
            }
        }
        revert NoVersionAtBlock(blockHeight);
    }

    function getVersionCount() external view returns (uint256) {
        return versions.length;
    }
}
