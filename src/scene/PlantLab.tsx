import { useMemo } from 'react';
import type { PlantInstance } from '../engine/types';
import { useApp } from '../store/store';
import { GrowthStages } from './GrowthStages';

/**
 * A development-only page (open the app with ?lab) that stands plants side by side at several ages so their shapes
 * can be checked by eye. Options: species=id,id or a habit name or "fruit", years=0,2,5,10,20, month=1..12,
 * container=5gal, spacing=feet, pitch=camera height (0.7 default, 0.1 for a side-on view).
 */
export function PlantLab() {
  const library = useApp((s) => s.library);
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const years = (q.get('years') ?? '0,2,5,10,20').split(',').map(Number);
  const month = Number(q.get('month') ?? 12);
  const container = (q.get('container') ?? '5gal') as PlantInstance['container'];
  const want = q.get('species') ?? 'round';
  const species = useMemo(() => {
    const ids = want.split(',');
    if (want === 'fruit') return library.species.filter((s) => s.fruit);
    if (want === 'all') return library.species;
    const byHabit = library.species.filter((s) => s.habit === want);
    return byHabit.length > 0 ? byHabit : library.species.filter((s) => ids.includes(s.id));
  }, [library, want]);
  const pitch = Number(q.get('pitch') ?? 0.7);
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#dfe7ee' }}>
      <GrowthStages species={species} years={years} month={month} pitch={pitch} container={container} spacing={Number(q.get('spacing')) || undefined} />
    </div>
  );
}
