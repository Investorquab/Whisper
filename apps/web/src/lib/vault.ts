/**
 * The inbox vault: the 32-byte seed that derives an inbox's ML-KEM-1024 keys, encrypted in the browser.
 *
 * - Key: PBKDF2-SHA256 (600,000 iterations, 16-byte random salt) over the user's password, then AES-256-GCM
 *   with a 12-byte random IV. The account address is bound in as additional data, so a vault copied to
 *   another account fails to open.
 * - Storage: IndexedDB in this browser. The plaintext seed is never written anywhere.
 * - Backup: the same encrypted record as a JSON file; restoring it still needs the password.
 */

export const VAULT_VERSION = 1;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSWORD_LENGTH = 10;

export interface VaultRecord {
  v: typeof VAULT_VERSION;
  /** Inbox account, lowercase 0x. */
  account: string;
  /** SHA-256 fingerprint of the ML-KEM public key this seed derives (to match against chain). */
  keyFingerprint: string;
  kdf: { name: "PBKDF2-SHA256"; iterations: number; salt: string };
  iv: string;
  ciphertext: string;
  createdAt: string;
}

const DB_NAME = "whisper";
const STORE = "vaults";

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  },
  decode(text: string): Uint8Array {
    const s = atob(text);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export class VaultError extends Error {
  constructor(
    readonly code: "WRONG_PASSWORD" | "WEAK_PASSWORD" | "NOT_FOUND" | "INVALID_BACKUP" | "WRONG_ACCOUNT" | "STORAGE",
    message: string,
  ) {
    super(message);
    this.name = "VaultError";
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const aad = (account: string) => new TextEncoder().encode(`whisper-vault-v1|${account.toLowerCase()}`);

export function checkPassword(password: string): string | undefined {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (/^(.)\1+$/.test(password)) return "Avoid repeating one character.";
  return undefined;
}

/** Encrypts a seed for an account. `iterations` is only lowered in tests. */
export async function sealVault(args: {
  account: string;
  seed: Uint8Array;
  password: string;
  keyFingerprint: string;
  iterations?: number;
}): Promise<VaultRecord> {
  const problem = checkPassword(args.password);
  if (problem) throw new VaultError("WEAK_PASSWORD", problem);
  if (args.seed.length !== 32) throw new VaultError("STORAGE", "A seed is 32 bytes");
  const iterations = args.iterations ?? PBKDF2_ITERATIONS;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(args.password, salt, iterations);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: aad(args.account) as BufferSource }, key, args.seed as BufferSource),
  );
  return {
    v: VAULT_VERSION,
    account: args.account.toLowerCase(),
    keyFingerprint: args.keyFingerprint,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: b64.encode(salt) },
    iv: b64.encode(iv),
    ciphertext: b64.encode(ciphertext),
    createdAt: new Date().toISOString(),
  };
}

/** Decrypts a vault. Throws WRONG_PASSWORD when the password (or account) does not match. */
export async function openVault(record: VaultRecord, password: string): Promise<Uint8Array> {
  const key = await deriveKey(password, b64.decode(record.kdf.salt), record.kdf.iterations);
  try {
    const seed = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64.decode(record.iv) as BufferSource, additionalData: aad(record.account) as BufferSource },
      key,
      b64.decode(record.ciphertext) as BufferSource,
    );
    return new Uint8Array(seed);
  } catch {
    throw new VaultError("WRONG_PASSWORD", "That password does not unlock this inbox, or the backup file is damaged.");
  }
}

export function parseBackup(text: string, expectedAccount?: string): VaultRecord {
  let record: VaultRecord;
  try {
    record = JSON.parse(text) as VaultRecord;
  } catch {
    throw new VaultError("INVALID_BACKUP", "This file is not a Whisper backup.");
  }
  const ok =
    record?.v === VAULT_VERSION &&
    typeof record.account === "string" &&
    /^0x[0-9a-f]{40}$/.test(record.account) &&
    record.kdf?.name === "PBKDF2-SHA256" &&
    Number.isInteger(record.kdf.iterations) &&
    record.kdf.iterations >= 100_000 &&
    typeof record.iv === "string" &&
    typeof record.ciphertext === "string" &&
    typeof record.keyFingerprint === "string";
  if (!ok) throw new VaultError("INVALID_BACKUP", "This file is not a Whisper backup.");
  if (expectedAccount && record.account !== expectedAccount.toLowerCase()) {
    throw new VaultError("WRONG_ACCOUNT", "This backup belongs to a different account.");
  }
  return record;
}

export function backupFileName(record: VaultRecord): string {
  return `whisper-inbox-${record.account.slice(2, 8)}-backup.json`;
}

// ------------------------------------------------------------------ IndexedDB

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "account" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new VaultError("STORAGE", "This browser blocked local storage. Whisper needs it to keep your inbox key."));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const t = database.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new VaultError("STORAGE", "Could not access local storage."));
    t.oncomplete = () => database.close();
  });
}

export function saveVault(record: VaultRecord): Promise<IDBValidKey> {
  return tx("readwrite", (s) => s.put(record));
}

export async function loadVault(account: string): Promise<VaultRecord | undefined> {
  return (await tx<VaultRecord | undefined>("readonly", (s) => s.get(account.toLowerCase()))) ?? undefined;
}

export function deleteVault(account: string): Promise<undefined> {
  return tx("readwrite", (s) => s.delete(account.toLowerCase()));
}
