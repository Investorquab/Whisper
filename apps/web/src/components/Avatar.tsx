/** Deterministic avatar from an address: a soft hue and two characters. No external service, no tracking. */
export function Avatar({ address, handle, size = 40 }: { address: string; handle?: string | null; size?: number }) {
  const hex = address.toLowerCase().replace(/^0x/, "");
  const hue = parseInt(hex.slice(0, 6), 16) % 360;
  const text = handle ? handle.slice(0, 2).toUpperCase() : hex.slice(0, 2).toUpperCase();
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: `hsl(${hue} 55% 42% / 0.22)`, color: `hsl(${hue} 70% 62%)`, fontSize: size * 0.36 }}
    >
      {text}
    </span>
  );
}
