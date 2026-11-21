# Whisper security audit

This is an internal audit in two passes (the second, attacker-minded pass is at the end): we tried to break Whisper and wrote down what happened. Every result below was run against the code in this repository and, where noted, against the live QoreChain testnet (`qorechain-diana`) with the real QoreX 0.4.3 extension. When something failed, we fixed it and ran it again; the tables show the final state, and the **Findings** section keeps the failures.

It is not a third-party audit. Known gaps are listed under **Limitations** and **Open items**.

| | |
| --- | --- |
| Date | 19 November 2026 |
| Commit audited | the commit that adds this file |
| Contract | `WhisperMailbox` at `0xd837298637f4459a3981b540d5543a4423add801` (testnet, block 10350669) |
| Wallet | QoreX 0.4.3 browser extension, testnet (developer mode) |
| Automated tests | 31 Foundry (incl. fuzz), 32 SDK, 17 web app, all passing |

## Summary

| Area | Attempts | Blocked / passed | Notes |
| --- | --- | --- | --- |
| Stolen classical key (live chain) | 8 | 8 | No send, transfer, window, key swap or forgery possible |
| Contract (Foundry) | 31 tests | 31 | Fees, request mode, blocking, sizes, reentrancy, fuzz |
| Encryption and signatures (SDK) | 32 tests | 32 | Tamper, re-address, replay, wrong signer, stripped ML-DSA |
| Hostile content in the browser (live) | 3 | 3 | HTML/script in messages, hostile compose links, proxy scope |
| Key backup and restore (live) | 4 | 4 | No plaintext in backup; tampered file and wrong password refused |
| Main-account linking (live) | 3 | 3 after fix | **F-1** found here |
| Browser hardening | 3 | 3 | CSP and COOP added (**F-3**, **F-4**) |

Five findings, all fixed. None let an attacker read or forge messages.

## Threat model

Whisper's promise is narrow, and the audit tests exactly that:

1. **Only the recipient can read a message.** Messages are sealed in the sender's browser with ML-KEM-1024 (QoreSeal) and stored on chain. There is no Whisper server.
2. **Nobody can send as you.** Every send is an EVM transaction from your QoreX Ethereum account. QoreChain only admits it inside an EVM window opened with your hybrid secp256k1 + ML-DSA-87 signature.
3. **A signed message proves who wrote it.** Signatures are checked against the signer's ML-DSA-87 key in QoreChain's PQC registry, never against a key the message brings along.
4. **Your inbox key never leaves your browser unencrypted.** It is stored in IndexedDB under AES-GCM with a PBKDF2 (600,000 rounds) password key, and backups use the same encryption.

The headline attacker is someone who has your **classical secp256k1 private key** and nothing else. That is the key a large quantum computer could derive from a public key, and on most chains it is the whole account.

## 1. Stolen classical key (live testnet)

Script: [`contracts/script/attack-classical-key.ts`](contracts/script/attack-classical-key.ts). It receives only the victim's secp256k1 private key and makes its own ML-DSA-87 key, because the real one is unknown to it. The victim was test account Carol (`qor1avnejacyrgz607gfh5y5ysgldq4mtqwcy67tzp`), who has a registered ML-DSA-87 key and a Whisper inbox. At the start of the run Carol's last EVM window was used up (`remainingTxs: 0`).

```bash
ATTACK_PRIVATE_KEY=0x… ATTACK_THIEF=0x… pnpm --filter @whisper/contracts attack:classical
```

