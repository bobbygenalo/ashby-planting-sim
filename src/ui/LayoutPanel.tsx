import { useMemo, useState } from 'react';
import type { Conflict } from '../engine/conflicts';
import { explainCell, exclusionText, rescore, suggestPlacements, type SuggestWeights, type TermId } from '../engine/suggest';
import { activeStructures } from '../engine/site';
import type { SunHoursResult } from '../engine/sunhours';
import { usePlaced } from '../store/derived';
import { useApp } from '../store/store';

const KIND_LABEL: Record<Conflict['kind'], string> = {
  overlap: 'Crowding', structure: 'Touches a building', roof: 'Reaches a roof', foundation: 'Too close to a foundation',
  paving: 'Too close to paving', 'lot-line': 'Too close to the lot line', overhead: 'Over the overhead-line cap',
};
const TERMS: [TermId, string][] = [['sun', 'Sun fit'], ['clearance', 'Clearance at maturity'], ['hydrozone', 'Hydrozone match']];
const yearLabel = (m: number) => (m === 0 ? 'at planting' : `year ${(m / 12).toFixed(1)}`);

export function LayoutPanel({ growing }: { growing: SunHoursResult | null }) {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const plants = usePlaced();
  const [speciesId, setSpeciesId] = useState('');
  const [zoneId, setZoneId] = useState(s.site.zones.find((z) => z.id === 'back_yard')?.id ?? s.site.zones[0].id);

  const mine = s.conflicts.filter((c) => c.instanceIds.length > 0);
  const siteOnly = s.conflicts.filter((c) => c.instanceIds.length === 0);
  const errors = mine.filter((c) => c.severity === 'error').length;
  const byName = (a: { common: string }, b: { common: string }) => a.common.localeCompare(b.common);
  const shortlist = useMemo(() => s.library.species.filter((sp) => s.palette[sp.id]).sort(byName), [s.library, s.palette]);
  const others = useMemo(() => s.library.species.filter((sp) => !s.palette[sp.id]).sort(byName), [s.library, s.palette]);
  const chosen = s.library.species.find((sp) => sp.id === (speciesId || shortlist[0]?.id || others[0]?.id));
  const structures = activeStructures(s.site, { aduEnabled: s.aduEnabled });
  const sg = s.suggestion;
  const species = sg ? s.library.species.find((sp) => sp.id === sg.speciesId) : undefined;

  const show = (c: Conflict) => {
    s.setTimelineMonth(c.firstMonth);
    if (c.instanceIds[0]) s.select(c.instanceIds[0]);
  };

  const find = () => {
    if (!chosen || !growing) return;
    const zone = s.site.zones.find((z) => z.id === zoneId)!;
    const result = suggestPlacements({
      species: chosen, zone, sun: growing, structures, plants, elements: s.hardscape, easements: s.site.easements,
      contextTrees: s.site.contextObjects.filter((o) => o.kind === 'tree' && o.position).map((o) => ({ id: o.id, name: o.name, x: o.position![0], y: o.position![1], height: o.height, width: o.canopyWidth ?? 10 })),
      lot: s.site.lot, weights: s.suggestWeights, cfg: s.engine,
    });
    s.setSuggestion({ result, speciesId: chosen.id });
  };
  const setWeight = (term: TermId, v: number) => {
    const w: SuggestWeights = { ...s.suggestWeights, [term]: v };
    s.setSuggestWeights(w);
    if (sg && species) s.setSuggestion({ result: rescore(sg.result, w, species, s.engine, s.site.lot), speciesId: sg.speciesId });
  };
  const resetWeights = () => {
    const w = { ...s.engine.suggest.weights };
    s.setSuggestWeights(w);
    if (sg && species) s.setSuggestion({ result: rescore(sg.result, w, species, s.engine, s.site.lot), speciesId: sg.speciesId });
  };
  const place = (x: number, y: number) => {
    if (!sg) return;
    s.addInstance(sg.speciesId, [x, y]);
    s.setSuggestion(null);
  };

  const row = (c: Conflict) => (
    <li key={c.id} className={`conflict ${c.severity}`}>
      <div className="row wrap">
        <span className={`pill ${c.severity === 'error' ? 'warn' : ''}`}>{c.severity}</span>
        <span className="pill">{KIND_LABEL[c.kind]}</span>
        <span className="pill">{c.atPlanting ? 'at planting' : yearLabel(c.firstMonth)}</span>
      </div>
      <p className="small">{c.message}</p>
      {c.instanceIds.length > 0 && <button className="link" onClick={() => show(c)}>{c.atPlanting ? 'Show it in the yard' : `Show it in the yard in ${yearLabel(c.firstMonth)}`}</button>}
    </li>
  );

  return (
    <div className="layoutpanel">
      <h2>Conflicts over 30 years</h2>
      {mine.length === 0 ? (
        <p className="small"><b>No conflicts found.</b> Every plant clears its neighbors, buildings, paving, lot lines and the overhead cap at every age up to year {s.engine.timeline.maxYears}.</p>
      ) : (
        <p className="small"><b>{mine.length} conflict{mine.length === 1 ? '' : 's'}</b> ({errors} serious). Each shows the year it first happens. Red rings in the yard are conflicts that exist at the timeline year; amber rings come later.</p>
      )}
      <label className="check"><input type="checkbox" checked={s.layers.conflicts} onChange={(e) => s.setLayer('conflicts', e.target.checked)} />Show conflict rings</label>
      <ul className="species">{mine.map(row)}</ul>
      {siteOnly.length > 0 && (
        <details>
          <summary>Existing site trees ({siteOnly.length})</summary>
          <p className="muted small">These come from the placeholder tree positions and sizes in the site file. Confirm them before acting.</p>
          <ul className="species">{siteOnly.map(row)}</ul>
        </details>
      )}
      <p className="muted small">Checks canopy overlap (beyond {s.engine.conflicts.overlapToleranceFt} ft), canopy touching a building or roof, trunks too near foundations, paving or the lot line, and height past the easement cap. Groundcovers and plants under {Math.round(s.engine.conflicts.understoryHeightRatio * 100)}% of a neighbor's height are treated as understory. Distances are guidance, set in the data files.</p>

      <h2>Find a spot</h2>
      <p className="small muted">Scores every 1 ft cell in a yard for one species. Pick a yard and species, then adjust what matters.</p>
      <div className="grid2">
        <label>Species
          <select value={chosen?.id ?? ''} onChange={(e) => setSpeciesId(e.target.value)}>
            {shortlist.length > 0 && <optgroup label="Starred">{shortlist.map((sp) => <option key={sp.id} value={sp.id}>{sp.common}</option>)}</optgroup>}
            <optgroup label="All plants">{others.map((sp) => <option key={sp.id} value={sp.id}>{sp.common}</option>)}</optgroup>
          </select>
        </label>
        <label>Yard
          <select value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
            {s.site.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      </div>
      <div className="weights">
        {TERMS.map(([id, label]) => (
          <label key={id}>
            <span>{label}</span>
            <input type="range" min={0} max={3} step={0.25} value={s.suggestWeights[id]} onChange={(e) => setWeight(id, Number(e.target.value))} aria-label={`${label} weight`} />
            <b>{s.suggestWeights[id].toFixed(2)}</b>
          </label>
        ))}
        <button className="link" onClick={resetWeights}>Reset weights</button>
      </div>
      <div className="row">
        <button className="on" disabled={!chosen || !growing} onClick={find}>{sg ? 'Re-run' : 'Find spots'}</button>
        {sg && <button onClick={() => s.setSuggestion(null)}>Clear</button>}
        <label className="check"><input type="checkbox" checked={s.layers.suggestions} onChange={(e) => s.setLayer('suggestions', e.target.checked)} />Heatmap</label>
      </div>

      {sg && species && (
        <div>
          <div className="legend-bar" aria-label="Score scale">
            <span>low</span><i /><span>high score</span><em>gray = excluded</em>
          </div>
          <p className="small">
            Best places for <b>{species.common}</b> in the {sg.result.zoneName.toLowerCase()}. {sg.result.excludedCount.toLocaleString()} of {sg.result.cells.length.toLocaleString()} cells are ruled out
            {sg.result.excludedCount > 0 && ' (buildings, paving, the driveway, the easement height cap, or existing roots)'}. Re-run after you change the plan.
          </p>
          {sg.result.top.length === 0 && <p className="warnings small">No open spot in this yard suits {species.common}. Try another yard or species.</p>}
          <ul className="species">
            {sg.result.top.map((c, i) => (
              <li key={`${c.x},${c.y}`} className={s.suggestFocus === i ? 'sel' : ''}>
                <div className="row">
                  <button className={`spot static ${s.suggestFocus === i ? 'on' : ''}`} onClick={() => s.setSuggestFocus(i)}>{i + 1}</button>
                  <b>{Math.round(c.total * 100)}%</b>
                  <span className="muted small">at {c.x.toFixed(1)} ft across, {c.y.toFixed(1)} ft from the street</span>
                  {edit && <button style={{ marginLeft: 'auto' }} onClick={() => place(c.x, c.y)}>Place here</button>}
                </div>
                <details open={s.suggestFocus === i}>
                  <summary>Why this score</summary>
                  {explainCell(c, species, sg.result.weights, s.engine).map((e) => (
                    <div key={e.term} className="why">
                      <div className="row"><span>{e.label}</span><b style={{ marginLeft: 'auto' }}>{Math.round(e.score * 100)}%</b><span className="muted small">× {e.weight.toFixed(2)}</span></div>
                      <div className="bar"><span style={{ width: `${e.score * 100}%` }} /></div>
                      <p className="small muted">{e.text}</p>
                    </div>
                  ))}
                </details>
              </li>
            ))}
          </ul>
          <p className="muted small">Score = weighted average of the three terms. Ruled-out cells: {(['structure', 'paving', 'easement', 'root-zone'] as const).map((k) => exclusionText(k)).join('; ')}.</p>
        </div>
      )}
    </div>
  );
}
