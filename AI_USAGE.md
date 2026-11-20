# How AI was used to build Whisper

Whisper was built by one developer working with **Claude Code** (Anthropic's coding agent) in a cloud session. This file says plainly who did what, so judges and users can weigh the work.

## The split

**The developer decided:**

- the product: a post-quantum messenger, chosen over a vault, an oracle and a launchpad after comparing them against what QoreChain and QoreX already offer;
- that everything lives on chain, that QoreX must be involved in every send, and that "Message the creator" is the most important integration;
- the four real problems the README and the video lead with;
- twelve build rules: a professional repo, a serious audit, a real SDK, no generic UI, tests before every commit, a full landing page, an evidence-based submission checklist, a backend only if needed, private notes kept out of the repo;
- every push to GitHub (from their own machine), the faucet funding of test accounts, the deployment, and the phone test.

**Claude Code did, under those rules:**

- **Research.** Read QoreChain's docs, the QoreX 0.4.3 extension code and the hackathon's project list; then tested each assumption on the live testnet before building on it (spike results drove the design: EVM windows, the `pqcKeyStatus` precompile, QoreX's account types, iframe limits, CORS).
- **Contract.** Wrote `WhisperMailbox` and its 31 Foundry tests (fuzzing, reentrancy, fee isolation), and the deploy script.
- **SDK.** Wrote `@whisper/sdk` (sealing, signatures, handle verification, the message button) and its 32 tests, including fixtures signed by the real QoreX wallet.
- **App and landing page.** Wrote the React app and the static landing page. Design choices came from two design skills used as working references: UI/UX Pro Max (style, palette and accessibility rules) and the Taste skill (its layout dealer, copy linter and finish gate, which the landing page was run through at 1440, 1024, 820, 768, 390 and 320 pixels).
- **Testing with the real wallet.** Drove Chrome with the real QoreX extension through Playwright: setup, sending, signed messages, attached QOR, contact requests, reactions, the creator popup, proof links, main-account linking and backup restore, with a second test user ("Carol") answering from a script.
- **Breaking it.** Wrote and ran the classical-key attack script and the browser checks in `audit.md`, fixed what failed (five findings), and re-ran each test.

## How the AI's work was checked

- Nothing was marked done without evidence: a passing test, an on-chain transaction, a screenshot or a measured result. `audit.md` keeps the failures as well as the passes.
- Every commit passed `pnpm check` (lint, typecheck, all tests, production build) first.
- Claims in the README and on the landing page were checked against the code and the chain (for example, the attack table is the script's real output, and the fee and limits come from the contract).
- The developer reviewed progress at each milestone and changed direction several times (rejecting ideas, renaming the product, adding the creator button as a priority).

## What AI did not do

- It held no keys of real value. Test accounts were testnet-only, their mnemonics never left the session's scratch space, and the attack script runs only against test accounts.
- It did not connect to or change any server: the app has no backend.
- It did not push to GitHub or deploy; the developer did both.
