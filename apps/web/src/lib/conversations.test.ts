import type { InboxItem, WhisperPayload } from "@whisper/sdk";
import { describe, expect, it } from "vitest";
import { buildConversations } from "./conversations";

const ME = "0x35750cc522969F297F421E411e0Cb4493572b1a8";
const ALICE = "0x38a370ecd9a2e43686cf2ea48950216eb6e1929d";
const BOB = "0x9d915196cb6c562e95f83240d5f1f6e4d38661a5";

let n = 0n;
function item(from: string, to: string, payload?: Partial<WhisperPayload>, extra: Partial<InboxItem> = {}): InboxItem {
  const id = n++;
  return {
    id,
    kind: "message",
    from: from as `0x${string}`,
    to: to as `0x${string}`,
    attached: 0n,
    blockNumber: 100n + id,
    txHash: `0x${id.toString(16).padStart(64, "0")}`,
    payload: payload ? { v: 1, type: "text", body: "", ts: Number(id), ...payload } : undefined,
    error: payload ? undefined : "Could not read this message",
    ...extra,
  };
}

describe("buildConversations", () => {
  it("groups received and sent messages by the other party, newest conversation first", () => {
    n = 0n;
    const a1 = item(ALICE, ME, { body: "hi" });
    const b1 = item(BOB, ME, { body: "hey" });
    const a2 = item(ME, ALICE, { body: "hello Alice" });
    const convs = buildConversations(ME, [a1, b1], [a2]);
    expect(convs.map((c) => c.peer)).toEqual([ALICE, BOB]);
    expect(convs[0]!.messages.map((m) => m.mine)).toEqual([false, true]);
    expect(convs[0]!.preview).toBe("You: hello Alice");
  });

  it("deduplicates items present in both directions (notes to self)", () => {
    n = 0n;
    const note = item(ME, ME, { body: "remember" });
    const convs = buildConversations(ME, [note], [note]);
    expect(convs).toHaveLength(1);
    expect(convs[0]!.peer).toBe(ME.toLowerCase());
    expect(convs[0]!.messages).toHaveLength(1);
  });

  it("attaches reactions to their message; the latest reaction per person wins", () => {
    n = 0n;
    const msg = item(ALICE, ME, { body: "deal?" });
    const r1 = item(ME, ALICE, { type: "reaction", body: "👍", replyTo: msg.id.toString() });
    const r2 = item(ME, ALICE, { type: "reaction", body: "✅", replyTo: msg.id.toString() });
    const theirs = item(ALICE, ME, { type: "reaction", body: "🙏", replyTo: msg.id.toString() });
    const [conv] = buildConversations(ME, [msg, theirs], [r1, r2]);
    expect(conv!.messages).toHaveLength(1);
    expect(conv!.messages[0]!.reactions.map((r) => [r.emoji, r.mine])).toEqual([
      ["✅", true],
      ["🙏", false],
    ]);
  });

  it("ignores a stranger's reaction aimed at another conversation's message", () => {
    n = 0n;
    const msg = item(ALICE, ME, { body: "private" });
    const spoof = item(BOB, ME, { type: "reaction", body: "😈", replyTo: msg.id.toString() });
    const convs = buildConversations(ME, [msg, spoof], []);
    expect(convs.find((c) => c.peer === ALICE)!.messages[0]!.reactions).toEqual([]);
  });

  it("marks unanswered contact requests and clears the flag once I reply", () => {
    n = 0n;
    const req = item(BOB, ME, { type: "request", body: "may I?" }, { kind: "request" });
    expect(buildConversations(ME, [req], [])[0]!.isRequest).toBe(true);
    const reply = item(ME, BOB, { body: "sure" });
    expect(buildConversations(ME, [req], [reply])[0]!.isRequest).toBe(false);
  });

  it("counts unread inbound messages after the last read id and sums attached QOR", () => {
    n = 0n;
    const a = item(ALICE, ME, { body: "1" }, { attached: 5n });
    const b = item(ALICE, ME, { body: "2" }, { attached: 7n });
    const c = item(ME, ALICE, { body: "mine" });
    const [conv] = buildConversations(ME, [a, b], [c], { [ALICE]: a.id.toString() });
    expect(conv!.unread).toBe(1);
    expect(conv!.attachedTotal).toBe(12n);
  });

  it("keeps undecryptable items visible with a clear preview", () => {
    n = 0n;
    const bad = item(ALICE, ME);
    const [conv] = buildConversations(ME, [bad], []);
    expect(conv!.messages[0]!.item.error).toBeDefined();
    expect(conv!.preview).toBe("Message could not be decrypted");
  });
});
