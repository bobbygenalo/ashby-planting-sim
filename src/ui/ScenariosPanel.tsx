import { useMemo, useRef, useState } from 'react';
import { compareMetrics, scenarioMetrics, type ShareRecord } from '../engine/scenario';
import { publishShare, republishShare, revokeShare } from '../share/service';
import { shareClient, shareUrl } from '../share/client';
import { CLOUD_ENABLED, SHARING_ENABLED } from '../share/config';
import { disableCloud, enableCloud, ensureBackedUp, getSyncKey, keepThisBrowser, syncNow, useCloudCopy, useCloudState } from '../store/cloudSync';
import { appStore, useApp } from '../store/store';

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';

function CloudBackup() {
  const c = useCloudState();
  const [entry, setEntry] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  if (!CLOUD_ENABLED) {
    return (
      <>
        <h2>Saving</h2>
        <p className="muted small">Scenarios are saved in this browser only; use Export to keep a copy.</p>
      </>
    );
  }
  const status =
    c.status === 'conflict' ? 'Needs a decision below.'
    : c.status === 'error' ? c.message
    : c.status === 'syncing' ? 'Saving online…'
    : c.syncedAt ? `Saved online ${when(c.syncedAt)}.`
    : 'Saved in this browser. Changes are also saved online automatically.';
  return (
    <>
      <h2>Saving</h2>
      <p className={`small savestatus ${c.status === 'error' || c.status === 'conflict' ? 'error' : 'saved'}`} role="status">{status}</p>
      {c.status === 'conflict' && (
        <div className="drawbox">
          <p className="small">Your scenarios online and the ones in this browser are different. Which should win? The other is replaced.</p>
          <div className="row wrap">
            <button className="on" onClick={() => void useCloudCopy()}>Use the online copy</button>
            <button onClick={() => void keepThisBrowser()}>Keep this browser's</button>
          </div>
        </div>
      )}
      <details>
        <summary>Use on another device</summary>
        <p className="muted small">To open these scenarios on another computer, copy this key there. Anyone who has it can read and change your scenarios, so keep it private.</p>
        {c.key ? (
          <>
            <div className="row wrap">
              <button onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide key' : 'Show key'}</button>
              <button disabled={c.status === 'syncing' || c.status === 'conflict'} onClick={() => void syncNow()}>Save online now</button>
            </div>
            {showKey && <input className="search" readOnly value={c.key} onFocus={(e) => e.currentTarget.select()} aria-label="Key for another device" />}
          </>
        ) : (
          <p className="muted small">The key appears after your first change.</p>
        )}
        <label>On the other computer, paste the key here
          <input className="search" value={entry} placeholder="Key from your other device" onChange={(e) => setEntry(e.target.value)} />
        </label>
        <div className="row wrap">
          <button disabled={!entry.trim()} onClick={() => { const r = enableCloud(entry); setProblem(r.ok ? null : r.message); if (r.ok) setEntry(''); }}>Use this key</button>
          {c.key && <button onClick={() => { if (window.confirm('Stop saving online from this browser? What is already online stays there.')) disableCloud(); }}>Stop saving online</button>}
        </div>
        {problem && <p className="small warn" role="alert">{problem}</p>}
      </details>
    </>
  );
}

