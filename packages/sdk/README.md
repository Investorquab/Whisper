# @whisper/sdk

Post-quantum, on-chain messaging for QoreChain. Add a **"Message the creator"** button to any dApp, or read, send and verify Whisper messages from your own code.

- Messages are sealed with **ML-KEM-1024** (QoreSeal) and stored in the `WhisperMailbox` contract on QoreChain. There is no server and no relay.
- Signed messages carry a hybrid **ML-DSA-87 + secp256k1** signature (QoreSign). Anyone can check one against the signer's key in QoreChain's PQC registry.
- Writes go through the user's **QoreX** wallet (Ethereum account). Reads need no wallet at all.

| Network | Chain | Mailbox |
| --- | --- | --- |
| QoreChain testnet | `qorechain-diana` (EVM 9800) | `0xd837298637f4459a3981b540d5543a4423add801` |

---

## 1. The button, with one script tag (no build step)

Put an element where the button should go and load the script from your Whisper deployment. The script turns every `[data-whisper-to]` element into a button.

```html
<span
  data-whisper-to="0xeB279977041A05a7F909Bd0942411F682bB581d8"
  data-whisper-label="Message the artist"
  data-whisper-source="Night Market"
  data-whisper-draft="Hi! I'm interested in this print."
></span>
<script src="https://YOUR-WHISPER-APP/whisper-button.js" defer></script>
```

| Attribute | Required | Meaning |
| --- | --- | --- |
| `data-whisper-to` | yes | Recipient, `0x…` or `qor1…` |
| `data-whisper-app` | no | Whisper app URL. Defaults to the origin the script was loaded from |
| `data-whisper-label` | no | Button text. Default "Message the creator" |
| `data-whisper-draft` | no | Text placed in the composer (max 500 chars). The sender still reviews it |
| `data-whisper-source` | no | Shown to the sender as "You came here from …" (max 60 chars). Defaults to the page title |
| `data-whisper-theme` | no | `dark` (default) or `light` |

Clicking opens Whisper in a 440×720 popup addressed to the recipient. Whisper runs as its own window because QoreX does not inject into iframes. If the browser blocks the popup, the button works as a normal link in a new tab. Ctrl/Cmd/Shift-click always opens a tab.

The script is ~22 KB minified and exposes `window.WhisperButton.autoMountMessageButtons` for content added after page load.

A working example lives in [`examples/creator-demo`](../../examples/creator-demo) and is served by the app at `/demo/`.

## 2. The button from JavaScript

```ts
import { mountMessageButton, composeUrl, openCompose } from "@whisper/sdk";

const remove = mountMessageButton(document.getElementById("contact")!, {
  to: "qor1avnejacyrgz607gfh5y5ysgldq4mtqwcy67tzp",
  appUrl: "https://YOUR-WHISPER-APP",
  label: "Message the seller",
  source: "My NFT market",
  draft: "Hi, is token #42 still for sale?",
});

// Or build your own button:
const href = composeUrl({ to: "0x…", appUrl: "https://YOUR-WHISPER-APP" });
button.onclick = () => openCompose({ to: "0x…", appUrl: "https://YOUR-WHISPER-APP" }) ?? window.open(href);
```

### React

```tsx
import { mountMessageButton } from "@whisper/sdk";
import { useEffect, useRef } from "react";

export function MessageCreator({ to }: { to: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => mountMessageButton(ref.current!, { to, appUrl: "https://YOUR-WHISPER-APP" }), [to]);
  return <span ref={ref} />;
}
```

## 3. Reading from the chain (no wallet)

```ts
import { WhisperClient } from "@whisper/sdk";

const client = new WhisperClient(); // QoreChain testnet, public RPC

const r = await client.resolveRecipient("qor1avnejacyrgz607gfh5y5ysgldq4mtqwcy67tzp");
r.status;     // "ready" when the account published a Whisper key, otherwise "no-key"
r.hasPqcKey;  // true when an ML-DSA-87 key is registered on QoreChain
r.inbox;      // where messages go (a linked inbox if the account set one)

const pq = await client.pqcKeyStatus("0xeB27…");   // reads the pqcKeyStatus precompile 0x…0a02
const size = await client.mailboxSize("0xeB27…");  // { inbox, outbox } message counts
```

