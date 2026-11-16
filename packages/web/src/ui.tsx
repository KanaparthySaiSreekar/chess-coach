// The page's shared controls (feature I16): a button that opens a floating panel, a menu of
// commands, a segmented control, a dialog sheet, the step buttons under a board and the knight
// mark. One set of parts, so every menu and dialog on the page behaves the same way.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { PieceBox } from './San.tsx';

/** A knight on a dark square: the app's mark, and the coach's face in the conversation. */
export function Mark({ className }: { className?: string }) {
  return (
    <span className={`mark${className ? ` ${className}` : ''}`} aria-hidden="true">
      <PieceBox className="mark-piece" role="knight" color="white" />
    </span>
  );
}

/**
 * A button that opens a small panel under itself. A click outside or Escape closes it, and Escape
 * puts the focus back on the button. Only one is open at a time: opening another closes this one.
 */
export function Popover({
  label,
  ariaLabel,
  title,
  buttonClass = 'tb-btn',
  align = 'start',
  menu,
  children,
}: {
  label: ReactNode;
  ariaLabel?: string;
  title?: string;
  buttonClass?: string;
  align?: 'start' | 'end';
  /** the panel is a menu of commands: the first one takes the focus and the arrow keys move through them */
  menu?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    if (menu) panel.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open, menu]);

  return (
    <div className="popover-wrap" ref={box}>
      <button ref={button} className={`${buttonClass}${open ? ' open' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup={menu ? 'menu' : 'dialog'} aria-label={ariaLabel} title={open ? undefined : title}>
        {label}
      </button>
      {open && (
        <div ref={panel} className={`popover align-${align}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export type MenuEntry =
  | 'sep'
  | { heading: string }
  | {
      label: string;
      icon?: LucideIcon;
      /** the key that does the same thing */
      hint?: string;
      run: () => void;
      disabled?: boolean;
      /** this command throws something away */
      danger?: boolean;
      /** a choice among its neighbours: `true` shows the tick */
      checked?: boolean;
    };

/** A list of commands. Up and Down move through it, Home and End jump to its ends. */
export function MenuList({ items, close, label }: { items: MenuEntry[]; close: () => void; label: string }) {
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    // the arrow keys belong to the menu while it is open, not to the move list behind it
    e.preventDefault();
    e.stopPropagation();
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)')];
    if (!all.length) return;
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : e.key === 'ArrowDown' ? (at + 1) % all.length : (at - 1 + all.length) % all.length;
    all[next]!.focus();
  };
  return (
    <div className="menu" role="menu" aria-label={label} onKeyDown={onKey}>
      {items.map((it, i) => {
        if (it === 'sep') return <div key={i} className="menu-sep" role="separator" />;
        if ('heading' in it) {
          return (
            <div key={i} className="menu-heading">
              {it.heading}
            </div>
          );
        }
        const Icon = it.icon;
        const choice = it.checked !== undefined;
        return (
          <button
            key={i}
            role={choice ? 'menuitemradio' : 'menuitem'}
            aria-checked={choice ? it.checked : undefined}
            className={`menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.run();
            }}
          >
            <span className="menu-icon" aria-hidden="true">
              {choice ? it.checked && <Check size={15} strokeWidth={2.4} /> : Icon && <Icon size={16} strokeWidth={1.8} />}
            </span>
            <span className="menu-label">{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/** A few closely related choices side by side, one of them selected. */
export function Segmented<T extends string>({ value, options, onChange, label, className }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (value: T) => void; label: string; className?: string }) {
  return (
    <div className={`segmented${className ? ` ${className}` : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A dialog over the page. Escape or a click on the dimmed page behind it closes it; Tab stays inside it. */
export function Sheet({ label, onClose, className, children }: { label: string; onClose: () => void; className?: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = sheet.current;
    if (el && !el.contains(document.activeElement)) el.focus();
    return () => before?.focus?.();
  }, []);
  const trap = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Escape closes any dialog, whoever opened it
    if (e.key === 'Escape') {
      e.stopPropagation();
      return onClose();
    }
    if (e.key !== 'Tab') return;
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')];
    if (!all.length) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheet} className={`modal${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} onKeyDown={trap}>
        {children}
      </div>
    </div>
  );
}

type Step = 'start' | 'prev' | 'next' | 'end';

/** The four step buttons under a board: first, back, forward, last. */
export function Transport({ onStep, disabled, label, endName = 'Last position' }: { onStep: (to: Step) => void; disabled?: boolean; label: string; endName?: string }) {
  const steps: { to: Step; name: string; key: string; Icon: LucideIcon }[] = [
    { to: 'start', name: 'First position', key: '↑', Icon: ChevronFirst },
    { to: 'prev', name: 'Back one move', key: '←', Icon: ChevronLeft },
    { to: 'next', name: 'Forward one move', key: '→', Icon: ChevronRight },
    { to: 'end', name: endName, key: '↓', Icon: ChevronLast },
  ];
  return (
    <div className="transport" role="group" aria-label={label}>
      {steps.map(({ to, name, key, Icon }) => (
        <button key={to} className="icon-btn" disabled={disabled} onClick={() => onStep(to)} title={`${name} (${key})`} aria-label={name}>
          <Icon size={18} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}
