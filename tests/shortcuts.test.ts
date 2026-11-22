import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { arrowDelta, isPlayPauseKey, viewForKey } from '../src/ui/shortcuts';

const views = (siteRaw as { views: { id: string; label: string }[] }).views;
const press = (key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  viewForKey(views, { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

describe('view shortcuts', () => {
  it('maps 1 to 6 to the views in the order of the buttons', () => {
    expect(views.length).toBeGreaterThanOrEqual(6);
    views.forEach((v, i) => expect(press(String(i + 1))).toBe(v.id));
    expect(press('1')).toBe('orbit');
    expect(press('2')).toBe('plan');
  });

  it('ignores keys with no view, other keys, and combinations that belong to the browser', () => {
    expect(press('0')).toBeNull();
    expect(press(String(views.length + 1))).toBeNull();
    expect(press('9')).toBeNull();
    expect(press('a')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('1', { metaKey: true })).toBeNull();
    expect(press('1', { ctrlKey: true })).toBeNull();
    expect(press('1', { altKey: true })).toBeNull();
    expect(press('1', { shiftKey: true })).toBeNull();
    expect(viewForKey([], { key: '1', metaKey: false, ctrlKey: false, altKey: false })).toBeNull();
  });
});

describe('play and pause shortcut', () => {
  const k = (key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean }> = {}) =>
    isPlayPauseKey({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });
  it('is the space bar alone', () => {
    expect(k(' ')).toBe(true);
    expect(k('Spacebar')).toBe(true);
    expect(k('a')).toBe(false);
    expect(k('Enter')).toBe(false);
  });
  it('ignores combinations and key repeat', () => {
    for (const x of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat'] as const) expect(k(' ', { [x]: true })).toBe(false);
  });
});

describe('arrow keys', () => {
  const k = (key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    arrowDelta({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra }, 0.5, 4);
  it('move one step: left and right along X, up toward the rear and down toward the street', () => {
    expect(k('ArrowLeft')).toEqual([-0.5, 0]);
    expect(k('ArrowRight')).toEqual([0.5, 0]);
    expect(k('ArrowUp')).toEqual([0, 0.5]);
    expect(k('ArrowDown')).toEqual([0, -0.5]);
  });
  it('move further with Shift, and ignore other keys and browser combinations', () => {
    expect(k('ArrowRight', { shiftKey: true })).toEqual([2, 0]);
    expect(k('a')).toBeNull();
    expect(k('ArrowLeft', { metaKey: true })).toBeNull();
    expect(k('ArrowLeft', { ctrlKey: true })).toBeNull();
    expect(k('ArrowLeft', { altKey: true })).toBeNull();
  });
});
