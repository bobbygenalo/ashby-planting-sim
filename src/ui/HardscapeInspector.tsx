import { useMemo } from 'react';
import { elementMetrics, hardscapeWarnings } from '../engine/hardscape';
import { formatFeetInches } from '../engine/units';
import { useApp } from '../store/store';

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/** Warnings for hardscape elements (easement, root zone, driveway), shared by the list and the selection card. */
export function useHardscapeWarnings() {
  const s = useApp((x) => x);
  const cfg = s.engine.hardscape;
  const ctx = useMemo(
    () => ({
      easements: s.site.easements.map((e) => ({ id: e.id, label: e.label, polygon: e.polygon })),
      trees: [
        ...s.site.contextObjects.filter((o) => o.kind === 'tree' && o.position).map((o) => ({ id: o.id, name: o.name, x: o.position![0], y: o.position![1], canopyWidth: o.canopyWidth ?? 10 })),
        ...s.instances
          .filter((i) => i.existing)
          .map((i) => {
            const sp = s.library.species.find((x) => x.id === i.speciesId);
            return { id: i.id, name: `existing ${sp?.common ?? 'plant'}`, x: i.position[0], y: i.position[1], canopyWidth: i.currentWidth ?? sp?.matureWidth ?? 8 };
          }),
      ],
      lot: s.site.lot,
    }),
    [s.site, s.instances, s.library],
  );
  return (id: string) => {
    const el = s.hardscape.find((e) => e.id === id);
    return el ? hardscapeWarnings(el, s.hardscape, ctx, cfg) : [];
  };
}

export function HardscapeInspector() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const cfg = s.engine.hardscape;
  const matById = useMemo(() => new Map(s.materials.map((m) => [m.id, m])), [s.materials]);
  const sel = s.hardscape.find((e) => e.id === s.selectedElementId);
  const warningsFor = useHardscapeWarnings();
  if (!sel) return null;
  const num = (v: number, set: (n: number) => void, step = 0.5, disabled = !edit) => (
    <input type="number" step={step} min={0} value={Number(v.toFixed(2))} disabled={disabled} onChange={(e) => set(Number(e.target.value))} />
  );
  const nudge = (dx: number, dy: number) => {
    if (!sel) return;
    s.beginGesture();
    s.moveElementBy(sel.id, dx, dy);
  };

  return (
    <div className="inspector">
      <h3>{sel.name ?? cfg.types[sel.type].label}</h3>
      <p className="muted small">
        {cfg.types[sel.type].label}{sel.existing ? ' · existing' : ''}{sel.removed ? ' · removed in this scenario' : ''}
      </p>
      {(() => {
        const m = elementMetrics(sel, matById.get(sel.materialId)!, cfg);
        const w = warningsFor(sel.id);
        return (
          <>
            {w.length > 0 && <ul className="warnings">{w.map((x) => <li key={x.message}>{x.message}</li>)}</ul>}
            <table className="tbl kv">
              <tbody>
                <tr><td>Area</td><td>{fmt(m.areaSf, 1)} sq ft</td></tr>
                <tr><td>Edge</td><td>{fmt(m.edgeLf, 1)} lin ft</td></tr>
                <tr><td>Surface</td><td>{fmt(m.surfaceCuYd, 2)} cu yd at {sel.depthIn} in</td></tr>
                <tr><td>Base</td><td>{fmt(m.baseCuYd, 2)} cu yd at {matById.get(sel.materialId)?.baseDepthIn} in</td></tr>
              </tbody>
            </table>
          </>
        );
      })()}
      <div className="grid2">
        <label>Material
          <select disabled={!edit || sel.existing} value={sel.materialId} onChange={(e) => s.setElementMaterial(sel.id, e.target.value)}>
            {s.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>Color
          <span className="row">
            <input type="color" disabled={!edit} value={sel.color ?? matById.get(sel.materialId)?.color ?? '#aaaaaa'} onChange={(e) => s.updateElement(sel.id, { color: e.target.value }, { silent: false })} />
            <button disabled={!edit || !sel.color} onClick={() => s.updateElement(sel.id, { color: undefined })}>Use material color</button>
          </span>
        </label>
        <label>Surface depth (in){num(sel.depthIn, (n) => s.updateElement(sel.id, { depthIn: n }), 0.5, !edit || sel.existing)}</label>
        <label>Height (ft){num(sel.height, (n) => s.updateElement(sel.id, { height: n }), 0.5, !edit || sel.existing)}</label>
        {cfg.types[sel.type].shape === 'line' && (
          <label>{sel.type === 'path' ? 'Width (ft)' : 'Thickness (ft)'}{num(sel.width, (n) => s.updateElement(sel.id, { width: Math.max(0.1, n) }), 0.25, !edit || sel.existing)}</label>
        )}
      </div>
      {!sel.existing && edit && (
        <div className="row wrap">
          <span className="muted small">Nudge {formatFeetInches(s.snap)}</span>
          <button onClick={() => nudge(-s.snap, 0)}>←</button>
          <button onClick={() => nudge(s.snap, 0)}>→</button>
          <button onClick={() => nudge(0, s.snap)}>↑ rear</button>
          <button onClick={() => nudge(0, -s.snap)}>↓ street</button>
        </div>
      )}
      <div className="row">
        <button disabled={!edit} onClick={() => s.deleteElement(sel.id)}>{sel.existing ? (sel.removed ? 'Keep it' : 'Remove it') : 'Delete'}</button>
      </div>
    </div>
  );
}
