import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

/** Nightstint mark: a crescent moon, drawn in the text colour. */
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

export const Check = () => (
  <svg className="check-mark" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Chevron = () => (
  <svg className="chevron" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
    <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Dropdown drawn by the app so every list looks the same, in place of the browser's native select. */
export function Select<T extends string>(props: {
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; minWidth: number }>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = props.options.findIndex((o) => o.value === props.value);
  const listId = `${props.id ?? 'select'}-list`;

  const place = () => {
    const r = buttonRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8));
    setPos(below < 260 && r.top > below ? { left, bottom: window.innerHeight - r.top + 4, minWidth: r.width } : { left, top: r.bottom + 4, minWidth: r.width });
  };
  const show = () => {
    place();
    setActive(Math.max(0, selected));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) buttonRef.current?.focus();
  };
  const pick = (i: number) => {
    const o = props.options[i];
    if (o && o.value !== props.value) props.onChange(o.value);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => {
      const t = e.target as Node;
      if (!listRef.current?.contains(t) && !buttonRef.current?.contains(t)) close(false);
    };
    const scroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const onKey = (e: ReactKeyboardEvent) => {
    const n = props.options.length;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === 'ArrowDown') setActive((a) => (a + 1) % n);
    else if (e.key === 'ArrowUp') setActive((a) => (a - 1 + n) % n);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(n - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab') return close(false);
    else if (e.key.length === 1) {
      const k = e.key.toLowerCase();
      const i = props.options.findIndex((o, j) => j > active && o.label.toLowerCase().startsWith(k));
      const j = i >= 0 ? i : props.options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (j >= 0) setActive(j);
      return;
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={props.id}
        type="button"
        className={`select ${props.className ?? ''}`}
        role="combobox"
        aria-label={props.ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKey}
      >
        <span className="select-value">{props.options[selected]?.label ?? ''}</span>
        <Chevron />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={listRef} id={listId} className="menu select-menu" role="listbox" aria-label={props.ariaLabel} style={pos}>
            {props.options.map((o, i) => (
              <div
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === selected}
                className={`menu-option ${i === active ? 'active' : ''}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                <span>{o.label}</span>
                {i === selected && <Check />}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
