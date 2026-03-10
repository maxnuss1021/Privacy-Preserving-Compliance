// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.8.21;

import {Test} from "forge-std/Test.sol";
import {CompliantToken} from "../src/CompliantToken.sol";
import {ComplianceDefinition} from "../src/ComplianceDefinition.sol";
import {IVerifier} from "../src/IVerifier.sol";

/// @dev Mock verifier that always returns true.
contract MockPassVerifier is IVerifier {
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

contract CompliantTokenTest is Test {
    CompliantToken public token;
    ComplianceDefinition public cd;
    MockPassVerifier public passVerifier;
    MockFailVerifier public failVerifier;
    address public regulator = address(0x1);
    address public user = address(0xBEEF);

    function setUp() public {
        cd = new ComplianceDefinition(regulator, "Test Compliance");
        passVerifier = new MockPassVerifier();
        failVerifier = new MockFailVerifier();
        token = new CompliantToken(address(cd), "Test Token", "TT");
    }

    // -- Constructor --

    function test_nameIsSet() public view {
        assertEq(token.name(), "Test Token");
    }

    function test_symbolIsSet() public view {
        assertEq(token.symbol(), "TT");
    }

    function test_decimalsIs18() public view {
        assertEq(token.decimals(), 18);
    }

    function test_complianceDefinitionIsSet() public view {
        assertEq(address(token.complianceDefinition()), address(cd));
    }

    function test_startsWithZeroSupply() public view {
        assertEq(token.totalSupply(), 0);
    }

    // -- Mint --

    function test_mintSucceedsWithValidProof() public {
        vm.prank(regulator);
        cd.updateCircuit(address(passVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.prank(user);
        token.mint(hex"");

        assertEq(token.balanceOf(user), 1e18);
        assertEq(token.totalSupply(), 1e18);
    }

    function test_mintRevertsWithInvalidProof() public {
        vm.prank(regulator);
        cd.updateCircuit(address(failVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.prank(user);
        vm.expectRevert(CompliantToken.ComplianceCheckFailed.selector);
        token.mint(hex"");
    }

    function test_mintRevertsWithNoActiveVersion() public {
        vm.prank(user);
        vm.expectRevert(ComplianceDefinition.NoActiveVersion.selector);
        token.mint(hex"");
    }

    function test_mintIncrementsCumulatively() public {
        vm.prank(regulator);
        cd.updateCircuit(address(passVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.startPrank(user);
        token.mint(hex"");
        token.mint(hex"");
        vm.stopPrank();

        assertEq(token.balanceOf(user), 2e18);
        assertEq(token.totalSupply(), 2e18);
    }

    function test_mintEmitsTransferEvent() public {
        vm.prank(regulator);
        cd.updateCircuit(address(passVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.expectEmit(true, true, false, true);
        emit CompliantToken.Transfer(address(0), user, 1e18);

        vm.prank(user);
        token.mint(hex"");
    }

    // -- ERC-20 transfer --

    function test_transferMovesTokens() public {
        vm.prank(regulator);
        cd.updateCircuit(address(passVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.prank(user);
        token.mint(hex"");

        address recipient = address(0xCAFE);

        vm.prank(user);
        bool ok = token.transfer(recipient, 0.5e18);

        assertTrue(ok);
        assertEq(token.balanceOf(user), 0.5e18);
        assertEq(token.balanceOf(recipient), 0.5e18);
    }

    // -- ERC-20 approve + transferFrom --

    function test_approveAndTransferFrom() public {
        vm.prank(regulator);
        cd.updateCircuit(address(passVerifier), bytes32(0), 0, type(uint256).max, "", "");

        vm.prank(user);
        token.mint(hex"");

        address spender = address(0xCAFE);
        address recipient = address(0xDEAD);

        vm.prank(user);
        token.approve(spender, 0.5e18);
        assertEq(token.allowance(user, spender), 0.5e18);

        vm.prank(spender);
        bool ok = token.transferFrom(user, recipient, 0.5e18);

        assertTrue(ok);
        assertEq(token.balanceOf(user), 0.5e18);
        assertEq(token.balanceOf(recipient), 0.5e18);
        assertEq(token.allowance(user, spender), 0);
    }
}
