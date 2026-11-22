import { saveNow } from '../store/persistence';
import { useCloudState } from '../store/cloudSync';
import { useApp } from '../store/store';
import { ShuffleControl } from './ShuffleControl';

function UndoRedo() {
  const edit = useApp((s) => s.mode === 'edit');
  const past = useApp((s) => s.history.past.length);
  const future = useApp((s) => s.history.future.length);
  const undo = useApp((s) => s.undo);
  const redo = useApp((s) => s.redo);
  return (
    <div className="undo">
      <button className="icon" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" disabled={!edit || past === 0} onClick={undo}>↶</button>
      <button className="icon" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!edit || future === 0} onClick={redo}>↷</button>
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
export function TopBar({ onScenarios }: { onScenarios: () => void }) {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
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
          <button onClick={() => s.createScenario()} title="Start another scenario">+ New</button>
          <button onClick={onScenarios}>Manage…</button>
          <ShuffleControl />
        </div>
      ) : (
        <div className="scenariobar"><span className="badge view">View only</span></div>
      )}
      <div className="topright">
        <SaveStatus />
        {edit && <UndoRedo />}
        {edit && <button className="on" onClick={onScenarios} title="Get a read-only link to a scenario">Share</button>}
      </div>
    </header>
  );
}
