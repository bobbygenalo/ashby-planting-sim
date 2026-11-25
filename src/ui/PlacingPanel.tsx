import { PlantPhoto } from './PlantPhoto';
import { defaultPlantPrice, materialUnitPrice } from '../engine/pricing';
import { elementColor } from '../engine/hardscape';
import { formatFeetInches } from '../engine/units';
import type { ContainerId, HardscapeType, Species } from '../engine/types';
import { useApp } from '../store/store';
import { PollBadge } from './PlantInspector';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthsLabel = (ms: number[]) => (ms.length === 0 ? 'none' : ms.length === 12 ? 'year-round' : ms.map((m) => MONTHS[m - 1]).join(', '));
const money = (n: number, cur: string) => `${cur}${Math.round(n).toLocaleString()}`;

function PlantDetail({ sp }: { sp: Species }) {
  const s = useApp((x) => x);
  const edit = s.mode === 'edit';
  const starred = !!s.palette[sp.id];
  const placed = s.instances.filter((i) => i.speciesId === sp.id).length;
  const own = s.prices.plant[sp.id];
  const price = own ?? defaultPlantPrice(s.placeContainer, s.engine.pricing);
  return (
    <>
      <div className="row">
        <span style={{ flex: 1 }}>
          <h3 style={{ margin: 0 }}>{sp.common}</h3>
          <small className="muted"><i>{sp.botanical}</i></small>
        </span>
        <button className={`star ${starred ? 'on' : ''}`} disabled={!edit} aria-pressed={starred} aria-label={starred ? `Remove ${sp.common} from starred` : `Star ${sp.common}`} onClick={() => s.setPaletteSpecies(sp.id, !starred)}>{starred ? '★' : '☆'}</button>
      </div>
      <p className="small">
        Click the yard to place it, and keep clicking to place as many as you like. <kbd className="key">Esc</kbd> or Stop placing lets go of it.
        {s.placedRun > 0 && <> <b>{s.placedRun} placed so far.</b></>}
      </p>
      <div className="row wrap">
        <span className="muted small">Place as</span>
        <select value={s.placeContainer} onChange={(e) => s.setPlaceContainer(e.target.value as ContainerId)} disabled={!edit} aria-label="Container size">
          {Object.entries(s.engine.growth.containers).map(([id, c]) => <option key={id} value={id}>{c.label}</option>)}
        </select>
        <span className="muted small">about {money(price, s.engine.pricing.currency)} each{own === undefined ? ' (default for the size)' : ''}</span>
      </div>
      <div className="row wrap">
        <button onClick={() => s.setGrowthStagesFor(sp.id)}>Growth stages…</button>
        <button className="on" onClick={() => s.setPlacing(null)}>Stop placing</button>
      </div>
      <div className="row wrap">
        <PollBadge v={sp.pollinator.value} />
        <span className="pill">{sp.wucols} water</span>
        <span className="pill">{sp.sun} sun</span>
        {sp.origin === 'california native' && <span className="pill native">CA native</span>}
        {sp.invasive && <span className="pill warn">invasive</span>}
        {sp.toxic && <span className="pill warn">toxic</span>}
      </div>
      <PlantPhoto sp={sp} />
      <table className="kv"><tbody>
        <tr><td>Size</td><td>{formatFeetInches(sp.matureHeight, 2)} tall × {formatFeetInches(sp.matureWidth, 2)} wide at maturity, reached in about {sp.yearsToMaturity} year{sp.yearsToMaturity === 1 ? '' : 's'}</td></tr>
        <tr><td>Kind</td><td>{sp.type}, {sp.habit}, {sp.evergreen ? 'evergreen' : `deciduous (bare ${monthsLabel(sp.leafOffMonths)})`}</td></tr>
        <tr><td>Blooms</td><td><span className="swatch" style={{ background: sp.bloomColor, display: 'inline-block', width: 10, height: 10, borderRadius: 5, marginRight: 6 }} />{monthsLabel(sp.bloomMonths)}</td></tr>
        <tr><td>Pollinators</td><td>{sp.pollinator.value}{sp.pollinator.groups.length > 0 && `: ${sp.pollinator.groups.join(', ')}`}</td></tr>
        <tr><td>Origin</td><td>{sp.origin}</td></tr>
        <tr><td>Care</td><td>{sp.maintenance} maintenance</td></tr>
        <tr><td>Soil</td><td>{sp.soil.drainageNeed} drainage; {sp.soil.textures.join(', ')}; pH {sp.soil.phMin} to {sp.soil.phMax}</td></tr>
        <tr><td>Roots</td><td>{sp.roots.behavior}; keep {formatFeetInches(sp.roots.minFoundationFt, 2)} from a foundation and {formatFeetInches(sp.roots.minPavingFt, 2)} from paving</td></tr>
        <tr><td>Placed</td><td>{placed === 0 ? 'none yet' : `${placed} in this scenario`}</td></tr>
      </tbody></table>
      {sp.notes && <p className="small">{sp.notes}</p>}
      <p className="muted small">{sp.sheet ? `${sp.sheet.confidence}. ${sp.sheet.verified ? `Checked: ${sp.sheet.verified}. ` : ''}To confirm: ${sp.sheet.toVerify}.` : 'Unverified, low confidence: compiled without checking WUCOLS, Calscape or Cal-IPC.'}</p>
    </>
  );
}