Registered ML-DSA keys are read from the EVM precompile first. The REST fallback (`network.rest`) does not send CORS headers, so in a browser point it at a same-origin proxy, for example `new WhisperClient({ network: { ...QORECHAIN_TESTNET, rest: location.origin + "/api/qore" } })`, as the Whisper web app does.

## 4. Sending (QoreX)

```ts
import { WhisperClient, inboxKeysFromSeed } from "@whisper/sdk";

const provider = window.qorex!.evm;                 // QoreX's EVM lane (EIP-1193)
const client = new WhisperClient({ provider });
const [from] = (await provider.request({ method: "eth_requestAccounts" })) as string[];

const recipient = await client.resolveRecipient("qor1…", from);
const hash = await client.send({
  from,
  recipient,
  payload: { v: 1, type: "message", body: "gm, post-quantum", ts: Date.now() },
  senderKeys,            // optional: also seals a copy to your own inbox so you can read your outbox
  attach: 10n ** 17n,    // optional: forward 0.1 QOR with the message
});
await client.waitFor(hash);
```

Every message pays the mailbox fee (0.001 QOR on testnet) plus gas. QoreX opens its ML-DSA EVM authorisation window for the transaction itself; the user approves twice in the wallet. Only a QoreX **Ethereum account** can send EVM transactions.

To receive messages an account publishes an ML-KEM-1024 key once:

```ts
import { generateInboxKeys, cardStatement, encodeCard } from "@whisper/sdk";
const keys = generateInboxKeys(); // keep keys.secretKey private: it decrypts the inbox
// sign cardStatement(...) with QoreX signArbitrary, then:
await client.publishKey(from, keys.publicKey, card);
```

The Whisper app keeps the secret key in an AES-GCM vault (PBKDF2, 600k rounds) in IndexedDB, never on chain and never on a server.

## 5. Reading an inbox

```ts
const items = await client.readMailbox(account, keys, { direction: "in" });
for (const m of items) {
  m.payload?.body;   // decrypted text, or m.error when it could not be opened
  m.payload?.signed; // present if the sender signed it
}
```

## 6. Verifying a signed message

```ts
import { verifySignedMessage, verifyProofBundle } from "@whisper/sdk";

const pq = await client.pqcPublicKey(item.from);       // the signer's ML-DSA-87 key, from QoreChain
verifySignedMessage({ chainId: client.network.chainId, from: item.from, to: item.to, payload: item.payload!, pqPublicKey: pq! });
// throws WhisperError("INVALID_SIGNATURE") if one character differs
```

A **proof bundle** (`{ v, chainId, from, statement, signature, txHash }`) lets someone show one signed message to a third party. The app's `/check#…` page verifies it with no wallet; `verifyProofBundle(bundle, pq)` does the same in code.

## 7. Contact controls

```ts
await client.setRequestMode(from, true);         // strangers can only send a contact request
await client.setAllowed(from, "0x…", true);      // accept a contact
await client.setBlocked(from, "0x…", true);      // block a sender (enforced by the contract)
await client.contactStatus(owner, sender);       // { requestMode, allowed, blocked }
```

## 8. Errors

All SDK errors are `WhisperError` with a `code`. `explainError(e)` turns wallet and contract failures (custom-error reverts such as `RequestOnly` or `SenderBlocked`, rejected signatures, missing funds) into a sentence you can show users.

## 9. QoreX handles

```ts
import { resolveHandle, reverseHandle } from "@whisper/sdk";
const rec = await resolveHandle("carol", { baseUrl: "/api/handles" }); // verifies owner + registry signatures
```

The handle registry only allows CORS from the QoreX dashboard, so browsers need a same-origin proxy (see `apps/web/vercel.json`).

## Building

```bash
pnpm --filter @whisper/sdk build   # ESM, CJS, types and dist/whisper-button.js (IIFE)
pnpm --filter @whisper/sdk test
```

MIT licensed.
