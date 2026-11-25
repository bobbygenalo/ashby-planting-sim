import { describe, expect, it } from 'vitest';
import { cycleSheet, raiseSheet, swipeSheet } from '../src/ui/sheet';

describe('the bottom sheet on narrow screens', () => {
  it('steps through peek, half and full on taps, and rounds back to peek', () => {
    expect(cycleSheet('peek')).toBe('half');
    expect(cycleSheet('half')).toBe('full');
    expect(cycleSheet('full')).toBe('peek');
  });
  it('opens one step on a swipe up and closes one on a swipe down, and ignores short moves', () => {
    expect(swipeSheet('peek', -40, 24)).toBe('half');
    expect(swipeSheet('half', -40, 24)).toBe('full');
    expect(swipeSheet('full', -80, 24)).toBe('full');
    expect(swipeSheet('full', 40, 24)).toBe('half');
    expect(swipeSheet('peek', 80, 24)).toBe('peek');
    expect(swipeSheet('half', -10, 24)).toBe('half');
  });
  it('is raised to half when something needs showing, never lowered', () => {
    expect(raiseSheet('peek')).toBe('half');
    expect(raiseSheet('half')).toBe('half');
    expect(raiseSheet('full')).toBe('full');
  });
});

import { makeAppStore } from '../src/store/store';

describe('a phone is a viewer', () => {
  it('turns editing off while the screen is phone-size and back on after, and still lets scenarios be switched', () => {
    const st = makeAppStore('edit');
    const a = st.getState();
    a.createScenario();
    const [first, second] = [st.getState().scenarios[0].id, st.getState().scenarios[1].id];
    st.getState().setPhoneViewer(true);
    expect(st.getState().mode).toBe('view');
    const n = st.getState().instances.length;
    st.getState().addInstance('salvia-leucantha', [10, 90]);
    expect(st.getState().instances.length).toBe(n); // the guard blocks the edit
    const from = st.getState().activeScenarioId;
    st.getState().switchScenario(from === first ? second : first);
    expect(st.getState().activeScenarioId).not.toBe(from);
    st.getState().setPhoneViewer(false);
    expect(st.getState().mode).toBe('edit');
  });
  it('keeps a shared view a view when the screen gets wide', () => {
    const st = makeAppStore('view');
    st.getState().setPhoneViewer(true);
    st.getState().setPhoneViewer(false);
    expect(st.getState().mode).toBe('view');
  });
});
