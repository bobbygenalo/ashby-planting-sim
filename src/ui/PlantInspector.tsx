import { useMemo } from 'react';
import { plantPrice } from '../engine/pricing';
import { fruitState, monthRange, sizeFraction } from '../engine/fruit';
import { placedPlants, sunFit } from '../engine/growth';
import { doyToMonthDay } from '../engine/time';
import type { SunHoursResult } from '../engine/sunhours';
import { formatFeetInches } from '../engine/units';
import type { ContainerId, Species } from '../engine/types';
import { soilMismatches } from '../engine/soil';
import { useWaterDemand, zoneIdAt } from '../store/derived';
import { useApp } from '../store/store';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function PollBadge({ v }: { v: Species['pollinator']['value'] }) {
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



export function PlantInspector({ growing }: { growing: SunHoursResult | null }) {
  const s = useApp((x) => x);
  const demand = useWaterDemand();
  const edit = s.mode === 'edit';
  const plants = useMemo(
    () => placedPlants(s.instances, s.palette, s.library.species, s.timelineMonth, s.engine.growth),
    [s.instances, s.palette, s.library, s.timelineMonth, s.engine],
  );
  const inst = s.instances.find((i) => i.id === s.selectedId);
  if (!inst) return null;
  const sp = s.library.species.find((x) => x.id === inst.speciesId)!;
  const placed = plants.find((p) => p.inst.id === inst.id);
  const hours = sunAt(growing, inst.position[0], inst.position[1]);
  const fit = hours === null ? null : sunFit(sp, hours, s.engine.growth);
  const age = (s.timelineMonth - inst.plantedMonth) / 12;
  // What the yard shows right now: depends on the sun date's month and how grown the plant is at this point in the timeline.
  let fruitNow = '';
  if (sp.fruit) {
    const calMonth = doyToMonthDay(s.doy)[0];
    const fs = placed ? fruitState(sp, placed.size, calMonth, s.engine.fruit) : null;
    if (!placed) fruitNow = 'not yet planted';
    else if (sizeFraction(sp, placed.size) < s.engine.fruit.minSizeFraction) fruitNow = `no fruit yet: starts at about ${Math.round(s.engine.fruit.minSizeFraction * 100)}% of mature size`;
    else if (!fs) fruitNow = 'out of season on this date';
    else fruitNow = `showing ${fs.count} ${fs.phase === 'ripe' ? 'ripe' : 'unripe'} fruit on this date`;
  }
  const warnings: string[] = [];
  if (sp.invasive) warnings.push('Flagged invasive in the library.');
  if (fit === 'too-shaded') warnings.push(`Only ${hours!.toFixed(1)} h of growing-season sun here; ${sp.common} wants ${sp.sun} sun.`);
  if (fit === 'too-sunny') warnings.push(`${hours!.toFixed(1)} h of growing-season sun here is more than ${sp.common} (${sp.sun} sun) likes.`);
  if (hours === null) warnings.push('This spot is under a structure or outside the lot.');
  const pf = s.engine.growth.wucolsPlantFactor[sp.wucols];
  const zid = zoneIdAt(s.site.zones, inst.position[0], inst.position[1]);
  const profile = (zid && s.soilProfiles[zid]) || s.soil.defaultProfile;
  for (const m of soilMismatches(sp, profile, s.soil)) warnings.push(m);
  const row = demand.rows.find((r) => r.id === inst.id);
  const hzName = row ? demand.hydrozones.find((h) => h.id === row.hydrozoneId)?.name : undefined;
  const prov = sp.provenance?.size ?? s.library.provenanceDefault;
  const num = (v: number, set: (n: number) => void, step = 0.5) => (
    <input type="number" step={step} value={Number(v.toFixed(2))} disabled={!edit} onChange={(e) => set(Number(e.target.value))} />
  );

  return (
    <div className="inspector">
      <h3>{sp.common}</h3>
      <p className="muted small"><i>{sp.botanical}</i></p>
      <div className="row"><button onClick={() => s.setGrowthStagesFor(sp.id)} title="See this plant at several ages, through the seasons">Growth stages…</button></div>
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
          <tr><td>Water</td><td>WUCOLS {sp.wucols}, plant factor {pf}{row && <>; about <b>{Math.round(row.annualGal).toLocaleString()} gal/yr</b> now{row.multiplier > 1 ? ` (establishing, x${row.multiplier})` : ''}</>}</td></tr>
          {hzName && <tr><td>Zone</td><td>{hzName}</td></tr>}
          <tr><td>Blooms</td><td>{monthsLabel(sp.bloomMonths)}</td></tr>
          {sp.fruit && (
            <tr>
              <td>Fruit</td>
              <td>
                ripe {monthRange(sp.fruit.ripeMonths)}
                <br /><small className="muted">{fruitNow}</small>
              </td>
            </tr>
          )}
          <tr><td>Hosts</td><td>{sp.pollinator.larvalHost.length ? sp.pollinator.larvalHost.join('; ') : 'no larval host recorded'}</td></tr>
          <tr><td>Data</td><td><span className={`pill conf-${prov.confidence}`}>{prov.confidence} confidence</span></td></tr>
        </tbody>
      </table>
      <p className="muted small">{sp.notes}</p>
      {sp.sheet && (
        <p className="muted small">
          <b>Data: {sp.sheet.confidence.toLowerCase()}.</b>{sp.sheet.verified ? ` Checked: ${sp.sheet.verified}.` : ''}{sp.sheet.toVerify ? ` Still to verify: ${sp.sheet.toVerify}.` : ''}
        </p>
      )}

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
        {!inst.existing && (
          <label>Price each ({s.engine.pricing.currency})
            <input
              type="number" min={0} step={1} disabled={!edit} aria-label="Price of this plant"
              value={inst.price ?? ''} placeholder={String(Math.round(plantPrice({ ...inst, price: undefined }, sp, s.prices, s.engine.pricing).price))}
              onChange={(e) => s.updateInstance(inst.id, { price: e.target.value.trim() === '' || Number(e.target.value) < 0 ? undefined : Number(e.target.value) })}
            />
          </label>
        )}
      </div>
      <label className="grid2" style={{ display: 'grid', gridTemplateColumns: '1fr' }}>
        Hydrozone
        <select disabled={!edit} value={inst.hydrozoneId ?? ''} onChange={(e) => s.assignHydrozone(inst.id, e.target.value || null)}>
          <option value="">Automatic (by water-use category)</option>
          {s.hydrozones.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </label>
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
      </div>
      <p className="muted small">Blue ring: mature width. Amber ring: current canopy.</p>
    </div>
  );
}

