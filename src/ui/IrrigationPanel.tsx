import { useMemo } from 'react';
import { FAMILY_LABEL, METHOD_LABEL } from '../engine/irrigation';
import { runsAt, runsOnDay, weekdayFor } from '../engine/irrigationSchedule';
import { doyToMonthDay } from '../engine/time';
import { useIrrigationPlan, useIrrigationSchedule, useShowRun } from '../store/derived';
import { useApp } from '../store/store';
import { MonthlyBars, type Series } from './charts';

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** A minute of the day as a clock time: 5:08 am. */
export const clock = (min: number) => {
  const m = Math.round(min) % 1440;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

/** How much water the scenario needs through its irrigation, and when each valve runs (the Water menu's layer shows it flowing). */
function WaterNeedAndSchedule() {
  const plan = useIrrigationPlan();
  const schedule = useIrrigationSchedule();
  const engine = useApp((s) => s.engine);
  const doy = useApp((s) => s.doy);
  const minutes = useApp((s) => s.minutes);
  const cfg = engine.irrigation;
  const [month, day] = doyToMonthDay(doy);
  const weekday = weekdayFor(engine.referenceYear, month, day);
  const series: Series[] = useMemo(() => {
    if (!plan || !schedule) return [];
    const out: Series[] = plan.valves.map((v, i) => ({ id: v.id, name: `${v.id} ${v.hydrozoneName}`, color: v.color, values: schedule.valves[i].monthlyGal }));
    if (schedule.handAnnualGal > 0) out.push({ id: 'hand', name: 'By hand', color: 'var(--series-other)', values: schedule.handMonthlyGal });
    return out;
  }, [plan, schedule]);
  if (!plan || !schedule || schedule.totalAnnualGal <= 0) return null;
  const peak = schedule.totalMonthlyGal.reduce((b, g, m) => (g > schedule.totalMonthlyGal[b] ? m : b), 0);
  const today = runsOnDay(schedule, month, weekday, cfg);
  const now = runsAt(today, minutes);
  const { jump } = useShowRun();
  return (
    <>
      <h3>Water this scenario needs</h3>
      <div className="kpi">
        <div><b>{fmt(schedule.totalAnnualGal)}</b><span>gallons a year</span></div>
        <div><b>{fmt(schedule.valveAnnualGal)}</b><span>through the valves</span></div>
        <div><b>{fmt(schedule.handAnnualGal)}</b><span>by hand</span></div>
      </div>
      <p className="small muted">
        Applied water for the plants at the timeline year, the lawn and the raised beds{plan.beds.some((b) => b.method !== 'hand') ? ' on drip' : ''}: reference ET x plant factor x 0.62 x area / efficiency, the same method as the Water & soil figures. Busiest month: {MONTH_NAMES[peak]}, {fmt(schedule.totalMonthlyGal[peak])} gallons. Raised-bed crops use a vegetable plant factor of {cfg.bed.plantFactor} (an estimate).
      </p>
      <MonthlyBars series={series} unit="gal" title="Water the scenario needs, by month" />
      <h3>When it runs in {MONTH_NAMES[month - 1]}</h3>
      <table className="tbl">
        <thead><tr><th>Valve</th><th>Days</th><th>Starts</th><th>Each run</th><th>Gal a run</th></tr></thead>
        <tbody>
          {schedule.valves.map((v) => {
            const m = v.months[month - 1];
            if (m.runsPerWeek === 0) return <tr key={v.valveId}><td><span className="irrsw" />{v.valveId}</td><td colSpan={4} className="muted">Not needed this month</td></tr>;
            const first = runsOnDay(schedule, month, m.weekdays[0], cfg).find((r) => r.valveId === v.valveId);
            return (
              <tr key={v.valveId}>
                <td><span className="irrsw" />{v.valveId}</td>
                <td>{m.weekdays.map((d) => DAYS[d]).join(', ')}</td>
                <td>{first ? clock(first.startMin) : ''}</td>
                <td>{fmt(m.minutesPerRun, m.minutesPerRun < 10 ? 1 : 0)} min</td>
                <td>{fmt(m.galPerRun, m.galPerRun < 1 ? 2 : m.galPerRun < 10 ? 1 : 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small">
        <b>{DAYS[weekday]} {MONTH_NAMES[month - 1].slice(0, 3)} {day}:</b>{' '}
        {today.length === 0 ? 'no valve runs.' : today.map((r) => `${r.valveId} ${clock(r.startMin)} to ${clock(r.endMin)}`).join(' · ')}
        {now.length > 0 && <> {'\u2014'} <b>running now ({clock(minutes)}): {now.map((r) => r.valveId).join(', ')}</b></>}
      </p>
      <div className="row wrap">
        <button type="button" onClick={jump}>Show it running</button>
      </div>
      <p className="small muted">
        Valves run one after another from {clock(cfg.schedule.windows[0].startMin)}, in short runs for spray and longer ones for drip, and never between 9 am and 4 pm. Thirstier plants and raised beds run more often. With the layout on, the lines pulse and the emitters, bubblers and sprays flow while a valve runs: move the sun time into a run to watch. {cfg.schedule.windowNote} Unverified guidance, not a controller program.
      </p>
      {schedule.warnings.map((w, i) => <p key={i} className="small"><span className="pill warn">check</span> {w}</p>)}
    </>
  );
}


/** Summary of the suggested irrigation layout (the "Irrigation layout" layer in the yard). */
export function IrrigationPanel() {
  const on = useApp((s) => s.layers.irrigation);
  const setLayer = useApp((s) => s.setLayer);
  const bedsOn = useApp((s) => s.layers.irrigationBeds);
  const cfg = useApp((s) => s.engine.irrigation);
  const sources = useApp((s) => s.site.irrigation?.sources ?? []);
  const plan = useIrrigationPlan();
  if (!plan || sources.length === 0) return null;
  const t = plan.totals;
  const sizes = cfg.lineSizes.filter((l) => t.linesFt[String(l.inches)]);
  const warns = plan.warnings.filter((w) => w.severity === 'warn');
  const infos = plan.warnings.filter((w) => w.severity === 'info');
  return (
    <>
      <h2>Irrigation layout (suggested)</h2>
      <p className="small muted">
        For plants and lawn{plan.beds.length > 0 ? (plan.beds[0].method === 'hand' ? `; the ${plan.beds.length} raised bed${plan.beds.length === 1 ? ' is' : 's are'} left to hand watering` : `, and drip in all ${plan.beds.length} raised bed${plan.beds.length === 1 ? '' : 's'}`) : ''}. Valves sit at a manifold by the hose bib; lines take the cheapest route round buildings and raised beds and avoid paving. Sized for plants at the timeline year. Guidance only, not a design.
      </p>
      <label className="check">
        <input type="checkbox" checked={on} onChange={(e) => setLayer('irrigation', e.target.checked)} />
        Show the layout in the yard
      </label>
      <label className="check">
        <input type="checkbox" checked={bedsOn} onChange={(e) => setLayer('irrigationBeds', e.target.checked)} />
        Include raised beds (drip in every bed)
      </label>
      <p className="small muted">
        Water access{sources.length > 1 ? 'es' : ''}: {sources.map((s, i) => (
          <span key={s.id}>{i > 0 ? '; ' : ''}{s.label}{s.estimate && <span className="pill warn" style={{ marginLeft: 6 }}>estimate</span>}</span>
        ))}. Each plant, bed and lawn is served by the access with the cheaper route to it. Set the real spots in <code>site.json</code> under <code>irrigation</code>.
      </p>
      {plan.valves.length === 0 ? (
        <p className="small muted">Nothing here needs lines yet: add plants outside raised beds, a lawn, or include the raised beds.</p>
      ) : (
        <>
          <div className="kpi">
            <div><b>{t.zones}</b><span>hydrozone{t.zones === 1 ? '' : 's'}</span></div>
            <div><b>{t.valves}</b><span>valve{t.valves === 1 ? '' : 's'}</span></div>
            <div><b>{fmt(t.emitters + t.bubblers + t.sprayHeads + t.rotorHeads)}</b><span>emitters, bubblers and heads</span></div>
          </div>
          <table className="tbl">
            <thead><tr><th>Valve</th><th>Waters</th><th>Devices</th><th>gal/hr</th><th>Longest run</th></tr></thead>
            <tbody>
              {plan.valves.map((v) => (
                <tr key={v.id}>
                  <td><span className="irrsw" />{v.id}</td>
                  <td>{v.hydrozoneName}, {FAMILY_LABEL[v.family].toLowerCase()}{v.bedIds.length > 0 ? ` · ${v.bedIds.length} bed${v.bedIds.length === 1 ? '' : 's'}` : v.plantIds.length > 0 ? ` · ${v.plantIds.length} plant${v.plantIds.length === 1 ? '' : 's'}` : ' · lawn'}</td>
                  <td>{v.devices.length}</td>
                  <td>{fmt(v.gph)}</td>
                  <td>{fmt(v.longestRunFt)} ft</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Line and parts list</h3>
          <table className="tbl tight">
            <thead><tr><th>Part</th><th>Qty</th><th>Price</th></tr></thead>
            <tbody>
              {plan.parts.map((p) => (
                <tr key={p.id}><td>{p.label}</td><td>{fmt(p.quantity)}{p.unit === 'ft' ? ' ft' : ''}</td><td>${fmt(p.total)}</td></tr>
              ))}
              <tr><td><b>Total</b></td><td /><td><b>${fmt(plan.cost)}</b></td></tr>
            </tbody>
          </table>
          <p className="small muted">
            Lines by size: {sizes.map((l) => `${fmt(t.linesFt[String(l.inches)])} ft of ${l.label}`).join(', ')}. {t.inlineFt > 0 ? `${fmt(t.inlineFt)} ft of inline drip. ` : ''}Peak flow if every valve ran at once: {fmt(t.gph)} gal/hr (valves run one at a time; the supply is assumed to give {cfg.supplyGph}).
          </p>
          <p className="small muted"><span className="pill warn">stand-in prices</span> {cfg.prices.note} Every coefficient is unverified guidance (<code>irrigation</code> in <code>engine.json</code>).</p>
        </>
      )}
      {(warns.length > 0 || infos.length > 0) && (
        <ul className="small">
          {warns.map((w, i) => <li key={`w${i}`}><span className="pill warn">check</span> {w.text}</li>)}
          {infos.map((w, i) => <li key={`i${i}`}>{w.text}</li>)}
        </ul>
      )}
      <WaterNeedAndSchedule />
      {plan.hand.length > 0 && (
        <>
          <h3>Hand-watered or dry ({plan.hand.length})</h3>
          <ul className="small">
            {plan.hand.map((r) => <li key={r.id}><b>{r.label}</b> ({METHOD_LABEL[r.method].toLowerCase()}): {r.reason}</li>)}
          </ul>
        </>
      )}
    </>
  );
}
