import { AlertTriangle, BadgeCheck, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({ variant = "primary", size = "md", loading, icon, block, children, disabled, className, ...rest }: ButtonProps) {
  return (
    <button
      className={`btn btn--${variant} btn--${size} ${block ? "btn--block" : ""} ${className ?? ""}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="btn__icon spin" aria-hidden="true" /> : icon ? <span className="btn__icon" aria-hidden="true">{icon}</span> : null}
      <span>{children}</span>
    </button>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <span className="spinner" role="status">
      <Loader2 className="spin" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`field ${error ? "field--error" : ""}`}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error" role="alert">
          <XCircle aria-hidden="true" /> {error}
        </p>
      )}
    </div>
  );
}

export function TextField({ label, hint, error, ...rest }: { label: string; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <input id={id} className="input" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />}
    </FieldShell>
  );
}

export function TextArea({ label, hint, error, ...rest }: { label: string; hint?: ReactNode; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ id, describedBy, invalid }) => <textarea id={id} className="input input--area" aria-describedby={describedBy} aria-invalid={invalid || undefined} {...rest} />}
    </FieldShell>
  );
}

type Tone = "info" | "success" | "warn" | "danger";
const toneIcon: Record<Tone, ReactNode> = {
  info: <Info aria-hidden="true" />,
  success: <CheckCircle2 aria-hidden="true" />,
  warn: <AlertTriangle aria-hidden="true" />,
  danger: <XCircle aria-hidden="true" />,
};

export function Notice({ tone = "info", title, children, action }: { tone?: Tone; title?: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <span className="notice__icon">{toneIcon[tone]}</span>
      <div className="notice__body">
        {title && <p className="notice__title">{title}</p>}
        {children && <div className="notice__text">{children}</div>}
        {action && <div className="notice__action">{action}</div>}
      </div>
    </div>
  );
}

export function VerifiedBadge({ label = "Verified sender", title }: { label?: string; title?: string }) {
  return (
    <span className="badge badge--verified" title={title}>
      <BadgeCheck aria-hidden="true" />
      {label}
    </span>
  );
}

export function Badge({ tone = "neutral", children, title }: { tone?: "neutral" | "accent" | "warn" | "danger"; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge--${tone}`} title={title}>
      {children}
    </span>
  );
}

export interface StepItem {
  key: string;
  title: string;
  description?: string;
}

/** Vertical progress list for multi-step flows. */
export function Steps({ steps, current, done }: { steps: StepItem[]; current: string; done: ReadonlySet<string> }) {
  return (
    <ol className="steps" aria-label="Setup progress">
      {steps.map((s, i) => {
        const state = done.has(s.key) ? "done" : s.key === current ? "current" : "todo";
        return (
          <li key={s.key} className={`steps__item steps__item--${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="steps__dot" aria-hidden="true">
              {state === "done" ? <CheckCircle2 /> : i + 1}
            </span>
            <span className="steps__text">
              <span className="steps__title">{s.title}</span>
              {s.description && <span className="steps__desc">{s.description}</span>}
              <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? " (current step)" : ""}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
