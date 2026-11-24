import { useEffect, useRef } from 'react';
import { useApp } from '../store/store';
import { addLook, listenForWalkKeys } from '../scene/walkInput';

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
      <div className="walkhint" role="note">
        <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · hold <kbd>C</kbd> crouch · drag or arrows to look
      </div>
    </>
  );
}
