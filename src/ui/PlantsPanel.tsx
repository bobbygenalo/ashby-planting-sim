import { useMemo, useState } from 'react';
import { filterSpecies, makeCustomSpecies, type CustomSpeciesInput, type LibraryFilter } from '../engine/library';
import { formatFeetInches } from '../engine/units';
import type { ContainerId } from '../engine/types';
import { useApp } from '../store/store';
import { PollBadge } from './PlantInspector';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TYPES = ['tree', 'shrub', 'perennial', 'grass', 'groundcover', 'vine', 'succulent', 'edible'] as const;
const GROUPS = ['native bees', 'honey bees', 'butterflies', 'moths', 'hummingbirds'] as const;

const BLANK: CustomSpeciesInput = {
  common: '', botanical: '', type: 'shrub', origin: 'other', evergreen: true, matureHeight: 4, matureWidth: 4,
  yearsToMaturity: 4, habit: 'round', sun: 'full', wucols: 'low', bloomMonths: [], bloomColor: '#c026d3',
  pollinatorValue: 'moderate', groups: [], invasive: false, toxic: false,
};

function CustomSpeciesForm({ onDone }: { onDone: () => void }) {
  const addSpecies = useApp((s) => s.addSpecies);
  const ids = useApp((s) => s.library.species.map((x) => x.id));
  const [v, setV] = useState<CustomSpeciesInput>(BLANK);
  const [errors, setErrors] = useState<string[]>([]);
  const up = <K extends keyof CustomSpeciesInput>(k: K, val: CustomSpeciesInput[K]) => setV({ ...v, [k]: val });
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const submit = () => {
    const r = makeCustomSpecies(v, ids);
    if (!r.ok) return setErrors(r.errors);
    addSpecies(r.species);
    setV(BLANK);
    setErrors([]);
    onDone();
  };
  const numField = (label: string, k: 'matureHeight' | 'matureWidth' | 'yearsToMaturity') => (
    <label>{label}<input type="number" step="0.5" min="0" value={v[k]} onChange={(e) => up(k, Number(e.target.value))} /></label>
  );
  return (
    <div className="custom">
      <div className="grid2">
        <label>Common name<input value={v.common} onChange={(e) => up('common', e.target.value)} /></label>
        <label>Botanical name<input value={v.botanical} onChange={(e) => up('botanical', e.target.value)} /></label>
        <label>Type<select value={v.type} onChange={(e) => up('type', e.target.value as never)}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Origin<select value={v.origin} onChange={(e) => up('origin', e.target.value as never)}><option>california native</option><option>mediterranean</option><option>other</option></select></label>
        {numField('Mature height (ft)', 'matureHeight')}
        {numField('Mature width (ft)', 'matureWidth')}
        {numField('Years to maturity', 'yearsToMaturity')}
        <label>Habit<select value={v.habit} onChange={(e) => up('habit', e.target.value as never)}>{['columnar', 'round', 'vase', 'spreading', 'weeping', 'clump', 'mat', 'vine'].map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Sun need<select value={v.sun} onChange={(e) => up('sun', e.target.value as never)}><option>full</option><option>part</option><option>shade</option></select></label>
        <label>WUCOLS water<select value={v.wucols} onChange={(e) => up('wucols', e.target.value as never)}><option>very low</option><option>low</option><option>moderate</option><option>high</option></select></label>
        <label>Pollinator value<select value={v.pollinatorValue} onChange={(e) => up('pollinatorValue', e.target.value as never)}><option>high</option><option>moderate</option><option>low</option></select></label>
        <label>Bloom color<input type="color" value={v.bloomColor} onChange={(e) => up('bloomColor', e.target.value)} /></label>
      </div>
      <p className="muted small">Bloom months</p>
      <div className="row wrap">
        {MONTHS.map((m, i) => (
          <button key={m} type="button" className={v.bloomMonths.includes(i + 1) ? 'on' : ''} onClick={() => up('bloomMonths', toggle(v.bloomMonths, i + 1))}>{m}</button>
        ))}
      </div>
      <p className="muted small">Groups served</p>
      <div className="row wrap">
        {GROUPS.map((g) => (
          <button key={g} type="button" className={v.groups.includes(g) ? 'on' : ''} onClick={() => up('groups', toggle(v.groups, g))}>{g}</button>
        ))}
      </div>
      <label className="check"><input type="checkbox" checked={v.evergreen} onChange={(e) => up('evergreen', e.target.checked)} />Evergreen (deciduous plants lose leaves Dec to Feb)</label>
      <label className="check"><input type="checkbox" checked={v.invasive} onChange={(e) => up('invasive', e.target.checked)} />Invasive</label>
      <label className="check"><input type="checkbox" checked={v.toxic} onChange={(e) => up('toxic', e.target.checked)} />Toxic to children or pets</label>
      {errors.length > 0 && <ul className="warnings">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="row">
        <button className="on" onClick={submit}>Add to library</button>
        <button onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

export function PlantsPanel() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const [f, setF] = useState<LibraryFilter>({});
  const [adding, setAdding] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [moreFilters, setMoreFilters] = useState(false);
  const list = useMemo(
    () => filterSpecies(s.library.species, f).filter((sp) => !starredOnly || s.palette[sp.id]),
    [s.library, f, starredOnly, s.palette],
  );
  const set = <K extends keyof LibraryFilter>(k: K, v: LibraryFilter[K] | '') => setF({ ...f, [k]: v === '' ? undefined : v });
  const sel = (v: string | undefined) => v ?? '';
  const starCount = s.library.species.filter((sp) => s.palette[sp.id]).length;

  return (
    <div className="plants">
      <p className="banner small">
        Library values are <b>unverified</b> (low confidence): compiled without checking WUCOLS, Calscape or Cal-IPC. Confirm before spending money.
      </p>
      <p className="small muted">
        {s.instances.length === 0 ? 'Pick a plant and press Place, then click the yard.' : `${s.instances.length} plant${s.instances.length === 1 ? '' : 's'} placed. Click one in the yard to edit it.`}
      </p>
      <div className="row">
        <span className="muted small">Place as</span>
        <select value={s.placeContainer} onChange={(e) => s.setPlaceContainer(e.target.value as ContainerId)} disabled={!edit}>
          {Object.entries(s.engine.growth.containers).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
        </select>
        {s.placingSpeciesId && <button className="on" onClick={() => s.setPlacing(null)}>Stop placing</button>}
      </div>
      {!edit && <p className="muted small">View only: the plan cannot be changed.</p>}

      <h2>Library ({list.length} of {s.library.species.length})</h2>
      <input className="search" placeholder="Search name…" value={f.text ?? ''} onChange={(e) => set('text', e.target.value)} />
      <div className="row wrap">
        <button className={starredOnly ? 'on' : ''} aria-pressed={starredOnly} onClick={() => setStarredOnly(!starredOnly)}>★ Starred ({starCount})</button>
        <button onClick={() => setMoreFilters(!moreFilters)} aria-expanded={moreFilters}>{moreFilters ? 'Fewer filters' : 'Filters'}</button>
        {edit && (adding ? null : <button onClick={() => setAdding(true)}>+ Custom plant</button>)}
      </div>
      {edit && adding && <CustomSpeciesForm onDone={() => setAdding(false)} />}
      {moreFilters && (
        <>
          <div className="filters">
            <select value={sel(f.type)} onChange={(e) => set('type', e.target.value as never)}><option value="">Any type</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <select value={sel(f.origin)} onChange={(e) => set('origin', e.target.value as never)}><option value="">Any origin</option><option>california native</option><option>mediterranean</option><option>other</option></select>
            <select value={sel(f.water)} onChange={(e) => set('water', e.target.value as never)}><option value="">Any water</option><option>very low</option><option>low</option><option>moderate</option><option>high</option></select>
            <select value={sel(f.sun)} onChange={(e) => set('sun', e.target.value as never)}><option value="">Any sun</option><option>full</option><option>part</option><option>shade</option></select>
            <select value={sel(f.pollinator)} onChange={(e) => set('pollinator', e.target.value as never)}><option value="">Any pollinator value</option><option>high</option><option>moderate</option><option>low</option></select>
            <select value={sel(f.group)} onChange={(e) => set('group', e.target.value as never)}><option value="">Any group served</option>{GROUPS.map((g) => <option key={g}>{g}</option>)}</select>
            <select value={f.bloomMonth ?? ''} onChange={(e) => set('bloomMonth', e.target.value === '' ? '' : (Number(e.target.value) as never))}><option value="">Any bloom month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <select value={f.evergreen === undefined ? '' : String(f.evergreen)} onChange={(e) => set('evergreen', e.target.value === '' ? '' : ((e.target.value === 'true') as never))}><option value="">Evergreen or deciduous</option><option value="true">Evergreen</option><option value="false">Deciduous</option></select>
          </div>
          <label className="check"><input type="checkbox" checked={!!f.nonToxicOnly} onChange={(e) => set('nonToxicOnly', e.target.checked ? true : '')} />Non-toxic only</label>
          <label className="check"><input type="checkbox" checked={!!f.hideInvasive} onChange={(e) => set('hideInvasive', e.target.checked ? true : '')} />Hide invasive</label>
        </>
      )}

      <ul className="species">
        {list.map((sp) => {
          const starred = !!s.palette[sp.id];
          const n = s.instances.filter((i) => i.speciesId === sp.id).length;
          const placing = s.placingSpeciesId === sp.id;
          return (
            <li key={sp.id} className={placing ? 'sel' : ''}>
              <div className="row">
                <span style={{ flex: 1 }}>
                  <b>{sp.common}</b>{n > 0 && <span className="count" title="Placed in this scenario">{n}</span>}
                  <br /><small className="muted"><i>{sp.botanical}</i></small>
                </span>
                <button
                  className={`star ${starred ? 'on' : ''}`}
                  disabled={!edit}
                  aria-pressed={starred}
                  aria-label={starred ? `Remove ${sp.common} from starred` : `Star ${sp.common}`}
                  title={starred ? 'Starred: shown first when finding a spot' : 'Star to shortlist'}
                  onClick={() => s.setPaletteSpecies(sp.id, !starred)}
                >{starred ? '★' : '☆'}</button>
              </div>
              <div className="row wrap">
                <PollBadge v={sp.pollinator.value} />
                <span className="pill">{sp.wucols} water</span>
                <span className="pill">{sp.sun} sun</span>
                {sp.origin === 'california native' && <span className="pill native">CA native</span>}
                {sp.invasive && <span className="pill warn">invasive</span>}
                <span className="pill">{formatFeetInches(sp.matureHeight, 2)}×{formatFeetInches(sp.matureWidth, 2)}</span>
                {edit && (
                  <button className={placing ? 'on' : ''} onClick={() => s.setPlacing(placing ? null : sp.id)}>
                    {placing ? 'Click the yard…' : 'Place'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
