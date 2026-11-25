import { useEffect, useMemo, useState } from 'react';
import { PlantsPanel } from './PlantsPanel';
import { HardscapePanel } from './HardscapePanel';
import { WaterSoilPanel } from './WaterSoilPanel';
import { PollinatorPanel } from './PollinatorPanel';
import { OutputsPanel } from './OutputsPanel';
import { LayoutPanel } from './LayoutPanel';
import { ScenariosPanel } from './ScenariosPanel';
import { Dialog } from './Dialog';
import { GrowthStagesDialog } from './GrowthStagesDialog';
import { TopBar } from './TopBar';
import { CanvasToolbar } from './CanvasToolbar';
import { SimDock } from './SimDock';
import { WalkOverlay } from './WalkOverlay';
import { QuickFind } from './QuickFind';
import { PlacingPanel } from './PlacingPanel';
import { SelectionPanel } from './SelectionPanel';
import { ShuffleBar } from './ShuffleControl';
import { arrowDelta, isFindKey, isFitKey, isPlayPauseKey, isWalkKey, viewForKey } from './shortcuts';
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
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) {
        // Escape in a field of the selection panel lets go of the field and clears the selection, so the tabs come back.
        if (e.key === 'Escape' && el.closest('.selpanel') && !document.querySelector('.dialog')) {
          el.blur();
          const st0 = appStore.getState();
          st0.select(null);
          st0.selectElement(null);
          st0.selectHive(false);
        }
        return;
      }
      const st = appStore.getState();
      // / (or Cmd/Ctrl+K) opens quick find, in the Walk view too; not with a dialog open.
      if (isFindKey(e) && !document.querySelector('.dialog')) {
        e.preventDefault();
        st.setQuickFind(true);
        return;
      }
      // F frames whatever is selected in the yard (a plant, a drawn element or the hive), outside the Walk view and with no dialog open.
      if (isFitKey(e) && !document.querySelector('.dialog') && !st.quickFindOpen && st.site.views.find((v) => v.id === st.view)?.kind !== 'walk' && (st.selectedId || st.selectedElementId || st.hiveSelected)) {
        e.preventDefault();
        st.requestFit();
        return;
      }
      // W, outside the Walk view, takes you into it (dropped where the view is looking); inside it W is walking forward.
      const walkView = st.site.views.find((v) => v.kind === 'walk');
      if (walkView && isWalkKey(e) && st.view !== walkView.id && !document.querySelector('.dialog') && !st.quickFindOpen) {
        e.preventDefault();
        st.setView(walkView.id);
        return;
      }
      // Number keys switch the camera view, unless a dialog is open.
      const view = viewForKey(st.site.views, e);
      if (view && !document.querySelector('.dialog')) {
        e.preventDefault();
        st.setView(view);
        return;
      }
      // In the Walk view the space bar is jump and the arrow keys turn, so growth play and nudging stay out of it.
      if (st.site.views.find((v) => v.id === st.view)?.kind === 'walk' && (e.key === ' ' || e.key.startsWith('Arrow'))) return;
      // Space plays and pauses growth (and with it the seasons), unless a dialog is open.
      if (isPlayPauseKey(e) && !document.querySelector('.dialog')) {
        e.preventDefault();
        // A button that has focus would also be pressed by the space bar, so let go of it first.
        if (el && el.tagName === 'BUTTON') el.blur();
        st.setTimelinePlaying(!st.timelinePlaying);
        return;
      }
      // Arrow keys move whatever is selected in the yard, a plant or a hardscape element, one snap step at a time.
      const move = arrowDelta(e, st.snap, st.engine.scene.arrowShiftMultiplier);
      if (move && st.mode === 'edit' && !document.querySelector('.dialog') && (st.selectedId || st.selectedElementId || st.hiveSelected)) {
        const el2 = st.selectedElementId ? st.hardscape.find((h) => h.id === st.selectedElementId) : undefined;
        const plant = !el2 && st.selectedId ? st.instances.find((i) => i.id === st.selectedId) : undefined;
        if (st.hiveSelected && st.hive) {
          e.preventDefault();
          if (!e.repeat) st.beginGesture();
          const { width, depth } = st.site.lot;
          st.moveHive([Math.min(width, Math.max(0, st.hive[0] + move[0])), Math.min(depth, Math.max(0, st.hive[1] + move[1]))]);
          return;
        }
        if (plant || (el2 && !el2.existing)) {
          e.preventDefault();
          // Holding a key down is one gesture for undo; each fresh press is its own.
          if (!e.repeat) st.beginGesture();
          if (el2) st.moveElementBy(el2.id, move[0], move[1]);
          else if (plant) {
            const { width, depth } = st.site.lot;
            st.updateInstance(plant.id, { position: [Math.min(width, Math.max(0, plant.position[0] + move[0])), Math.min(depth, Math.max(0, plant.position[1] + move[1]))] }, { silent: true });
          }
          return;
        }
      }
      // R turns the selected rectangle a quarter turn (Shift+R the other way).
      if ((e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && st.selectedElementId && st.mode === 'edit' && !document.querySelector('.dialog')) {
        e.preventDefault();
        st.rotateElement(st.selectedElementId, e.shiftKey ? -90 : 90);
        return;
      }
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
        // Quick find first, even when its field has lost the keyboard.
        if (st.quickFindOpen) st.setQuickFind(false);
        else if (st.drawing) st.startDrawing(null);
        else if (st.placingSpeciesId) st.setPlacing(null);
        else if (st.measureActive) st.setMeasureActive(false);
        else {
          st.select(null);
          st.selectElement(null);
          st.selectHive(false);
        }
      } else if (e.key === 'Backspace' && st.drawing) {
        e.preventDefault();
        st.removeLastDrawPoint();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && !st.drawing) {
        if (st.selectedElementId) st.deleteElement(st.selectedElementId);
        else if (st.selectedId) st.deleteInstance(st.selectedId);
      }
    };
    // A raised bed nudged with the arrow keys snaps to a neighbor within reach once the key is let go.
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow')) return;
      const st = appStore.getState();
      const bed = st.selectedElementId ? st.hardscape.find((h) => h.id === st.selectedElementId) : undefined;
      if (bed?.cells && st.mode === 'edit') st.settleBed(bed.id);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); };
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
  // The right panel is a drawer: its state is remembered in this browser.
  const [panelOpen, setPanelOpen] = useState(() => {
    try { return localStorage.getItem('ashby-planner/panel-open') !== '0'; } catch { return true; }
  });
  const togglePanel = () => {
    setPanelOpen((open) => {
      try { localStorage.setItem('ashby-planner/panel-open', open ? '0' : '1'); } catch { /* private window: nothing to remember */ }
      return !open;
    });
  };
  // Quick find lives at the top of the right panel, so opening it shows the panel if it was hidden.
  const mode = useApp((x) => x.mode);
  const quickOpen = useApp((x) => x.quickFindOpen);
  // With something in hand to place, the right panel shows that element's details in place of the section tabs.
  const inHand = useApp((x) => !!x.placingSpeciesId || !!x.drawing);
  const placingView = inHand && !quickOpen;
  // A selected plant, element or the hive is the right panel too, unless find or placing has it.
  const hasSelection = useApp((x) => !!x.selectedId || !!x.selectedElementId || x.hiveSelected);
  const selectionView = hasSelection && !inHand && !quickOpen;
  useEffect(() => { if (quickOpen) setPanelOpen(true); }, [quickOpen]);
  const group = groupOf(tab);
  const go = (next: Tab) => {
    if (next !== 'hardscape') appStore.getState().commitDrawing();
    setTab(next);
  };
  return (
    <>
    {shared && <div className="viewer-banner">Shared plan: {shared.name}. You are viewing a read-only copy; only the owner can change it.</div>}
    <div className={`app ${panelOpen ? '' : 'panel-closed'}`}>
      <TopBar onScenarios={() => setScenariosOpen(true)} panelOpen={panelOpen} onTogglePanel={togglePanel} />
      <main className="stage">
        <SiteScene sunResult={sun.result} />
        <WalkOverlay />
        <CanvasToolbar />
        <ShuffleBar />
        <SimDock />
      </main>
      <aside className={`right ${quickOpen ? 'quick-open' : ''} ${placingView ? 'placing-open' : ''} ${selectionView ? 'selection-open' : ''}`}>
        <QuickFind />
        <PlacingPanel />
        <SelectionPanel growing={sun.growing} />
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
              {group.id === 'design' && (
                <button className="icon find" aria-label="Find a plant or hardscape to place" title="Find a plant or hardscape to place (press /)" aria-keyshortcuts="/" disabled={mode !== 'edit'} onClick={() => appStore.getState().setQuickFind(true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
                </button>
              )}
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
        </div>
      </aside>
    </div>
    <GrowthStagesDialog />
    {scenariosOpen && <Dialog title="Scenarios" onClose={() => setScenariosOpen(false)}><ScenariosPanel /></Dialog>}
    {sheetOpen && <PlanSheet />}
    </>
  );
}

const SHARE_MESSAGES: Record<Exclude<LoadOutcome['status'], 'ready'>, { title: string; body: string }> = {
  revoked: { title: 'This link has been turned off', body: 'The owner has stopped sharing this plan. Ask them for a new link if you still need to see it.' },
  'not-found': { title: 'This link does not work', body: 'It may have been copied incompletely. Check the link, or ask the owner to send it again.' },
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
