import { useMemo } from 'react';
import { hiveProblems } from '../engine/life';
import { footprint } from '../engine/hardscape';
import { activeStructures } from '../engine/site';
import { formatFeetInches } from '../engine/units';
import { useApp } from '../store/store';

/** The beehive's card: where it stands, what is wrong with that spot, and ways to move it. */
export function HiveInspector() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const hive = s.hive;
  const problems = useMemo(() => {
    if (!hive) return [];
    return hiveProblems(
      { x: hive[0], y: hive[1] },
      {
        lot: s.site.lot,
        structures: activeStructures(s.site, { aduEnabled: s.aduEnabled }).map((st) => st.footprint),
        plants: s.instances.flatMap((i) => {
          const sp = s.library.species.find((q) => q.id === i.speciesId);
          return sp ? [{ x: i.position[0], y: i.position[1], r: sp.matureWidth / 2 }] : [];
        }),
        paths: s.hardscape.filter((e) => !e.removed && e.type === 'path').map((e) => footprint(e, s.engine.hardscape)),
      },
      s.engine.life,
    );
  }, [hive, s.site, s.aduEnabled, s.instances, s.library, s.hardscape, s.engine]);
  const place = (x: number, y: number) => s.setHive([Math.min(s.site.lot.width, Math.max(0, x)), Math.min(s.site.lot.depth, Math.max(0, y))]);
  const nudge = (dx: number, dy: number) => {
    if (!hive) return;
    s.beginGesture();
    place(hive[0] + dx, hive[1] + dy);
  };
  const num = (v: number, set: (n: number) => void) => (
    <input type="number" step={0.5} value={Number(v.toFixed(2))} disabled={!edit} onChange={(e) => set(Number(e.target.value))} />
  );
  return (
    <div className="inspector">
      <h3>Beehive</h3>
      <p className="muted small">Four stacked boxes on a stand. The bees fly out from here to the flowers in bloom this month.</p>
      {problems.length > 0 && <ul className="warnings">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      {hive ? (
        <div className="grid2">
          <label>X (ft){num(hive[0], (n) => place(n, hive[1]))}</label>
          <label>Y (ft){num(hive[1], (n) => place(hive[0], n))}</label>
        </div>
      ) : (
        <p className="muted small">The app is choosing the spot. Drag the hive, or use the arrow keys, to place it yourself.</p>
      )}
      {hive && edit && (
        <div className="row wrap">
          <span className="muted small">Nudge {formatFeetInches(s.snap)}</span>
          <button onClick={() => nudge(-s.snap, 0)}>←</button>
          <button onClick={() => nudge(s.snap, 0)}>→</button>
          <button onClick={() => nudge(0, s.snap)}>↑ rear</button>
          <button onClick={() => nudge(0, -s.snap)}>↓ street</button>
        </div>
      )}
      <div className="row">
        <button disabled={!edit || !hive} onClick={() => { s.setHive(null); s.selectHive(false); }} title="Let the app choose a spot again: away from paths and buildings, near flowers">Choose a spot for me</button>
      </div>
      <p className="muted small">Drag it in the yard, or use the arrow keys (Shift for bigger steps). A good spot is at least {s.engine.life.bees.hive.minFromPathFt} ft from paths and {s.engine.life.bees.hive.minFromStructureFt} ft from buildings, so bees and people keep out of each other's way.</p>
    </div>
  );
}
