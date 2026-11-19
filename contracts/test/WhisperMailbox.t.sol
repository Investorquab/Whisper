// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WhisperMailbox} from "../src/WhisperMailbox.sol";

contract RejectsQor {
    receive() external payable {
        revert("no");
    }
}

/// Re-enters send() from its receive hook when QOR is attached to it.
contract Reenterer {
    WhisperMailbox public immutable box;
    bytes public envelope;
    uint256 public reentries;

    constructor(WhisperMailbox box_, bytes memory envelope_) {
        box = box_;
        envelope = envelope_;
    }

    receive() external payable {
        if (reentries == 0) {
            reentries++;
            box.send{value: box.messageFee()}(address(this), envelope);
        }
    }
}

contract WhisperMailboxTest is Test {
    WhisperMailbox internal box;
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    uint256 internal constant FEE = 0.001 ether;

    event KeyPublished(address indexed account, uint256 indexed version, bytes mlkemPublicKey, bytes card);
    event Linked(address indexed account, address indexed inbox, bytes proof);
    event Message(
        address indexed to, address indexed from, uint256 indexed id, uint256 attached, bytes envelope
    );
    event Request(address indexed to, address indexed from, uint256 indexed id, bytes envelope);

    function setUp() public {
        box = new WhisperMailbox(FEE, feeRecipient);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _key(uint8 seed) internal pure returns (bytes memory k) {
        k = new bytes(1568);
        k[0] = bytes1(seed);
    }

    function _env(uint256 len) internal pure returns (bytes memory e) {
        e = new bytes(len);
        e[0] = 0x01;
    }

    function _env() internal pure returns (bytes memory) {
        return _env(3400);
    }

    // ------------------------------------------------------------ constructor

    function test_constructor_rejectsZeroFeeRecipient() public {
        vm.expectRevert(WhisperMailbox.InvalidRecipient.selector);
        new WhisperMailbox(FEE, address(0));
    }

    // ------------------------------------------------------------ keys

    function test_publishKey_storesVersionHashAndIndex() public {
        bytes memory k = _key(1);
        vm.expectEmit(true, true, false, true);
        emit KeyPublished(alice, 1, k, "card");
        vm.prank(alice);
        box.publishKey(k, "card");
        assertEq(box.keyVersion(alice), 1);
        assertEq(box.keyHash(alice), keccak256(k));
        uint64[] memory blocks = box.keyBlocks(alice, 0, 10);
        assertEq(blocks.length, 1);
        assertEq(blocks[0], block.number);
    }

    function test_publishKey_rotationBumpsVersionAndAppendsIndexAcrossBlocks() public {
        vm.prank(alice);
        box.publishKey(_key(1), "");
        vm.roll(block.number + 5);
        vm.prank(alice);
        box.publishKey(_key(2), "");
        assertEq(box.keyVersion(alice), 2);
        assertEq(box.keyHash(alice), keccak256(_key(2)));
        assertEq(box.keyBlocks(alice, 0, 10).length, 2);
    }

    function test_publishKey_sameBlockIsIndexedOnce() public {
        vm.startPrank(alice);
        box.publishKey(_key(1), "");
        box.publishKey(_key(2), "");
        vm.stopPrank();
        assertEq(box.keyBlocks(alice, 0, 10).length, 1);
        assertEq(box.keyVersion(alice), 2);
    }

    function test_publishKey_rejectsWrongLength() public {
        vm.startPrank(alice);
        vm.expectRevert(WhisperMailbox.InvalidKeyLength.selector);
        box.publishKey(new bytes(1567), "");
        vm.expectRevert(WhisperMailbox.InvalidKeyLength.selector);
        box.publishKey(new bytes(1569), "");
        vm.expectRevert(WhisperMailbox.InvalidKeyLength.selector);
        box.publishKey("", "");
        vm.stopPrank();
    }

    function test_publishKey_rejectsOversizedCard() public {
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.ProofTooLarge.selector);
        box.publishKey(_key(1), new bytes(24_577));
    }

    // ------------------------------------------------------------ links

    function test_link_emitsAndIndexesUnderLinkedAccount() public {
        vm.expectEmit(true, true, false, true);
        emit Linked(carol, alice, "proof");
        vm.prank(alice);
        box.link(carol, "proof");
        assertEq(box.linkBlocks(carol, 0, 10).length, 1);
        assertEq(box.linkBlocks(alice, 0, 10).length, 0);
    }

    function test_link_forgedLinkCannotRemoveGenuineOne() public {
        vm.prank(alice);
        box.link(carol, "genuine");
        vm.roll(block.number + 1);
        vm.prank(bob);
        box.link(carol, "forged");
        uint64[] memory blocks = box.linkBlocks(carol, 0, 10);
        assertEq(blocks.length, 2, "both links stay visible for client-side verification");
    }

    function test_link_rejectsZeroAccountAndOversizedProof() public {
        vm.startPrank(alice);
        vm.expectRevert(WhisperMailbox.InvalidRecipient.selector);
        box.link(address(0), "");
        vm.expectRevert(WhisperMailbox.ProofTooLarge.selector);
        box.link(carol, new bytes(24_577));
        vm.stopPrank();
    }

    // ------------------------------------------------------------ send

    function test_send_emitsIndexesAndCollectsFee() public {
        bytes memory e = _env();
        vm.expectEmit(true, true, true, true);
        emit Message(bob, alice, 0, 0, e);
        vm.prank(alice);
        box.send{value: FEE}(bob, e);
        assertEq(box.messageCount(), 1);
        assertEq(box.collectedFees(), FEE);
        assertEq(address(box).balance, FEE);
        assertEq(box.inboxBlocks(bob, 0, 10).length, 1);
        assertEq(box.outboxBlocks(alice, 0, 10).length, 1);
        assertEq(box.inboxBlocks(alice, 0, 10).length, 0);
    }

    function test_send_forwardsAttachedQor() public {
        uint256 before = bob.balance;
        vm.expectEmit(true, true, true, true);
        emit Message(bob, alice, 0, 0.5 ether, _env());
        vm.prank(alice);
        box.send{value: FEE + 0.5 ether}(bob, _env());
        assertEq(bob.balance, before + 0.5 ether);
        assertEq(box.collectedFees(), FEE);
        assertEq(address(box).balance, FEE);
    }

    function test_send_requiresFee() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(WhisperMailbox.FeeRequired.selector, FEE));
        box.send{value: FEE - 1}(bob, _env());
    }

    function test_send_rejectsBadEnvelopeSizes() public {
        vm.startPrank(alice);
        vm.expectRevert(WhisperMailbox.InvalidEnvelope.selector);
        box.send{value: FEE}(bob, _env(1687));
        vm.expectRevert(WhisperMailbox.InvalidEnvelope.selector);
        box.send{value: FEE}(bob, _env(24_577));
        box.send{value: FEE}(bob, _env(1688));
        box.send{value: FEE}(bob, _env(24_576));
        vm.stopPrank();
        assertEq(box.messageCount(), 2);
    }

    function test_send_rejectsZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.InvalidRecipient.selector);
        box.send{value: FEE}(address(0), _env());
    }

    function test_send_noteToSelfAllowed() public {
        vm.prank(alice);
        box.send{value: FEE}(alice, _env());
        assertEq(box.inboxBlocks(alice, 0, 10).length, 1);
        assertEq(box.outboxBlocks(alice, 0, 10).length, 1);
    }

    function test_send_indexAppendsPerBlockOnly() public {
        vm.startPrank(alice);
        box.send{value: FEE}(bob, _env());
        box.send{value: FEE}(bob, _env());
        vm.roll(block.number + 1);
        box.send{value: FEE}(bob, _env());
        vm.stopPrank();
        uint64[] memory blocks = box.inboxBlocks(bob, 0, 10);
        assertEq(blocks.length, 2);
        assertEq(blocks[1], blocks[0] + 1);
        assertEq(box.messageCount(), 3);
    }

    function test_send_revertsWhenRecipientRejectsAttachedQor() public {
        RejectsQor r = new RejectsQor();
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.TransferFailed.selector);
        box.send{value: FEE + 1}(address(r), _env());
        // without attachment the same recipient can still be messaged
        vm.prank(alice);
        box.send{value: FEE}(address(r), _env());
        assertEq(box.messageCount(), 1);
    }

    function test_send_reentrancyKeepsAccountingConsistent() public {
        Reenterer r = new Reenterer(box, _env());
        vm.deal(address(r), 1 ether);
        vm.prank(alice);
        box.send{value: FEE + 0.1 ether}(address(r), _env());
        assertEq(r.reentries(), 1);
        assertEq(box.messageCount(), 2);
        assertEq(box.collectedFees(), 2 * FEE);
        assertEq(address(box).balance, 2 * FEE, "contract holds exactly the collected fees");
    }

    // ------------------------------------------------------------ request mode, allow and block

    function test_requestMode_blocksUnknownSenders() public {
        vm.prank(bob);
        box.setRequestMode(true);
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.RequestOnly.selector);
        box.send{value: FEE}(bob, _env());
        assertFalse(box.canMessage(alice, bob));
    }

    function test_requestMode_requestThenAllowThenSend() public {
        vm.prank(bob);
        box.setRequestMode(true);

        vm.expectEmit(true, true, true, true);
        emit Request(bob, alice, 0, _env());
        vm.prank(alice);
        box.request{value: FEE}(bob, _env());
        assertEq(box.inboxBlocks(bob, 0, 10).length, 1);

        vm.prank(bob);
        box.setAllowed(alice, true);
        assertTrue(box.canMessage(alice, bob));
        vm.prank(alice);
        box.send{value: FEE}(bob, _env());
        assertEq(box.messageCount(), 2);

        vm.prank(bob);
        box.setAllowed(alice, false);
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.RequestOnly.selector);
        box.send{value: FEE}(bob, _env());
    }

    function test_requestMode_selfMessageStillAllowed() public {
        vm.startPrank(bob);
        box.setRequestMode(true);
        box.send{value: FEE}(bob, _env());
        vm.stopPrank();
        assertTrue(box.canMessage(bob, bob));
    }

    function test_request_rejectsAttachedQor() public {
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.NoAttachmentOnRequest.selector);
        box.request{value: FEE + 1}(bob, _env());
    }

    function test_request_requiresFeeAndValidEnvelope() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(WhisperMailbox.FeeRequired.selector, FEE));
        box.request{value: 0}(bob, _env());
        vm.expectRevert(WhisperMailbox.InvalidEnvelope.selector);
        box.request{value: FEE}(bob, _env(10));
        vm.stopPrank();
    }

    function test_blocked_refusesSendAndRequest() public {
        vm.prank(bob);
        box.setBlocked(alice, true);
        vm.startPrank(alice);
        vm.expectRevert(WhisperMailbox.SenderBlocked.selector);
        box.send{value: FEE}(bob, _env());
        vm.expectRevert(WhisperMailbox.SenderBlocked.selector);
        box.request{value: FEE}(bob, _env());
        vm.stopPrank();
        assertFalse(box.canMessage(alice, bob));
        // other senders unaffected
        vm.prank(carol);
        box.send{value: FEE}(bob, _env());
    }

    function test_blocked_winsOverAllowed() public {
        vm.startPrank(bob);
        box.setRequestMode(true);
        box.setAllowed(alice, true);
        box.setBlocked(alice, true);
        vm.stopPrank();
        assertFalse(box.canMessage(alice, bob));
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.SenderBlocked.selector);
        box.send{value: FEE}(bob, _env());
    }

    function test_canMessage_zeroRecipientIsFalse() public view {
        assertFalse(box.canMessage(alice, address(0)));
    }

    // ------------------------------------------------------------ fees

    function test_withdrawFees_onlyRecipientAndResets() public {
        vm.prank(alice);
        box.send{value: FEE}(bob, _env());
        vm.prank(alice);
        vm.expectRevert(WhisperMailbox.NotFeeRecipient.selector);
        box.withdrawFees();

        uint256 before = feeRecipient.balance;
        vm.prank(feeRecipient);
        box.withdrawFees();
        assertEq(feeRecipient.balance, before + FEE);
        assertEq(box.collectedFees(), 0);
        assertEq(address(box).balance, 0);

        vm.prank(feeRecipient);
        box.withdrawFees(); // nothing left: still succeeds, moves 0
        assertEq(feeRecipient.balance, before + FEE);
    }

    function test_withdrawFees_cannotTakeAttachedQor() public {
        RejectsQor r = new RejectsQor();
        vm.prank(alice);
        box.send{value: FEE}(address(r), _env());
        vm.prank(alice);
        box.send{value: FEE + 1 ether}(bob, _env());
        vm.prank(feeRecipient);
        box.withdrawFees();
        assertEq(feeRecipient.balance, 2 * FEE);
    }

    // ------------------------------------------------------------ index pagination

    function test_indexes_paginate() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 5; i++) {
            vm.roll(block.number + 1);
            box.send{value: FEE}(bob, _env());
        }
        vm.stopPrank();
        assertEq(box.inboxBlocks(bob, 0, 2).length, 2);
        assertEq(box.inboxBlocks(bob, 4, 10).length, 1);
        assertEq(box.inboxBlocks(bob, 5, 10).length, 0);
        assertEq(box.inboxBlocks(bob, 99, 10).length, 0);
        assertEq(box.inboxBlocks(bob, 1, type(uint256).max).length, 4, "huge limit does not overflow");
        (uint256 inbox, uint256 outbox, uint256 keys, uint256 links) = box.indexLengths(bob);
        assertEq(inbox, 5);
        assertEq(outbox, 0);
        assertEq(keys, 0);
        assertEq(links, 0);
    }

    // ------------------------------------------------------------ fuzz

    function testFuzz_send_attachedArrivesAndFeeKept(uint96 extra) public {
        uint256 value = FEE + uint256(extra) % 50 ether;
        uint256 before = bob.balance;
        vm.deal(alice, value);
        vm.prank(alice);
        box.send{value: value}(bob, _env());
        assertEq(bob.balance, before + (value - FEE));
        assertEq(address(box).balance, FEE);
    }

    function testFuzz_send_envelopeBounds(uint16 len) public {
        bytes memory e = new bytes(len);
        vm.prank(alice);
        if (len < 1688 || len > 24_576) {
            vm.expectRevert(WhisperMailbox.InvalidEnvelope.selector);
            box.send{value: FEE}(bob, e);
        } else {
            box.send{value: FEE}(bob, e);
            assertEq(box.messageCount(), 1);
        }
    }
}
