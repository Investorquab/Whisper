// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WhisperMailbox
/// @notice On-chain mailbox for Whisper, a post-quantum messenger for QoreChain.
///
/// Messages are sealed in the sender's browser with ML-KEM-1024 (FIPS 203) before they reach this
/// contract, so the contract only ever stores ciphertext. Everything lives on chain:
///  - encryption keys (with the ML-DSA-87 signed card that binds them to the account),
///  - sealed messages and contact requests,
///  - links from a QoreChain main account to the inbox it uses,
///  - each recipient's contact policy (request mode, allow list, block list).
///
/// Event data is the storage; small per-address block indexes let clients find their events with a
/// few exact-block log queries instead of scanning the chain (public nodes cap log queries at
/// 10,000 blocks).
///
/// Signatures inside cards, links and signed messages are verified by clients against the signer's
/// ML-DSA-87 key registered on QoreChain. Sending itself is protected by QoreChain: an EVM
/// transaction is only admitted inside an authorisation window that the sender opened with a hybrid
/// ML-DSA-87 signature.
contract WhisperMailbox {
    /// @notice ML-KEM-1024 encapsulation key length (FIPS 203).
    uint256 public constant MLKEM_PUBLIC_KEY_LENGTH = 1568;
    /// @notice Smallest valid sealed envelope: QoreSeal v1 header (56 bytes) + one ML-KEM entry (1632 bytes).
    uint256 public constant MIN_ENVELOPE_LENGTH = 1688;
    /// @notice Largest envelope accepted (sealed text, optional ML-DSA-87 signature, two recipients).
    uint256 public constant MAX_ENVELOPE_LENGTH = 24_576;
    /// @notice Largest card or link proof accepted.
    uint256 public constant MAX_PROOF_LENGTH = 24_576;

    /// @notice Anti-spam fee for every message and request, kept by the contract.
    uint256 public immutable messageFee;
    /// @notice Account allowed to withdraw collected fees.
    address public immutable feeRecipient;

    /// @notice Number of messages and requests ever sent; each gets the next id.
    uint256 public messageCount;
    /// @notice Fees collected and not yet withdrawn.
    uint256 public collectedFees;

    /// @notice Latest key version per account (0 = never published).
    mapping(address => uint256) public keyVersion;
    /// @notice keccak256 of each account's latest ML-KEM key.
    mapping(address => bytes32) public keyHash;
    /// @notice Recipient accepts direct messages only from allowed senders; others must send a request.
    mapping(address => bool) public requestMode;
    mapping(address => mapping(address => bool)) public isAllowed;
    mapping(address => mapping(address => bool)) public isBlocked;

    mapping(address => uint64[]) private _inboxBlocks;
    mapping(address => uint64[]) private _outboxBlocks;
    mapping(address => uint64[]) private _keyBlocks;
    mapping(address => uint64[]) private _linkBlocks;

    event KeyPublished(address indexed account, uint256 indexed version, bytes mlkemPublicKey, bytes card);
    event Linked(address indexed account, address indexed inbox, bytes proof);
    event Message(
        address indexed to, address indexed from, uint256 indexed id, uint256 attached, bytes envelope
    );
    event Request(address indexed to, address indexed from, uint256 indexed id, bytes envelope);
    event RequestModeSet(address indexed account, bool enabled);
    event AllowedSet(address indexed account, address indexed sender, bool allowed);
    event BlockedSet(address indexed account, address indexed sender, bool blocked);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error InvalidKeyLength();
    error ProofTooLarge();
    error InvalidEnvelope();
    error InvalidRecipient();
    error FeeRequired(uint256 required);
    error RequestOnly();
    error SenderBlocked();
    error NoAttachmentOnRequest();
    error NotFeeRecipient();
    error TransferFailed();

    constructor(uint256 messageFee_, address feeRecipient_) {
        if (feeRecipient_ == address(0)) revert InvalidRecipient();
        messageFee = messageFee_;
        feeRecipient = feeRecipient_;
    }

    // ------------------------------------------------------------------ keys and identity

    /// @notice Publish (or rotate) the caller's ML-KEM-1024 key with its signed Whisper card.
    /// @param mlkemPublicKey The 1568-byte ML-KEM-1024 encapsulation key.
    /// @param card The card: the key's hash and the account, signed with the account's hybrid
    ///        ML-DSA-87 key (QoreX signArbitrary). Verified by clients, not here.
    function publishKey(bytes calldata mlkemPublicKey, bytes calldata card) external {
        if (mlkemPublicKey.length != MLKEM_PUBLIC_KEY_LENGTH) revert InvalidKeyLength();
        if (card.length > MAX_PROOF_LENGTH) revert ProofTooLarge();
        uint256 version = ++keyVersion[msg.sender];
        keyHash[msg.sender] = keccak256(mlkemPublicKey);
        _record(_keyBlocks[msg.sender]);
        emit KeyPublished(msg.sender, version, mlkemPublicKey, card);
    }

    /// @notice Link another QoreChain account (for example a QoreX main account) to the caller's inbox.
    /// @dev Anyone can call this for any account; clients accept a link only when `proof` carries a valid
    ///      signature by `account` naming this inbox. The index is append-only, so a forged link cannot
    ///      hide a genuine one.
    function link(address account, bytes calldata proof) external {
        if (account == address(0)) revert InvalidRecipient();
        if (proof.length > MAX_PROOF_LENGTH) revert ProofTooLarge();
        _record(_linkBlocks[account]);
        emit Linked(account, msg.sender, proof);
    }

    // ------------------------------------------------------------------ messaging

    /// @notice Send a sealed message. `msg.value` is the fee plus any QOR attached for the recipient.
    function send(address to, bytes calldata envelope) external payable {
        _checkSend(to, envelope);
        if (requestMode[to] && !isAllowed[to][msg.sender] && to != msg.sender) revert RequestOnly();

        uint256 attached = msg.value - messageFee;
        uint256 id = messageCount++;
        collectedFees += messageFee;
        _record(_inboxBlocks[to]);
        _record(_outboxBlocks[msg.sender]);
        emit Message(to, msg.sender, id, attached, envelope);

        if (attached > 0) {
            (bool ok,) = to.call{value: attached}("");
            if (!ok) revert TransferFailed();
        }
    }

    /// @notice Ask to start a conversation with a recipient who only accepts allowed senders.
    function request(address to, bytes calldata envelope) external payable {
        _checkSend(to, envelope);
        if (msg.value != messageFee) revert NoAttachmentOnRequest();
        uint256 id = messageCount++;
        collectedFees += messageFee;
        _record(_inboxBlocks[to]);
        _record(_outboxBlocks[msg.sender]);
        emit Request(to, msg.sender, id, envelope);
    }

    function _checkSend(address to, bytes calldata envelope) private view {
        if (to == address(0)) revert InvalidRecipient();
        if (envelope.length < MIN_ENVELOPE_LENGTH || envelope.length > MAX_ENVELOPE_LENGTH) {
            revert InvalidEnvelope();
        }
        if (msg.value < messageFee) revert FeeRequired(messageFee);
        if (isBlocked[to][msg.sender]) revert SenderBlocked();
    }

    /// @notice True when `from` can send a direct message to `to` right now.
    function canMessage(address from, address to) external view returns (bool) {
        if (to == address(0) || isBlocked[to][from]) return false;
        return !requestMode[to] || isAllowed[to][from] || from == to;
    }

    // ------------------------------------------------------------------ contact policy

    function setRequestMode(bool enabled) external {
        requestMode[msg.sender] = enabled;
        emit RequestModeSet(msg.sender, enabled);
    }

    function setAllowed(address sender, bool allowed) external {
        isAllowed[msg.sender][sender] = allowed;
        emit AllowedSet(msg.sender, sender, allowed);
    }

    function setBlocked(address sender, bool blocked) external {
        isBlocked[msg.sender][sender] = blocked;
        emit BlockedSet(msg.sender, sender, blocked);
    }

    // ------------------------------------------------------------------ fees

    function withdrawFees() external {
        if (msg.sender != feeRecipient) revert NotFeeRecipient();
        uint256 amount = collectedFees;
        collectedFees = 0;
        (bool ok,) = feeRecipient.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(feeRecipient, amount);
    }

    // ------------------------------------------------------------------ indexes

    /// @notice Blocks holding Message or Request events addressed to `account`.
    function inboxBlocks(address account, uint256 start, uint256 limit)
        external
        view
        returns (uint64[] memory)
    {
        return _slice(_inboxBlocks[account], start, limit);
    }

    /// @notice Blocks holding Message or Request events sent by `account`.
    function outboxBlocks(address account, uint256 start, uint256 limit)
        external
        view
        returns (uint64[] memory)
    {
        return _slice(_outboxBlocks[account], start, limit);
    }

    /// @notice Blocks holding KeyPublished events for `account`.
    function keyBlocks(address account, uint256 start, uint256 limit)
        external
        view
        returns (uint64[] memory)
    {
        return _slice(_keyBlocks[account], start, limit);
    }

    /// @notice Blocks holding Linked events naming `account`.
    function linkBlocks(address account, uint256 start, uint256 limit)
        external
        view
        returns (uint64[] memory)
    {
        return _slice(_linkBlocks[account], start, limit);
    }

    /// @notice Lengths of the four indexes for `account`: inbox, outbox, keys, links.
    function indexLengths(address account) external view returns (uint256, uint256, uint256, uint256) {
        return (
            _inboxBlocks[account].length,
            _outboxBlocks[account].length,
            _keyBlocks[account].length,
            _linkBlocks[account].length
        );
    }

    /// @dev Appends the current block once, however many events the account gets in it.
    function _record(uint64[] storage blocks) private {
        uint64 current = uint64(block.number);
        uint256 n = blocks.length;
        if (n == 0 || blocks[n - 1] != current) blocks.push(current);
    }

    function _slice(uint64[] storage blocks, uint256 start, uint256 limit)
        private
        view
        returns (uint64[] memory out)
    {
        uint256 n = blocks.length;
        if (start >= n) return new uint64[](0);
        uint256 end = limit > n - start ? n : start + limit;
        out = new uint64[](end - start);
        for (uint256 i = start; i < end; i++) {
            out[i - start] = blocks[i];
        }
    }
}
