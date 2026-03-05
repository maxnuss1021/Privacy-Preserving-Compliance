// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.21;

import {Test} from "forge-std/Test.sol";
import {ComplianceDefinition} from "../src/ComplianceDefinition.sol";
import {IVerifier} from "../src/IVerifier.sol";

/// @dev Mock verifier that always returns true.
contract MockVerifier is IVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return true;
    }
}

/// @dev Mock verifier that always returns false.
contract MockFailVerifier is IVerifier {
    function verify(bytes calldata, bytes32[] calldata) external pure returns (bool) {
        return false;
    }
}

/// @dev Mock verifier that captures the public inputs it receives.
contract MockCapturingVerifier is IVerifier {
    bytes32[] public lastPublicInputs;

    function verify(bytes calldata, bytes32[] calldata publicInputs) external returns (bool) {
        delete lastPublicInputs;
        for (uint256 i = 0; i < publicInputs.length; i++) {
            lastPublicInputs.push(publicInputs[i]);
        }
        return true;
    }

    function getLastPublicInput(uint256 index) external view returns (bytes32) {
        return lastPublicInputs[index];
    }

    function getLastPublicInputsLength() external view returns (uint256) {
        return lastPublicInputs.length;
    }
}

contract ComplianceDefinitionTest is Test {
    ComplianceDefinition public cd;
    MockVerifier public mockVerifier;
    address public regulator = address(0x1);
    address public nonRegulator = address(0x2);

    function setUp() public {
        cd = new ComplianceDefinition(regulator);
        mockVerifier = new MockVerifier();
    }

    // -- Constructor --

    function test_regulatorIsSet() public view {
        assertEq(cd.regulator(), regulator);
    }

    function test_startsWithNoVersions() public view {
        assertEq(cd.getVersionCount(), 0);
    }

    // -- updateConstraint --

    function test_updateConstraintAddsVersion() public {
        vm.prank(regulator);
        cd.updateConstraint(
            address(mockVerifier),
            bytes32(uint256(0xabc)),
            0,
            type(uint256).max,
            "QmTestCid123",
            ""
        );

        assertEq(cd.getVersionCount(), 1);

        ComplianceDefinition.ComplianceVersion memory v = cd.getActiveVersion();
        assertEq(v.verifier, address(mockVerifier));
        assertEq(v.merkleRoot, bytes32(uint256(0xabc)));
        assertEq(v.tStart, 0);
        assertEq(v.tEnd, type(uint256).max);
        assertEq(v.metadataHash, "QmTestCid123");
    }

    function test_updateConstraintRevertsForNonRegulator() public {
        vm.prank(nonRegulator);
        vm.expectRevert(ComplianceDefinition.NotRegulator.selector);
        cd.updateConstraint(
            address(mockVerifier),
            bytes32(0),
            0,
            type(uint256).max,
            "",
            ""
        );
    }

    // -- updateParams --

    function test_updateParamsKeepsVerifier() public {
        vm.startPrank(regulator);
        cd.updateConstraint(
            address(mockVerifier),
            bytes32(uint256(1)),
            0,
            type(uint256).max,
            "QmVersion1",
            ""
        );

        cd.updateParams(
            bytes32(uint256(2)),
            0,
            type(uint256).max,
            "QmVersion2",
            ""
        );
        vm.stopPrank();

        assertEq(cd.getVersionCount(), 2);

        ComplianceDefinition.ComplianceVersion memory v = cd.getActiveVersion();
        assertEq(v.verifier, address(mockVerifier));
        assertEq(v.merkleRoot, bytes32(uint256(2)));
        assertEq(v.metadataHash, "QmVersion2");
    }

    function test_updateParamsRevertsForNonRegulator() public {
        vm.prank(regulator);
        cd.updateConstraint(address(mockVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.prank(nonRegulator);
        vm.expectRevert(ComplianceDefinition.NotRegulator.selector);
        cd.updateParams(bytes32(uint256(2)), 0, type(uint256).max, "", "");
    }

    function test_updateParamsRevertsWithNoActiveVersion() public {
        vm.prank(regulator);
        vm.expectRevert(ComplianceDefinition.NoActiveVersion.selector);
        cd.updateParams(bytes32(uint256(2)), 0, type(uint256).max, "", "");
    }

    // -- getActiveVersion --

    function test_getActiveVersionRevertsWhenEmpty() public {
        vm.expectRevert(ComplianceDefinition.NoActiveVersion.selector);
        cd.getActiveVersion();
    }

    function test_getActiveVersionReturnsLatestActive() public {
        vm.startPrank(regulator);
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(1)), 0, type(uint256).max, "", "");
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(2)), 0, type(uint256).max, "", "");
        vm.stopPrank();

        ComplianceDefinition.ComplianceVersion memory v = cd.getActiveVersion();
        assertEq(v.merkleRoot, bytes32(uint256(2)));
    }

    function test_getActiveVersionRespectsTimeWindow() public {
        vm.startPrank(regulator);
        // Version active from block 0 to 100
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(1)), 0, 100, "", "");
        // Version active from block 200 to max
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(2)), 200, type(uint256).max, "", "");
        vm.stopPrank();

        // At block 50, version 1 should be active
        vm.roll(50);
        ComplianceDefinition.ComplianceVersion memory v = cd.getActiveVersion();
        assertEq(v.merkleRoot, bytes32(uint256(1)));

        // At block 150, no version is active
        vm.roll(150);
        vm.expectRevert(ComplianceDefinition.NoActiveVersion.selector);
        cd.getActiveVersion();

        // At block 200, version 2 should be active
        vm.roll(200);
        v = cd.getActiveVersion();
        assertEq(v.merkleRoot, bytes32(uint256(2)));
    }

    // -- getVersionAt --

    function test_getVersionAtReturnsCorrectVersion() public {
        vm.startPrank(regulator);
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(1)), 0, 100, "", "");
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(2)), 101, 200, "", "");
        vm.stopPrank();

        ComplianceDefinition.ComplianceVersion memory v = cd.getVersionAt(50);
        assertEq(v.merkleRoot, bytes32(uint256(1)));

        v = cd.getVersionAt(150);
        assertEq(v.merkleRoot, bytes32(uint256(2)));
    }

    function test_getVersionAtRevertsForInvalidBlock() public {
        vm.prank(regulator);
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(1)), 10, 100, "", "");

        vm.expectRevert(abi.encodeWithSelector(ComplianceDefinition.NoVersionAtBlock.selector, 5));
        cd.getVersionAt(5);
    }

    // -- verify --

    function test_verifyForwardsToActiveVerifier() public {
        vm.prank(regulator);
        cd.updateConstraint(address(mockVerifier), bytes32(uint256(0xdeadbeef)), 0, type(uint256).max, "", "");

        bool result = cd.verify(hex"");
        assertTrue(result);
    }

    function test_verifyInjectsPublicInputs() public {
        MockCapturingVerifier capturingVerifier = new MockCapturingVerifier();
        bytes32 expectedRoot = bytes32(uint256(0x1234));

        vm.prank(regulator);
        cd.updateConstraint(address(capturingVerifier), expectedRoot, 0, type(uint256).max, "", "");

        address caller = address(0xBEEF);
        vm.prank(caller);
        cd.verify(hex"");

        assertEq(capturingVerifier.getLastPublicInputsLength(), 2);
        assertEq(capturingVerifier.getLastPublicInput(0), bytes32(uint256(uint160(caller))));
        assertEq(capturingVerifier.getLastPublicInput(1), expectedRoot);
    }

    function test_verifyReturnsFalseFromFailVerifier() public {
        MockFailVerifier failVerifier = new MockFailVerifier();

        vm.prank(regulator);
        cd.updateConstraint(address(failVerifier), bytes32(0), 0, type(uint256).max, "", "");

        bool result = cd.verify(hex"");
        assertFalse(result);
    }

    function test_verifyRevertsWithNoActiveVersion() public {
        vm.expectRevert(ComplianceDefinition.NoActiveVersion.selector);
        cd.verify(hex"");
    }

    // -- getVersionCount --

    function test_getVersionCountIncrementsCorrectly() public {
        vm.startPrank(regulator);
        assertEq(cd.getVersionCount(), 0);

        cd.updateConstraint(address(mockVerifier), bytes32(0), 0, type(uint256).max, "", "");
        assertEq(cd.getVersionCount(), 1);

        cd.updateConstraint(address(mockVerifier), bytes32(0), 0, type(uint256).max, "", "");
        assertEq(cd.getVersionCount(), 2);
        vm.stopPrank();
    }
}
