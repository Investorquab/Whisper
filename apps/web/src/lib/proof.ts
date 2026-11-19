import type { MessageProofBundle } from "@whisper/sdk";

/** Proofs travel in the URL fragment (`/check#…`), which browsers never send to any server. */
export function encodeProof(bundle: MessageProofBundle): string {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeProof(text: string): MessageProofBundle {
  const cleaned = text.trim().replace(/^.*#/, "");
  let json: string;
  if (cleaned.startsWith("{")) {
    json = cleaned;
  } else {
    const b64 = cleaned.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    json = new TextDecoder().decode(bytes);
  }
  const bundle = JSON.parse(json) as MessageProofBundle;
  if (bundle?.v !== 1 || typeof bundle.statement !== "string" || typeof bundle.from !== "string" || typeof bundle.signature !== "object") {
    throw new Error("This is not a Whisper message proof.");
  }
  return bundle;
}

export function proofUrl(bundle: MessageProofBundle): string {
  return `${window.location.origin}/check#${encodeProof(bundle)}`;
}