| # | Attempt | Expected | Actual (chain or Whisper response) | Result |
| --- | --- | --- | --- | --- |
| 1 | EVM transfer of 0.001 QOR to the thief | Rejected | "the EVM authorisation window … does not admit this transaction: the window does not list 0x3575… as an allowed target" | Blocked |
| 2 | EVM call to the mailbox: send a message as the victim | Rejected | "the EVM authorisation window … does not admit this transaction (remaining: 0 blocks, 0 transactions …)" | Blocked |
| 3 | Native `MsgSend` with a classical-only signature | Rejected | code 20 (pqc): "has a registered PQC key and must include the hybrid signature extension" | Blocked |
| 4 | Open an EVM window with a classical-only signature | Rejected | code 20 (pqc), same message | Blocked |
| 5 | Open an EVM window, hybrid-signed with the attacker's own ML-DSA key | Rejected | code 21 (pqc): "hybrid PQC signature verification failed" | Blocked |
| 6 | Register the attacker's ML-DSA key over the victim's | Rejected | code 234 (pqc): "register and migrate need its hybrid signature" | Blocked |
| 7 | Forge a signed Whisper message ("I confirm I owe you nothing.") | Rejected by Whisper | "Signature does not verify against the signer's ML-DSA-87 key" | Blocked |
| 8 | Forge a Whisper card to swap in the attacker's inbox key | Rejected by Whisper | "Card signature does not verify against the account's ML-DSA-87 key" | Blocked |

After the run, Carol's registered ML-DSA-87 key was unchanged. **8 of 8 attacks were blocked.**

Attacks 1 to 6 are stopped by QoreChain itself, and Whisper builds on that guarantee. Attacks 7 and 8 are stopped by Whisper's own checks: card and message signatures must verify against the key registered on chain.

Residual risk: see **L-2** (an EVM window the real owner leaves open).

## 2. Contract (Foundry, 31 tests)

`forge test` in `contracts/`. All 31 pass. What they try to break:

| Attempt | Expected | Result |
| --- | --- | --- |
| Send with no fee, or with too little | Revert | Pass |
| Envelope shorter than 1,688 bytes or longer than 24,576 (fuzzed) | Revert | Pass |
| Send to the zero address | Revert | Pass |
| Stranger sends directly to an inbox in request mode | Revert `RequestOnly` | Pass |
| Request, then the owner allows the sender, then a direct send | Succeeds | Pass |
| Blocked sender sends | Revert `SenderBlocked` | Pass |
| Attach QOR to a contact request | Revert | Pass |
| Attached QOR goes to the recipient, not to the fee pot | Forwarded exactly | Pass |
| Recipient contract that rejects QOR | Whole send reverts, so nothing is lost | Pass |
| Reentrant recipient re-enters `send` while receiving QOR | Accounting stays consistent | Pass |
| `withdrawFees` takes attached QOR | Only fees can be withdrawn | Pass |
| `withdrawFees` by anyone but the fee recipient | Revert | Pass |
| Publish a key of the wrong length, or an oversized card | Revert | Pass |
| Key rotation | Version bumps, old key stays readable in history | Pass |
| Link with a zero account or an oversized proof | Revert | Pass |
| Index bookkeeping when many events land in one block | One index entry per block | Pass |

The contract never decides who someone is from a signature. It stores keys, links and envelopes, and the client verifies signatures against QoreChain's registry. A bad card or link therefore costs its sender gas and is ignored by every reader.

## 3. Encryption and signatures (SDK, 32 tests)

`pnpm --filter @whisper/sdk test`. Adversarial cases:

