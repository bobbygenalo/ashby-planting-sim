/** The keys that switch the camera view: 1 for the first view, 2 for the second, and so on. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}

/**
 * The view a key press selects, or null. Number keys only, and only on their own, so Cmd/Ctrl+1 (a browser shortcut)
 * and Shift+1 are left alone.
 */
export function viewForKey(views: { id: string }[], e: KeyLike): string | null {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (!/^[1-9]$/.test(e.key)) return null;
  return views[Number(e.key) - 1]?.id ?? null;
}

/** The space bar on its own plays and pauses growth. Held-down repeats and combinations with other keys are ignored. */
export function isPlayPauseKey(e: KeyLike): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return false;
  return e.key === ' ' || e.key === 'Spacebar';
}

/**
 * How far an arrow key moves the selected plant or element, in site feet [dx, dy], or null for any other key.
 * Left and right are -X and +X; up is toward the rear of the lot (+Y) and down toward the street, as the plan view
 * and the Nudge buttons have it. `step` is the snap size; Shift moves `shiftMultiplier` times as far. Cmd, Ctrl and Alt
 * combinations belong to the browser and are ignored.
 */
export function arrowDelta(e: KeyLike, step: number, shiftMultiplier: number): [number, number] | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  const d = e.shiftKey ? step * shiftMultiplier : step;
  switch (e.key) {
    case 'ArrowLeft': return [-d, 0];
    case 'ArrowRight': return [d, 0];
    case 'ArrowUp': return [0, d];
    case 'ArrowDown': return [0, -d];
    default: return null;
  }
}

/** W on its own, outside the Walk view, takes you into it (inside the Walk view W walks forward). Held-down repeats and combinations are ignored. */
export function isWalkKey(e: KeyLike): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return false;
  return e.key === 'w' || e.key === 'W';
}

/** F on its own frames the selected element in the view. Held-down repeats and combinations (Cmd+F finds on the page) are ignored. */
export function isFitKey(e: KeyLike): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return false;
  return e.key === 'f' || e.key === 'F';
}

/** "/" on its own, or Cmd/Ctrl+K, opens quick find. */
export function isFindKey(e: KeyLike): boolean {
  if (e.altKey) return false;
  if (e.key === '/' && !e.metaKey && !e.ctrlKey) return true;
  return (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'k';
}
