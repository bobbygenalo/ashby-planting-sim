import { useCallback, useState } from 'react';
import { GrowthStages } from '../scene/GrowthStages';
import { doyToMonthDay, monthName } from '../engine/time';
import { useApp } from '../store/store';
import { Dialog } from './Dialog';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** One plant, planted and at several ages, season by season, in 3D you can turn: how it will look as it grows. */
export function GrowthStagesDialog() {
  const id = useApp((s) => s.growthStagesFor);
  const setFor = useApp((s) => s.setGrowthStagesFor);
  // A stable function: a new one each render would make the dialog take focus back every time the store changed.
  const close = useCallback(() => setFor(null), [setFor]);
  const library = useApp((s) => s.library);
  const cfg = useApp((s) => s.engine.growthStages);
  const doy = useApp((s) => s.doy);
  const [month, setMonth] = useState(() => doyToMonthDay(doy)[0]);
  const [side, setSide] = useState(false);
  const [others, setOthers] = useState<string[]>([]);
  const sp = library.species.find((x) => x.id === id);
  if (!sp) return null;
  // The plant opened, plus up to maxPlants - 1 more to compare it with.
  const room = cfg.maxPlants - 1;
  const chosen = others.map((id) => library.species.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x && x.id !== sp.id);
  const list = [sp, ...chosen];
  const slots = chosen.length < room ? [...chosen.map((x) => x.id), ''] : chosen.map((x) => x.id);
  const setSlot = (slot: number, id: string) => setOthers(id === '' ? chosen.map((x) => x.id).filter((_, i) => i !== slot) : slots.map((cur, i) => (i === slot ? id : cur)).filter((x) => x !== ''));
  return (
    <Dialog title={`${sp.common}: growth stages`} onClose={close} wide>
      <div className="row wrap" style={{ margin: '8px 0' }}>
        <label>Season
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
            {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        {slots.map((cur, slot) => (
          <label key={slot}>{slot === 0 ? 'Compare with' : 'and'}
            <select value={cur} onChange={(e) => setSlot(slot, e.target.value)} aria-label={`Compare with another plant${slot > 0 ? `, ${slot + 1}` : ''}`}>
              <option value="">{slot === 0 ? 'Nothing' : 'Remove'}</option>
              {library.species.filter((x) => x.id !== sp.id && (x.id === cur || !slots.includes(x.id))).map((x) => <option key={x.id} value={x.id}>{x.common}</option>)}
            </select>
          </label>
        ))}
        <label className="check"><input type="checkbox" checked={side} onChange={(e) => setSide(e.target.checked)} />Side view</label>
      </div>
      <div className="stagescanvas">
        <GrowthStages species={list} years={cfg.years} month={month} pitch={side ? cfg.sidePitch : cfg.anglePitch} />
      </div>
      <p className="muted small">
        Each plant at its age from planting, in {monthName(month)}: leaves, bloom color and fruit follow the month. Drag to turn the view, scroll to zoom. {sp.common} reaches {sp.matureHeight} ft by {sp.matureWidth} ft in about {sp.yearsToMaturity} years.
      </p>
    </Dialog>
  );
}
