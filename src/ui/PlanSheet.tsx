import { useEffect, useMemo } from 'react';
import { bbox } from '../engine/geometry';
import { footprint, takeoff } from '../engine/hardscape';
import { feetToInches, northAngleDeg, planKey, scaleBarFeet, SHEET_SCALE_FT_PER_IN } from '../engine/plansheet';
import { plantSchedule } from '../engine/schedule';
import { activeStructures } from '../engine/site';
import { formatFeetInches } from '../engine/units';
import { usePlaced } from '../store/derived';
import { useApp } from '../store/store';

const M = { left: 13, right: 13, top: 12, bottom: 14 };
const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

/** A scaled top-down plan for contractors, designers and nurseries (OUT-2). Prints at 1 in = 20 ft. */
export function PlanSheet() {
  const s = useApp((x) => x);
  const plants = usePlaced();
  const { width: W, depth: D } = s.site.lot;
  const Y = (y: number) => D - y; // the rear of the lot is at the top of the sheet
  const structures = activeStructures(s.site, { aduEnabled: s.aduEnabled });
  const scenarioName = s.scenarios.find((x) => x.id === s.activeScenarioId)?.name ?? '';
  const year = s.timelineMonth / 12;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && s.setSheetOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s]);

  const schedule = useMemo(() => plantSchedule(plants, s.engine.growth, s.water), [plants, s.engine, s.water]);
  const tk = useMemo(() => takeoff(s.hardscape, s.materials, s.engine.hardscape), [s.hardscape, s.materials, s.engine]);
  const keys = useMemo(() => {
    const ids = [...new Set(plants.map((p) => p.species.id))].sort((a, b) => (s.library.species.find((x) => x.id === a)?.common ?? '').localeCompare(s.library.species.find((x) => x.id === b)?.common ?? ''));
    return new Map(ids.map((id, i) => [id, planKey(i)]));
  }, [plants, s.library]);
  // One label per building: the parts of a group (the ADU's wings) are measured together.
  const buildings = useMemo(() => {
    const groups = new Map<string, typeof structures>();
    for (const st of structures) groups.set(st.groupName ?? st.group ?? st.id, [...(groups.get(st.groupName ?? st.group ?? st.id) ?? []), st]);
    return [...groups.entries()].map(([key, parts]) => {
      const b = bbox(parts.filter((p) => p.group === parts[0].group).flatMap((p) => p.footprint));
      return { key, name: parts[0].groupName ?? parts[0].name, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, d: b.maxY - b.minY };
    });
  }, [structures]);
  const existing = plants.filter((p) => p.inst.existing);
  const matColor = (id: string) => s.materials.find((m) => m.id === id)?.color ?? '#bbb';
  const toVerify = s.site.assumptions.filter((a) => a.estimate);
  const trees = s.site.contextObjects.filter((o) => o.kind === 'tree' && o.position);

  const vbW = W + M.left + M.right, vbH = D + M.top + M.bottom;
  const fs = 2.3; // text height in feet: 8 pt on the printed sheet
  const north = northAngleDeg(s.site);
  const line = { stroke: '#222', fill: 'none' } as const;
  // A white halo keeps labels readable where they cross lines and canopies.
  const halo = { stroke: '#fff', strokeWidth: 0.7, paintOrder: 'stroke' } as const;

  return (
    <div className="sheet-overlay" role="dialog" aria-label="Printable plan sheet">
      <div className="sheet-toolbar">
        <button className="on" onClick={() => window.print()}>Print or save as PDF</button>
        <button onClick={() => s.setSheetOpen(false)}>Close</button>
        <span className="muted small">Letter, portrait. Set margins to none and scale to 100% so 1 in = 20 ft holds.</span>
      </div>
      <article className="sheet">
        <header className="sheet-head">
          <div>
            <h1>{s.site.name}</h1>
            {s.site.address && <p>{s.site.address}</p>}
            <p><b>Plan: {scenarioName}</b> · plants shown at year {fmt(year, 1)}</p>
          </div>
          <div className="sheet-meta">
            <p>{new Date().toLocaleDateString([], { dateStyle: 'long' })}</p>
            <p>Scale 1 in = {SHEET_SCALE_FT_PER_IN} ft</p>
            <p>Planning drawing, not for construction</p>
          </div>
        </header>
        <div className="sheet-body">
          <svg
            className="sheet-plan"
            width={`${feetToInches(vbW)}in`} height={`${feetToInches(vbH)}in`}
            viewBox={`${-M.left} ${-M.top} ${vbW} ${vbH}`} role="img" aria-label="Scaled plan of the lot"
            style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}
          >
            <defs>
              <pattern id="hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="1.6" stroke="#b45309" strokeWidth="0.3" />
              </pattern>
            </defs>

            {/* lot, setbacks, easement */}
            {s.site.easements.map((e) => (
              <polygon key={e.id} points={e.polygon.map(([x, y]) => `${x},${Y(y)}`).join(' ')} fill="url(#hatch)" stroke="#b45309" strokeWidth={0.25} />
            ))}
            <rect x={0} y={0} width={W} height={D} fill="#fff" stroke="#111" strokeWidth={0.7} />
            {s.site.setbacks.map((sb) => {
              const p = sb.edge === 'left' ? [sb.distance, 0, sb.distance, D] : sb.edge === 'right' ? [W - sb.distance, 0, W - sb.distance, D] : sb.edge === 'rear' ? [0, D - sb.distance, W, D - sb.distance] : [0, sb.distance, W, sb.distance];
              return <line key={sb.id} x1={p[0]} y1={Y(p[1])} x2={p[2]} y2={Y(p[3])} stroke="#b91c1c" strokeWidth={0.25} strokeDasharray="2.5 1.5" />;
            })}

            {/* hardscape */}
            {s.hardscape.filter((e) => !e.removed).map((e) => {
              const poly = footprint(e, s.engine.hardscape);
              if (poly.length < 3) return null;
              const b = bbox(poly);
              return (
                <g key={e.id}>
                  <polygon points={poly.map(([x, y]) => `${x},${Y(y)}`).join(' ')} fill={matColor(e.materialId)} fillOpacity={e.existing ? 0.45 : 0.7} stroke="#444" strokeWidth={0.2} strokeDasharray={e.existing ? '1 0.8' : undefined} />
                  {(() => {
                    const label = e.name ?? s.engine.hardscape.types[e.type].label;
                    const w = b.maxX - b.minX, h = b.maxY - b.minY;
                    const textLen = label.length * fs * 0.52;
                    const cx = (b.minX + b.maxX) / 2, cy = Y((b.minY + b.maxY) / 2);
                    if (w >= textLen + 1 && h > 3) return <text x={cx} y={cy} fontSize={fs * 0.9} textAnchor="middle" fill="#222" {...halo}>{label}</text>;
                    if (h >= textLen + 1 && w > 2.5) return <text transform={`translate(${cx + fs * 0.3},${cy}) rotate(-90)`} fontSize={fs * 0.9} textAnchor="middle" fill="#222" {...halo}>{label}</text>;
                    return null;
                  })()}
                </g>
              );
            })}

            {/* structures and roof overhangs. A building made of several parts is outlined part by part and labeled once. */}
            {structures.map((st) => (
              <g key={st.id}>
                {st.roofFootprint && <polygon points={st.roofFootprint.map(([x, y]) => `${x},${Y(y)}`).join(' ')} fill="none" stroke="#444" strokeWidth={0.2} strokeDasharray="1.5 1" />}
                <polygon points={st.footprint.map(([x, y]) => `${x},${Y(y)}`).join(' ')} fill="#e5e7eb" stroke="#111" strokeWidth={0.45} />
              </g>
            ))}
            {buildings.map((bd) => (
              <g key={bd.key}>
                <text x={bd.cx} y={Y(bd.cy) - 0.5} fontSize={fs} textAnchor="middle" fill="#111" fontWeight={600} {...halo}>{bd.name}</text>
                <text x={bd.cx} y={Y(bd.cy) + fs} fontSize={fs * 0.85} textAnchor="middle" fill="#333" {...halo}>{formatFeetInches(bd.w, 2)} × {formatFeetInches(bd.d, 2)}</text>
              </g>
            ))}

            {/* existing site trees */}
            {trees.map((t) => (
              <g key={t.id}>
                <circle cx={t.position![0]} cy={Y(t.position![1])} r={(t.canopyWidth ?? 10) / 2} fill="#86a97a" fillOpacity={0.2} stroke="#3f6b36" strokeWidth={0.25} strokeDasharray="1.5 1" />
                <circle cx={t.position![0]} cy={Y(t.position![1])} r={0.6} fill="#3f6b36" />
                {(t.canopyWidth ?? 0) >= 20 && <text x={Math.max(t.position![0], 6)} y={Y(t.position![1]) + 4} fontSize={fs * 0.85} textAnchor="middle" fill="#2f5128" {...halo}>{t.name.replace(/\s*\(.*\)/, '')}</text>}
              </g>
            ))}

            {/* plants, keyed to the schedule */}
            {plants.map((p) => (
              <g key={p.inst.id}>
                <circle cx={p.inst.position[0]} cy={Y(p.inst.position[1])} r={Math.max(p.size.width / 2, 0.8)} fill={p.species.foliageColor} fillOpacity={0.55} stroke="#2d5a27" strokeWidth={0.25} strokeDasharray={p.inst.existing ? '1 0.8' : undefined} />
                <text x={p.inst.position[0]} y={Y(p.inst.position[1]) + fs * 0.33} fontSize={fs * 0.9} textAnchor="middle" fontWeight={700} fill="#111">{keys.get(p.species.id)}</text>
              </g>
            ))}

            {/* dimensions */}
            <g {...line} strokeWidth={0.2}>
              <line x1={0} y1={D + 5} x2={W} y2={D + 5} />
              <line x1={0} y1={D + 3.5} x2={0} y2={D + 6.5} /><line x1={W} y1={D + 3.5} x2={W} y2={D + 6.5} />
              <line x1={W + 5} y1={0} x2={W + 5} y2={D} />
              <line x1={W + 3.5} y1={0} x2={W + 6.5} y2={0} /><line x1={W + 3.5} y1={D} x2={W + 6.5} y2={D} />
            </g>
            <text x={W / 2} y={D + 5 + fs} fontSize={fs} textAnchor="middle" fill="#111">{formatFeetInches(W, 8)}</text>
            <text transform={`translate(${W + 5 + fs * 0.4},${D / 2}) rotate(90)`} fontSize={fs} textAnchor="middle" fill="#111">{formatFeetInches(D, 8)}</text>
            <text x={W / 2} y={D + 3} fontSize={fs * 0.8} textAnchor="middle" fill="#666">STREET</text>

            {/* north arrow and scale bar */}
            <g transform={`translate(-6.5, -4) rotate(${north})`}>
              <polygon points="0,-5 2.2,2 0,0.6 -2.2,2" fill="#111" />
              <text x={0} y={-6} fontSize={fs} textAnchor="middle" fontWeight={700} fill="#111">N</text>
            </g>
            <g transform={`translate(0, ${D + 10})`}>
              {scaleBarFeet().slice(0, -1).map((f, i) => <rect key={f} x={f} y={0} width={10} height={1.2} fill={i % 2 ? '#fff' : '#111'} stroke="#111" strokeWidth={0.15} />)}
              {scaleBarFeet().map((f) => <text key={f} x={f} y={-0.8} fontSize={fs * 0.8} textAnchor="middle" fill="#111">{f}</text>)}
              <text x={22} y={1.1} fontSize={fs * 0.8} fill="#111">ft</text>
            </g>
          </svg>

          <div className="sheet-tables">
            <h2>Plant schedule</h2>
            {schedule.length === 0 ? <p>No new plants.</p> : (
              <table>
                <thead><tr><th>Key</th><th>Plant</th><th>Qty</th><th>Size</th><th>Spacing</th><th>Water</th><th>Sun</th></tr></thead>
                <tbody>
                  {schedule.map((r) => (
                    <tr key={`${r.speciesId}|${r.container}`}>
                      <td><b>{keys.get(r.speciesId)}</b></td>
                      <td>{r.common}<br /><i>{r.botanical}</i></td>
                      <td>{r.quantity}</td><td>{r.container}</td><td>{formatFeetInches(r.spacingFt, 2)}</td><td>{r.water}</td><td>{r.sun}</td>
                    </tr>
                  ))}
                  <tr><td colSpan={2}><b>Total new plants</b></td><td><b>{schedule.reduce((a, r) => a + r.quantity, 0)}</b></td><td colSpan={4} /></tr>
                </tbody>
              </table>
            )}
            {existing.length > 0 && (
              <p className="small">Existing plants (dashed): {[...new Set(existing.map((p) => `${keys.get(p.species.id)} ${p.species.common}`))].join(', ')}.</p>
            )}

            <h2>Hardscape takeoff</h2>
            {tk.rows.length === 0 ? <p>No new hardscape.</p> : (
              <table>
                <thead><tr><th>Material</th><th>Sq ft</th><th>Lin ft</th><th>Surface cu yd</th><th>Base cu yd</th></tr></thead>
                <tbody>
                  {tk.rows.map((r) => <tr key={r.materialId}><td>{r.name}</td><td>{fmt(r.areaSf, 1)}</td><td>{fmt(r.edgeLf, 1)}</td><td>{fmt(r.surfaceCuYd, 2)}</td><td>{fmt(r.baseCuYd, 2)}</td></tr>)}
                  <tr><td><b>Total</b></td><td>{fmt(tk.total.areaSf, 1)}</td><td>{fmt(tk.total.edgeLf, 1)}</td><td>{fmt(tk.total.surfaceCuYd, 2)}</td><td>{fmt(tk.total.baseCuYd, 2)}</td></tr>
                </tbody>
              </table>
            )}

            <h2>Legend</h2>
            <ul className="small">
              <li>Solid outline: building. Dashed beside it: roof edge.</li>
              <li>Circles: plant canopy at year {fmt(year, 1)}, with its schedule key.</li>
              <li>Dashed green: existing trees. Hatched: easement. Red dashes: setbacks.</li>
            </ul>

            <h2>To verify before building</h2>
            <ul className="small verify">
              {toVerify.map((a) => <li key={a.id}>{a.text}</li>)}
              <li>Plant data in the library is unverified. Water figures use a placeholder ETo table.</li>
            </ul>
          </div>
        </div>
      </article>
    </div>
  );
}
