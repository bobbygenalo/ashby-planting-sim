import { useEffect, useRef, useState } from 'react';
import { fenceLayout, fenceRun, materialOf, packBlocks, vineSpots } from '../engine/fencedesign';
import { useApp } from '../store/store';

function Slider({ label, min, max, step, value, onChange, format }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label>{label}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <output>{format(value)}</output>
    </label>
  );
}

const ft = (v: number) => `${v} ft`;
const inch = (v: number) => `${v} in`;

/**
 * The west fence's design: blocks of different materials and widths along the fence line, which can be moved and shuffled, the fill
 * between them, and the plants that climb the wire panels. A bar down the far left of the yard, under the dropdowns (beside the
 * shuffle bar when that is open), shown while "Customize fence" in the Other menu is on.
 */
export function FenceBar() {
  const d = useApp((x) => x.fenceDesign);
  const cfg = useApp((x) => x.engine.fenceDesign);
  const patch = useApp((x) => x.patchFenceDesign);
  const add = useApp((x) => x.addFenceBlock);
  const update = useApp((x) => x.updateFenceBlock);
  const remove = useApp((x) => x.removeFenceBlock);
  const duplicate = useApp((x) => x.duplicateFenceBlock);
  const move = useApp((x) => x.moveFenceBlock);
  const reorder = useApp((x) => x.reorderFenceBlock);
  const shuffle = useApp((x) => x.shuffleFenceBlocks);
  const apply = useApp((x) => x.applyFenceVines);
  const clear = useApp((x) => x.clearFenceVines);
  const library = useApp((x) => x.library);
  const site = useApp((x) => x.site);
  const instances = useApp((x) => x.instances);
  const edit = useApp((x) => x.mode === 'edit');
  const setCustom = useApp((x) => x.setFenceCustom);
  const barOpen = useApp((x) => x.fenceBarOpen);
  const setBarOpen = useApp((x) => x.setFenceBarOpen);
  const shuffleOpen = useApp((x) => x.shuffleOpen && x.mode === 'edit');
  const [note, setNote] = useState('');
  const picked = useApp((x) => x.fenceBlockId);
  const setPicked = useApp((x) => x.selectFenceBlock);
  // dragging a block up or down the list: which one, and where it would land (0 to the number of blocks: before that row)
  const [drag, setDrag] = useState<{ id: string; at: number | null } | null>(null);
  // Sit just beneath the dropdowns, which wrap onto more rows in a narrow yard.
  const bar = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(54);
  const open = !!d && edit && barOpen;
  useEffect(() => {
    if (!open) return;
    const stage = bar.current?.parentElement;
    const views = stage?.querySelector('.viewbar');
    if (!views || !stage) return;
    const place = () => setTop(Math.round(views.getBoundingClientRect().bottom - stage.getBoundingClientRect().top + 8));
    place();
    const ro = new ResizeObserver(place);
    ro.observe(views);
    return () => ro.disconnect();
  }, [open]);
  // Escape lets go of the picked block, and a block picked in the yard scrolls into view in the list.
  useEffect(() => {
    if (!picked || !open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) setPicked(null);
    };
    window.addEventListener('keydown', onKey);
    bar.current?.querySelector('.fenceblock.on')?.scrollIntoView?.({ block: 'nearest' });
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, open, setPicked]);
  if (!d || !edit || !barOpen) return null;

  const run = fenceRun(site, cfg);
  const streetAt = run?.a[1] ?? 0; // the fence starts this far from the street
  const lengthFt = run?.lengthFt ?? 1;
  const layout = run ? fenceLayout(d, run.lengthFt, cfg) : null;
  const blocks = run ? packBlocks(d.blocks, cfg, run.lengthFt) : [];
  const sel = blocks.find((b) => b.id === picked) ?? null;
  const selMat = sel ? materialOf(cfg, sel.material) : undefined;
  // how many plants this panel asked for and how many found room
  const hereCount = (b: { atFt: number; widthFt: number }) => (run ? instances.filter((i) => i.id.startsWith(cfg.vine.idPrefix) && (i.position[1] - run.a[1]) >= b.atFt - 1e-6 && (i.position[1] - run.a[1]) <= b.atFt + b.widthFt + 1e-6).length : 0);
  const wantedCount = (id: string) => (run && layout ? vineSpots({ ...d, blocks: d.blocks.map((b) => ({ ...b, climbers: b.id === id })) }, run.a, run.b, cfg, layout).length : 0);
  const vines = library.species.filter((s) => s.habit === 'vine');
  const planted = instances.filter((i) => i.id.startsWith(cfg.vine.idPrefix)).length;
  const toggleVine = (id: string) => patch({ vines: d.vines.includes(id) ? d.vines.filter((v) => v !== id) : [...d.vines, id] });
  const street = (along: number) => Math.round((streetAt + along) * 10) / 10;

  return (
    <div className="fencebar" ref={bar} style={{ top, left: shuffleOpen ? 230 : 10, maxHeight: `calc(100% - ${top}px - 110px)` }} role="group" aria-label="Fence design">
      <div className="fencebar-head">
        <span className="skybox-title">Customize fence</span>
        <button type="button" className="icon" aria-label="Close this panel" title="Close this panel: the fence design stays in the yard (open it again from Other)" onClick={() => setBarOpen(false)}>×</button>
      </div>

      <div className="skybox-title">Fence line <span className="muted">({Math.round(streetAt)} to {Math.round(streetAt + lengthFt)} ft from the street)</span></div>
      <div className="fencestrip" role="list" aria-label="Fence blocks along the fence line">
        {layout?.segments.map((sg, i) => (
          <button
            key={i} type="button" role="listitem"
            className={`fenceseg ${sg.kind} ${sg.blockId ? 'block' : ''} ${sg.blockId && sg.blockId === picked ? 'on' : ''}`}
            style={{ left: `${(sg.from / lengthFt) * 100}%`, width: `${((sg.to - sg.from) / lengthFt) * 100}%`, background: sg.color }}
            title={`${materialOf(cfg, sg.material)?.label ?? sg.material}, ${Math.round((sg.to - sg.from) * 10) / 10} ft, at ${street(sg.from)} ft${sg.blockId ? '' : ' (fill)'}`}
            onClick={() => sg.blockId && setPicked(sg.blockId === picked ? null : sg.blockId)}
            aria-label={`${materialOf(cfg, sg.material)?.label ?? sg.material}, ${Math.round((sg.to - sg.from) * 10) / 10} feet at ${street(sg.from)} feet${sg.blockId ? '' : ', fill'}`}
          />
        ))}
      </div>

      <div className="fencerow fenceadd" role="group" aria-label="Add a block">
        {cfg.quickAdd.map((q) => (
          <button key={q.material} type="button" className="fenceaddbtn" title={`Add ${q.widthFt} ft of ${materialOf(cfg, q.material)?.label.toLowerCase() ?? q.material} after the last block`} onClick={() => { const id = add(q.material, undefined, q.widthFt); if (id) { setPicked(id); setNote(`${q.label} added`); } else setNote('No room for another block'); }}>
            <i style={{ background: materialOf(cfg, q.material)?.color }} />+ {q.label}
          </button>
        ))}
      </div>
      <label className="check" title="Give every hog wire, cattle and welded wire panel a wooden top piece (a panel can still be changed on its own)">
        <input type="checkbox" checked={d.wireTop} onChange={(e) => patch({ wireTop: e.target.checked, blocks: d.blocks.map(({ topPiece: _t, ...b }) => { void _t; return b; }) })} />
        Wood top on every wire panel
      </label>
      <div className="fencerow">
        <button type="button" disabled={blocks.length < 2} onClick={() => { shuffle(); setNote('Blocks shuffled'); }} title="Put the blocks in a new order along the same stretch of fence">Shuffle blocks</button>
        <span className="muted">{blocks.length} block{blocks.length === 1 ? '' : 's'}</span>
      </div>

      <div className="fenceblocks" onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag((d) => (d ? { ...d, at: null } : d)); }}>
        {blocks.map((b, i) => {
          const m = materialOf(cfg, b.material);
          const dragging = drag?.id === b.id;
          const mark = drag && drag.at !== null && !dragging ? (drag.at === i ? 'before' : drag.at === i + 1 && i === blocks.length - 1 ? 'after' : '') : '';
          return (
            <div
              key={b.id}
              className={`fenceblock ${b.id === picked ? 'on' : ''} ${dragging ? 'dragging' : ''} ${mark ? `drop-${mark}` : ''}`}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); setDrag({ id: b.id, at: null }); setPicked(b.id); }}
              onDragEnd={() => setDrag(null)}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = e.currentTarget.getBoundingClientRect();
                const at = e.clientY < r.top + r.height / 2 ? i : i + 1;
                if (drag.at !== at) setDrag({ ...drag, at });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && drag.at !== null) {
                  const from = blocks.findIndex((x) => x.id === drag.id);
                  reorder(drag.id, drag.at > from ? drag.at - 1 : drag.at);
                  setNote('Block moved');
                }
                setDrag(null);
              }}
            >
              <span className="fencegrip" aria-hidden="true" title="Drag to reorder">⠿</span>
              <button type="button" className="fenceblock-main" onClick={() => setPicked(b.id === picked ? null : b.id)} aria-pressed={b.id === picked}>
                <i style={{ background: m?.color }} />
                <span>{m?.label ?? b.material}</span>
                <span className="muted">{b.climbers ? '🌿 ' : ''}{b.widthFt} ft at {street(b.atFt)}</span>
              </button>
              <button type="button" className="icon" aria-label="Move toward the street" title="Trade places with the block toward the street" onClick={() => move(b.id, -1)}>↑</button>
              <button type="button" className="icon" aria-label="Move toward the rear" title="Trade places with the block toward the rear" onClick={() => move(b.id, 1)}>↓</button>
              <button type="button" className="icon" aria-label="Duplicate block" title="Duplicate: a copy with the same settings goes right after it" onClick={() => { const nid = duplicate(b.id); if (nid) { setPicked(nid); setNote('Block duplicated'); } else setNote('No room for a copy'); }}>⧉</button>
              <button type="button" className="icon" aria-label="Remove block" title="Remove this block (the fill takes its place)" onClick={() => { remove(b.id); if (b.id === picked) setPicked(null); }}>×</button>
            </div>
          );
        })}
      </div>

      {sel && selMat && (
        <div className="fencedetail">
          <div className="fencerow">
            <span className="skybox-title">This block</span>
            <button type="button" style={{ marginLeft: 'auto' }} title="Add a copy with the same settings right after this block, and select it, so you can press again to repeat it" onClick={() => { const nid = duplicate(sel.id); if (nid) { setPicked(nid); setNote('Block duplicated'); } else setNote('No room for a copy'); }}>Duplicate</button>
          </div>
          <label>Material
            <select value={sel.material} onChange={(e) => update(sel.id, { material: e.target.value })} aria-label="Block material">
              {cfg.materials.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label>Width
            <select value={sel.widthFt} onChange={(e) => update(sel.id, { widthFt: Number(e.target.value) })} aria-label="Block width">
              {selMat.widthsFt.map((w) => <option key={w} value={w}>{w} ft</option>)}
            </select>
          </label>
          <Slider label="Starts" min={Math.round(streetAt)} max={Math.round(streetAt + lengthFt)} step={cfg.blockStepFt} value={Math.round((streetAt + sel.atFt) * 2) / 2} onChange={(v) => update(sel.id, { atFt: v - streetAt })} format={(v) => `${v} ft`} />
          {selMat.kind === 'boards' ? (
            <>
              <label>Board size
                <select value={sel.boardNominalIn ?? d.boardNominalIn} onChange={(e) => update(sel.id, { boardNominalIn: Number(e.target.value) })} aria-label="Block board size">
                  {cfg.boardNominalIn.map((n) => <option key={n} value={n}>1x{n} ({cfg.boardActualIn[String(n)]} in)</option>)}
                </select>
              </label>
              <Slider label="Gap" {...cfg.boardGapIn} value={sel.boardGapIn ?? d.boardGapIn} onChange={(v) => update(sel.id, { boardGapIn: v })} format={(v) => (v === 0 ? 'none' : `${v} in`)} />
              <label>Fence height
                <select value={sel.heightFt ?? d.fillHeightFt} onChange={(e) => update(sel.id, { heightFt: Number(e.target.value) })} aria-label="Block fence height">
                  {cfg.boardHeightFt.options.map((h) => <option key={h} value={h}>{h} ft (posts too)</option>)}
                </select>
              </label>
            </>
          ) : (
            <>
              <Slider label="Height" {...cfg.panelHeightIn} value={sel.heightIn ?? selMat.heightIn ?? 36} onChange={(v) => update(sel.id, { heightIn: v })} format={inch} />
              <Slider label="Grid width" {...cfg.gridIn} value={sel.gridWidthIn ?? selMat.gridWidthIn ?? 4} onChange={(v) => update(sel.id, { gridWidthIn: v })} format={inch} />
              <Slider label="Grid height" {...cfg.gridIn} value={sel.gridHeightIn ?? selMat.gridHeightIn ?? 4} onChange={(v) => update(sel.id, { gridHeightIn: v })} format={inch} />
              <Slider label="Off the ground" {...cfg.panelBottomFt} value={sel.bottomFt ?? cfg.panelBottomFt.default ?? 0} onChange={(v) => update(sel.id, { bottomFt: v })} format={ft} />
              <label className="check" title="A wooden board laid across the top of this panel">
                <input type="checkbox" checked={sel.topPiece ?? d.wireTop} onChange={(e) => update(sel.id, { topPiece: e.target.checked })} />
                Wood top piece
              </label>
              <label className="check" title={d.vines.length ? 'Set out the chosen climbing plants along this panel' : 'Choose climbing plants below first'}>
                <input type="checkbox" checked={!!sel.climbers} disabled={!d.vines.length && !sel.climbers} onChange={(e) => { update(sel.id, { climbers: e.target.checked }); setNote(e.target.checked ? 'Climbing plants set out along this panel' : 'Climbing plants removed from this panel'); }} />
                Climbing plants on this panel{!d.vines.length && !sel.climbers ? ' (choose some below)' : ''}
              </label>
              {sel.climbers && <div className="muted">{hereCount(sel)} of {wantedCount(sel.id)} plants set out here{hereCount(sel) < wantedCount(sel.id) ? ': no room for the rest (the driveway or a step is in the way)' : ''}</div>}
            </>
          )}
        </div>
      )}

      <div className="skybox-title">Everywhere else (the fill)</div>
      <label>Material
        <select value={d.fillMaterial} onChange={(e) => patch({ fillMaterial: e.target.value })} aria-label="Fill material">
          {cfg.materials.filter((m) => m.kind === 'boards').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label>Posts every
        <select value={d.fillBayFt} onChange={(e) => patch({ fillBayFt: Number(e.target.value) })} aria-label="Distance between posts in the fill">
          {cfg.fill.bayFt.options.map((n) => <option key={n} value={n}>{n} ft</option>)}
        </select>
      </label>
      <label>Board size
        <select value={d.boardNominalIn} onChange={(e) => patch({ boardNominalIn: Number(e.target.value) })} aria-label="Fill board size">
          {cfg.boardNominalIn.map((n) => <option key={n} value={n}>1x{n} ({cfg.boardActualIn[String(n)]} in)</option>)}
        </select>
      </label>
      <Slider label="Gap" {...cfg.boardGapIn} value={d.boardGapIn} onChange={(v) => patch({ boardGapIn: v })} format={(v) => (v === 0 ? 'none' : `${v} in`)} />
      <label>Fence height
        <select value={d.fillHeightFt} onChange={(e) => patch({ fillHeightFt: Number(e.target.value) })} aria-label="Fill fence height">
          {cfg.boardHeightFt.options.map((h) => <option key={h} value={h}>{h} ft (posts too)</option>)}
        </select>
      </label>
      {layout && <div className="muted">{layout.boards.length} boards, {layout.panels.length} wire panels, {layout.posts.length} posts; 4x4 posts and rails on the west side</div>}

      <div className="skybox-title">Climbing plants <span className="muted">(choose what, then which panels)</span></div>
      {vines.map((s) => (
        <label key={s.id} className="check">
          <input type="checkbox" checked={d.vines.includes(s.id)} onChange={() => toggleVine(s.id)} />
          {s.common} <span className="muted">({s.matureHeight} x {s.matureWidth} ft)</span>
        </label>
      ))}
      <Slider label="One every" {...cfg.vine.spacingFt} value={d.vineSpacingFt} onChange={(v) => patch({ vineSpacingFt: v })} format={ft} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" disabled={!d.vines.length || !layout?.panels.length} onClick={() => { const n = apply(); setNote(`${n} planted on ${layout?.panels.length ?? 0} panel${layout?.panels.length === 1 ? '' : 's'}`); }}>Plant every panel</button>
        <button type="button" className="linklike" disabled={!planted} onClick={() => { clear(); setNote('removed'); }}>Remove all ({planted})</button>
      </div>
      <button type="button" className="linklike" onClick={() => setCustom(false)} title="Take the custom fence out and go back to the plain fence (the climbing plants it set out go too)">Turn off the custom fence</button>
      <div className="muted" aria-live="polite">{note || (planted ? `${planted} planted; they follow their panels when blocks move` : 'Plants are set out 1 ft from the fence and join the plan.')}</div>
    </div>
  );
}
