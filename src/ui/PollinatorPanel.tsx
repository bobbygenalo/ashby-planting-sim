import { useMemo } from 'react';
import { bloomCalendar, gapSuggestions, pollinatorSummary, pollinatorWarnings } from '../engine/pollinator';
import type { SunHoursResult } from '../engine/sunhours';
import { zoneStats } from '../engine/sunhours';
import { usePlaced, zoneIdAt } from '../store/derived';
import { useApp } from '../store/store';

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '0%');

export function PollinatorPanel({ growing }: { growing: SunHoursResult | null }) {
  const s = useApp((x) => x);
  const plants = usePlaced();
  const cal = useMemo(() => bloomCalendar(plants, s.water.pollinator), [plants, s.water]);
  const sum = useMemo(() => pollinatorSummary(plants), [plants]);
  const maxScore = Math.max(1, ...cal.scores);
  const zoneNames = useMemo(() => Object.fromEntries(s.site.zones.map((z) => [z.id, z.name])), [s.site]);
  const warnings = useMemo(
    () =>
      pollinatorWarnings(plants, (x, y) => zoneIdAt(s.site.zones, x, y), zoneNames, new Set(Object.keys(s.playZones).filter((k) => s.playZones[k]))),
    [plants, s.site, zoneNames, s.playZones],
  );
  const zoneSun = useMemo(
    () => (growing ? zoneStats(growing, s.engine.sun.classes).filter((z) => z.id !== 'lot').map((z) => ({ id: z.id, name: z.name, meanHours: z.meanHours, area: z.area })) : []),
    [growing, s.engine],
  );
  const suggestions = useMemo(() => {
    const ids = new Set(plants.map((p) => p.species.id));
    const cats = [...new Set(plants.map((p) => p.species.wucols as string))];
    return cal.gaps.map((m) => ({
      month: m,
      list: gapSuggestions({ month: m, library: s.library.species, placedSpeciesIds: ids, placedCategories: cats, zones: zoneSun, growth: s.engine.growth, limit: s.water.pollinator.topSuggestions }),
    }));
  }, [cal.gaps, plants, s.library, zoneSun, s.engine, s.water]);

  if (plants.length === 0) {
    return <p className="muted small">Place plants to see the bloom calendar and pollinator summary.</p>;
  }

  return (
    <div className="pollpanel">
      <h2>Pollinator summary</h2>
      <div className="kpi">
        <div><b>{pct(sum.byValue.high.plants, sum.plants)}</b><span>of plants high value ({sum.byValue.high.plants} of {sum.plants})</span></div>
        <div><b>{pct(sum.nativePlants, sum.plants)}</b><span>California native ({pct(sum.nativeCanopySf, sum.canopySf)} of canopy)</span></div>
        <div><b>{sum.larvalHostPlants}</b><span>larval host plants</span></div>
      </div>
      <table className="tbl">
        <thead><tr><th>Value</th><th className="num">Plants</th><th className="num">Canopy sq ft</th><th className="num">Canopy share</th></tr></thead>
        <tbody>
          {(['high', 'moderate', 'low'] as const).map((v) => (
            <tr key={v}><td>{v}</td><td className="num">{sum.byValue[v].plants}</td><td className="num">{Math.round(sum.byValue[v].canopySf)}</td><td className="num">{pct(sum.byValue[v].canopySf, sum.canopySf)}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="small"><b>Groups served:</b> {sum.groups.length ? sum.groups.join(', ') : 'none'}.</p>

      {warnings.length > 0 && <ul className="warnings">{warnings.map((w) => <li key={w.message}>{w.message}</li>)}</ul>}

      <h2>Bloom calendar</h2>
      <p className="small muted">Plants at their size in year {(s.timelineMonth / 12).toFixed(1)}. Darker cells are higher pollinator value; red months have no high-value plant in bloom.</p>
      <div className="scroll">
        <table className="bloom">
          <thead><tr><th>Species</th>{MONTHS.map((m, i) => <th key={i} title={MONTH_FULL[i]}>{m}</th>)}</tr></thead>
          <tbody>
            {cal.rows.map((r) => (
              <tr key={r.species.id}>
                <td title={r.species.botanical}>{r.species.common}{r.count > 1 ? ` ×${r.count}` : ''}</td>
                {MONTHS.map((_, i) => (
                  <td key={i} className={r.species.bloomMonths.includes(i + 1) ? `cell-${r.species.pollinator.value}` : ''} title={r.species.bloomMonths.includes(i + 1) ? `${r.species.common} blooms in ${MONTH_FULL[i]} (${r.species.pollinator.value} value)` : undefined}>
                    {r.species.bloomMonths.includes(i + 1) ? '●' : ''}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td><b>Score</b></td>
              {cal.scores.map((v, i) => (
                <td key={i} className={cal.gaps.includes(i + 1) ? 'gap' : ''} title={`${MONTH_FULL[i]}: ${v.toFixed(1)}`}>
                  <div className="bar" style={{ height: 34, width: 10, margin: '0 auto', display: 'flex', alignItems: 'flex-end' }}>
                    <span style={{ height: `${(v / maxScore) * 100}%`, width: '100%' }} />
                  </div>
                </td>
              ))}
            </tr>
            <tr><td>Gap</td>{MONTHS.map((_, i) => <td key={i} className={cal.gaps.includes(i + 1) ? 'gap' : ''}>{cal.gaps.includes(i + 1) ? '!' : ''}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="small">
        {cal.gaps.length === 0 ? <b>Every month has a high-value plant in bloom.</b> : <><b>Gaps:</b> {cal.gaps.map((m) => MONTH_FULL[m - 1]).join(', ')}.</>}
      </p>

      {suggestions.length > 0 && (
        <>
          <h2>Ways to fill the gaps</h2>
          <p className="small muted">High-value plants that bloom in the gap month, fit the light in a yard zone, and sit within one water-use step of what you already water.</p>
          {suggestions.map(({ month, list }) => (
            <div key={month} className="gapbox">
              <b>{MONTH_FULL[month - 1]}</b>
              {list.length === 0 ? <p className="muted small">No match in the library for this scenario's light and water.</p> : (
                <ul className="species">
                  {list.map((g) => (
                    <li key={g.species.id}>
                      <b>{g.species.common}</b> <span className="muted small"><i>{g.species.botanical}</i></span>
                      <div className="small muted">{g.species.wucols} water, {g.species.sun} sun · fits {g.zones.map((z) => `${z.name} (${z.hours.toFixed(1)} h)`).join(', ')}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
