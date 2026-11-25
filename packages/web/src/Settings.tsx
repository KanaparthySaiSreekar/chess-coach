// The settings window (features K1, K2, K7, I16): every registered setting, each with its reason.
// A new setting on the server appears here without any change to the page.
//
// Laid out like a desktop settings window: the groups down the side, a search box above them,
// "Changed" as its own entry, one-click presets on the first page, switches and segmented buttons
// instead of drop-downs, steppers for numbers, and the technical knobs kept out of the way until
// asked for.

import { useMemo, useState } from 'react';
import { Minus, Plus, Search, X } from 'lucide-react';
import type { PresetView, SettingView } from '@chess-coach/core';
import { send, useStore } from './store.ts';
import { Sheet } from './ui.tsx';
import { PieceBox } from './San.tsx';
import { VoiceInstall, VoicePicker } from './Voice.tsx';

const pretty = (s: SettingView, option: string) => s.optionLabels?.[option] ?? option;

function Stepper({ s }: { s: SettingView }) {
  const value = s.value as number;
  const step = s.step ?? 1;
  const clamp = (v: number) => Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, Math.round(v / step) * step));
  const set = (v: number) => {
    const next = Number(clamp(v).toFixed(4));
    if (Number.isFinite(next) && next !== value) send({ type: 'setting', key: s.key, value: next });
  };
  return (
    <div className="stepper">
      <button className="step-btn" onClick={() => set(value - step)} disabled={s.min !== undefined && value <= s.min} aria-label={`Less: ${s.label}`}>
        <Minus size={14} strokeWidth={2.2} />
      </button>
      <input
        type="number"
        defaultValue={value}
        key={String(value)}
        min={s.min}
        max={s.max}
        step={step}
        aria-label={s.label}
        onBlur={(e) => set(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button className="step-btn" onClick={() => set(value + step)} disabled={s.max !== undefined && value >= s.max} aria-label={`More: ${s.label}`}>
        <Plus size={14} strokeWidth={2.2} />
      </button>
    </div>
  );
}

export function Control({ s }: { s: SettingView }) {
  const store = useStore();
  const set = (value: unknown) => send({ type: 'setting', key: s.key, value });
  // the coach's voice is chosen by ear (A20)
  if (s.key === 'voice.voice') return <VoicePicker s={store} />;
  if (s.type === 'boolean') {
    const on = s.value as boolean;
    return (
      <button className={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} aria-label={s.label} onClick={() => set(!on)}>
        <span className="toggle-knob" />
      </button>
    );
  }
  if (s.type === 'choice') {
    const options = s.options ?? [];
    // board colours are picked by looking at them
    if (s.key === 'display.boardTheme') {
      return (
        <div className="swatches" role="radiogroup" aria-label={s.label}>
          {options.map((o) => (
            <button key={o} role="radio" aria-checked={s.value === o} className={`swatch theme-${o}${s.value === o ? ' on' : ''}`} onClick={() => set(o)} title={pretty(s, o)} aria-label={pretty(s, o)} />
          ))}
        </div>
      );
    }
    // piece sets too: a knight of each, drawn in that set
    if (s.key === 'display.pieceSet') {
      return (
        <div className="piece-swatches" role="radiogroup" aria-label={s.label}>
          {options.map((o) => (
            <button key={o} role="radio" aria-checked={s.value === o} className={`piece-swatch${s.value === o ? ' on' : ''}`} onClick={() => set(o)} title={pretty(s, o)} aria-label={pretty(s, o)}>
              <PieceBox role="knight" color="white" className={`piece-swatch-img set-preview-${o}`} />
            </button>
          ))}
        </div>
      );
    }
    if (options.length <= 4) {
      return (
        <div className="segmented" role="radiogroup" aria-label={s.label}>
          {options.map((o) => (
            <button key={o} role="radio" aria-checked={s.value === o} className={s.value === o ? 'on' : ''} onClick={() => set(o)}>
              {pretty(s, o)}
            </button>
          ))}
        </div>
      );
    }
    return (
      <select value={s.value as string} onChange={(e) => set(e.target.value)} aria-label={s.label}>
        {options.map((o) => (
          <option key={o} value={o}>
            {pretty(s, o)}
          </option>
        ))}
      </select>
    );
  }
  if (s.type === 'number') return <Stepper s={s} />;
  return <input type="text" defaultValue={s.value as string} key={String(s.value)} aria-label={s.label} onBlur={(e) => set(e.target.value)} />;
}

/** Is a preset in effect right now? (every one of its values is the current one) */
export function presetActive(p: PresetView, settings: SettingView[]): boolean {
  return Object.entries(p.values).every(([key, value]) => settings.find((s) => s.key === key)?.value === value);
}

export function Presets({ compact }: { compact?: boolean }) {
  const { presets, settings } = useStore();
  if (!presets.length) return null;
  return (
    <div className={`presets${compact ? ' compact' : ''}`}>
      {presets.map((p) => {
        const active = presetActive(p, settings);
        return (
          <button key={p.id} className={`preset${active ? ' active' : ''}`} onClick={() => send({ type: 'preset', id: p.id })} title={p.about} aria-pressed={active}>
            <span className="preset-name">
              {p.name}
              {active && <span className="preset-on">In use</span>}
            </span>
            {!compact && <span className="preset-about">{p.about}</span>}
          </button>
        );
      })}
    </div>
  );
}

const readAdvanced = () => {
  try {
    return localStorage.getItem('cc.settings.advanced') === '1';
  } catch {
    return false;
  }
};

export function SettingsWindow({ onClose }: { onClose: () => void }) {
  const { settings } = useStore();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<string>('All');
  const [advanced, setAdvanced] = useState(readAdvanced);
  const groups = useMemo(() => [...new Set(settings.map((s) => s.group))], [settings]);
  const changed = settings.filter((s) => s.value !== s.default);
  const q = query.trim().toLowerCase();

  const visible = settings.filter((s) => {
    if (q) return `${s.label} ${s.why} ${s.group} ${s.key}`.toLowerCase().includes(q); // a search looks everywhere, advanced included
    if (tab === 'Changed') return s.value !== s.default;
    if (tab !== 'All' && s.group !== tab) return false;
    return advanced || !s.advanced || s.value !== s.default;
  });
  const hiddenAdvanced = q || tab === 'Changed' ? 0 : settings.filter((s) => s.advanced && s.value === s.default && (tab === 'All' || s.group === tab)).length;
  const shownGroups = groups.filter((g) => visible.some((s) => s.group === g));
  const toggleAdvanced = () => {
    const next = !advanced;
    setAdvanced(next);
    try {
      localStorage.setItem('cc.settings.advanced', next ? '1' : '0');
    } catch {
      /* private mode: it just is not remembered */
    }
  };
  const title = q ? `Results for “${query.trim()}”` : tab === 'All' ? 'All settings' : tab;
  const entry = (name: string, text: string, count?: number, disabled?: boolean) => (
    <button key={name} role="tab" aria-selected={!q && tab === name} className={`side-item${!q && tab === name ? ' on' : ''}`} disabled={disabled} onClick={() => setTab(name)}>
      <span>{text}</span>
      {count !== undefined && count > 0 && <span className="side-count">{count}</span>}
    </button>
  );

  return (
    <Sheet label="Settings" onClose={onClose} className="settings">
      <nav className="settings-side" aria-label="Setting groups">
        <div className="settings-find">
          <Search size={15} strokeWidth={2} aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search settings" autoFocus />
        </div>
        <div className="side-list" role="tablist" aria-label="Setting groups" aria-orientation="vertical">
          {entry('All', 'All settings')}
          {groups.map((g) => entry(g, g))}
          <div className="side-sep" />
          {entry('Changed', 'Changed', changed.length, !changed.length && tab !== 'Changed')}
        </div>
      </nav>

      <div className="settings-main">
        <header className="settings-head">
          <h2>{title}</h2>
          <button className="icon-btn plain" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
            <X size={17} strokeWidth={2} />
          </button>
        </header>

        <div className="settings-body">
          {!q && tab === 'All' && (
            <section className="settings-presets">
              <h3>Start from a preset</h3>
              <Presets />
            </section>
          )}

          {visible.length === 0 && <p className="muted settings-none">{q ? 'No setting matches that. Try a shorter word.' : tab === 'Changed' ? 'Everything is at its default.' : 'Nothing here.'}</p>}

          {shownGroups.map((g) => {
            const rows = visible.filter((s) => s.group === g);
            const groupChanged = rows.some((s) => s.value !== s.default);
            return (
              <section key={g}>
                <div className="group-head">
                  {/* on a group's own page the window title already names it */}
                  {q || tab !== g ? <h3>{g}</h3> : <span />}
                  {groupChanged && (
                    <button className="link" onClick={() => send({ type: 'settings_reset', group: g })} title={`Put every ${g} setting back to its default`}>
                      Reset group
                    </button>
                  )}
                </div>
                {g === 'Voice' && <VoiceInstall />}
                <div className="group">
                  {rows.map((s) => {
                    const isChanged = s.value !== s.default;
                    return (
                      <div className={`setting${isChanged ? ' changed' : ''}`} key={s.key}>
                        <div className="setting-text">
                          <div className="setting-label">
                            {s.label}
                            {s.advanced && <span className="adv-tag">Advanced</span>}
                            {isChanged && (
                              <button className="link" onClick={() => send({ type: 'setting', key: s.key, value: s.default })} title={`Back to the default (${typeof s.default === 'boolean' ? (s.default ? 'on' : 'off') : pretty(s, String(s.default))})`}>
                                Reset
                              </button>
                            )}
                          </div>
                          <div className="setting-why">{s.why}</div>
                        </div>
                        <Control s={s} />
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}

          <footer className="settings-foot">
            {(hiddenAdvanced > 0 || advanced) && !q && tab !== 'Changed' && (
              <button className="link" onClick={toggleAdvanced}>
                {advanced ? 'Hide advanced settings' : `Show ${hiddenAdvanced} advanced ${hiddenAdvanced === 1 ? 'setting' : 'settings'}`}
              </button>
            )}
            {changed.length > 0 && (
              <button className="link danger" onClick={() => send({ type: 'settings_reset' })}>
                Reset everything to the defaults
              </button>
            )}
            <p className="muted">Every change is saved at once and logged. The two hard rules (fair play, and keeping course files on this computer) are not settings.</p>
          </footer>
        </div>
      </div>
    </Sheet>
  );
}