function HardscapeDetail({ type, shape, points }: { type: HardscapeType; shape?: string; points: number }) {
  const s = useApp((x) => x);
  const cfg = s.engine.hardscape;
  const t = cfg.types[type];
  const mat = s.materials.find((m) => m.id === t.material);
  const mod = cfg.raisedBedModule;
  const bed = type === 'raisedBed' ? mod.shapes.find((sh) => sh.id === shape) : undefined;
  const isLine = t.shape === 'line';
  const preset = !!t.placeSize;
  const need = isLine ? 2 : 3;
  const unit = mat ? materialUnitPrice(mat, s.prices) : 0;
  const basis = mat ? (mat.priceBasis ?? (mat.unit === 'lf' ? 'lf' : 'sf')) : 'sf';
  const color = mat ? elementColor({ materialId: mat.id }, s.materials, cfg) : '#aaaaaa';
  return (
    <>
      <h3 style={{ margin: 0 }}>{type === 'raisedBed' ? `Raised bed${bed ? `, ${bed.label}` : ''}` : t.label}</h3>
      {type === 'raisedBed' ? (
        <p className="small">Click the yard where its center goes. Within {formatFeetInches(mod.snapFt)} of another bed it snaps flush and joins when together they make a 3×6, an L, a 6×6 or a U. <kbd className="key">Esc</kbd> drops it.</p>
      ) : preset ? (
        <p className="small">Click the yard where its center goes ({t.placeSize!.map((n) => formatFeetInches(n)).join(' × ')}); turn or resize it afterwards. <kbd className="key">Esc</kbd> drops it.</p>
      ) : (
        <p className="small">Click to add {isLine ? 'points along the centerline' : 'corners'} ({points} so far). Points snap to corners, then edges, then the {formatFeetInches(s.snap)} grid. Enter or Finish to end; <kbd className="key">Esc</kbd> drops it.</p>
      )}
      {type === 'raisedBed' && (
        <div className="row wrap" role="group" aria-label="Raised bed shapes">
          {mod.shapes.map((sh) => <button key={sh.id} className={shape === sh.id ? 'on' : ''} onClick={() => s.startDrawing('raisedBed', sh.id)}>{sh.label}</button>)}
        </div>
      )}
      <div className="row wrap">
        {!preset && <button className="on" onClick={() => s.finishDrawing()} disabled={points < need}>Finish</button>}
        {!preset && <button onClick={() => s.removeLastDrawPoint()} disabled={points === 0}>Undo point</button>}
        <button onClick={() => s.startDrawing(null)}>Stop placing</button>
      </div>
      <table className="kv"><tbody>
        <tr><td>Material</td><td><span className="swatch" style={{ background: color, display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 6 }} />{mat?.name ?? t.material}</td></tr>
        {mat && <tr><td>Kind</td><td>{mat.category}; {mat.permeability >= 0.5 ? 'water soaks in' : mat.permeability > 0 ? 'partly permeable' : 'water runs off'}</td></tr>}
        {!t.furniture && t.height > 0 && <tr><td>Height</td><td>{formatFeetInches(t.height)}</td></tr>}
        {!t.furniture && t.depthIn > 0 && <tr><td>Surface</td><td>{t.depthIn} in deep</td></tr>}
        {isLine && <tr><td>{type === 'path' ? 'Width' : 'Thickness'}</td><td>{formatFeetInches(t.width, 2)}</td></tr>}
        {bed && <tr><td>Size</td><td>{bed.cells.length} square{bed.cells.length === 1 ? '' : 's'} of {formatFeetInches(mod.cellFt)}, about {bed.cells.length * mod.cellFt * mod.cellFt} sq ft</td></tr>}
        {mat && <tr><td>Price</td><td>about {money(unit, s.engine.pricing.currency)} per {basis === 'each' ? 'item' : basis === 'lf' ? 'linear ft' : 'sq ft'} (a stand-in; set yours under Outputs)</td></tr>}
      </tbody></table>
      {mat?.note && <p className="small">{mat.note}</p>}
    </>
  );
}

/**
 * The right panel while something is in hand to place: details of that plant or kind of hardscape, with the controls that
 * go with it (container size, shapes, Finish and Undo while drawing), in place of the Design, Analyze and Outputs tabs.
 */
export function PlacingPanel() {
  const placingId = useApp((x) => x.placingSpeciesId);
  const drawing = useApp((x) => x.drawing);
  const species = useApp((x) => x.library.species);
  const sp = placingId ? species.find((q) => q.id === placingId) : undefined;
  if (!sp && !drawing) return null;
  return (
    <div className="placing" role="region" aria-label="What you are placing">
      {sp ? <PlantDetail sp={sp} /> : drawing && <HardscapeDetail type={drawing.type} shape={drawing.shape} points={drawing.points.length} />}
    </div>
  );
}
