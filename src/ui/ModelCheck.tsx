import { useMemo } from 'react';
import { checkPrintedDimensions } from '../engine/site';
import { formatFeetInches } from '../engine/units';
import { useApp } from '../store/store';

/** How well the 3D model matches the printed plans, plus the assumptions behind the site. */
export function ModelCheck() {
  const site = useApp((s) => s.site);
  const checks = useMemo(() => checkPrintedDimensions(site, 1), [site]);
  const failing = checks.filter((c) => !c.ok).length;
  return (
    <>
      <h2>Model check</h2>
      <p className="muted small">Printed dimensions against this model (tolerance 1 in). {failing === 0 ? 'All match.' : `${failing} do not match.`}</p>
      <details>
        <summary>Show the {checks.length} checks</summary>
        <table className="tbl">
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className={c.ok ? '' : 'bad'}>
                <td>{c.label}</td>
                <td className="num">{formatFeetInches(c.measured, 16)}</td>
                <td className="num">{c.ok ? '✓' : '✗'} {c.deltaInches >= 0 ? '+' : ''}{c.deltaInches.toFixed(2)}"</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <h2>Site assumptions</h2>
      <ul className="assume">
        {site.assumptions.map((a) => (
          <li key={a.id}>
            {a.estimate && <span className="tag">estimate</span>} {a.text}
          </li>
        ))}
      </ul>
    </>
  );
}
