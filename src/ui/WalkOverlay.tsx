import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/store';
import { addLook, hintShown, isMoveCode, listenForWalkKeys } from '../scene/walkInput';

/**
 * Over the yard in the Walk view only: it listens for the movement keys, turns a drag of the mouse into looking
 * around, and covers the canvas so a click never selects or places anything while you are walking.
 */
export function WalkOverlay() {
  const view = useApp((s) => s.view);
  const kind = useApp((s) => s.site.views.find((v) => v.id === s.view)?.kind);
  const active = kind === 'walk';
  // With a plant or a shape in hand to place, the pad steps aside so a click reaches the ground you are looking at.
  const inHand = useApp((s) => !!s.placingSpeciesId || !!s.drawing);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => (active ? listenForWalkKeys() : undefined), [active, view]);

  // The legend fades while walking keys are in use and comes back after ten quiet seconds.
  const [legend, setLegend] = useState(true);
  useEffect(() => {
    if (!active) { setLegend(true); return; }
    const down = new Set<string>();
    let last: number | null = null;
    const touch = (e: KeyboardEvent, isDown: boolean) => {
      if (!isMoveCode(e.code) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isDown) down.add(e.code); else down.delete(e.code);
      last = performance.now();
      setLegend(false);
    };
    const onDown = (e: KeyboardEvent) => touch(e, true);
    const onUp = (e: KeyboardEvent) => touch(e, false);
    const onBlur = () => { down.clear(); last = performance.now(); };
    const timer = window.setInterval(() => setLegend(hintShown(down.size, last, performance.now())), 500);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => { window.clearInterval(timer); window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', onBlur); setLegend(true); };
  }, [active, view]);
  if (!active) return null;

  return (
    <>
      {!inHand && <div
        className="walkpad"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          addLook(e.clientX - d.x, e.clientY - d.y);
          d.x = e.clientX; d.y = e.clientY;
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
      />}
      <div className={`walkhint ${legend ? '' : 'away'}`} role="note" aria-hidden={!legend}>
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · hold <kbd>C</kbd> crouch · drag or arrows to look
      </div>
    </>
  );
}
