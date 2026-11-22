import { useEffect, useRef, useState } from 'react';
import { formatFeetInches } from '../engine/units';
import { useApp } from '../store/store';

const LAYERS = [
  ['sunHours', 'Sun-hours overlay'],
  ['dimensions', 'Dimensions'],
  ['setbacks', 'Setback lines'],
  ['easements', 'Easement'],
  ['context', 'Trees, fences, pole'],
  ['bloom', 'Bloom color on plants'],
  ['conflicts', 'Conflict rings'],
  ['suggestions', 'Placement heatmap'],
] as const;

/** Camera view, layers and the measure tool: the controls for looking at the yard, over its top-left corner. */
export function CanvasToolbar() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div className="canvasbar">
      <label className="pillctl">View
        <select value={s.view} onChange={(e) => s.setView(e.target.value)} aria-label="Camera view">
          {s.site.views.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <div className="layers" ref={box}>
        <button aria-expanded={open} onClick={() => setOpen(!open)}>Layers ▾</button>
        {open && (
          <div className="popover" role="group" aria-label="Layers">
            {LAYERS.map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={s.layers[k]} onChange={(e) => s.setLayer(k, e.target.checked)} />
                {label}
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={s.aduEnabled} disabled={!edit} onChange={(e) => s.setAduEnabled(e.target.checked)} />
              Model the ADU{!edit && ' (locked)'}
            </label>
          </div>
        )}
      </div>
      <button className={s.measureActive ? 'on' : ''} onClick={() => s.setMeasureActive(!s.measureActive)}>{s.measureActive ? 'Measuring: click 2 points' : 'Measure'}</button>
      <label className="pillctl">Snap
        <select value={s.snap} onChange={(e) => s.setSnap(Number(e.target.value))} aria-label="Snap grid">
          {s.engine.scene.snapOptionsFt.map((v) => <option key={v} value={v}>{formatFeetInches(v)}</option>)}
        </select>
      </label>
    </div>
  );
}
