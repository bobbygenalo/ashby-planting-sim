/** The keys that switch the camera view: 1 for the first view, 2 for the second, and so on. */
export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
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
