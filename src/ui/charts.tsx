import { useState } from 'react';

export interface Series {
  id: string;
  name: string;
  /** CSS color, normally a categorical token such as var(--series-1). */
  color: string;
  values: number[];
}

const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmt = (n: number) => Math.round(n).toLocaleString();

/** Round a maximum up to a tidy axis ceiling. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Stacked monthly bars with a legend, a hover tooltip, and a table view. Segments are separated by a
 * 2px surface-colored gap, and each series keeps its color for its identity (not its rank).
 */
export function MonthlyBars({ series, unit, title }: { series: Series[]; unit: string; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 520, H = 190, L = 44, R = 8, T = 10, B = 24;
  const totals = MONTHS.map((_, m) => series.reduce((a, s) => a + s.values[m], 0));
  const max = niceMax(Math.max(...totals, 0));
  const plotW = W - L - R, plotH = H - T - B;
  const bw = plotW / 12;
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const empty = totals.every((t) => t === 0);

  return (
    <figure className="chart">
      <figcaption>{title}</figcaption>
      {series.length > 1 && (
        <ul className="chart-legend">
          {series.map((s) => (
            <li key={s.id}><i style={{ background: s.color }} />{s.name}</li>
          ))}
        </ul>
      )}
      {empty ? (
        <p className="muted small">Nothing to show yet: place plants or draw lawn.</p>
      ) : (
        <div className="chart-wrap" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}, by month`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" />
                <text x={L - 6} y={y(t) + 3} textAnchor="end" className="axis">{fmt(t)}</text>
              </g>
            ))}
            {MONTHS.map((label, m) => {
              let acc = 0;
              return (
                <g key={m} onMouseEnter={() => setHover(m)}>
                  <rect x={L + m * bw} y={T} width={bw} height={plotH} fill="transparent" />
                  {series.map((s, si) => {
                    const v = s.values[m];
                    if (v <= 0) return null;
                    const top = y(acc + v), bottom = y(acc);
                    acc += v;
                    const h = Math.max(0, bottom - top - (si > 0 ? 2 : 0));
                    return <rect key={s.id} x={L + m * bw + bw * 0.18} y={top} width={bw * 0.64} height={h} fill={s.color} opacity={hover === null || hover === m ? 1 : 0.55} />;
                  })}
                  <text x={L + m * bw + bw / 2} y={H - 8} textAnchor="middle" className="axis">{label}</text>
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="chart-tip" style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%` }}>
              <b>{MONTH_NAMES[hover]}</b>: {fmt(totals[hover])} {unit}
              {series.filter((s) => s.values[hover] > 0).map((s) => (
                <div key={s.id}><i style={{ background: s.color }} />{s.name} {fmt(s.values[hover])}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <button className="link" onClick={() => setTable(!table)}>{table ? 'Hide table' : 'Show table'}</button>
      {table && (
        <table className="tbl">
          <thead>
            <tr><th>Month</th>{series.map((s) => <th key={s.id} className="num">{s.name}</th>)}<th className="num">Total</th></tr>
          </thead>
          <tbody>
            {MONTH_NAMES.map((n, m) => (
              <tr key={n}><td>{n.slice(0, 3)}</td>{series.map((s) => <td key={s.id} className="num">{fmt(s.values[m])}</td>)}<td className="num">{fmt(totals[m])}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
