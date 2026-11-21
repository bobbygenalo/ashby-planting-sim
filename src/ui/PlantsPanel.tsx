import { useMemo, useState } from 'react';
import { placedPlants, sunFit } from '../engine/growth';
import { filterSpecies, type LibraryFilter } from '../engine/library';
import type { SunHoursResult } from '../engine/sunhours';
import { formatFeetInches } from '../engine/units';
import type { ContainerId, Species } from '../engine/types';
import { useApp } from '../store/store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPES = ['tree', 'shrub', 'perennial', 'grass', 'groundcover', 'vine', 'succulent', 'edible'] as const;
const GROUPS = ['native bees', 'honey bees', 'butterflies', 'moths', 'hummingbirds'] as const;

function PollBadge({ v }: { v: Species['pollinator']['value'] }) {
  return <span className={`pill poll-${v}`} title="Pollinator value">{v} pollinator</span>;
}

function monthsLabel(ms: number[]) {
  if (ms.length === 0) return 'none';
  if (ms.length === 12) return 'year-round';
  return ms.map((m) => MONTHS[m - 1]).join(', ');
}

function sunAt(result: SunHoursResult | null, x: number, y: number): number | null {
  if (!result) return null;
  const i = Math.floor(x / result.cellSize);
  const j = Math.floor(y / result.cellSize);
  if (i < 0 || j < 0 || i >= result.nx || j >= result.ny) return null;
  const k = j * result.nx + i;
  return result.mask[k] === 1 ? result.hours[k] : null;
}

