interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}

/** The Whisper mark: a speech bubble whose three dots fade, a message said quietly. */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M6 4.5h20A3.5 3.5 0 0 1 29.5 8v13a3.5 3.5 0 0 1-3.5 3.5H13.2l-5.6 4.6a.9.9 0 0 1-1.5-.7v-3.9H6A3.5 3.5 0 0 1 2.5 21V8A3.5 3.5 0 0 1 6 4.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="14.5" r="2" fill="var(--accent)" />
      <circle cx="16" cy="14.5" r="2" fill="var(--accent)" opacity="0.6" />
      <circle cx="22" cy="14.5" r="2" fill="var(--accent)" opacity="0.28" />
    </svg>
  );
}

export function Logo({ size = 28, withWordmark = true, className }: LogoProps) {
  return (
    <span className={`logo ${className ?? ""}`}>
      <LogoMark size={size} />
      {withWordmark && <span className="logo__word">Whisper</span>}
    </span>
  );
}
