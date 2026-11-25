import { useEffect, useRef, useState } from 'react';
import { defaultLifeSettings, useApp } from '../store/store';
import { defaultSkySettings } from '../engine/planet';
import { money, waterCost } from '../engine/pricing';
import { useCostReadout, useIrrigationPlan, useShowRun, useWaterCostOverTime } from '../store/derived';
import { doyToMonthDay } from '../engine/time';
import { clock } from './IrrigationPanel';
import { useRunningValves } from '../scene/IrrigationFlow';
import type { CloudKind } from '../engine/types';
import { PHONE_QUERY, useMedia } from './sheet';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const MPH = 0.681818; // feet a second to miles an hour

/** A labelled slider with its value shown at the right: the one control style for the Environment and Life menus. */
function Slider({ label, min, max, step = 1, value, onChange, format }: { label: string; min: number; max: number; step?: number; value: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label>{label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <output>{format ? format(value) : String(value)}</output>
    </label>
  );
}

/** The planet and its sky: planet size, cloud type and cover, wind, and how often meteors fall. Remembered in this browser. */
function SkyControls() {
  const layers = useApp((x) => x.layers);
  const sky = useApp((x) => x.skySettings);
  const set = useApp((x) => x.setSkySettings);
  const cfg = useApp((x) => x.engine.planet);
  const kinds = Object.keys(cfg.clouds.types) as CloudKind[];
  return (
    <div className="skybox" role="group" aria-label="Planet and sky">
      <div className="skybox-title">Planet and sky</div>
      {layers.planet && <Slider label="Planet size" min={cfg.radiusRangeFt[0]} max={cfg.radiusRangeFt[1]} step={25} value={sky.planetRadiusFt} onChange={(v) => set({ planetRadiusFt: v })} format={(v) => `${Math.round(v)} ft`} />}
      {layers.skyBodies && (
        <>
          <label>Clouds
            <select value={sky.cloudType} onChange={(e) => set({ cloudType: e.target.value as CloudKind })} aria-label="Cloud type">
              {kinds.map((k) => <option key={k} value={k}>{cfg.clouds.types[k].label}</option>)}
            </select>
          </label>
          <Slider label="Cloud cover" min={0} max={2} step={0.1} value={sky.cloudCover} onChange={(v) => set({ cloudCover: v })} format={(v) => (v === 0 ? 'clear' : v < 0.7 ? 'few' : v < 1.3 ? 'some' : 'many')} />
          <Slider label="Wind speed" min={0} max={cfg.wind.maxFtPerS} step={0.5} value={sky.windFtPerS} onChange={(v) => set({ windFtPerS: v })} format={(v) => `${Math.round(v * MPH)} mph`} />
          <label>Wind from
            <select value={Math.round(sky.windFromDeg / 45) % 8} onChange={(e) => set({ windFromDeg: Number(e.target.value) * 45 })} aria-label="Wind direction">
              {COMPASS.map((c, i) => <option key={c} value={i}>{c}</option>)}
            </select>
          </label>
          <Slider label="Meteors" min={0} max={cfg.meteors.maxPerMin} value={sky.meteorsPerMin} onChange={(v) => set({ meteorsPerMin: v })} format={(v) => (v === 0 ? 'none' : `${v} a min`)} />
        </>
      )}
      <button type="button" className="linklike" onClick={() => set(defaultSkySettings(cfg))}>Reset sky</button>
    </div>
  );
}

const LAYERS = [
  ['sunHours', 'Sun-hours overlay'],
  ['dimensions', 'Dimensions'],
  ['setbacks', 'Setback lines'],
  ['easements', 'Easement'],
  ['context', 'Trees, fences, pole'],
  ['bloom', 'Bloom color on plants'],
  ['fruit', 'Fruit on trees'],
  ['detail', 'Leaves and flowers (detailed plants)'],
  ['crops', 'Raised-bed crops'],
  ['drift', 'Slowly turn the Orbit view'],
  ['conflicts', 'Conflict rings'],
  ['suggestions', 'Placement heatmap'],
] as const;

/** A button that opens a menu under it and closes it again on an outside click or Escape; the label is always the button's text. */
function Dropdown({ label, ariaLabel, align = 'right', wide = false, title, className, children }: { label: React.ReactNode; ariaLabel: string; align?: 'left' | 'right'; wide?: boolean; title?: string; className?: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <div className={`dropdown ${className ?? ''}`} ref={box}>
      <button aria-expanded={open} aria-haspopup="true" aria-label={ariaLabel} title={title} className={open ? 'on' : ''} onClick={() => setOpen(!open)}>{label} <span aria-hidden="true">▾</span></button>
      {open && (
        <div className={`popover ${align === 'left' ? 'left' : ''} ${wide ? 'wide' : ''}`} role="group" aria-label={ariaLabel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Who is in the yard, in three groups: people, animals (dogs, birds, worms) and pollinators (bees, hummingbirds, butterflies). */
function LifeControls() {
  const layers = useApp((x) => x.layers);
  const setLayer = useApp((x) => x.setLayer);
  const st = useApp((x) => x.lifeSettings);
  const set = useApp((x) => x.setLifeSettings);
  const engine = useApp((x) => x.engine);
  const e = engine.life;
  const c = e.critters;
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={layers.life} onChange={(ev) => setLayer('life', ev.target.checked)} />
        People, animals and pollinators
      </label>
      {layers.life && (
        <>
          <div className="skybox" role="group" aria-label="People">
            <div className="skybox-title">People</div>
            <Slider label="People" min={0} max={e.people.max} value={st.people} onChange={(v) => set({ people: v })} format={(v) => (v === 0 ? 'none' : String(v))} />
          </div>
          <div className="skybox" role="group" aria-label="Animals">
            <div className="skybox-title">Animals</div>
            <Slider label="Dogs" min={0} max={e.dogs.max} value={st.dogs} onChange={(v) => set({ dogs: v })} format={(v) => (v === 0 ? 'none' : String(v))} />
            <Slider label="Birds" min={0} max={c.birds.max} value={st.birds} onChange={(v) => set({ birds: v })} format={(v) => (v === 0 ? 'none' : `up to ${v}`)} />
            <Slider label="Worms" min={0} max={c.worms.max} value={st.worms} onChange={(v) => set({ worms: v })} format={(v) => (v === 0 ? 'none' : `up to ${v}`)} />
          </div>
          <div className="skybox" role="group" aria-label="Pollinators">
            <div className="skybox-title">Pollinators</div>
            <Slider label="Bees" min={0} max={e.bees.count} value={st.bees ? st.beeCount : 0} onChange={(v) => set({ beeCount: v, bees: v > 0 })} format={(v) => (v === 0 ? 'none' : String(v))} />
            <Slider label="Hummingbirds" min={0} max={c.hummer.max} value={st.hummingbirds} onChange={(v) => set({ hummingbirds: v })} format={(v) => (v === 0 ? 'none' : `up to ${v}`)} />
            <Slider label="Butterflies" min={0} max={c.butterfly.max} value={st.butterflies} onChange={(v) => set({ butterflies: v })} format={(v) => (v === 0 ? 'none' : `up to ${v}`)} />
          </div>
          <button type="button" className="linklike" onClick={() => set(defaultLifeSettings(engine))}>Reset life</button>
        </>
      )}
    </>
  );
}

/** The Water menu's timing line: what is running now, or when water next flows, with a button that jumps the sun dock there. */
function WaterTiming() {
  const { next, jump } = useShowRun();
  const running = useRunningValves();
  const doy = useApp((x) => x.doy);
  const minutes = useApp((x) => x.minutes);
  if (!next) return null;
  const [mo, da] = doyToMonthDay(next.doy);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = next.doy === doy ? `today at ${clock(next.run.startMin)}` : `${MONTHS[mo - 1]} ${da} at ${clock(next.run.startMin)}`;
  return (
    <div className="watertiming">
      <p className="small">
        {running.size > 0
          ? <>Water is flowing now ({clock(minutes)}): <b>{[...running].join(', ')}</b>.</>
          : <>Nothing is running at {clock(minutes)}: valves run early morning and evening. Next: <b>{next.run.valveId}</b> {when}.</>}
      </p>
      {running.size === 0 && <button type="button" onClick={jump}>Show it running</button>}
    </div>
  );
}

/**
 * The cost of the scenario on show, live at the top right of the yard: hardscape, planting and a year of water. Clicking it
 * opens the detail (what each is made of, the irrigation system, the water rate) and the totals.
 */
function CostReadout() {
  const cost = useCostReadout();
  const pricing = useApp((x) => x.engine.pricing);
  const scenarioName = useApp((x) => x.scenarios.find((sc) => sc.id === x.activeScenarioId)?.name ?? 'This scenario');
  const plan = useIrrigationPlan();
  const over = useWaterCostOverTime();
  const m = (n: number) => money(n, pricing);
  return (
    <Dropdown ariaLabel="Scenario cost" title={`Estimated cost of ${scenarioName}: click for the detail`} wide className="costdrop"
      label={(
        <span className="costreadout">
          <span>Hardscape <b>{m(cost.hardscape)}</b></span>
          <span className="sep" aria-hidden="true">·</span>
          <span>Planting <b>{m(cost.planting)}</b></span>
          <span className="sep" aria-hidden="true">·</span>
          <span>Water <b>{m(cost.waterPerYear)}</b>/yr</span>
        </span>
      )}>
      {() => (
        <div className="costdetail">
          <div className="costtitle">{scenarioName}</div>
          <table className="tbl tight">
            <tbody>
              <tr><td>Hardscape</td><td>{m(cost.hardscape)}</td></tr>
              <tr><td>Planting</td><td>{m(cost.planting)}</td></tr>
              <tr><td>Irrigation system{plan && plan.valves.length > 0 ? ` (${plan.valves.length} valves)` : ''}</td><td>{m(cost.irrigationSystem)}</td></tr>
              <tr className="sum"><td>Total up front</td><td>{m(cost.upFront)}</td></tr>
              <tr><td>Water, {Math.round(cost.waterGallonsPerYear).toLocaleString('en-US')} gal a year</td><td>{m(cost.waterPerYear)} / yr</td></tr>
              <tr className="sum"><td>First year, all in</td><td>{m(cost.firstYear)}</td></tr>
            </tbody>
          </table>
          <div className="costtitle">Water cost as the plants grow</div>
          <table className="tbl tight">
            <thead><tr><th>Year</th><th>Gallons</th><th>Per year</th></tr></thead>
            <tbody>
              {over.milestones.map((r) => (
                <tr key={r.year}><td>{r.year === 0 ? 'Planting' : `Year ${r.year}`}</td><td>{Math.round(r.gallons).toLocaleString('en-US')}</td><td>{m(r.cost)}</td></tr>
              ))}
              <tr className="sum"><td>First 30 years</td><td>{Math.round(over.thirtyYearGallons).toLocaleString('en-US')}</td><td>{m(over.thirtyYearCost)}</td></tr>
            </tbody>
          </table>
          <p className="small muted">
            The readout above is today's size. A new plant is watered over at least the soil round its root ball (and gets a first-year boost), then water climbs as the canopy fills out and levels off at maturity. Rate held at today's price.
          </p>
          <p className="small muted">
            New work only: hardscape from each material's price and the plants from their containers (set your own in Outputs, Prices). Water is the irrigation plan's applied gallons at {pricing.currency}{pricing.water.perCcf} per hundred cubic feet ({pricing.water.galPerCcf} gal), about {pricing.currency}{(waterCost(1000, pricing)).toFixed(2)} per 1,000 gallons. <span className="pill warn" title={pricing.water.source}>stand-in rate</span> Replace it with the rate on your own bill (LADWP's biannual notice is the reference; hover the tag for the notes).
          </p>
        </div>
      )}
    </Dropdown>
  );
}

/**
 * The controls over the yard: along the top left, the camera view (which shows the current view and lists them all), Water
 * (irrigation), Life (who is in the yard), Environment (the planet and its sky) and Other (the remaining layers); at the top
 * right, the scenario's live cost readout.
 */
export function CanvasToolbar() {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const current = s.site.views.find((v) => v.id === s.view) ?? s.site.views[0];
  const currentIndex = s.site.views.indexOf(current);
  const phone = useMedia(PHONE_QUERY);
  if (phone) {
    // A phone gets one Layers button: the camera views and a few switches, nothing to tune.
    const SIMPLE = [['irrigation', 'Irrigation'], ['life', 'People, animals and pollinators'], ['sunHours', 'Sun-hours overlay'], ['bloom', 'Bloom color'], ['fruit', 'Fruit on trees'], ['context', 'Trees, fences, pole']] as const;
    return (
      <div className="canvasbar">
        <div className="toolbar-left">
          <Dropdown align="left" ariaLabel="View and layers" label={<>View<kbd className="key">{currentIndex + 1}</kbd> and layers</>}>
            {(close) => (
              <>
                <ul className="viewlist" role="listbox" aria-label="Camera views">
                  {s.site.views.map((v) => (
                    <li key={v.id} role="option" aria-selected={s.view === v.id}>
                      <button className={s.view === v.id ? 'on' : ''} onClick={() => { s.setView(v.id); close(); }}><span>{v.label}</span></button>
                    </li>
                  ))}
                </ul>
                <div className="skybox-title">Show</div>
                {SIMPLE.map(([k, label]) => (
                  <label key={k} className="check">
                    <input type="checkbox" checked={s.layers[k]} onChange={(e) => s.setLayer(k, e.target.checked)} />
                    {label}
                  </label>
                ))}
              </>
            )}
          </Dropdown>
        </div>
        <div className="toolbar-right"><CostReadout /></div>
      </div>
    );
  }
  return (
    <div className="canvasbar">
      <div className="toolbar-left">
      <Dropdown align="left" ariaLabel="Camera view" title={`View: ${current.label} (press 1 to ${s.site.views.length} to switch)`}
        label={<>View<kbd className="key">{currentIndex + 1}</kbd></>}>
        {(close) => (
          <ul className="viewlist" role="listbox" aria-label="Camera views">
            {s.site.views.map((v, i) => (
              <li key={v.id} role="option" aria-selected={s.view === v.id}>
                <button className={s.view === v.id ? 'on' : ''} aria-keyshortcuts={String(i + 1)} title={v.kind === 'walk' ? `${v.label} (press ${i + 1}, or W from any other view)` : `${v.label} (press ${i + 1})`} onClick={() => { s.setView(v.id); close(); }}>
                  <span>{v.label}</span><kbd className="key">{i + 1}</kbd>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Dropdown>
        <Dropdown align="left" ariaLabel="Water" label="Water">
          {() => (
            <>
              <label className="check">
                <input type="checkbox" checked={s.layers.irrigation} onChange={(e) => s.setLayer('irrigation', e.target.checked)} />
                Irrigation layout
              </label>
              <label className="check">
                <input type="checkbox" checked={s.layers.irrigationBeds} onChange={(e) => s.setLayer('irrigationBeds', e.target.checked)} />
                Include raised beds (drip in every bed)
              </label>
              <label className="check" title="Off: a valve is labelled only while it is being watered">
                <input type="checkbox" checked={s.layers.irrigationLabels} onChange={(e) => s.setLayer('irrigationLabels', e.target.checked)} />
                Valve labels (always)
              </label>
              <WaterTiming />
            </>
          )}
        </Dropdown>
        <Dropdown align="left" ariaLabel="Life" label="Life" wide>
          {() => <LifeControls />}
        </Dropdown>
        <Dropdown align="left" ariaLabel="Environment" label="Environment" wide>
          {() => (
            <>
              <label className="check">
                <input type="checkbox" checked={s.layers.planet} onChange={(e) => s.setLayer('planet', e.target.checked)} />
                Tiny planet (curved ground)
              </label>
              <label className="check">
                <input type="checkbox" checked={s.layers.skyBodies} onChange={(e) => s.setLayer('skyBodies', e.target.checked)} />
                Sun, clouds and stars
              </label>
              {(s.layers.planet || s.layers.skyBodies) && <SkyControls />}
            </>
          )}
        </Dropdown>
        <Dropdown align="left" ariaLabel="Other layers" label="Other">
          {() => (
            <>
              {LAYERS.map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={s.layers[k]} onChange={(e) => s.setLayer(k, e.target.checked)} />
                  {label}
                </label>
              ))}
              <label className="check">
                <input type="checkbox" checked={s.aduEnabled} disabled={!edit} onChange={(e) => s.setAduEnabled(e.target.checked)} />
                Model the ADU{!edit && ' (locked)'}
              </label>
            </>
          )}
        </Dropdown>
      </div>
      <div className="toolbar-right">
        <CostReadout />
      </div>
    </div>
  );
}
