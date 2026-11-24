import type { PlayerInput } from '../engine/player';

/** Keys held and mouse drag waiting to be applied, shared by the overlay that listens and the scene that moves the player. */
const held = new Set<string>();
let dragX = 0;
let dragY = 0;

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** What the keyboard asks of the player right now. */
export function readInput(): PlayerInput {
  const k = (c: string) => (held.has(c) ? 1 : 0);
  return {
    forward: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown'),
    strafe: k('KeyD') - k('KeyA'),
    run: held.has('ShiftLeft') || held.has('ShiftRight'),
    jump: held.has('Space'),
    turn: k('ArrowRight') - k('ArrowLeft'),
  };
}

export function addLook(dx: number, dy: number) { dragX += dx; dragY += dy; }

/** The mouse drag since the last call, in pixels. */
export function takeLook(): { dx: number; dy: number } {
  const r = { dx: dragX, dy: dragY };
  dragX = dragY = 0;
  return r;
}

export function clearInput() { held.clear(); dragX = dragY = 0; }

/** Listen for the movement keys until the returned function is called. Typing in a field or an open dialog is left alone. */
export function listenForWalkKeys(): () => void {
  const typing = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };
  const down = (e: KeyboardEvent) => {
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || !MOVE_KEYS.has(e.code)) return;
    if (document.querySelector('.dialog')) return;
    e.preventDefault();
    // A button that has focus would also be pressed by the space bar, so let go of it.
    if (e.code === 'Space' && document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
    held.add(e.code);
  };
  const up = (e: KeyboardEvent) => { held.delete(e.code); };
  const blur = () => held.clear();
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('blur', blur);
  return () => {
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('blur', blur);
    clearInput();
  };
}
