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
  const [other, setOther] = useState('');
  const sp = library.species.find((x) => x.id === id);
  if (!sp) return null;
  const compare = library.species.find((x) => x.id === other);
  const list = compare ? [sp, compare] : [sp];
  return (
    <Dialog title={`${sp.common}: growth stages`} onClose={close} wide>
      <div className="row wrap" style={{ margin: '8px 0' }}>
        <label>Season
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
            {MONTHS.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <label>Compare with
          <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Compare with another plant">
            <option value="">Nothing</option>
            {library.species.filter((x) => x.id !== sp.id).map((x) => <option key={x.id} value={x.id}>{x.common}</option>)}
          </select>
        </label>
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
