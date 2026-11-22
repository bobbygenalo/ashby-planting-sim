import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import { viewForKey } from '../src/ui/shortcuts';

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
