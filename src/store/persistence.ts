import { useEffect } from 'react';
import { loadWorkspace, saveWorkspace, type KeyValueStorage } from '../engine/scenario';
import { appStore, type AppState } from './store';

/** localStorage, or null where it is blocked (private windows, some embeds). Reading the property can itself throw. */
export function browserStorage(): KeyValueStorage | null {
  try {
    const s = window.localStorage;
    s.getItem('ashby-planner/probe');
    return s;
  } catch {
    return null;
  }
}

/** Bring back the owner's saved work. Only the owner's own browser does this; a viewer never reads it. */
export function restoreWorkspace(): boolean {
  if (appStore.getState().mode !== 'edit') return false;
  const storage = browserStorage();
  if (!storage) return false;
  const ws = loadWorkspace(storage);
  if (!ws) return false;
  appStore.getState().hydrateWorkspace(ws);
  return true;
}

/** Save right now (the Save button), and report the result in the save status. */
export function saveNow(): boolean {
  const set = appStore.getState().setSaveStatus;
  const storage = browserStorage();
  if (!storage) {
    set({ state: 'error', at: null, message: 'This browser blocks saving. Export your scenarios to keep them.' });
    return false;
  }
  appStore.getState().commitDrawing();
  const r = saveWorkspace(storage, appStore.getState().toWorkspace());
  if (r.ok) set({ state: 'saved', at: new Date().toISOString(), message: null });
  else set({ state: 'error', at: null, message: `Could not save (${r.error}). Export your scenarios to keep them.` });
  return r.ok;
}

export const WATCHED: (keyof AppState)[] = [
  'instances', 'palette', 'hardscape', 'hydrozones', 'autoIrrigation', 'useRain', 'aduEnabled', 'hive', 'scenarios', 'activeScenarioId', 'saved',
  'shares', 'soilProfiles', 'playZones', 'library',
];

/** Save the owner's work shortly after every change (SC-2). Nothing is saved in a shared view. */
export function useAutosave(delayMs = 600) {
  useEffect(() => {
    if (appStore.getState().mode !== 'edit') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      timer = undefined;
      const storage = browserStorage();
      const set = appStore.getState().setSaveStatus;
      if (!storage) return set({ state: 'error', at: null, message: 'This browser blocks saving. Export your scenarios to keep them.' });
      const r = saveWorkspace(storage, appStore.getState().toWorkspace());
      if (r.ok) set({ state: 'saved', at: new Date().toISOString(), message: null });
      else set({ state: 'error', at: null, message: `Could not save (${r.error}). Export your scenarios to keep them.` });
    };
    const unsub = appStore.subscribe((s, prev) => {
      if (WATCHED.some((k) => s[k] !== prev[k])) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(save, delayMs);
      }
    });
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        save();
      }
    };
    window.addEventListener('pagehide', flush);
    return () => {
      unsub();
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [delayMs]);
}