export function ScenariosPanel() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [hideAddress, setHideAddress] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [cmpA, setCmpA] = useState('');
  const [cmpB, setCmpB] = useState('');
  const client = useMemo(() => shareClient(undefined, undefined, getSyncKey), []);
  const nameOf = (id: string) => s.scenarios.find((x) => x.id === id)?.name ?? 'a deleted scenario';

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    const r = s.importScenarioFile(await file.text());
    if (r.ok) setMessage({ kind: 'ok', text: `Imported "${r.name}".${r.warnings.length ? ` ${r.warnings.length} item${r.warnings.length === 1 ? ' was' : 's were'} left out: ${r.warnings.slice(0, 3).join(' ')}` : ''}` });
    else setMessage({ kind: 'bad', text: `Could not import: ${r.errors.slice(0, 3).join(' ')}` });
    if (fileRef.current) fileRef.current.value = '';
  };

  const share = async (scenarioId: string) => {
    setBusy(`create:${scenarioId}`);
    const ready = await ensureBackedUp();
    if (!ready.ok) {
      setBusy(null);
      setMessage({ kind: 'bad', text: ready.message });
      return;
    }
    const r = await publishShare(appStore, client, scenarioId, hideAddress);
    setBusy(null);
    setMessage(r.ok ? { kind: 'ok', text: `Link created for "${nameOf(scenarioId)}". Anyone with it can view that plan, and nobody can change it.` } : { kind: 'bad', text: r.error.message });
  };
  const update = async (rec: ShareRecord) => {
    setBusy(rec.token);
    const r = await republishShare(appStore, client, rec.token);
    setBusy(null);
    setMessage(r.ok ? { kind: 'ok', text: 'The link now shows the plan as it is today.' } : { kind: 'bad', text: r.error.message });
  };
  const revoke = async (rec: ShareRecord) => {
    setBusy(rec.token);
    const r = await revokeShare(appStore, client, rec.token);
    setBusy(null);
    setConfirmRevoke(null);
    setMessage(r.ok ? { kind: 'ok', text: 'Link turned off. Nobody can open it any more.' } : { kind: 'bad', text: r.error.message });
  };
  const copy = async (url: string, token: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setMessage({ kind: 'bad', text: 'Could not copy. Select the link and copy it by hand.' });
    }
  };

  const ids = s.scenarios.map((x) => x.id);
  const a = ids.includes(cmpA) ? cmpA : s.activeScenarioId;
  const b = ids.includes(cmpB) && cmpB !== a ? cmpB : ids.find((i) => i !== a) ?? '';
  const rows = useMemo(() => {
    if (!b) return null;
    const ws = s.toWorkspace();
    const ctx = { site: s.site, engine: s.engine, water: s.water, species: s.library.species, materials: s.materials, timelineMonth: s.timelineMonth };
    return compareMetrics(scenarioMetrics(ws.data[a], ctx), scenarioMetrics(ws.data[b], ctx));
    // The workspace snapshot changes whenever any scenario does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, s.instances, s.palette, s.hardscape, s.hydrozones, s.autoIrrigation, s.useRain, s.aduEnabled, s.saved, s.timelineMonth, s.library]);

  const liveLinks = (scenarioId: string) => s.shares.filter((r) => r.scenarioId === scenarioId && !r.revoked);
  // Links whose scenario was deleted still work until turned off, so they stay reachable.
  const orphanLinks = s.shares.filter((r) => !r.revoked && !s.scenarios.some((x) => x.id === r.scenarioId));
  const linkRow = (r: ShareRecord) => {
    const url = shareUrl(window.location.origin, r.token);
    return (
      <li key={r.token} className={`linkrow ${r.revoked ? 'off' : ''}`}>
        <div className="row wrap">
          <span className={`pill ${r.revoked ? 'warn' : 'native'}`}>{r.revoked ? 'turned off' : 'live'}</span>
          {r.hideAddress && <span className="pill">address hidden</span>}
          <span className="muted small">{s.scenarios.some((x) => x.id === r.scenarioId) ? '' : `for ${nameOf(r.scenarioId)} · `}shown {when(r.updatedAt)}</span>
        </div>
        {!r.revoked && (
          <>
            <input className="search" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
            <div className="row wrap">
              <button onClick={() => copy(url, r.token)}>{copied === r.token ? 'Copied' : 'Copy link'}</button>
              <a className="btnlink" href={url} target="_blank" rel="noreferrer">Open</a>
              {edit && <button disabled={busy === r.token || !s.scenarios.some((x) => x.id === r.scenarioId)} onClick={() => update(r)}>Update to today's plan</button>}
              {edit && (confirmRevoke === r.token
                ? <><button className="on" disabled={busy === r.token} onClick={() => revoke(r)}>Yes, turn it off</button><button onClick={() => setConfirmRevoke(null)}>Keep it</button></>
                : <button onClick={() => setConfirmRevoke(r.token)}>Turn off</button>)}
            </div>
          </>
        )}
      </li>
    );
  };

  if (!edit) {
    return (
      <div className="scenarios">
        <h2>Shared plan</h2>
        <p className="small"><b>{s.shared?.name ?? s.scenarios[0]?.name}</b>{s.shared?.createdAt ? ` · shared ${when(s.shared.createdAt)}` : ''}</p>
        <p className="muted small">You are viewing a read-only copy. You can orbit the yard, scrub the timeline and sun, switch layers and views, and inspect plants. Only the owner can change the plan.</p>
      </div>
    );
  }

  return (
    <div className="scenarios">
      {message && <p className={message.kind === 'ok' ? 'okmsg small' : 'warnings small'} role="status">{message.text}</p>}

      <ul className="species">
        {s.scenarios.map((sc) => {
          const active = sc.id === s.activeScenarioId;
          return (
            <li key={sc.id} className={active ? 'sel' : ''}>
              <div className="row">
                {editing === sc.id ? (
                  <input className="search" style={{ marginBottom: 0 }} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { s.renameScenario(sc.id, draft); setEditing(null); } if (e.key === 'Escape') setEditing(null); }}
                    onBlur={() => { s.renameScenario(sc.id, draft); setEditing(null); }} aria-label="Scenario name" />
                ) : (
                  <b style={{ flex: 1 }}>{sc.name}</b>
                )}
                {active && <span className="pill native">editing</span>}
              </div>
              <p className="muted small">Changed {when(sc.modifiedAt)}</p>
              <div className="row wrap">
                {!active && <button className="on" onClick={() => s.switchScenario(sc.id)}>Open</button>}
                <button onClick={() => { setEditing(sc.id); setDraft(sc.name); }}>Rename</button>
                <button onClick={() => { const id = s.createScenario(undefined, sc.id); if (id) setMessage({ kind: 'ok', text: `Copied "${sc.name}". You are editing the copy.` }); }}>Duplicate</button>
                <button onClick={() => { const f = s.exportScenario(sc.id); if (f) download(`${slug(f.name)}.json`, f.text); }}>Export</button>
                {s.scenarios.length > 1 && (confirmDelete === sc.id
                  ? <><button className="on" onClick={() => { s.deleteScenario(sc.id); setConfirmDelete(null); }}>Yes, delete</button><button onClick={() => setConfirmDelete(null)}>Keep</button></>
                  : <button onClick={() => setConfirmDelete(sc.id)}>Delete</button>)}
              </div>
              {SHARING_ENABLED && (
                <div className="sharebox">
                  {liveLinks(sc.id).length > 0 && <ul className="species">{liveLinks(sc.id).map(linkRow)}</ul>}
                  <div className="row wrap">
                    <button disabled={busy === `create:${sc.id}`} onClick={() => share(sc.id)}>
                      {busy === `create:${sc.id}` ? 'Creating…' : liveLinks(sc.id).length ? 'Create another link' : 'Create share link'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row wrap">
        <button className="on" onClick={() => s.createScenario()}>New blank scenario</button>
        <button onClick={() => fileRef.current?.click()}>Import from file…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => onImport(e.target.files?.[0])} />
      </div>
      <p className="muted small">Each scenario holds its own palette, plants, hardscape, hydrozones and settings. Export saves one as a file you can keep, email, or import on another computer.</p>

      <CloudBackup />

      <h2>Sharing</h2>
      {!SHARING_ENABLED ? (
        <p className="muted small">Share links are not available on this site yet. Use Export above to send a scenario as a file.</p>
      ) : (<>
      <p className="small">Every scenario above has its own link. Family and professionals open a link with no login. They can orbit, scrub time and seasons, switch layers, and inspect plants, but cannot change anything.</p>
      <label className="check"><input type="checkbox" checked={hideAddress} onChange={(e) => setHideAddress(e.target.checked)} />Hide the street address on new links</label>
      <p className="muted small">{hideAddress
        ? 'New links carry no name or address, and their location is rounded to about 7 miles. The lot layout stays, since that is the plan.'
        : 'New links show the lot name and address.'}</p>
      {orphanLinks.length > 0 && (
        <details>
          <summary>Links for deleted scenarios ({orphanLinks.length})</summary>
          <ul className="species">{orphanLinks.map(linkRow)}</ul>
        </details>
      )}
      <p className="muted small">A link shows a snapshot, so later edits stay private until you press "Update to today's plan". Turning a link off deletes the shared copy and stops it working at once. The key that lets you turn it off is saved in this browser, so keep using this browser for that. Anyone who has the link can pass it on.</p>
      </>)}

      <h2>Compare two scenarios</h2>
      {s.scenarios.length < 2 ? (
        <p className="muted small">Make a second scenario to compare them.</p>
      ) : (
        <>
          <div className="grid2">
            <label>First<select value={a} onChange={(e) => setCmpA(e.target.value)}>{s.scenarios.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>Second<select value={b} onChange={(e) => setCmpB(e.target.value)}>{s.scenarios.filter((x) => x.id !== a).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          </div>
          {rows && (
            <table className="tbl">
              <thead><tr><th>At year {(s.timelineMonth / 12).toFixed(1)}</th><th className="num">{nameOf(a)}</th><th className="num">{nameOf(b)}</th><th className="num">Change</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const d = r.delta;
                  const verdict = d === 0 || !r.better ? '' : (r.better === 'lower') === (d < 0) ? ' (better)' : ' (worse)';
                  const dec = r.id === 'highValueShare' ? 0 : 0;
                  return (
                    <tr key={r.id}>
                      <td>{r.label}{r.unit && <span className="muted small"> {r.unit}</span>}</td>
                      <td className="num">{fmt(r.a, dec)}</td><td className="num">{fmt(r.b, dec)}</td>
                      <td className="num">{d > 0 ? '+' : ''}{fmt(d, dec)}{verdict}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted small">Plants at their simulated size for the timeline year. Canopy cover adds each plant's canopy, so overlaps count twice. Water uses the placeholder ETo table, so compare the scenarios to each other, not to a real bill. Conflicts count the owner's plants only.</p>
        </>
      )}
    </div>
  );
}