function Inspector({ growing }: { growing: SunHoursResult | null }) {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const plants = useMemo(
    () => placedPlants(s.instances, s.palette, s.library.species, s.timelineMonth, s.engine.growth),
    [s.instances, s.palette, s.library, s.timelineMonth, s.engine],
  );
  const inst = s.instances.find((i) => i.id === s.selectedId);
  if (!inst) return <p className="muted small">Click a plant in the yard, or pick a species and place one.</p>;
  const sp = s.library.species.find((x) => x.id === inst.speciesId)!;
  const placed = plants.find((p) => p.inst.id === inst.id);
  const hours = sunAt(growing, inst.position[0], inst.position[1]);
  const fit = hours === null ? null : sunFit(sp, hours, s.engine.growth);
  const age = (s.timelineMonth - inst.plantedMonth) / 12;
  const warnings: string[] = [];
  if (!s.palette[sp.id]) warnings.push('Species is deselected, so this plant is hidden and excluded from totals.');
  if (sp.invasive) warnings.push('Flagged invasive in the library.');
  if (fit === 'too-shaded') warnings.push(`Only ${hours!.toFixed(1)} h of growing-season sun here; ${sp.common} wants ${sp.sun} sun.`);
  if (fit === 'too-sunny') warnings.push(`${hours!.toFixed(1)} h of growing-season sun here is more than ${sp.common} (${sp.sun} sun) likes.`);
  if (hours === null) warnings.push('This spot is under a structure or outside the lot.');
  const pf = s.engine.growth.wucolsPlantFactor[sp.wucols];
  const prov = sp.provenance?.size ?? s.library.provenanceDefault;
  const num = (v: number, set: (n: number) => void, step = 0.5) => (
    <input type="number" step={step} value={Number(v.toFixed(2))} disabled={!edit} onChange={(e) => set(Number(e.target.value))} />
  );

  return (
    <div className="inspector">
      <h3>{sp.common}</h3>
      <p className="muted small"><i>{sp.botanical}</i></p>
      <div className="row wrap">
        <PollBadge v={sp.pollinator.value} />
        {sp.origin === 'california native' && <span className="pill native">CA native</span>}
        {sp.invasive && <span className="pill warn">invasive</span>}
        {sp.toxic && <span className="pill warn">toxic</span>}
      </div>
      {warnings.length > 0 && (
        <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      <table className="tbl kv">
        <tbody>
          <tr><td>Now</td><td>{placed ? `${formatFeetInches(placed.size.height, 4)} tall × ${formatFeetInches(placed.size.width, 4)} wide` : 'not yet planted'}</td></tr>
          <tr><td>Mature</td><td>{formatFeetInches(sp.matureHeight, 4)} × {formatFeetInches(sp.matureWidth, 4)} in {sp.yearsToMaturity} yr</td></tr>
          <tr><td>Age</td><td>{inst.existing ? 'existing' : age < 0 ? `plants in ${(-age).toFixed(1)} yr` : `${age.toFixed(1)} yr`}</td></tr>
          <tr><td>Sun here</td><td>{hours === null ? 'n/a' : `${hours.toFixed(1)} h/day, Mar-Oct`} <small className="muted">(needs {sp.sun})</small></td></tr>
          <tr><td>Water</td><td>WUCOLS {sp.wucols}, plant factor {pf}</td></tr>
          <tr><td>Blooms</td><td>{monthsLabel(sp.bloomMonths)}</td></tr>
          <tr><td>Hosts</td><td>{sp.pollinator.larvalHost.length ? sp.pollinator.larvalHost.join('; ') : 'no larval host recorded'}</td></tr>
          <tr><td>Data</td><td><span className={`pill conf-${prov.confidence}`}>{prov.confidence} confidence</span></td></tr>
        </tbody>
      </table>
      <p className="muted small">{sp.notes}</p>

      <h2>Edit this plant</h2>
      <div className="grid2">
        <label>X (ft){num(inst.position[0], (n) => s.updateInstance(inst.id, { position: [n, inst.position[1]] }))}</label>
        <label>Y (ft){num(inst.position[1], (n) => s.updateInstance(inst.id, { position: [inst.position[0], n] }))}</label>
        <label>Container
          <select disabled={!edit || inst.existing} value={inst.container} onChange={(e) => s.updateInstance(inst.id, { container: e.target.value as ContainerId })}>
            {Object.entries(s.engine.growth.containers).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
          </select>
        </label>
        <label>Planted (year){num(inst.plantedMonth / 12, (n) => s.updateInstance(inst.id, { plantedMonth: Math.round(n * 12) }), 0.25)}</label>
      </div>
      <label className="check">
        <input type="checkbox" disabled={!edit} checked={inst.existing} onChange={(e) => s.updateInstance(inst.id, e.target.checked ? { existing: true, currentHeight: placed?.size.height ?? sp.matureHeight, currentWidth: placed?.size.width ?? sp.matureWidth } : { existing: false })} />
        Existing plant (enter its current size)
      </label>
      {inst.existing && (
        <div className="grid2">
          <label>Height (ft){num(inst.currentHeight ?? 0, (n) => s.updateInstance(inst.id, { currentHeight: n }))}</label>
          <label>Canopy width (ft){num(inst.currentWidth ?? 0, (n) => s.updateInstance(inst.id, { currentWidth: n }))}</label>
        </div>
      )}
      <div className="row">
        <button disabled={!edit} onClick={() => s.duplicateInstance(inst.id)}>Duplicate</button>
        <button disabled={!edit} onClick={() => s.deleteInstance(inst.id)}>Delete</button>
        <button onClick={() => s.select(null)}>Close</button>
      </div>
      <p className="muted small">Blue ring: mature width. Amber ring: current canopy.</p>
    </div>
  );
}

export function PlantsPanel({ growing }: { growing: SunHoursResult | null }) {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const [f, setF] = useState<LibraryFilter>({});
  const list = useMemo(() => filterSpecies(s.library.species, f), [s.library, f]);
  const set = <K extends keyof LibraryFilter>(k: K, v: LibraryFilter[K] | '') => setF({ ...f, [k]: v === '' ? undefined : v });
  const active = s.instances.filter((i) => s.palette[i.speciesId]);
  const hidden = s.instances.length - active.length;
  const plants = useMemo(
    () => placedPlants(s.instances, s.palette, s.library.species, s.timelineMonth, s.engine.growth),
    [s.instances, s.palette, s.library, s.timelineMonth, s.engine],
  );
  const canopy = plants.reduce((a, p) => a + Math.PI * (p.size.width / 2) ** 2, 0);
  const sel = (v: string | undefined) => v ?? '';

  return (
    <div className="plants">
      <p className="banner small">
        Library values are <b>unverified</b> (low confidence): compiled without checking WUCOLS, Calscape or Cal-IPC. Confirm before spending money.
      </p>

      <h2>Scenario</h2>
      <p className="small">
        {active.length} plant{active.length === 1 ? '' : 's'} placed
        {hidden > 0 && <span className="muted"> ({hidden} hidden by deselected species)</span>}; canopy {Math.round(canopy).toLocaleString()} sq ft at this point in the timeline.
      </p>

      <h2>Inspector</h2>
      <Inspector growing={growing} />

      <h2>Library ({list.length} of {s.library.species.length})</h2>
      <input className="search" placeholder="Search name…" value={f.text ?? ''} onChange={(e) => set('text', e.target.value)} />
      <div className="filters">
        <select value={sel(f.type)} onChange={(e) => set('type', e.target.value as never)}><option value="">Any type</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        <select value={sel(f.origin)} onChange={(e) => set('origin', e.target.value as never)}><option value="">Any origin</option><option>california native</option><option>mediterranean</option><option>other</option></select>
        <select value={sel(f.water)} onChange={(e) => set('water', e.target.value as never)}><option value="">Any water</option><option>very low</option><option>low</option><option>moderate</option><option>high</option></select>
        <select value={sel(f.sun)} onChange={(e) => set('sun', e.target.value as never)}><option value="">Any sun</option><option>full</option><option>part</option><option>shade</option></select>
        <select value={sel(f.pollinator)} onChange={(e) => set('pollinator', e.target.value as never)}><option value="">Any pollinator value</option><option>high</option><option>moderate</option><option>low</option></select>
        <select value={sel(f.group)} onChange={(e) => set('group', e.target.value as never)}><option value="">Any group served</option>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select>
        <select value={f.bloomMonth ?? ''} onChange={(e) => set('bloomMonth', e.target.value === '' ? '' : (Number(e.target.value) as never))}><option value="">Any bloom month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select value={f.evergreen === undefined ? '' : String(f.evergreen)} onChange={(e) => set('evergreen', e.target.value === '' ? '' : ((e.target.value === 'true') as never))}><option value="">Evergreen or deciduous</option><option value="true">Evergreen</option><option value="false">Deciduous</option></select>
      </div>
      <label className="check"><input type="checkbox" checked={!!f.nonToxicOnly} onChange={(e) => set('nonToxicOnly', e.target.checked ? true : '')} />Non-toxic only</label>
      <label className="check"><input type="checkbox" checked={!!f.hideInvasive} onChange={(e) => set('hideInvasive', e.target.checked ? true : '')} />Hide invasive</label>

      <div className="row">
        <span className="muted small">Place as</span>
        <select value={s.placeContainer} onChange={(e) => s.setPlaceContainer(e.target.value as ContainerId)} disabled={!edit}>
          {Object.entries(s.engine.growth.containers).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
        </select>
        {s.placingSpeciesId && <button className="on" onClick={() => s.setPlacing(null)}>Stop placing</button>}
      </div>
      {!edit && <p className="muted small">View only: the plan cannot be changed.</p>}

      <ul className="species">
        {list.map((sp) => {
          const on = !!s.palette[sp.id];
          const n = s.instances.filter((i) => i.speciesId === sp.id).length;
          return (
            <li key={sp.id} className={on ? 'sel' : ''}>
              <label className="check">
                <input type="checkbox" checked={on} disabled={!edit} onChange={(e) => { s.setPaletteSpecies(sp.id, e.target.checked); if (!e.target.checked && s.placingSpeciesId === sp.id) s.setPlacing(null); }} />
                <span>
                  <b>{sp.common}</b>{n > 0 && <span className="count">{n}</span>}
                  <br /><small className="muted"><i>{sp.botanical}</i></small>
                </span>
              </label>
              <div className="row wrap">
                <PollBadge v={sp.pollinator.value} />
                <span className="pill">{sp.wucols} water</span>
                <span className="pill">{sp.sun} sun</span>
                {sp.origin === 'california native' && <span className="pill native">CA native</span>}
                {sp.invasive && <span className="pill warn">invasive</span>}
                <span className="pill">{formatFeetInches(sp.matureHeight, 2)}×{formatFeetInches(sp.matureWidth, 2)}</span>
                {on && edit && (
                  <button className={s.placingSpeciesId === sp.id ? 'on' : ''} onClick={() => s.setPlacing(s.placingSpeciesId === sp.id ? null : sp.id)}>
                    {s.placingSpeciesId === sp.id ? 'Click the yard…' : 'Place'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
