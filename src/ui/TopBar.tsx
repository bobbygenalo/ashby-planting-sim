import { useState } from 'react';
import { saveNow } from '../store/persistence';
import { useCloudState } from '../store/cloudSync';
import { useApp } from '../store/store';
import { ShuffleControl } from './ShuffleControl';

/** A 24-unit stroke icon in the style of Feather icons: 2 px round lines, no fill, in the current text color. */
function FeatherIcon({ d }: { d: string[] }) {
  return (
    <svg className="feather" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((path) => <path key={path} d={path} />)}
    </svg>
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
      <button className="icon" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!edit || past === 0} onClick={undo}><FeatherIcon d={['M9 14 4 9l5-5', 'M20 20v-7a4 4 0 0 0-4-4H4']} /></button>
      <button className="icon" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!edit || future === 0} onClick={redo}><FeatherIcon d={['m15 14 5-5-5-5', 'M4 20v-7a4 4 0 0 1 4-4h12']} /></button>
    </div>
  );
}

function SaveStatus() {
  const save = useApp((s) => s.saveStatus);
  const cloud = useCloudState();
  const edit = useApp((s) => s.mode === 'edit');
  if (!edit) return null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { timeStyle: 'short' });
  const bad = save.state === 'error' || cloud.status === 'error' || cloud.status === 'conflict';
  const text =
    save.state === 'error' ? 'Not saved'
    : cloud.status === 'conflict' ? 'Needs a decision'
    : cloud.status === 'error' ? 'Saved here, not online'
    : cloud.status === 'syncing' ? 'Saving…'
    : cloud.syncedAt ? `Saved ${time(cloud.syncedAt)}`
    : save.at ? `Saved ${time(save.at)}`
    : 'Saved';
  const title = [save.state === 'error' ? save.message : 'Saved in this browser automatically.', cloud.message].filter(Boolean).join(' ');
  return (
    <button className={`savepill ${bad ? 'bad' : ''}`} title={`${title} Click to save now.`} onClick={() => saveNow()}>{text}</button>
  );
}

/**
 * The scenario is the container for everything else, so it leads: which scenario you are in, switching,
 * making a new one, and sharing, with saving and undo beside it.
 */
export function TopBar({ onScenarios, panelOpen, onTogglePanel }: { onScenarios: () => void; panelOpen: boolean; onTogglePanel: () => void }) {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const [more, setMore] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">
        <b>{s.site.name}</b>
      </div>
      {edit ? (
        <div className="scenariobar">
          <label className="scenariopick">
            <span className="muted small">Scenario</span>
            <select value={s.activeScenarioId} onChange={(e) => s.switchScenario(e.target.value)} aria-label="Scenario">
              {s.scenarios.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
            </select>
          </label>
          <div className={`collapsible ${more ? 'open' : ''}`}>
            <button onClick={() => { s.createScenario(); setMore(false); }} title="Start another scenario">+ New</button>
            <button onClick={() => { onScenarios(); setMore(false); }}>Manage…</button>
            <ShuffleControl />
          </div>
          <button className="morebtn" aria-expanded={more} aria-label="More scenario actions" title="New, manage, shuffle" onClick={() => setMore(!more)}>⋯</button>
        </div>
      ) : s.phoneViewer ? (
        <div className="scenariobar">
          <label className="scenariopick">
            <span className="muted small">Scenario</span>
            <select value={s.activeScenarioId} onChange={(e) => s.switchScenario(e.target.value)} aria-label="Scenario">
              {s.scenarios.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="scenariobar"><span className="badge view">View only</span></div>
      )}
      <div className="topright">
        <SaveStatus />
        {edit && <UndoRedo />}
        {edit && <button className="on" onClick={onScenarios} title="Get a read-only link to a scenario">Share</button>}
        <button className={`drawerbtn ${panelOpen ? 'on' : ''}`} aria-pressed={panelOpen} aria-label={panelOpen ? 'Hide the side panel' : 'Show the side panel'} title={panelOpen ? 'Hide the side panel' : 'Show the side panel'} onClick={onTogglePanel}>
          <span className="drawericon" aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
