import { describe, expect, it } from 'vitest';
import { makeAppStore } from '../src/store/store';

describe('view mode', () => {
  it('blocks plan mutations at the store level but allows viewing controls', () => {
    const view = makeAppStore('view');
    view.getState().setAduEnabled(false);
    expect(view.getState().aduEnabled).toBe(true);
    const site = view.getState().site;
    view.getState().replaceSite({ ...site, name: 'changed' });
    expect(view.getState().site.name).toBe(site.name);
    // Viewers can still orbit, scrub time and toggle layers.
    view.getState().setDoy(10);
    view.getState().setLayer('sunHours', false);
    view.getState().setView('plan');
    expect(view.getState().doy).toBe(10);
    expect(view.getState().layers.sunHours).toBe(false);
    expect(view.getState().view).toBe('plan');
  });

  it('lets the owner mutate in edit mode', () => {
    const edit = makeAppStore('edit');
    edit.getState().setAduEnabled(false);
    expect(edit.getState().aduEnabled).toBe(false);
  });
});
