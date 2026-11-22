import { useEffect, useMemo, useState } from 'react';
import { PlantsPanel } from './PlantsPanel';
import { HardscapePanel } from './HardscapePanel';
import { WaterSoilPanel } from './WaterSoilPanel';
import { PollinatorPanel } from './PollinatorPanel';
import { OutputsPanel } from './OutputsPanel';
import { LayoutPanel } from './LayoutPanel';
import { ScenariosPanel } from './ScenariosPanel';
import { Dialog } from './Dialog';
import { TopBar } from './TopBar';
import { CanvasToolbar } from './CanvasToolbar';
import { SimDock } from './SimDock';
import { SelectionCard } from './SelectionCard';
import { PlanSheet } from './PlanSheet';
import { shareClient, tokenFromSearch } from '../share/client';
import { startCloudSync } from '../store/cloudSync';
import { loadSharedPlan, type LoadOutcome } from '../share/service';
import { useAutosave } from '../store/persistence';
import { SiteScene } from '../scene/SiteScene';
import { zoneStats } from '../engine/sunhours';
import { appStore, useApp } from '../store/store';
import { useSunHours } from '../store/useSunHours';
import { useConflictSync } from '../store/derived';

type SunHook = ReturnType<typeof useSunHours>;
type Tab = 'plants' | 'hardscape' | 'layout' | 'water' | 'pollinators' | 'sun' | 'outputs';
type Group = 'design' | 'analyze' | 'outputs';
/** The right panel has two levels: what you are doing (design, analyze, outputs), then the tool for it. */
const GROUPS: { id: Group; label: string; tabs: [Tab, string][] }[] = [
  { id: 'design', label: 'Design', tabs: [['plants', 'Plants'], ['hardscape', 'Hardscape']] },
  { id: 'analyze', label: 'Analyze', tabs: [['layout', 'Layout'], ['water', 'Water & soil'], ['pollinators', 'Pollinators'], ['sun', 'Sun hours']] },
  { id: 'outputs', label: 'Outputs', tabs: [['outputs', 'Plan, schedules, checks']] },
];
const groupOf = (tab: Tab) => GROUPS.find((g) => g.tabs.some(([id]) => id === tab))!;

const CLASS_LABELS = ['Shade', 'Part shade', 'Part sun', 'Full sun'];
const CLASS_COLORS = ['#2d2d69', '#5082cd', '#f5aa37', '#ffe650'];

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

function Planner() {
  const sun = useSunHours();
  useAutosave();
  useEffect(() => startCloudSync(), []);
  const sheetOpen = useApp((s) => s.sheetOpen);
  const shared = useApp((s) => s.shared);
  useShortcuts();
  useConflictSync();
  const conflictCount = useApp((s) => s.conflicts.filter((c) => c.instanceIds.length > 0 && c.severity === 'error').length);
  const [tab, setTab] = useState<Tab>('plants');
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const group = groupOf(tab);
  const go = (next: Tab) => {
    if (next !== 'hardscape') appStore.getState().commitDrawing();
    setTab(next);
  };
  return (
    <>
    {shared && <div className="viewer-banner">Shared plan: {shared.name}. You are viewing a read-only copy; only the owner can change it.</div>}
    <div className="app">
      <TopBar onScenarios={() => setScenariosOpen(true)} />
      <main className="stage">
        <SiteScene sunResult={sun.result} />
        <CanvasToolbar />
        <SimDock />
      </main>
      <aside className="right">
        <nav className="rightnav" aria-label="Planner sections">
          <div className="segmented" role="tablist">
            {GROUPS.map((g) => (
              <button key={g.id} role="tab" aria-selected={group.id === g.id} className={group.id === g.id ? 'on' : ''} onClick={() => go(g.tabs[0][0])}>
                {g.label}{g.id === 'analyze' && conflictCount > 0 ? ` (${conflictCount})` : ''}
              </button>
            ))}
          </div>
          {group.tabs.length > 1 && (
            <div className="subtabs" role="tablist">
              {group.tabs.map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>{label}{id === 'layout' && conflictCount > 0 ? ` (${conflictCount})` : ''}</button>
              ))}
            </div>
          )}
        </nav>
        <div className="rightstack">
          <div className="rightscroll">
            {tab === 'plants' && <PlantsPanel />}
            {tab === 'hardscape' && <HardscapePanel />}
            {tab === 'layout' && <LayoutPanel growing={sun.growing} />}
            {tab === 'water' && <WaterSoilPanel />}
            {tab === 'pollinators' && <PollinatorPanel growing={sun.growing} />}
            {tab === 'sun' && <SunPanel sun={sun} />}
            {tab === 'outputs' && <OutputsPanel />}
          </div>
          <SelectionCard growing={sun.growing} />
        </div>
      </aside>
    </div>
    {scenariosOpen && <Dialog title="Scenarios" onClose={() => setScenariosOpen(false)}><ScenariosPanel /></Dialog>}
    {sheetOpen && <PlanSheet />}
    </>
  );
}

const SHARE_MESSAGES: Record<Exclude<LoadOutcome['status'], 'ready'>, { title: string; body: string }> = {
  revoked: { title: 'This link has been turned off', body: 'The owner has stopped sharing this plan. Ask them for a new link if you still need to see it.' },
  'not-found': { title: 'This link does not work', body: 'It may have been copied incompletely. Check the address, or ask the owner to send it again.' },
  invalid: { title: 'This plan cannot be opened', body: 'The shared plan is damaged or was made by a newer version of this app.' },
  network: { title: 'Could not reach the sharing service', body: 'Check your connection and try again.' },
  error: { title: 'Something went wrong', body: 'Try again in a moment.' },
};

/**
 * A page opened from a share link first fetches the plan and checks it. Until that works, nothing of
 * the owner's plan is shown. Anyone else gets the app as normal.
 */
export function App() {
  const token = useMemo(() => tokenFromSearch(window.location.search), []);
  const wantsShare = useMemo(() => new URLSearchParams(window.location.search).has('share'), []);
  const [state, setState] = useState<'loading' | LoadOutcome>(wantsShare ? 'loading' : { status: 'ready', warnings: [] });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wantsShare) return;
    if (!token) {
      setState({ status: 'not-found', message: '' });
      return;
    }
    let cancelled = false;
    setState('loading');
    loadSharedPlan(appStore, shareClient(), token).then((r) => {
      if (!cancelled) setState(r);
    });
    return () => {
      cancelled = true;
    };
  }, [token, wantsShare, attempt]);

  if (state === 'loading') return <div className="gate" role="status"><div><h1>Opening the shared plan…</h1></div></div>;
  if (state.status !== 'ready') {
    const m = SHARE_MESSAGES[state.status];
    return (
      <div className="gate" role="alert">
        <div>
          <h1>{m.title}</h1>
          <p>{m.body}</p>
          {(state.status === 'network' || state.status === 'error') && <button className="on" onClick={() => setAttempt(attempt + 1)}>Try again</button>}
        </div>
      </div>
    );
  }
  return <Planner />;
}
