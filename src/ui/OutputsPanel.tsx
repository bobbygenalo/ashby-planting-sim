import { useMemo } from 'react';
import { buildAssumptions, placeholders } from '../engine/assumptions';
import { plantSchedule, scheduleCsv } from '../engine/schedule';
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
  const rows = useMemo(() => plantSchedule(plants, s.engine.growth, s.water), [plants, s.engine, s.water]);
  const groups = useMemo(() => buildAssumptions({ engine: s.engine, water: s.water, soil: s.soil, site: s.site, library: s.library }), [s.engine, s.water, s.soil, s.site, s.library]);
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
            <thead><tr><th>Plant</th><th className="num">Qty</th><th>Container</th><th className="num">Spacing</th><th>Water</th><th>Sun</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.speciesId}|${r.container}`}>
                  <td><b>{r.common}</b><div className="muted small"><i>{r.botanical}</i></div></td>
                  <td className="num">{r.quantity}</td><td>{r.container}</td><td className="num">{formatFeetInches(r.spacingFt, 2)}</td><td>{r.water}</td><td>{r.sun}</td>
                </tr>
              ))}
              <tr className="total"><td>Total plants</td><td className="num">{total}</td><td colSpan={4} /></tr>
            </tbody>
          </table>
          <div className="row"><button onClick={() => download('plant-schedule.csv', scheduleCsv(rows))}>Download CSV</button></div>
        </>
      )}
      <p className="muted small">Spacing is on center, equal to mature width. Quantities are every plant placed in this scenario.</p>

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
