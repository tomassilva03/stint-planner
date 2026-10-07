import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DRIVER_COLORS } from './model';

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

/** Nightshift mark: a crescent moon, drawn in the text colour. */
export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20.5 14.6A8.5 8.5 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1Z" fill="currentColor" />
    </svg>
  );
}

/** Colour swatch that opens a small palette, with the system picker as a fallback for any other colour. */
export function ColorPicker(props: { id: string; label: string; value: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const current = props.value.toLowerCase();
  return (
    <div className="color-picker" ref={ref}>
      <button id={props.id} type="button" className="color" style={{ background: props.value }} aria-label={props.label} aria-expanded={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="palette" role="group" aria-label={props.label}>
          {DRIVER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === current ? 'on' : ''}
              style={{ background: c }}
              aria-label={c}
              aria-pressed={c === current}
              onClick={() => (props.onChange(c), setOpen(false))}
            />
          ))}
          <label className="palette-custom">
            Other…
            <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
