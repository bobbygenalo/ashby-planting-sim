import { useMemo, useState } from 'react';
import { raisedBedFill, soilMismatches, soilQuantities, treeSoilVolumes } from '../engine/soil';
import { waterBudget } from '../engine/water';
import type { HydrozoneSummary } from '../engine/water';
import { activeStructures } from '../engine/site';
import type { Irrigation, SoilProfile } from '../engine/types';
import { formatFeetInches } from '../engine/units';
import { useWaterDemand, usePlaced, zoneIdAt } from '../store/derived';
import { useApp } from '../store/store';
import { MonthlyBars, type Series } from './charts';
import { IrrigationPanel } from './IrrigationPanel';

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A hydrozone keeps one color for its identity: automatic zones by category, custom zones in creation order. */
function seriesColor(id: string, customIds: string[]): string {
  const auto: Record<string, number> = { 'auto:very low': 1, 'auto:low': 2, 'auto:moderate': 3, 'auto:high': 4, 'auto:lawn': 5 };
  if (auto[id]) return `var(--series-${auto[id]})`;
  const i = customIds.indexOf(id);
  return i >= 0 && i < 3 ? `var(--series-${6 + i})` : 'var(--series-other)';
}

export function WaterSoilPanel() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const demand = useWaterDemand();
  const plants = usePlaced();
  const [newName, setNewName] = useState('');
  const [newIrr, setNewIrr] = useState<Irrigation>('drip');
  const customIds = s.hydrozones.map((h) => h.id);
  const year = s.timelineMonth / 12;

  const series: Series[] = useMemo(
    () => demand.hydrozones.filter((h) => h.annualGal > 0).map((h) => ({ id: h.id, name: h.name, color: seriesColor(h.id, customIds), values: h.monthlyGal })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demand, s.hydrozones],
  );
  const budget = useMemo(
    () => waterBudget({ plants, elements: s.hardscape, water: s.water, hardscapeCfg: s.engine.hardscape, annualDemandGal: demand.lot.annualGal }),
    [plants, s.hardscape, s.water, s.engine, demand.lot.annualGal],
  );
  const structures = activeStructures(s.site, { aduEnabled: s.aduEnabled });
  const qty = useMemo(() => soilQuantities({ plants, elements: s.hardscape, soil: s.soil, hardscapeCfg: s.engine.hardscape }), [plants, s.hardscape, s.soil, s.engine]);
  const fill = useMemo(() => raisedBedFill(s.hardscape, s.soil, s.engine.hardscape), [s.hardscape, s.soil, s.engine]);
  const trees = useMemo(
    () => treeSoilVolumes({ plants, elements: s.hardscape, materials: s.materials, structures, lot: s.site.lot, soil: s.soil, hardscapeCfg: s.engine.hardscape }),
    [plants, s.hardscape, s.materials, structures, s.site, s.soil, s.engine],
  );
  const zoneName = (id: string | null) => s.site.zones.find((z) => z.id === id)?.name ?? 'Outside the yard zones';
  const flags = useMemo(() => {
    const out: { id: string; zone: string; text: string }[] = [];
    for (const p of plants) {
      const zid = zoneIdAt(s.site.zones, p.inst.position[0], p.inst.position[1]);
      const profile = (zid && s.soilProfiles[zid]) || s.soil.defaultProfile;
      for (const m of soilMismatches(p.species, profile, s.soil)) out.push({ id: p.inst.id, zone: zoneName(zid), text: m });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plants, s.soilProfiles, s.soil, s.site]);

  const setIrrigation = (h: HydrozoneSummary, v: Irrigation) => (h.auto ? s.setAutoIrrigation(h.id, v) : s.updateHydrozone(h.id, { irrigation: v }));
  const irrOptions = Object.entries(s.water.irrigation) as [Irrigation, { label: string; efficiency: number }][];
  const warnings = demand.hydrozones.filter((h) => h.warning);
  const peakMonth = (a: number[]) => a.indexOf(Math.max(...a));

  const profileField = (zoneId: string, p: SoilProfile) => (
    <div className="soilcard" key={zoneId}>
      <div className="row">
        <b>{zoneName(zoneId)}</b>
        {p.isDefault && <span className="pill warn">default, untested</span>}
      </div>
      <div className="grid2">
        <label>Texture
          <select disabled={!edit} value={p.texture} onChange={(e) => s.setSoilProfile(zoneId, { texture: e.target.value })}>
            {s.soil.textures.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label>Drainage (in/hr)
          <input type="number" step="0.1" min="0" disabled={!edit} value={p.drainageInHr} onChange={(e) => s.setSoilProfile(zoneId, { drainageInHr: Number(e.target.value) })} />
        </label>
        <label>pH
          <input type="number" step="0.1" min="3" max="10" disabled={!edit} value={p.ph} onChange={(e) => s.setSoilProfile(zoneId, { ph: Number(e.target.value) })} />
        </label>
        <label>Organic matter (%)
          <input type="number" step="0.5" min="0" disabled={!edit} value={p.organicMatterPct} onChange={(e) => s.setSoilProfile(zoneId, { organicMatterPct: Number(e.target.value) })} />
        </label>
        <label>Compaction notes
          <input disabled={!edit} value={p.compaction} onChange={(e) => s.setSoilProfile(zoneId, { compaction: e.target.value })} />
        </label>
        <label>Test date
          <input type="date" disabled={!edit} value={p.testDate ?? ''} onChange={(e) => s.setSoilProfile(zoneId, { testDate: e.target.value || null })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" disabled={!edit} checked={!!s.playZones[zoneId]} onChange={(e) => s.setPlayZone(zoneId, e.target.checked)} />
        Play area (warns about bee-attracting groundcover)
      </label>
    </div>
  );

  return (
    <div className="waterpanel">
      {s.water.eto.status !== 'verified' && (
        <p className="banner small">
          <b>The ETo table is a placeholder.</b> The official MWELO Appendix A row for Los Angeles could not be retrieved, so every gallon figure here is provisional. Replace the twelve values in <code>src/data/water.json</code>.
        </p>
      )}

      <h2>Water demand</h2>
      <p className="small muted">
        At year {year.toFixed(1)} of the timeline, with plants at their simulated canopy size. Formula: ETo × 0.62 × (plant factor × area) ÷ irrigation efficiency, with a higher factor while plants establish.
      </p>
      <label className="check">
        <input type="checkbox" disabled={!edit} checked={s.useRain} onChange={(e) => s.setUseRain(e.target.checked)} />
        Subtract effective rainfall
      </label>

      <div className="kpi">
        <div><b>{fmt(demand.lot.annualGal)}</b><span>gallons per year</span></div>
        <div><b>{fmt(Math.max(...demand.lot.monthlyGal))}</b><span>gallons in the peak month ({MONTHS[peakMonth(demand.lot.monthlyGal)]})</span></div>
        <div><b>{fmt(demand.lot.areaSf)}</b><span>sq ft of canopy and lawn</span></div>
      </div>

      <MonthlyBars series={series} unit="gal" title="Gallons per month, by hydrozone" />

      <h2>By yard zone</h2>
      <table className="tbl">
        <thead><tr><th>Zone</th><th className="num">Sq ft</th><th className="num">Gal / yr</th><th className="num">Peak month</th></tr></thead>
        <tbody>
          {demand.yardZones.map((z) => (
            <tr key={z.id}><td>{z.name}</td><td className="num">{fmt(z.areaSf)}</td><td className="num">{fmt(z.annualGal)}</td><td className="num">{fmt(Math.max(...z.monthlyGal))}</td></tr>
          ))}
          <tr className="total"><td>Whole lot</td><td className="num">{fmt(demand.lot.areaSf)}</td><td className="num">{fmt(demand.lot.annualGal)}</td><td className="num">{fmt(Math.max(...demand.lot.monthlyGal))}</td></tr>
        </tbody>
      </table>

      <h2>Hydrozones</h2>
      {warnings.length > 0 && <ul className="warnings">{warnings.map((h) => <li key={h.id}><b>{h.name}:</b> {h.warning}</li>)}</ul>}
      <table className="tbl">
        <thead><tr><th>Zone</th><th>Irrigation</th><th className="num">Plants</th><th className="num">Gal / yr</th></tr></thead>
        <tbody>
          {demand.hydrozones.map((h) => (
            <tr key={h.id}>
              <td>
                <i className="dot" style={{ background: seriesColor(h.id, customIds) }} />{h.name}
                {!h.auto && edit && <button className="link" onClick={() => s.deleteHydrozone(h.id)}> delete</button>}
                <div className="muted small">{h.categories.join(', ') || 'no plants yet'} · {fmt(h.areaSf)} sq ft</div>
              </td>
              <td>
                <select disabled={!edit} value={h.irrigation} onChange={(e) => setIrrigation(h, e.target.value as Irrigation)}>
                  {irrOptions.map(([k, v]) => <option key={k} value={k}>{v.label}{v.efficiency ? ` (${v.efficiency})` : ''}</option>)}
                </select>
              </td>
              <td className="num">{h.members}</td>
              <td className="num">{fmt(h.annualGal)}</td>
            </tr>
          ))}
          {demand.hydrozones.length === 0 && <tr><td colSpan={4} className="muted">Place plants to create hydrozones automatically by water-use category.</td></tr>}
        </tbody>
      </table>
      {edit && (
        <div className="row">
          <input className="search" style={{ marginBottom: 0 }} placeholder="New hydrozone name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select value={newIrr} onChange={(e) => setNewIrr(e.target.value as Irrigation)}>{irrOptions.map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          <button disabled={!newName.trim()} onClick={() => { if (s.addHydrozone(newName, newIrr)) setNewName(''); }}>Add</button>
        </div>
      )}
      <p className="muted small">Assign a plant to a hydrozone from its inspector on the Plants tab. Without one, a plant joins an automatic zone for its water-use category.</p>

      <h2>Weekly watering (gallons per week)</h2>
      <div className="scroll">
        <table className="tbl tight">
          <thead><tr><th>Zone</th>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}</tr></thead>
          <tbody>
            {demand.hydrozones.filter((h) => h.annualGal > 0).map((h) => (
              <tr key={h.id}><td>{h.name.replace(' (automatic)', '')}</td>{h.weeklyGal.map((g, m) => <td key={m} className="num" title={`${h.weeklyInches[m].toFixed(2)} in per week`}>{fmt(g)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Hover a figure for inches of water per week over that zone's canopy. Zones set to no irrigation get no applied water.</p>

      <h2>Water budget (benchmark)</h2>
      <p className="small">
        Landscape area {fmt(budget.landscapeAreaSf)} sq ft. MWELO-style allowance (ETAF {s.water.budget.etaf}): <b>{fmt(budget.annualAllowanceGal)}</b> gal per year, against <b>{fmt(demand.lot.annualGal)}</b> planned
        {budget.ratio !== null && <> ({fmt(budget.ratio * 100)}% of allowance)</>}.
      </p>
      {budget.ratio !== null && <div className="bar" title="Share of allowance"><span style={{ width: `${Math.min(100, budget.ratio * 100)}%`, background: budget.ratio > 1 ? 'var(--series-8)' : 'var(--series-3)' }} /></div>}
      <p className="muted small">An informational benchmark, not a compliance finding.</p>

      <IrrigationPanel />

      <h2>Soil by yard zone</h2>
      <p className="small muted">Enter test results when you have them. Until then each zone uses a default loam.</p>
      {s.site.zones.map((z) => profileField(z.id, s.soilProfiles[z.id] ?? s.soil.defaultProfile))}

      <h2>Soil fit ({flags.length} flag{flags.length === 1 ? '' : 's'})</h2>
      {flags.length === 0 ? (
        <p className="muted small">No plant conflicts with its zone's soil.</p>
      ) : (
        <ul className="warnings">{flags.map((f, i) => <li key={`${f.id}${i}`}>{f.text} <span className="muted">({f.zone})</span></li>)}</ul>
      )}

      <h2>Planting quantities</h2>
      {qty.rows.length === 0 ? (
        <p className="muted small">New plants will appear here with their excavation, amendment and mulch volumes.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>Bed</th><th className="num">Plants</th><th className="num">Excavate</th><th className="num">Amend</th><th className="num">Mulch</th></tr></thead>
          <tbody>
            {[...qty.rows, qty.total].map((r) => (
              <tr key={r.id} className={r.id === 'total' ? 'total' : ''}>
                <td>{r.name}</td><td className="num">{r.plants}</td><td className="num">{fmt(r.excavationCuYd, 2)}</td><td className="num">{fmt(r.amendmentCuYd, 2)}</td><td className="num">{fmt(r.mulchCuYd, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Cubic yards. Plants that need sharp drainage get no amendment. Existing plants are not counted.</p>
      {fill.length > 0 && (
        <table className="tbl">
          <thead><tr><th>Raised bed</th><th className="num">Sq ft</th><th className="num">Fill, cu yd</th></tr></thead>
          <tbody>{fill.map((f) => <tr key={f.id}><td>{f.name}</td><td className="num">{fmt(f.areaSf, 1)}</td><td className="num">{fmt(f.fillCuYd, 2)}</td></tr>)}</tbody>
        </table>
      )}

      <h2>Tree soil volume</h2>
      {trees.length === 0 ? (
        <p className="muted small">Place a tree to compare its target rootable soil with the open ground around it.</p>
      ) : (
        <table className="tbl">
          <thead><tr><th>Tree</th><th className="num">Needs</th><th className="num">Has</th><th className="num">Short</th></tr></thead>
          <tbody>
            {trees.map((t) => (
              <tr key={t.id} className={t.shortfallCuFt > 0 ? 'bad' : ''}><td>{t.name}</td><td className="num">{fmt(t.requiredCuFt)}</td><td className="num">{fmt(t.availableCuFt)}</td><td className="num">{t.shortfallCuFt > 0 ? fmt(t.shortfallCuFt) : 'ok'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Cubic feet. Target is {s.soil.rootableSoil.cuFtPerSfCanopy} cu ft per sq ft of mature canopy; soil under paving or buildings does not count. Mature width of the first tree: {trees[0] ? formatFeetInches(Math.sqrt((trees[0].matureCanopySf / Math.PI)) * 2, 2) : 'n/a'}.</p>
    </div>
  );
}