| Attempt | Expected | Result |
| --- | --- | --- |
| Open a message with someone else's inbox key | Fails | Pass |
| Copy an envelope and re-send it to another inbox, or claim another sender | Fails (AAD binds `whisper/v1\|from\|to`) | Pass |
| Flip ciphertext bytes | Fails (authenticated encryption) | Pass |
| Infer message length from ciphertext size | Not possible: payloads are padded to 256-byte blocks | Pass |
| Change one word in a signed message ("90%" to "50%") | Signature rejected | Pass |
| Present a signed message as addressed to someone else | Rejected | Pass |
| Re-attribute a proof to another account (checked against that account's key) | Rejected | Pass |
| Sign Alice's statement with Mallory's keys and present it as Alice's | Rejected | Pass |
| Replay a proof with another chain id (`qorechain-vladi`) | Rejected | Pass |
| Zero out the ML-DSA-87 half and keep the classical half | Rejected | Pass |
| Card for a different key, account, chain or ML-DSA key | Rejected | Pass |
| QoreX handle record with a swapped address, re-signed by another registry key, or with tampered fields | Rejected | Pass |
| Real QoreX 0.4.3 `signArbitrary` output | Verifies | Pass |

## 4. Hostile content in the browser (live, Playwright + QoreX)

Script: `private/tools/e2e-audit.cjs` (kept out of the repo because it drives test wallets).

| Attempt | Expected | Actual | Result |
| --- | --- | --- | --- |
| Carol sends `<img src=x onerror=…><script>alert(1)</script> [click](javascript:alert(2))` on chain (tx `0xe44ca897…`) | Shown as text, nothing runs | Text shown literally; 0 `img`/`script`/`a` elements inside the bubble; no dialogs; page title unchanged | Pass |
| A site links to `/to/<addr>?from=<b>Whisper Support</b>…(200 chars)&draft=<img onerror>…(900 chars)` | Label trimmed and shown as the site's claim; draft capped; no HTML | "You came here from a site that calls itself “<b>Whisper Support</b> xxx…”" as plain text; draft 500 chars; no dialogs | Pass after **F-2** |
| Use the same-origin QoreChain proxy for other REST routes (`/api/qore/cosmos/bank/…`, `POST /api/qore/cosmos/tx/…`) | Not forwarded | The bank route returns the app's own HTML (no proxy), and the tx route returns 404. Only `/qorechain/pqc/v1/*` reaches QoreChain | Pass |

## 5. Key backup and restore (live)

Script: `private/tools/e2e-restore.cjs`. We downloaded the backup from Settings, deleted the browser's vault (IndexedDB), and restored.

| Attempt | Expected | Actual | Result |
| --- | --- | --- | --- |
| Inspect the backup file | No plaintext key | Fields `v, account, keyFingerprint, kdf, iv, ciphertext, createdAt`; no seed | Pass |
| Restore a backup with altered ciphertext | Refused | "Not restored: That password does not unlock this inbox, or the backup file is damaged." | Pass after **F-5** |
| Restore with a wrong password | Refused | Same message | Pass |
| Restore with the right password | Inbox back | 3 conversations; all 8 messages in Carol's thread decrypt, 0 errors | Pass |

Unit tests also cover: wrong password, a vault moved to another account, a fresh salt and IV on every save, weak passwords refused, and 600,000 PBKDF2 iterations by default.

## 6. Main-account linking (live)

A QoreX **main** account (coin 118) cannot use the EVM lane. Whisper lets it sign a link saying "deliver my messages to this Ethereum-account inbox". Senders accept the link only if its ML-DSA-87 signature verifies against the main account's key registered on QoreChain.

Scripts: `private/tools/e2e-link.cjs`, `e2e-link-gate.cjs` and `qx-send.cjs`.

| Attempt | Expected | Actual | Result |
| --- | --- | --- | --- |
| Link a main account that has **no** ML-DSA key on chain (fresh "Account 1") | Whisper refuses to call it linked | **Before fix:** UI said "Main account linked", but `resolveRecipient` returned `no-key` (the link was correctly ignored by readers). **After fix:** the app explains the problem and hides the sign button | Fail, then pass (**F-1**) |
| Follow the new in-app advice: send 0.01 QOR from the main account using QoreX's own Send screen | QoreX registers the key | Tx `8EB197ED…` "Sent with a hybrid ML-DSA-87 signature"; the PQC registry now has the key | Pass |
| Resolve the main account after that | Messages route to the linked inbox | `status ready, via link, inbox 0x3575…b1a8` | Pass |

## 7. Browser hardening

| Check | Expected | Actual | Result |
| --- | --- | --- | --- |
| App under a strict Content-Security-Policy (no inline script, `connect-src` limited to self and the QoreChain EVM/REST hosts), served with the header and used with real QoreX | Works, no violations | QoreX provider present, unlock works, 8 messages decrypt, 2 signatures verify, 0 CSP violations | Pass after **F-3** |
| Clickjacking | Cannot be framed | `X-Frame-Options: DENY` and `frame-ancestors 'none'` | Configured |
| A site that opened Whisper keeps a handle to the window | Handle cut | `Cross-Origin-Opener-Policy: same-origin`, served by the live site | Pass (**F-4**) |

The CSP test first injected the exact header from `apps/web/vercel.json` into a local build; the live site now serves it, COOP and the other headers, and a signed send there showed 0 violations (see Open items).

## Findings

| ID | Severity | Finding | Fix | Retest |
| --- | --- | --- | --- | --- |
| F-1 | Medium (integrity of UI) | Linking a main account whose ML-DSA key is not on chain showed "Main account linked", but every reader ignored the link, so messages to that address would not arrive. | Setup checks `pqcKeyStatus` before signing and explains how to register the key. After publishing, the app reads the link back with `getLinkedInbox` and only reports success if it verifies. | Pass (section 6) |
| F-2 | Low (phishing aid) | The "You came here from …" line and the draft came straight from the URL. A site could pose as "Whisper Support" with a long label, and a hand-written URL bypassed the SDK's length limits. | The label is whitespace-collapsed, capped at 60 chars, quoted, and worded as the site's own claim; the draft is capped at 500. Both are rendered as text. | Pass (section 4) |
| F-3 | Medium (defence in depth) | No Content-Security-Policy. The inbox key is decrypted in the page, so any script injection would be serious. | Strict CSP in `vercel.json`. The inline theme script moved to `/theme.js` so `script-src 'self'` needs no exceptions. `/demo/` is excluded because it is a stand-in third-party page. | Pass (section 7) |
| F-4 | Low | `openCompose` popups kept `window.opener`, so the opening site could later navigate the Whisper window to a look-alike page. | `Cross-Origin-Opener-Policy: same-origin` on Whisper. | Pass: header served by the live site |
| F-5 | Info | A damaged backup was reported as a wrong password. | The message now names both causes. AES-GCM cannot tell them apart. | Pass (section 5) |

## Limitations (accepted, documented)

- **L-1 Metadata is public.** Sender address, recipient inbox, time, attached QOR and padded size of every message are on chain. Content is not. This is the price of "no server": anyone can see *that* two addresses talk.
- **L-2 A live EVM window can be used by anyone holding the classical key.** QoreX opens a window scoped to the mailbox, for 1 transaction, for about 10 minutes. If the owner leaves it unused, a classical-key holder could spend that one transaction within the window's limits (mailbox only, capped value). Whisper sends immediately after QoreX opens the window, which keeps this gap small. Closing it fully is QoreChain's call: binding windows to the ML-DSA key per transaction.
- **L-3 The inbox key is as safe as the browser and the password.** A compromised device, a malicious extension or a weak password defeats any web wallet. PBKDF2 at 600,000 rounds slows offline guessing of a stolen backup; it does not stop it for weak passwords, which is why setup requires at least 10 characters.
- **L-4 Trusted infrastructure.** Reads use QoreChain's public EVM RPC, and the PQC key comes from the `pqcKeyStatus` precompile through it. A lying RPC node could hide messages or keys. Whisper cannot detect that without a light client. The QoreX handle registry is reached through a same-origin proxy, but every record's owner and registry signatures are verified in the browser, so the proxy cannot forge a handle.
- **L-5 Fees.** QoreChain charges at least 50% of a transaction's gas limit, so the app estimates gas tightly. A message costs about 0.0156 QOR plus the 0.001 QOR anti-spam fee, and QoreX's window transaction adds about 0.045 QOR.
- **L-6 Reload locks the inbox.** The decrypted key lives only in memory, so a page reload asks for the password again. This is deliberate.
- **L-7 Lost key, lost history.** Without the backup file and password, old messages cannot be decrypted. Publishing a new key starts a fresh inbox.

## Open items

- **QoreChain's own audit service (QCAI).** We planned a two-pass review of `WhisperMailbox` with QoreChain's audit tooling. It needs a signed-in QoreChain dashboard account, so it has not been run. This audit does not claim it.
- **Post-deployment checks: done 19 Nov 2026** on https://whisper-qorex.vercel.app. `curl -I` shows the CSP, `Cross-Origin-Opener-Policy: same-origin`, `X-Frame-Options: DENY`, `nosniff` and `no-referrer`; every app route and both proxies answer, and unknown paths return 404. With the real QoreX extension on the live site we connected, restored the inbox from its encrypted backup (8 messages decrypted, 2 signatures verified), and sent a signed message to Carol with 0 CSP violations; Carol decrypted it as message #15. The phone test is still to do.
- **External review.** None yet.

## Reproducing

```bash
pnpm install
pnpm check                                   # lint, typecheck, Foundry + unit tests, build
pnpm --filter @whisper/contracts test        # contract tests only
ATTACK_PRIVATE_KEY=0x… pnpm --filter @whisper/contracts attack:classical   # testnet, a test account only
```

Never use a key that has held real funds with the attack script. It only prints addresses, but a key typed into a terminal can end up in shell history.

## Second pass, 20–21 November 2026

The first pass proved Whisper works and blocked the attacks we expected. The second pass asked a harder question: **who could read a message that was not meant for them, or make Whisper vouch for something false?** It attacked commit `cca7ca4` with working exploits, written as tests in `packages/sdk/test/security.test.ts` that drive the real `WhisperClient` against an in-memory stand-in for the chain. Everything ran locally: no transactions were sent, the live site was not attacked, and no other AI models or external tools were used.

| | |
| --- | --- |
| Commit audited | `cca7ca4` |
| Fix commits | `65d7d1c` (F-6), `2d96e56` (F-7), `c575567` (F-8), `5529c0d` (F-9) |
| Tests before | 80: 32 SDK, 17 web app, 31 Foundry |
| Tests after | 88: 40 SDK (8 new security tests), 17 web app, 31 Foundry, all passing; `pnpm check` passes |

### Scope and focus
How keys are bound to accounts, the recipient key registry, swapping in another key, links between a main account and an inbox, replay, metadata, the contract's access control, how the client uses cryptography (nonces, key derivation, authenticated encryption, randomness, key storage), XSS that could reach keys, the embed kit (popups, iframes, `postMessage`) and the README's promises. Leak sweep: a secret scan of the working tree and all 30 commits on both branches found only the public BIP-39 test mnemonics; no `.env` or key file was ever committed.

### Summary

| Area | Attacks | Result |
| --- | --- | --- |
| Key binding and the recipient key registry | forged card, rollback to an old card, publishing for another account, copying someone's ML-DSA key | **F-6** and **F-7** found and fixed; the rest blocked |
| Links (main account to inbox) | forged link, replay from another inbox, replay by a former inbox | **F-8** found and fixed; the rest blocked |
| Signed messages and the Check page | header spoofing from the body, an unrelated transaction shown as "sent" proof, re-attribution, chain replay | **F-9** found and fixed; the rest blocked (first-pass tests) |
| Inbox view | quotes and reactions pointing into another conversation | blocked (scoped by conversation) |
| Browser and embedding | XSS sinks, compose URL parameters, `postMessage`, opener, framing | blocked; F-2, F-3 and F-4 still in place |
| Cryptography | nonces, key derivation, authenticated encryption, randomness, vault | no misuse found (see leads) |
| Contract | access control on every write function, fee withdrawal | blocked; index spam is a lead |

### Earlier fixes re-tested
F-1 (the link setup checks the ML-DSA key and reads the link back), F-2 (URL label and draft are trimmed and shown as text), F-3 (CSP `script-src 'self'`, no inline scripts), F-4 (COOP header) and F-5 (backup error wording) still hold in the code. The live headers were not re-checked in this pass.

### Findings (second pass)

Each finding was first shown by a test that fails on the old code (`cca7ca4`), then fixed, then the test was re-run and the fix attacked again.

| ID | Severity | What was wrong | Fix | Status |
| --- | --- | --- | --- | --- |
| **F-6** | High | Senders could be made to seal messages to a thief's key: a key whose card did not verify was still "ready" | A verifying card is required when the account has an ML-DSA-87 key (`65d7d1c`) | Fixed |
| **F-7** | Medium | A retired key and its genuine old card could be published again after a rotation, and senders went back to it | A card must be newer than every earlier card for a different key (`2d96e56`) | Fixed |

#### F-6 (High): messages sealed to a key whose card does not verify

**What was wrong.** Every Whisper inbox key comes with a *card*: a statement signed with the account's ML-DSA-87 key that says "this is my inbox key". `getKey` correctly worked out when a card did **not** verify, but `resolveRecipient` (`packages/sdk/src/client.ts`) ignored that and still returned "ready". The composer enabled Send and `send()` sealed the message to that key. The web app only showed a small "Key not verified" badge. Verification was advice, not a rule.

**How it was exploited.**
1. Alice publishes her inbox key with a valid card.
2. A thief who holds Alice's classical key, and lands one transaction through a leftover EVM window (the risk documented as L-2), publishes **his own** ML-KEM key from Alice's address, with a card he signed himself.
3. Bob resolves Alice and sends "the launch code is 4471".
4. The thief's keys open the envelope. Test: `security.test.ts`, "F-6 … refuses to seal to a key whose card does not verify".

**Impact.** Every later message to Alice is readable by the thief, while Alice's own app simply fails to decrypt. It breaks Whisper's headline promise ("only the recipient can read it"), and section 1, attack 8, which said the swap was "rejected by Whisper": it was flagged, not refused. High rather than Critical because it needs the victim's classical key and an open EVM window.

**Fix** (`65d7d1c`). When the account has an ML-DSA-87 key, its inbox key must carry a card that verifies against it. Otherwise the recipient resolves to the new status `untrusted-key`, `send()` refuses with `INVALID_CARD`, and the app shows a danger notice in place of the send button. Accounts with no ML-DSA-87 key keep the documented "Key not verified" behaviour.

**Verification.** The test failed on `cca7ca4` (the thief could decrypt) and passes after; "still sends to a key with a valid card" passes before and after. Re-attacked: the linked-inbox path applies the same check with the linked inbox's ML-DSA key; an RPC failure while reading the ML-DSA key makes resolution throw (fails closed); replies use the same resolution. Looking for the same pattern elsewhere led to F-7 and F-8.

#### F-7 (Medium): an old key re-published after a rotation

**What was wrong.** Keys and cards stay public in the event history, and cards carried no check that they were the newest. Re-publishing an old key together with its old, genuinely signed card made it the latest key again, and its card verified.

**How it was exploited.** Alice publishes key A (card signed 19 November), then rotates to key B (20 November), perhaps because A leaked. Anyone who can send one transaction from Alice's account re-publishes A with A's original card. Before the fix the recipient resolved to "ready" with A's card verified. Test: `security.test.ts`, "F-7 … does not seal to an older key re-published after a rotation".

**Impact.** Messages go back to a key the user deliberately retired, which is likely the leaked one.

**Fix** (`2d96e56`). `getKey` reads every key event, and the latest card counts as verified only if its signed `issued` time is later than every earlier verified card for a different key. A rollback resolves to `untrusted-key` (see F-6), and nothing is sealed.

**Verification.** The rollback test failed on `cca7ca4` and passes after. Two guard tests pass before and after: re-publishing the current key and card changes nothing, and a normal rotation to a newer card is accepted. Re-attacked: A → B → A is rejected; a forged newer card fails the F-6 check.
