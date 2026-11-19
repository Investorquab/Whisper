import { describe, expect, it } from "vitest";
import { checkPassword, deleteVault, loadVault, openVault, parseBackup, saveVault, sealVault } from "./vault";

const account = "0x35750cc522969F297F421E411e0Cb4493572b1a8";
const seed = new Uint8Array(32).map((_, i) => i + 1);
const fast = { iterations: 1000 }; // production uses 600,000

describe("vault", () => {
  it("encrypts and decrypts the seed with the password", async () => {
    const record = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", ...fast });
    expect(record.ciphertext).not.toContain(btoa(String.fromCharCode(...seed)));
    expect(await openVault(record, "correct horse battery")).toEqual(seed);
  });

  it("rejects a wrong password", async () => {
    const record = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", ...fast });
    await expect(openVault(record, "wrong password!!")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("is bound to its account (a vault moved to another account fails)", async () => {
    const record = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", ...fast });
    await expect(openVault({ ...record, account: "0x9d915196cb6c562e95f83240d5f1f6e4d38661a5" }, "correct horse battery")).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("uses a fresh salt and IV every time", async () => {
    const a = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", ...fast });
    const b = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", ...fast });
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("refuses weak passwords", async () => {
    expect(checkPassword("short")).toMatch(/10 characters/);
    expect(checkPassword("aaaaaaaaaaaa")).toMatch(/repeating/);
    expect(checkPassword("a fine passphrase")).toBeUndefined();
    await expect(sealVault({ account, seed, password: "short", keyFingerprint: "0x" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });

  it("defaults to 600,000 PBKDF2 iterations", async () => {
    const record = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc" });
    expect(record.kdf.iterations).toBe(600_000);
  });

  it("validates backup files", async () => {
    const record = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", iterations: 100_000 });
    const text = JSON.stringify(record);
    expect(parseBackup(text, account)).toEqual(record);
    expect(() => parseBackup("not json")).toThrowError(/not a Whisper backup/);
    expect(() => parseBackup(JSON.stringify({ ...record, kdf: { ...record.kdf, iterations: 10 } }))).toThrowError(/not a Whisper backup/);
    expect(() => parseBackup(text, "0x9d915196cb6c562e95f83240d5f1f6e4d38661a5")).toThrowError(/different account/);
  });

  it("stores, loads and deletes vaults in IndexedDB", async () => {
    const record = await sealVault({ account, seed, password: "correct horse battery", keyFingerprint: "0xabc", ...fast });
    await saveVault(record);
    expect(await loadVault(account.toUpperCase().replace("0X", "0x"))).toEqual(record);
    await deleteVault(account);
    expect(await loadVault(account)).toBeUndefined();
  });
});
