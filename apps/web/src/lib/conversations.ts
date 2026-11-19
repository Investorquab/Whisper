import type { InboxItem } from "@whisper/sdk";

/** One message as the inbox shows it. */
export interface ThreadMessage {
  id: string;
  /** True when I sent it. */
  mine: boolean;
  item: InboxItem;
  /** Reactions on this message, newest last (emoji and who). */
  reactions: { emoji: string; mine: boolean; id: string }[];
}

export interface Conversation {
  /** The other party, lowercase 0x. */
  peer: string;
  messages: ThreadMessage[];
  /** Latest message or reaction id, for ordering. */
  lastId: bigint;
  /** Preview of the latest readable message. */
  preview: string;
  /** Every inbound item is a contact request and I have not answered. */
  isRequest: boolean;
  /** Inbound messages newer than the last one I read. */
  unread: number;
  attachedTotal: bigint;
}

const lower = (a: string) => a.toLowerCase();

/**
 * Groups my received and sent items into conversations. Items I sent to myself (notes) form a
 * conversation with myself. Reactions attach to the message they point at instead of showing as messages.
 * `lastRead` maps peer → highest message id read.
 */
export function buildConversations(me: string, received: InboxItem[], sent: InboxItem[], lastRead: Record<string, string> = {}): Conversation[] {
  const self = lower(me);
  const byId = new Map<string, InboxItem>();
  for (const item of [...received, ...sent]) byId.set(item.id.toString(), item);
  const items = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const groups = new Map<string, ThreadMessage[]>();
  const messageIndex = new Map<string, ThreadMessage>();
  const reactions: InboxItem[] = [];

  for (const item of items) {
    const mine = lower(item.from) === self;
    const peer = mine ? lower(item.to) : lower(item.from);
    if (item.payload?.type === "reaction" && item.payload.replyTo) {
      reactions.push(item);
      continue;
    }
    const message: ThreadMessage = { id: item.id.toString(), mine, item, reactions: [] };
    messageIndex.set(message.id, message);
    const list = groups.get(peer) ?? [];
    list.push(message);
    groups.set(peer, list);
  }

  for (const r of reactions) {
    const target = messageIndex.get(r.payload!.replyTo!);
    if (!target) continue;
    const mine = lower(r.from) === self;
    const sameConversation = mine ? lower(r.to) === peerOf(target, self) : lower(r.from) === peerOf(target, self);
    if (!sameConversation) continue; // a reaction from a stranger cannot attach to someone else's message
    // One reaction per person per message: the latest wins.
    target.reactions = target.reactions.filter((x) => x.mine !== mine);
    target.reactions.push({ emoji: r.payload!.body, mine, id: r.id.toString() });
  }

  const conversations: Conversation[] = [];
  for (const [peer, messages] of groups) {
    const inbound = messages.filter((m) => !m.mine);
    const iReplied = messages.some((m) => m.mine);
    const latest = messages[messages.length - 1]!;
    const lastReadId = BigInt(lastRead[peer] ?? "-1");
    const readable = [...messages].reverse().find((m) => m.item.payload);
    conversations.push({
      peer,
      messages,
      lastId: messages.reduce((max, m) => (m.item.id > max ? m.item.id : max), latest.item.id),
      preview: readable ? previewText(readable) : "Message could not be decrypted",
      isRequest: inbound.length > 0 && !iReplied && inbound.every((m) => m.item.kind === "request"),
      unread: inbound.filter((m) => m.item.id > lastReadId).length,
      attachedTotal: inbound.reduce((sum, m) => sum + m.item.attached, 0n),
    });
  }
  return conversations.sort((a, b) => (a.lastId < b.lastId ? 1 : -1));
}

function peerOf(message: ThreadMessage, self: string): string {
  return message.mine ? lower(message.item.to) : lower(message.item.from) === self ? lower(message.item.to) : lower(message.item.from);
}

function previewText(m: ThreadMessage): string {
  const body = m.item.payload!.body.replace(/\s+/g, " ").trim();
  return `${m.mine ? "You: " : ""}${body.length > 90 ? `${body.slice(0, 89)}…` : body}`;
}

/** Short, human time: "14:05", "Yesterday", "3 Nov". */
export function shortTime(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const yesterday = new Date(now - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
