import { useMemo } from 'react';
import { permeabilityReport, takeoff, takeoffCsv } from '../engine/hardscape';
import { activeStructures } from '../engine/site';
import { formatFeetInches } from '../engine/units';
import type { HardscapeType } from '../engine/types';
import { useApp } from '../store/store';
import { useHardscapeWarnings } from './HardscapeInspector';

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function HardscapePanel() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const cfg = s.engine.hardscape;
  const matById = useMemo(() => new Map(s.materials.map((m) => [m.id, m])), [s.materials]);
  const types = (Object.keys(cfg.types) as HardscapeType[]).filter((t) => !cfg.notDrawable?.includes(t));

  const tk = useMemo(() => takeoff(s.hardscape, s.materials, cfg), [s.hardscape, s.materials, cfg]);
  const perm = useMemo(
    () => permeabilityReport(s.hardscape, s.materials, activeStructures(s.site, { aduEnabled: s.aduEnabled }), s.site.zones, s.site.lot, cfg),
    [s.hardscape, s.materials, s.site, s.aduEnabled, cfg],
  );

  const warningsFor = useHardscapeWarnings();
  const totalWarnings = s.hardscape.reduce((a, e) => a + warningsFor(e.id).length, 0);

  return (
    <div className="hardscape">
      <h2>Draw</h2>
      <div className="row wrap">
        {types.map((t) => (
          <button key={t} disabled={!edit} className={s.drawing?.type === t ? 'on' : ''} onClick={() => s.startDrawing(s.drawing?.type === t ? null : t)}>
            {cfg.types[t].label}
          </button>
        ))}
      </div>
      {!edit && <p className="muted small">View only: the plan cannot be changed.</p>}
      {s.drawing ? (
        <div className="drawbox">
          {cfg.types[s.drawing.type].placeSize ? (
            <p className="small">
              Placing a <b>{cfg.types[s.drawing.type].label.toLowerCase()}</b> ({cfg.types[s.drawing.type].placeSize!.map((n) => formatFeetInches(n)).join(' × ')}): click in the yard where its center goes. Turn it or resize it afterwards from its card or its corner handles. Esc cancels.
            </p>
          ) : (
          <p className="small">
            Drawing a <b>{cfg.types[s.drawing.type].label.toLowerCase()}</b>: click to add {cfg.types[s.drawing.type].shape === 'line' ? 'points along the centerline' : 'corners'} ({s.drawing.points.length} so far).
            Points snap to corners, then edges, then the {formatFeetInches(s.snap)} grid. Double-click, Enter or Finish to end; Esc cancels.
          </p>
          )}
          <div className="row">
            {!cfg.types[s.drawing.type].placeSize && <button className="on" onClick={() => s.finishDrawing()} disabled={s.drawing.points.length < (cfg.types[s.drawing.type].shape === 'line' ? 2 : 3)}>Finish</button>}
            {!cfg.types[s.drawing.type].placeSize && <button onClick={() => s.removeLastDrawPoint()} disabled={s.drawing.points.length === 0}>Undo point</button>}
            <button onClick={() => s.startDrawing(null)}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="muted small">Pick a type, then click in the yard. Select an element to reshape it by its corner handles or drag it to move; Option-drag (Alt-drag) copies it. Picking another tool keeps a path you have started.</p>
      )}

      <h2>Elements ({s.hardscape.length}){totalWarnings > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>{totalWarnings} warning{totalWarnings === 1 ? '' : 's'}</span>}</h2>
      <ul className="species">
        {s.hardscape.map((e) => {
          const w = warningsFor(e.id).length;
          return (
            <li key={e.id} className={e.id === s.selectedElementId ? 'sel' : ''} onClick={() => s.selectElement(e.id)} style={{ cursor: 'pointer', opacity: e.removed ? 0.55 : 1 }}>
              <b>{e.name ?? cfg.types[e.type].label}</b>
              <div className="row wrap">
                <span className="pill">{matById.get(e.materialId)?.name}</span>
                {e.existing && <span className="pill">existing</span>}
                {e.removed && <span className="pill warn">removed</span>}
                {w > 0 && <span className="pill warn">{w} warning{w === 1 ? '' : 's'}</span>}
              </div>
            </li>
          );
        })}
      </ul>

      <h2>Materials takeoff (new work)</h2>
      {tk.rows.length === 0 ? (
        <p className="muted small">Nothing drawn yet. Existing and removed elements are not counted.</p>
      ) : (
        <>
          <table className="tbl">
            <thead><tr><th>Material</th><th className="num">Sq ft</th><th className="num">Lin ft</th><th className="num">Surface cu yd</th><th className="num">Base cu yd</th></tr></thead>
            <tbody>
              {tk.rows.map((r) => (
                <tr key={r.materialId}>
                  <td>{r.name}{r.count > 1 && <small className="muted"> ×{r.count}</small>}</td>
                  <td className="num">{fmt(r.areaSf, 1)}</td><td className="num">{fmt(r.edgeLf, 1)}</td>
                  <td className="num">{fmt(r.surfaceCuYd, 2)}</td><td className="num">{fmt(r.baseCuYd, 2)}</td>
                </tr>
              ))}
              <tr className="total"><td>Total</td><td className="num">{fmt(tk.total.areaSf, 1)}</td><td className="num">{fmt(tk.total.edgeLf, 1)}</td><td className="num">{fmt(tk.total.surfaceCuYd, 2)}</td><td className="num">{fmt(tk.total.baseCuYd, 2)}</td></tr>
            </tbody>
          </table>
          <div className="row"><button onClick={() => downloadCsv('hardscape-takeoff.csv', takeoffCsv(tk.rows))}>Download CSV</button></div>
        </>
      )}
      <p className="muted small">Surface = area × surface depth. Base = area × the material's base depth (footing for walls). Footings for decks and fence posts are not included. Quantities are net, with no waste factor.</p>

      <h2>Permeable vs impervious</h2>
      <table className="tbl">
        <thead><tr><th>Zone</th><th className="num">Impervious</th><th className="num">Permeable</th><th className="num">Open soil</th></tr></thead>
        <tbody>
          {perm.map((r) => (
            <tr key={r.id} className={r.id === 'lot' ? 'total' : ''}>
              <td>{r.name}</td><td className="num">{fmt(r.imperviousSf)}</td><td className="num">{fmt(r.permeableSf)}</td><td className="num">{fmt(r.openSoilSf)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Square feet, sampled on a {cfg.sampleCellFt} ft grid (about ±0.5% of lot area). Roofs count as impervious. Materials at or above {Math.round(cfg.permeableThreshold * 100)}% permeability count as permeable. Zones cover only the yards, so the driveway appears in the lot row only.</p>
    </div>
  );
}
