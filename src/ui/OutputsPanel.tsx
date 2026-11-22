import { useMemo } from 'react';
import { buildAssumptions, placeholders } from '../engine/assumptions';
import { plantSchedule, scheduleCsv } from '../engine/schedule';
import { hardscapeCosts, money, money2, priceLabel, defaultPlantPrice } from '../engine/pricing';
import { takeoff, takeoffCsv } from '../engine/hardscape';
import { formatFeetInches } from '../engine/units';
import { usePlaced } from '../store/derived';
import { useApp } from '../store/store';
import { ModelCheck } from './ModelCheck';

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function OutputsPanel() {
  const s = useApp((x) => x);
  const plants = usePlaced();
  const edit = s.mode === 'edit';
  const pricing = useMemo(() => ({ prices: s.prices, cfg: s.engine.pricing }), [s.prices, s.engine]);
  const rows = useMemo(() => plantSchedule(plants, s.engine.growth, s.water, pricing), [plants, s.engine, s.water, pricing]);
  const hs = useMemo(() => hardscapeCosts(s.hardscape, s.materials, s.engine.hardscape, s.prices), [s.hardscape, s.materials, s.engine, s.prices]);
  const tk = useMemo(() => takeoff(s.hardscape, s.materials, s.engine.hardscape), [s.hardscape, s.materials, s.engine]);
  const plantTotal = rows.reduce((a, r) => a + r.total, 0);
  const cur = s.engine.pricing;
  const speciesInPlan = useMemo(() => {
    const ids = [...new Set(rows.map((r) => r.speciesId))];
    return ids.map((id) => s.library.species.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.common.localeCompare(b.common));
  }, [rows, s.library]);
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const groups = useMemo(() => buildAssumptions({ engine: s.engine, water: s.water, soil: s.soil, site: s.site, library: s.library, materials: s.materials }), [s.engine, s.water, s.soil, s.site, s.library, s.materials]);
  const todo = placeholders(groups);
  const total = rows.reduce((a, r) => a + r.quantity, 0);

  return (
    <div className="outputs">
      <h2>Plan sheet</h2>
      <p className="small muted">A scaled top-down plan (1 in = 20 ft) with dimensions, north arrow, plant schedule, hardscape takeoff and the items still to verify. Print it or save it as a PDF for a designer, contractor or nursery.</p>
      <div className="row"><button className="on" onClick={() => s.setSheetOpen(true)}>Open printable plan sheet</button></div>

      <h2>Plant schedule</h2>
      {rows.length === 0 ? (
        <p className="muted small">New plants appear here. Existing plants are left out.</p>
      ) : (
        <>
          <table className="tbl">
            <thead><tr><th>Plant</th><th className="num">Qty</th><th>Container</th><th className="num">Spacing</th><th>Water</th><th>Sun</th><th className="num">Each</th><th className="num">Total</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.speciesId}|${r.container}`}>
                  <td><b>{r.common}</b><div className="muted small"><i>{r.botanical}</i></div></td>
                  <td className="num">{r.quantity}</td><td>{r.container}</td><td className="num">{formatFeetInches(r.spacingFt, 2)}</td><td>{r.water}</td><td>{r.sun}</td>
                  <td className="num">{money2(r.unitPrice, cur)}</td><td className="num">{money(r.total, cur)}</td>
                </tr>
              ))}
              <tr className="total"><td>Total plants</td><td className="num">{total}</td><td colSpan={5} /><td className="num">{money(plantTotal, cur)}</td></tr>
            </tbody>
          </table>
          <div className="row"><button onClick={() => download('plant-schedule.csv', scheduleCsv(rows))}>Download CSV</button></div>
        </>
      )}
      <p className="muted small">Spacing is on center, equal to mature width. Quantities are every plant placed in this scenario.</p>

      <h2>Estimated cost</h2>
      <table className="tbl kv">
        <tbody>
          <tr><td>New plants</td><td className="num">{money(plantTotal, cur)}</td></tr>
          <tr><td>New hardscape</td><td className="num">{money(hs.total, cur)}</td></tr>
          <tr className="total"><td>Total</td><td className="num">{money(plantTotal + hs.total, cur)}</td></tr>
        </tbody>
      </table>
      <p className="muted small">A rough estimate from stand-in prices, not a quote. Existing plants and hardscape are not counted. Set your own below, or on one plant or element from its card; the plan sheet prints the same figures.</p>

      <h2>Prices</h2>
      {speciesInPlan.length === 0 && hs.rows.length === 0 ? (
        <p className="muted small">Add plants or hardscape to set prices.</p>
      ) : (
        <>
          {speciesInPlan.length > 0 && (
            <table className="tbl">
              <thead><tr><th>Plant</th><th className="num">Price each ({cur.currency})</th><th /></tr></thead>
              <tbody>
                {speciesInPlan.map((sp) => {
                  const containers = plants.filter((p) => p.species.id === sp.id && !p.inst.existing).map((p) => p.inst.container);
                  const dflt = containers.length ? containers.reduce((a, c) => a + defaultPlantPrice(c, cur), 0) / containers.length : 0;
                  const own = s.prices.plant[sp.id];
                  return (
                    <tr key={sp.id}>
                      <td>{sp.common}</td>
                      <td className="num"><input type="number" min={0} step={1} disabled={!edit} value={own ?? ''} placeholder={String(Math.round(dflt))} aria-label={`Price of ${sp.common}`} onChange={(e) => s.setPlantPrice(sp.id, num(e.target.value))} style={{ width: 72 }} /></td>
                      <td>{own !== undefined && edit && <button className="link" onClick={() => s.setPlantPrice(sp.id, null)}>reset</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {hs.rows.length > 0 && (
            <table className="tbl">
              <thead><tr><th>Hardscape</th><th className="num">Price ({cur.currency})</th><th /></tr></thead>
              <tbody>
                {hs.rows.map((r) => {
                  const mat = s.materials.find((m) => m.id === r.materialId)!;
                  const own = s.prices.material[mat.id];
                  return (
                    <tr key={mat.id}>
                      <td>{mat.name}<div className="muted small">per {priceLabel[r.basis]}</div></td>
                      <td className="num"><input type="number" min={0} step={0.5} disabled={!edit} value={own ?? ''} placeholder={String(mat.price ?? 0)} aria-label={`Price of ${mat.name} per ${priceLabel[r.basis]}`} onChange={(e) => s.setMaterialPrice(mat.id, num(e.target.value))} style={{ width: 72 }} /></td>
                      <td>{own !== undefined && edit && <button className="link" onClick={() => s.setMaterialPrice(mat.id, null)}>reset</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <p className="muted small">Grayed numbers are the stand-in prices. A price on a single plant or element, set from its card, overrides these.</p>
        </>
      )}
      <div className="row">
        <button onClick={() => download('hardscape-takeoff.csv', takeoffCsv(tk.rows, new Map(hs.rows.map((r) => [r.materialId, { unitPrice: r.unitPrice, basis: priceLabel[r.basis], total: r.total }]))))} disabled={tk.rows.length === 0}>Download takeoff CSV with prices</button>
      </div>

      <h2>Assumptions and sources</h2>
      {todo.length > 0 && (
        <p className="banner small"><b>{todo.length} stand-in value{todo.length === 1 ? '' : 's'} to replace:</b> {todo.map((t) => t.label).join(', ')}.</p>
      )}
      <p className="small muted">Every coefficient and data source behind the numbers in this tool. Change values in the files under <code>src/data</code>; no code changes are needed.</p>
      {groups.map((g) => (
        <details key={g.title} open={g.title === 'Water demand'}>
          <summary>{g.title} ({g.items.length})</summary>
          <dl className="assume-list">
            {g.items.map((i) => (
              <div key={i.label}>
                <dt>
                  {i.label}
                  {i.placeholder && <span className="pill warn">placeholder</span>}
                  {i.confidence && !i.placeholder && <span className={`pill conf-${i.confidence}`}>{i.confidence}</span>}
                </dt>
                <dd>{i.value}<div className="muted small">Source: {i.source}</div></dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      <ModelCheck />
    </div>
  );
}
