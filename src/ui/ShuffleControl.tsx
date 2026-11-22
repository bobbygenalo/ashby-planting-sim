import { useState } from 'react';
import { doyToMonthDay, monthName } from '../engine/time';
import type { ShuffleOptions } from '../engine/shuffle';
import { useApp, type ConceptSummary, type ShuffleSummary } from '../store/store';
import type { ConceptOptions } from '../engine/concept';
import { fmtTime } from './SimDock';

const CHOICES: { key: keyof ShuffleOptions; label: string; help: string }[] = [
  { key: 'species', label: 'Species', help: 'Swap new plants for look-alikes with the same light, water and size.' },
  { key: 'positions', label: 'Positions', help: 'Nudge new plants a couple of feet, off buildings and hard surfaces.' },
  { key: 'materials', label: 'Materials', help: 'Swap new paving, paths and decks for another material of the same kind.' },
  { key: 'colors', label: 'Colors', help: 'Try different colors on new hardscape.' },
  { key: 'time', label: 'Time', help: 'Jump to a random year of growth and a random date and time of day.' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The top-bar button that shows or hides the shuffle bar. */
export function ShuffleControl() {
  const edit = useApp((s) => s.mode === 'edit');
  const open = useApp((s) => s.shuffleOpen);
  const setOpen = useApp((s) => s.setShuffleOpen);
  if (!edit) return null;
  return (
    <button className={open ? 'on' : ''} aria-pressed={open} onClick={() => setOpen(!open)} title="Try variations of plants, hardscape and time">Shuffle</button>
  );
}

type Mode = 'vary' | 'concept';
type Last =
  | { kind: 'vary'; summary: ShuffleSummary; sourceId: string; inCopy: boolean }
  | { kind: 'concept'; summary: ConceptSummary; sourceId: string; inCopy: boolean };

/**
 * A slim bar along the top of the yard, so the result stays in view. Two modes: vary what is in this scenario, or
 * build a brand-new concept from scratch. Either lands in a copy and leaves the scenario you were in untouched;
 * rolling again replaces that copy until you keep one.
 */
export function ShuffleBar() {
  const open = useApp((s) => s.shuffleOpen && s.mode === 'edit');
  const setOpen = useApp((s) => s.setShuffleOpen);
  const shuffle = useApp((s) => s.shuffle);
  const generate = useApp((s) => s.generateConcept);
  const switchScenario = useApp((s) => s.switchScenario);
  const deleteScenario = useApp((s) => s.deleteScenario);
  const scenarios = useApp((s) => s.scenarios);
  const activeId = useApp((s) => s.activeScenarioId);
  const palette = useApp((s) => s.palette);
  const minPool = useApp((s) => s.engine.concept.minPoolSize);
  const [mode, setMode] = useState<Mode>('vary');
  const [opts, setOpts] = useState<ShuffleOptions>({ species: true, positions: true, materials: true, colors: true, time: false });
  const [starredVary, setStarredVary] = useState(false);
  const [concept, setConcept] = useState<ConceptOptions>({ hardscape: true, plants: true, starredOnly: true });
  const [copy, setCopy] = useState(true);
  const [seedText, setSeedText] = useState('');
  const [last, setLast] = useState<Last | null>(null);
  if (!open) return null;

  const stars = Object.values(palette).filter(Boolean).length;
  // While a result is pending, the scenario being varied is the one it came from, not the copy you are looking at.
  const sourceId = last?.inCopy && scenarios.some((s) => s.id === last.sourceId) ? last.sourceId : activeId;
  const activeName = scenarios.find((s) => s.id === sourceId)?.name ?? 'this scenario';
  const changesPlan = opts.species || opts.positions || opts.materials || opts.colors;
  const none = mode === 'vary' ? !changesPlan && !opts.time : !concept.hardscape && !concept.plants;
  const seedNumber = seedText.trim() === '' ? undefined : Number(seedText);
  const badSeed = seedNumber !== undefined && (!Number.isInteger(seedNumber) || seedNumber < 0);
  const inCopy = mode === 'concept' ? true : copy && changesPlan;
  const pending = last?.inCopy && last.kind === mode;

  const roll = () => {
    if (none || badSeed) return;
    let sourceId = activeId;
    // Rolling again replaces the copy the last roll made, starting from the same scenario.
    const lastId = last?.summary.scenarioId;
    if (last?.inCopy && lastId && scenarios.some((s) => s.id === lastId)) {
      sourceId = last.sourceId;
      switchScenario(sourceId);
      deleteScenario(lastId);
    }
    if (mode === 'vary') {
      const summary = shuffle({ ...opts, starredOnly: starredVary }, { copy: inCopy, seed: seedNumber });
      if (summary) setLast({ kind: 'vary', summary, sourceId, inCopy });
    } else {
      const summary = generate(concept, { seed: seedNumber });
      if (summary) setLast({ kind: 'concept', summary, sourceId, inCopy: summary.scenarioId !== null });
    }
  };

  let result = '';
  if (last?.kind === 'vary') {
    const c = last.summary.changes;
    const parts = [c.species && `${plural(c.species, 'plant')} swapped`, c.moved && `${c.moved} moved`, c.materials && `${plural(c.materials, 'material')}`, c.colors && `${plural(c.colors, 'color')}`].filter(Boolean);
    const t = last.summary.time;
    if (t) {
      const [m, d] = doyToMonthDay(t.doy);
      parts.push(`${t.timelineMonth === 0 ? 'today' : `year ${t.timelineMonth / 12}`}, ${monthName(m)} ${d}, ${fmtTime(t.minutes)}`);
    }
    result = parts.length > 0 ? parts.join(' · ') : 'Nothing could change (existing items stay put)';
  } else if (last?.kind === 'concept') {
    const c = last.summary.counts;
    const parts = [c.patio && '1 patio', c.path && '1 path', c.beds && plural(c.beds, 'bed'), c.plants && `${plural(c.plants, 'plant')} of ${plural(c.species, 'kind')}`].filter(Boolean);
    result = [parts.length > 0 ? parts.join(' · ') : 'Nothing could be built', ...last.summary.notes].join(' · ');
  }

  const description =
    mode === 'vary'
      ? `Tweaks the new plants and hardscape in "${activeName}". Existing items never change.${starredVary ? ' Plants swap only for your starred ones.' : ''}`
      : `Builds a brand-new plan in a new scenario, ignoring what is placed in "${activeName}". ${concept.plants ? (concept.starredOnly ? `Plants come only from your ${stars} starred.` : 'Plants come from the whole library.') : ''}`;

  return (
    <div className="shufflebar" role="group" aria-label="Shuffle">
      <div className="segmented small" role="tablist" aria-label="Shuffle mode">
        <button role="tab" aria-selected={mode === 'vary'} className={mode === 'vary' ? 'on' : ''} onClick={() => setMode('vary')}>Vary this scenario</button>
        <button role="tab" aria-selected={mode === 'concept'} className={mode === 'concept' ? 'on' : ''} onClick={() => setMode('concept')}>New concept</button>
      </div>
      <button className="on" disabled={none || badSeed || (mode === 'concept' && concept.plants && concept.starredOnly && stars < minPool && !concept.hardscape)} onClick={roll}>
        {mode === 'vary' ? (pending ? 'Shuffle again' : 'Shuffle') : pending ? 'Generate again' : 'Generate'}
      </button>
      {pending && <button onClick={() => last && setLast({ ...last, inCopy: false })} title="Keep this copy and stop replacing it">Keep this one</button>}
      {mode === 'vary' ? (
        <>
          <span className="chips" role="group" aria-label="What to shuffle">
            {CHOICES.map((o) => (
              <button key={o.key} className={`chip ${opts[o.key] ? 'on' : ''}`} aria-pressed={!!opts[o.key]} title={o.help} onClick={() => setOpts({ ...opts, [o.key]: !opts[o.key] })}>{o.label}</button>
            ))}
          </span>
          <button className={`chip ${starredVary ? 'on' : ''}`} aria-pressed={starredVary} disabled={!opts.species} title="Swap plants only for ones starred in this scenario's palette" onClick={() => setStarredVary(!starredVary)}>★ Starred only ({stars})</button>
          <button
            className={`chip ${inCopy ? 'on' : ''}`}
            aria-pressed={inCopy}
            disabled={!changesPlan}
            title={inCopy ? 'Results go in a new scenario; this one stays as it is. Click to change this scenario instead (Undo brings it back).' : 'This scenario changes. Undo (Cmd/Ctrl+Z) brings it back. Click to shuffle into a copy.'}
            onClick={() => setCopy(!copy)}
          >In a copy</button>
        </>
      ) : (
        <span className="chips" role="group" aria-label="What to build">
          <button className={`chip ${concept.hardscape ? 'on' : ''}`} aria-pressed={concept.hardscape} title="A patio, a garden path and planting beds in free space" onClick={() => setConcept({ ...concept, hardscape: !concept.hardscape })}>Hardscape</button>
          <button className={`chip ${concept.plants ? 'on' : ''}`} aria-pressed={concept.plants} title="Plants placed in the beds and open ground, with room to grow" onClick={() => setConcept({ ...concept, plants: !concept.plants })}>Plants</button>
          <button className={`chip ${concept.starredOnly ? 'on' : ''}`} aria-pressed={concept.starredOnly} disabled={!concept.plants} title={concept.starredOnly ? 'Plants come only from your starred palette. Click to use the whole library.' : 'Plants come from the whole library. Click to use only your starred palette.'} onClick={() => setConcept({ ...concept, starredOnly: !concept.starredOnly })}>★ Starred only ({stars})</button>
        </span>
      )}
      <input className="seedbox" inputMode="numeric" value={seedText} placeholder="Seed" aria-label="Seed (optional, a whole number)" aria-invalid={badSeed} title="Type the seed from an earlier roll to get the same result again" onChange={(e) => setSeedText(e.target.value)} />
      <button className="icon" aria-label="Close shuffle" title="Close" onClick={() => setOpen(false)}>✕</button>
      <div className="shuffleinfo">
        <span className="muted">{description}</span>
        {mode === 'concept' && concept.plants && concept.starredOnly && stars < minPool && <span className="warn"> Star at least {minPool} plants first, or turn off Starred only.</span>}
        {last && last.kind === mode && <span className="shuffleresult" role="status" title={`Seed ${last.summary.seed}. ${result}`}> {result} · seed {last.summary.seed}</span>}
      </div>
    </div>
  );
}
