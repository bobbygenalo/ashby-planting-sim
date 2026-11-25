import { useEffect, useState } from 'react';

/** Below this width the right panel is a bottom sheet over the yard instead of a column beside it. */
export const NARROW_QUERY = '(max-width: 1000px)';
/** Below this width (a phone) the top bar and the yard's controls are folded away too. */
export const PHONE_QUERY = '(max-width: 700px)';

export type Sheet = 'peek' | 'half' | 'full';
const ORDER: Sheet[] = ['peek', 'half', 'full'];

/** A tap on the sheet's handle: peek, half, full, and round to peek again. */
export function cycleSheet(s: Sheet): Sheet {
  return ORDER[(ORDER.indexOf(s) + 1) % ORDER.length];
}

/** A swipe on the handle: up (negative dy) opens one step further, down closes one, a short move changes nothing. */
export function swipeSheet(s: Sheet, dy: number, thresholdPx: number): Sheet {
  const i = ORDER.indexOf(s);
  if (dy <= -thresholdPx) return ORDER[Math.min(ORDER.length - 1, i + 1)];
  if (dy >= thresholdPx) return ORDER[Math.max(0, i - 1)];
  return s;
}

/** Something was selected, put in hand or searched for: the sheet shows it, at least half way up. */
export function raiseSheet(s: Sheet): Sheet {
  return s === 'peek' ? 'half' : s;
}

/** Whether a media query matches now, kept up to date as the window or the device turns. */
export function useMedia(query: string): boolean {
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [query]);
  return on;
}
