import { shortAddress } from "@whisper/sdk";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

/** An address in mono type with a copy button. Shows a short form; the full value is copied and titled. */
export function Address({ value, short = true, label }: { value: string; short?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const display = short ? shortAddress(value, value.startsWith("qor1") ? 8 : 6, 4) : value;
  return (
    <span className="address" title={value}>
      {label && <span className="sr-only">{label}: </span>}
      <span className="address__text">{display}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label={copied ? "Copied" : `Copy ${label ?? "address"}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          } catch {
            /* clipboard blocked: the full value stays selectable in the title */
          }
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
    </span>
  );
}
