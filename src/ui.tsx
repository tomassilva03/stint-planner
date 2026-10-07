import { useEffect, useState, type ReactNode } from 'react';

/** Text input that keeps what you type locally and commits on blur or Enter. */
export function Field(props: {
  id: string;
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  type?: string;
  inputMode?: 'decimal' | 'numeric' | 'text';
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft !== props.value) props.onCommit(draft);
  };
  return (
    <input
      id={props.id}
      type={props.type ?? 'text'}
      className={props.className}
      value={draft}
      inputMode={props.inputMode}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}

export function NumberField(props: {
  id: string;
  value: number;
  onCommit: (v: number) => void;
  step?: number;
  min?: number;
  className?: string;
  ariaLabel?: string;
  digits?: number;
}) {
  const shown = Number.isFinite(props.value) ? String(props.digits != null ? +props.value.toFixed(props.digits) : props.value) : '';
  return (
    <Field
      id={props.id}
      className={props.className}
      ariaLabel={props.ariaLabel}
      inputMode="decimal"
      value={shown}
      onCommit={(v) => {
        const n = Number(v.replace(',', '.'));
        if (Number.isFinite(n) && (props.min == null || n >= props.min)) props.onCommit(n);
      }}
    />
  );
}

export function Labeled(props: { label: string; htmlFor: string; hint?: string; children: ReactNode; unit?: string }) {
  return (
    <div className="labeled">
      <label htmlFor={props.htmlFor}>{props.label}</label>
      <div className="with-unit">
        {props.children}
        {props.unit && <span className="unit">{props.unit}</span>}
      </div>
      {props.hint && <p className="hint">{props.hint}</p>}
    </div>
  );
}

export function Pill(props: { tone: 'open' | 'tentative' | 'blocked' | 'unknown' | 'warn' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`pill pill-${props.tone}`} title={props.title}>
      {props.children}
    </span>
  );
}

export const AVAIL_LABEL = { open: 'Open', tentative: 'Tentative', blocked: 'Blocked', unknown: 'No info' } as const;

/** Nightshift mark: a crescent moon over three stints, the last one still to run. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <path d="M20 5a15 15 0 1 0 14.4 19.3A13 13 0 0 1 15.3 5.8 15 15 0 0 1 20 5Z" fill="#e9ecf6" />
      <rect x="8" y="33" width="7" height="3" rx="1.5" fill="#ffa424" />
      <rect x="17" y="33" width="7" height="3" rx="1.5" fill="#ffa424" />
      <rect x="26" y="33" width="7" height="3" rx="1.5" fill="#ffa424" opacity=".45" />
    </svg>
  );
}
