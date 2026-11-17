// The computer's load in the top bar (feature I18; the owner, 2026-11-17: "show the hardware insights
// like RAM used GPU used CPU used memory beside Game, View and settings"). Three small meters (CPU,
// memory, GPU) in one button; pressing it shows the numbers behind them, with this app's own share.

import { Cpu, Gauge, MemoryStick } from 'lucide-react';
import type { SystemView } from '@chess-coach/core';
import { setting, type Store } from './store.ts';
import { Popover } from './ui.tsx';

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 0 : 1)} GB`;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);

/** A meter's tone: calm, busy, or near the limit. Said in words too (the title), never by colour alone. */
const tone = (p: number) => (p >= 90 ? 'hot' : p >= 70 ? 'busy' : 'calm');

function Meter({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Cpu }) {
  return (
    <span className={`sys-meter ${tone(value)}`}>
      <Icon size={13} strokeWidth={2.1} aria-hidden="true" />
      <span className="sys-meter-label">{label}</span>
      <span className="sys-meter-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(3, Math.min(100, value))}%` }} />
      </span>
      <span className="sys-meter-num">{value}%</span>
    </span>
  );
}

function Row({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="sys-row">
      <span>{name}</span>
      <span className="sys-row-value">{value}</span>
      {note && <span className="sys-row-note">{note}</span>}
    </div>
  );
}

function Details({ v }: { v: SystemView }) {
  const ram = pct(v.ram.used, v.ram.total);
  return (
    <div className="sys-details">
      <h3>This computer</h3>
      <Row name="CPU" value={`${v.cpu}%`} note={`${v.cores} threads`} />
      <Row name="Memory" value={`${gb(v.ram.used)} of ${gb(v.ram.total)}`} note={`${ram}% in use`} />
      {v.gpu ? (
        <>
          <Row name="GPU" value={`${v.gpu.util}%`} note={v.gpu.name} />
          <Row name="GPU memory" value={`${gb(v.gpu.memUsed)} of ${gb(v.gpu.memTotal)}`} />
          {(v.gpu.temp !== undefined || v.gpu.power !== undefined) && <Row name="GPU heat and power" value={[v.gpu.temp !== undefined ? `${v.gpu.temp} °C` : '', v.gpu.power !== undefined ? `${Math.round(v.gpu.power)} W` : ''].filter(Boolean).join(' · ')} />}
        </>
      ) : (
        <Row name="GPU" value="not read" note="no NVIDIA GPU answered" />
      )}
      <h3>This app</h3>
      <Row name="The server" value={gb(v.app.memory)} />
      {v.engines && <Row name="Stockfish engines" value={v.engines.count ? `${v.engines.count} running` : 'none running'} note={v.engines.count ? `${gb(v.engines.memory)} of memory` : undefined} />}
      <p className="sys-note">Sampled every three seconds while the page is open; nothing leaves this computer. Turn it off in Settings → Appearance.</p>
    </div>
  );
}

export function SystemStats({ s }: { s: Store }) {
  const v = s.system;
  if (!v || !setting(s, 'display.systemStats', true)) return null;
  const ram = pct(v.ram.used, v.ram.total);
  const words = `CPU ${v.cpu}%, memory ${ram}% (${gb(v.ram.used)} of ${gb(v.ram.total)})${v.gpu ? `, GPU ${v.gpu.util}%` : ''}`;
  return (
    <Popover
      label={
        <span className="sys-meters">
          <Meter label="CPU" value={v.cpu} icon={Cpu} />
          <Meter label="RAM" value={ram} icon={MemoryStick} />
          {v.gpu && <Meter label="GPU" value={v.gpu.util} icon={Gauge} />}
        </span>
      }
      ariaLabel={`Computer load: ${words}`}
      title={`${words}. Press for details`}
      buttonClass="tb-btn sys-btn"
      align="end"
    >
      {() => <Details v={v} />}
    </Popover>
  );
}
