// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.21;

import {IVerifier} from "./IVerifier.sol";

contract ComplianceDefinition {
    struct ComplianceVersion {
        address verifier;
        string publicParams;
        uint256 tStart;
        uint256 tEnd;
        string metadataHash;
    }

    ComplianceVersion[] public versions;
    address public regulator;

    error NotRegulator();
    error NoActiveVersion();
    error NoVersionAtBlock(uint256 blockHeight);

    modifier onlyRegulator() {
        if (msg.sender != regulator) revert NotRegulator();
        _;
    }

    constructor(address _regulator) {
        regulator = _regulator;
    }

    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external returns (bool) {
        ComplianceVersion memory v = getActiveVersion();
        return IVerifier(v.verifier).verify(proof, publicInputs);
    }

    function updateConstraint(
        address newVerifier,
        string calldata newPublicParams,
        uint256 tStart,
        uint256 tEnd,
        string calldata metadataHash
    ) external onlyRegulator {
        versions.push(ComplianceVersion({
            verifier: newVerifier,
            publicParams: newPublicParams,
            tStart: tStart,
            tEnd: tEnd,
            metadataHash: metadataHash
        }));
    }

    function updateParams(
        string calldata newPublicParams,
        uint256 tStart,
        uint256 tEnd,
        string calldata metadataHash
    ) external onlyRegulator {
        ComplianceVersion memory current = getActiveVersion();
        versions.push(ComplianceVersion({
            verifier: current.verifier,
            publicParams: newPublicParams,
            tStart: tStart,
            tEnd: tEnd,
            metadataHash: metadataHash
        }));
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

    function getVersionAt(uint256 blockHeight) external view returns (ComplianceVersion memory) {
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
