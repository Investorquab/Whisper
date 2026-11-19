// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { autoMountMessageButtons, mountMessageButton } from "../src/button.js";

const CAROL = "0xeB279977041A05a7F909Bd0942411F682bB581d8";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Message the creator button", () => {
  it("renders an accessible link to the compose page", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountMessageButton(host, { to: CAROL, appUrl: "https://whisper.example", source: "Night Market", label: "Message the artist" });
    const a = host.querySelector("a")!;
    expect(a.textContent).toBe("Message the artist");
    const url = new URL(a.href);
    expect(url.origin).toBe("https://whisper.example");
    expect(url.pathname).toBe(`/to/${CAROL}`);
    expect(url.searchParams.get("from")).toBe("Night Market");
    expect(a.getAttribute("rel")).toBe("noopener");
  });

  it("opens a popup on click and falls back to the link when the popup is blocked", () => {
    const host = document.createElement("div");
    document.body.append(host);
    mountMessageButton(host, { to: CAROL, appUrl: "https://whisper.example" });
    const a = host.querySelector("a")!;
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    const opened = new MouseEvent("click", { cancelable: true });
    a.dispatchEvent(opened);
    expect(open).toHaveBeenCalledWith(expect.stringContaining(`/to/${CAROL}`), "whisper-compose", expect.stringContaining("popup=yes"));
    expect(opened.defaultPrevented).toBe(true);
    open.mockReturnValue(null);
    const blocked = new MouseEvent("click", { cancelable: true });
    a.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(false);
  });

  it("removes itself cleanly", () => {
    const host = document.createElement("div");
    const remove = mountMessageButton(host, { to: CAROL, appUrl: "https://whisper.example" });
    remove();
    expect(host.children.length).toBe(0);
  });

  it("auto-mounts from data attributes, once, and skips invalid addresses", () => {
    document.body.innerHTML = `
      <span id="ok" data-whisper-to="${CAROL}" data-whisper-app="https://whisper.example" data-whisper-label="Ask the seller"></span>
      <span id="bad" data-whisper-to="0x123" data-whisper-app="https://whisper.example"></span>
      <span id="noapp" data-whisper-to="${CAROL}"></span>`;
    expect(autoMountMessageButtons()).toBe(1);
    expect(autoMountMessageButtons()).toBe(0);
    expect(document.querySelector("#ok a")?.textContent).toBe("Ask the seller");
    expect(document.querySelector("#bad a")).toBeNull();
    expect(document.querySelector("#noapp a")).toBeNull();
  });
});
