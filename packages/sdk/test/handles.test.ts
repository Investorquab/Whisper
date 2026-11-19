import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isHandle, normalizeHandle, resolveHandle, verifyHandleRecord, type HandleRecord } from "../src/handles.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/handle-test.json", import.meta.url), "utf8")) as { record: HandleRecord };

describe("QoreX @handles", () => {
  it("verifies a real record from the QoreX handle registry", () => {
    expect(() => verifyHandleRecord(fixture.record)).not.toThrow();
  });

  it("rejects a record whose address was swapped", () => {
    const swapped = { ...fixture.record, qorAddress: "qor18z3hpmxe5tjrdpk096jgj5ppd6mwry5atay6g4" };
    expect(() => verifyHandleRecord(swapped)).toThrowError(/owner key does not match/);
  });

  it("rejects a record re-signed by a different registry key or with tampered fields", () => {
    expect(() => verifyHandleRecord(fixture.record, "00".repeat(32))).toThrowError(/registry signature invalid|malformed/);
    expect(() => verifyHandleRecord({ ...fixture.record, createdAt: fixture.record.createdAt + 1 })).toThrowError(/registry signature invalid/);
    expect(() => verifyHandleRecord({ ...fixture.record, pqcRegistered: !fixture.record.pqcRegistered })).toThrowError(/registry signature invalid/);
  });

  it("normalizes and validates handle syntax like QoreX", () => {
    expect(normalizeHandle("  @Maria ")).toBe("maria");
    expect(isHandle("@maria_01")).toBe(true);
    expect(isHandle("ab")).toBe(false);
    expect(isHandle("qorex")).toBe(false);
    expect(isHandle("qorechain_team")).toBe(false);
    expect(isHandle("hello-world")).toBe(false);
  });

  it("resolves through a proxy, refuses mismatched answers and reports unclaimed handles", async () => {
    const ok = await resolveHandle("@Test", { baseUrl: "https://proxy.example", fetch: async () => new Response(JSON.stringify(fixture)) });
    expect(ok?.qorAddress).toBe(fixture.record.qorAddress);
    await expect(resolveHandle("other_name", { baseUrl: "https://proxy.example", fetch: async () => new Response(JSON.stringify(fixture)) })).rejects.toThrowError(/answered for @test/);
    expect(await resolveHandle("nobody_here", { baseUrl: "https://proxy.example", fetch: async () => new Response("{}", { status: 404 }) })).toBeUndefined();
    const lying = { record: { ...fixture.record, qorAddress: "qor18z3hpmxe5tjrdpk096jgj5ppd6mwry5atay6g4" } };
    await expect(resolveHandle("test", { baseUrl: "https://proxy.example", fetch: async () => new Response(JSON.stringify(lying)) })).rejects.toThrowError(/failed verification/);
  });
});
