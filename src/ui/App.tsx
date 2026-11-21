import { useEffect, useMemo, useState } from 'react';
import { PlantsPanel } from './PlantsPanel';
import { HardscapePanel } from './HardscapePanel';
import { SiteScene } from '../scene/SiteScene';
import { solarPosition } from '../engine/solar';
import { checkPrintedDimensions } from '../engine/site';
import { zoneStats } from '../engine/sunhours';
import { doyToMonthDay, localToUtc, monthDayToDoy, monthName, tzAbbrev } from '../engine/time';
import { formatFeetInches } from '../engine/units';
import { appStore, useApp } from '../store/store';
import { useSunHours } from '../store/useSunHours';

type SunHook = ReturnType<typeof useSunHours>;

const CLASS_LABELS = ['Shade', 'Part shade', 'Part sun', 'Full sun'];
const CLASS_COLORS = ['#2d2d69', '#5082cd', '#f5aa37', '#ffe650'];

function fmtTime(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${ap}`;
}

function Sidebar() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const checks = useMemo(() => checkPrintedDimensions(s.site, 1), [s.site]);
  const layerLabels: [keyof typeof s.layers, string][] = [
    ['sunHours', 'Sun-hours overlay'],
    ['dimensions', 'Dimensions'],
    ['setbacks', 'Setback lines'],
    ['easements', 'Easement'],
    ['context', 'Trees, fences, pole'],
    ['bloom', 'Bloom color on plants'],
  ];
  return (
    <aside className="sidebar">
      <h1>{s.site.name}</h1>
      <p className="muted">
        {s.site.address}
        <span className={`badge ${edit ? '' : 'view'}`}>{edit ? 'Edit' : 'View only'}</span>
      </p>

      <h2>Views</h2>
      <div className="row wrap">
        {s.site.views.map((v) => (
          <button key={v.id} className={s.view === v.id ? 'on' : ''} onClick={() => s.setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      <h2>Layers</h2>
      {layerLabels.map(([k, label]) => (
        <label key={k} className="check">
          <input type="checkbox" checked={s.layers[k]} onChange={(e) => s.setLayer(k, e.target.checked)} />
          {label}
        </label>
      ))}
      <label className="check">
        <input type="checkbox" checked={s.aduEnabled} disabled={!edit} onChange={(e) => s.setAduEnabled(e.target.checked)} />
        Model the ADU{!edit && ' (plan setting, locked)'}
      </label>

      <h2>Measure</h2>
      <div className="row">
        <button className={s.measureActive ? 'on' : ''} onClick={() => s.setMeasureActive(!s.measureActive)}>
          {s.measureActive ? 'Measuring: click 2 points' : 'Measure tool'}
        </button>
        <select value={s.snap} onChange={(e) => s.setSnap(Number(e.target.value))} aria-label="Snap grid">
          {s.engine.scene.snapOptionsFt.map((v) => (
            <option key={v} value={v}>
              Snap {formatFeetInches(v)}
            </option>
          ))}
        </select>
      </div>

      <h2>Plan check</h2>
      <p className="muted small">Printed dimensions vs. this model (tolerance 1 in).</p>
      <table className="tbl">
        <tbody>
          {checks.map((c) => (
            <tr key={c.id} className={c.ok ? '' : 'bad'}>
              <td>{c.label}</td>
              <td className="num">{formatFeetInches(c.measured, 16)}</td>
              <td className="num">{c.ok ? '✓' : '✗'} {c.deltaInches >= 0 ? '+' : ''}{c.deltaInches.toFixed(2)}"</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Assumptions</h2>
      <ul className="assume">
        {s.site.assumptions.map((a) => (
          <li key={a.id}>
            {a.estimate && <span className="tag">estimate</span>} {a.text}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function SunPanel({ sun }: { sun: SunHook }) {
  const s = useApp((x) => x);
  const { result, pending, computeMs } = sun;
  const stats = useMemo(() => (result ? zoneStats(result, s.engine.sun.classes) : []), [result, s.engine]);
  return (
    <div className="sunpanel">
      <div className="row">
        <h2>Sun hours</h2>
        <select value={s.sunPeriod} onChange={(e) => s.setSunPeriod(e.target.value)} aria-label="Sun-hours period">
          <option value="day">Selected day</option>
          {s.engine.sun.seasons.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <span className="muted small">{pending ? 'Computing…' : computeMs !== null ? `${Math.round(computeMs)} ms` : ''}</span>
      </div>
      <div className="legend">
        {CLASS_LABELS.map((l, i) => (
          <span key={l}><i style={{ background: CLASS_COLORS[i] }} />{l}{' '}
            <small>{[`<${s.engine.sun.classes.partShadeHours}`, `${s.engine.sun.classes.partShadeHours}–${s.engine.sun.classes.partSunHours}`, `${s.engine.sun.classes.partSunHours}–${s.engine.sun.classes.fullSunHours}`, `${s.engine.sun.classes.fullSunHours}+`][i]} h</small>
          </span>
        ))}
      </div>
      <table className="tbl">
        <thead>
          <tr><th>Zone</th><th className="num">Open sq ft</th><th className="num">Avg h</th>{CLASS_LABELS.map((l) => <th key={l} className="num">{l}</th>)}</tr>
        </thead>
        <tbody>
          {stats.map((z) => (
            <tr key={z.id} className={z.id === 'lot' ? 'total' : ''}>
              <td>{z.name}</td>
              <td className="num">{Math.round(z.area).toLocaleString()}</td>
              <td className="num">{z.meanHours.toFixed(1)}</td>
              {z.classArea.map((a, i) => <td key={i} className="num">{Math.round(a).toLocaleString()}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Clear-sky geometry only. Clouds and the coastal marine layer are not modeled, so summer morning sun is overstated.
        Hours are the daily average over the period (sampled weekly for ranges).
        {result && ` ${result.daysSampled} day${result.daysSampled === 1 ? '' : 's'} sampled.`}
      </p>
    </div>
  );
}

function SunBar() {
  const s = useApp((x) => x);
  const [month, day] = doyToMonthDay(s.doy);
  const utc = localToUtc(s.site.timeZone, s.engine.referenceYear, month, day, 0, s.minutes);
  const sun = solarPosition(utc, s.site.latitude, s.site.longitude, s.engine.sun.refraction);

  useEffect(() => {
    if (!s.playing) return;
    const id = setInterval(() => {
      const st = (() => { const m = s.minutes + 6; return m > 1320 ? 240 : m; })();
      s.setMinutes(st);
    }, 50);
    return () => clearInterval(id);
  });

  return (
    <div className="sunbar">
      <div className="row wrap">
        {s.engine.sun.presets.map((p) => (
          <button key={p.id} className={s.doy === monthDayToDoy(p.month, p.day) ? 'on' : ''} onClick={() => s.setDoy(monthDayToDoy(p.month, p.day))}>
            {p.label}
          </button>
        ))}
        <button onClick={() => s.setPlaying(!s.playing)}>{s.playing ? '■ Stop' : '▶ Play day'}</button>
        <strong className="readout">
          {monthName(month)} {day}, {fmtTime(s.minutes)} {tzAbbrev(s.site.timeZone, utc)}
        </strong>
        <span className="muted small">
          Sun az {sun.azimuthDeg.toFixed(1)}°, el {sun.elevationDeg.toFixed(1)}°{sun.elevationDeg <= 0 ? ' (below horizon)' : ''}
        </span>
      </div>
      <div className="sliders">
        <label>Date<input type="range" min={1} max={365} value={s.doy} onChange={(e) => s.setDoy(Number(e.target.value))} /></label>
        <label>Time<input type="range" min={0} max={1439} step={5} value={s.minutes} onChange={(e) => s.setMinutes(Number(e.target.value))} /></label>
      </div>
    </div>
  );
}

function TimelineBar() {
  const s = useApp((x) => x);
  const maxM = s.engine.timeline.maxYears * 12;
  const years = Math.floor(s.timelineMonth / 12);
  const months = s.timelineMonth % 12;

  useEffect(() => {
    if (!s.timelinePlaying) return;
    const id = setInterval(() => {
      const next = s.timelineMonth + 1;
      if (next > maxM) s.setTimelinePlaying(false);
      else s.setTimelineMonth(next);
    }, 90);
    return () => clearInterval(id);
  });

  return (
    <div className="sunbar">
      <div className="row wrap">
        <strong>Growth timeline</strong>
        {s.engine.timeline.presets.map((y) => (
          <button key={y} className={s.timelineMonth === y * 12 ? 'on' : ''} onClick={() => s.setTimelineMonth(y * 12)}>
            Year {y}
          </button>
        ))}
        <button onClick={() => s.setTimelineMonth(0)}>Today</button>
        <button onClick={() => s.setTimelinePlaying(!s.timelinePlaying)}>{s.timelinePlaying ? '■ Stop' : '▶ Grow'}</button>
        <strong className="readout">Year {years}, month {months}</strong>
      </div>
      <div className="sliders one">
        <label>Years<input type="range" min={0} max={maxM} value={s.timelineMonth} onChange={(e) => s.setTimelineMonth(Number(e.target.value))} /></label>
      </div>
    </div>
  );
}

function UndoRedo() {
  const edit = useApp((s) => s.mode === 'edit');
  const past = useApp((s) => s.history.past.length);
  const future = useApp((s) => s.history.future.length);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  return (
    <div className="undo">
      <button title="Undo (Ctrl/Cmd+Z)" disabled={!edit || past === 0} onClick={undo}>↶</button>
      <button title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!edit || future === 0} onClick={redo}>↷</button>
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return;
      const st = appStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Enter' && st.drawing) {
        st.finishDrawing();
      } else if (e.key === 'Escape') {
        if (st.drawing) st.startDrawing(null);
        else if (st.placingSpeciesId) st.setPlacing(null);
        else if (st.measureActive) st.setMeasureActive(false);
        else {
          st.select(null);
          st.selectElement(null);
        }
      } else if (e.key === 'Backspace' && st.drawing) {
        e.preventDefault();
        st.removeLastDrawPoint();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !st.drawing) {
        if (st.selectedElementId) st.deleteElement(st.selectedElementId);
        else if (st.selectedId) st.deleteInstance(st.selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const sun = useSunHours();
  useShortcuts();
  const [tab, setTab] = useState<'plants' | 'hardscape' | 'sun'>('plants');
  const [controlsOpen, setControlsOpen] = useState(true);
  return (
    <div className="app">
      <Sidebar />
      <main className="stage">
        <SiteScene sunResult={sun.result} />
        <div className="controls">
          <button className="ctl-toggle" onClick={() => setControlsOpen(!controlsOpen)}>
            {controlsOpen ? 'Hide timeline and sun controls' : 'Show timeline and sun controls'}
          </button>
          {controlsOpen && (
            <>
              <TimelineBar />
              <SunBar />
            </>
          )}
        </div>
      </main>
      <aside className="right">
        <div className="tabs">
          <UndoRedo />
          <button className={tab === 'plants' ? 'on' : ''} onClick={() => setTab('plants')}>Plants</button>
          <button className={tab === 'hardscape' ? 'on' : ''} onClick={() => setTab('hardscape')}>Hardscape</button>
          <button className={tab === 'sun' ? 'on' : ''} onClick={() => setTab('sun')}>Sun hours</button>
        </div>
        {tab === 'plants' ? <PlantsPanel growing={sun.growing} /> : tab === 'hardscape' ? <HardscapePanel /> : <SunPanel sun={sun} />}
      </aside>
    </div>
  );
}
