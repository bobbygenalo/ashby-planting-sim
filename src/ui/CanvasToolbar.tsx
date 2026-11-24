import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/store';

const LAYERS = [
  ['sunHours', 'Sun-hours overlay'],
  ['dimensions', 'Dimensions'],
  ['setbacks', 'Setback lines'],
  ['easements', 'Easement'],
  ['context', 'Trees, fences, pole'],
  ['bloom', 'Bloom color on plants'],
  ['fruit', 'Fruit on trees'],
  ['detail', 'Leaves and flowers (detailed plants)'],
  ['crops', 'Raised-bed crops'],
  ['life', 'People, dogs and bees'],
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
      <div className="viewbar" role="group" aria-label="Camera view">
        {s.site.views.map((v, i) => (
          <button key={v.id} className={s.view === v.id ? 'on' : ''} aria-pressed={s.view === v.id} aria-keyshortcuts={String(i + 1)} title={v.kind === 'walk' ? `${v.label} (press ${i + 1}, or W from any other view)` : `${v.label} (press ${i + 1})`} onClick={() => s.setView(v.id)}>
            {v.label}<kbd className="key">{i + 1}</kbd>
          </button>
        ))}
      </div>
      <div className="toolbar-right">
      <button disabled={!edit} onClick={() => s.setQuickFind(true)} title="Find a plant or hardscape to place (press /)" aria-keyshortcuts="/">Find<kbd className="key">/</kbd></button>
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
            {s.layers.life && (
              <div className="lifebox">
                <label>People
                  <select value={s.lifeSettings.people} onChange={(e) => s.setLifeSettings({ people: Number(e.target.value) })} aria-label="People">
                    {Array.from({ length: s.engine.life.people.max + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label>Dogs
                  <select value={s.lifeSettings.dogs} onChange={(e) => s.setLifeSettings({ dogs: Number(e.target.value) })} aria-label="Dogs">
                    {Array.from({ length: s.engine.life.dogs.max + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label className="check"><input type="checkbox" checked={s.lifeSettings.bees} onChange={(e) => s.setLifeSettings({ bees: e.target.checked })} />Hive and bees</label>
              </div>
            )}
            <label className="check">
              <input type="checkbox" checked={s.aduEnabled} disabled={!edit} onChange={(e) => s.setAduEnabled(e.target.checked)} />
              Model the ADU{!edit && ' (locked)'}
            </label>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
