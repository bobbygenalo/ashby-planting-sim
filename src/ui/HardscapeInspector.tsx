import { useMemo } from 'react';
import { CROPS } from '../data/cropLibrary';
import { activeCrop, planOf, seasonOf } from '../engine/crops';
import { doyToMonthDay } from '../engine/time';
import { isRectangle } from '../engine/geometry';
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
                {!cfg.types[sel.type].furniture && <tr><td>Surface</td><td>{fmt(m.surfaceCuYd, 2)} cu yd at {sel.depthIn} in</td></tr>}
                {!cfg.types[sel.type].furniture && <tr><td>Base</td><td>{fmt(m.baseCuYd, 2)} cu yd at {matById.get(sel.materialId)?.baseDepthIn} in</td></tr>}
              </tbody>
            </table>
          </>
        );
      })()}
      <div className="grid2">
        {!cfg.types[sel.type].furniture && <label>Material
          <select disabled={!edit || sel.existing} value={sel.materialId} onChange={(e) => s.setElementMaterial(sel.id, e.target.value)}>
            {s.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>}
        <label>Color
          <span className="row">
            <input type="color" disabled={!edit} value={sel.color ?? matById.get(sel.materialId)?.color ?? '#aaaaaa'} onChange={(e) => s.updateElement(sel.id, { color: e.target.value }, { silent: false })} />
            <button disabled={!edit || !sel.color} onClick={() => s.updateElement(sel.id, { color: undefined })}>Use material color</button>
          </span>
        </label>
        {!cfg.types[sel.type].furniture && <label>Surface depth (in){num(sel.depthIn, (n) => s.updateElement(sel.id, { depthIn: n }), 0.5, !edit || sel.existing)}</label>}
        {!cfg.types[sel.type].furniture && <label>Height (ft){num(sel.height, (n) => s.updateElement(sel.id, { height: n }), 0.5, !edit || sel.existing)}</label>}
        {cfg.types[sel.type].shape === 'line' && (
          <label>{sel.type === 'path' ? 'Width (ft)' : 'Thickness (ft)'}{num(sel.width, (n) => s.updateElement(sel.id, { width: Math.max(0.1, n) }), 0.25, !edit || sel.existing)}</label>
        )}
      </div>
      {sel.type === 'raisedBed' && (() => {
        const beds = s.hardscape.filter((e) => e.type === 'raisedBed' && !e.removed);
        const plan = planOf(sel, CROPS, Math.max(0, beds.findIndex((b) => b.id === sel.id)));
        const month = doyToMonthDay(s.doy)[0];
        const now = activeCrop(plan, CROPS, month, s.engine.crops);
        const set = (season: 'cool' | 'warm', id: string) => s.updateElement(sel.id, { crops: { ...plan, [season]: id } });
        const opts = (season: 'cool' | 'warm') => CROPS.filter((c) => c.season === season || c.season === 'any');
        const label = { growing: 'growing', harvest: 'harvest', spent: 'spent, about to be pulled', dormant: 'cut back for winter', bare: '' };
        return (
          <>
            <h4>What grows here</h4>
            <div className="grid2">
              <label>Cool season (Nov to Apr)
                <select disabled={!edit} value={plan.cool} onChange={(e) => set('cool', e.target.value)}>
                  {opts('cool').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>Warm season (May to Oct)
                <select disabled={!edit} value={plan.warm} onChange={(e) => set('warm', e.target.value)}>
                  {opts('warm').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
            <p className="muted small">
              {now ? <>In {seasonOf(month, s.engine.crops)} season now: <b>{now.crop.name}</b>, {label[now.stage.phase]}.</> : 'Nothing standing this month: the bed is bare between crops.'}{' '}
              Each crop is sown at the start of its season, harvested, pulled and replaced; months are general estimates for coastal Southern California. Move the sun date to watch the beds turn over.
            </p>
          </>
        );
      })()}
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
        {cfg.types[sel.type].shape === 'polygon' && !sel.existing && isRectangle(sel.points) && (
          <>
            <button disabled={!edit} onClick={() => s.rotateElement(sel.id, 15)} title="Turn 15° counterclockwise about its center" aria-label="Rotate 15 degrees counterclockwise">↺ 15°</button>
            <button disabled={!edit} onClick={() => s.rotateElement(sel.id, -15)} title="Turn 15° clockwise about its center" aria-label="Rotate 15 degrees clockwise">↻ 15°</button>
            <button disabled={!edit} onClick={() => s.rotateElement(sel.id)} title="Turn a quarter turn about its center (press R)">Rotate 90°</button>
          </>
        )}
        <button disabled={!edit} onClick={() => s.deleteElement(sel.id)}>{sel.existing ? (sel.removed ? 'Keep it' : 'Remove it') : 'Delete'}</button>
      </div>
    </div>
  );
}
