import { useEffect, useRef, useState } from 'react';
import type { SunHoursResult } from '../engine/sunhours';
import { useApp } from '../store/store';
import { HardscapeInspector } from './HardscapeInspector';
import { PlantInspector } from './PlantInspector';
import { HiveInspector } from './HiveInspector';

/**
 * Whatever is selected in the yard, a plant or a hardscape element, opens here as a card over the yard, against its
 * right edge (just left of the right panel) with its bottom resting above the time controls, whichever tab is showing.
 */
/** Space kept around the card, in pixels. */
const GAP = 10;

export function SelectionCard({ growing }: { growing: SunHoursResult | null }) {
  const plantId = useApp((s) => s.selectedId);
  const elementId = useApp((s) => s.selectedElementId);
  const hiveSelected = useApp((s) => s.hiveSelected);
  const selectHive = useApp((s) => s.selectHive);
  const select = useApp((s) => s.select);
  const selectElement = useApp((s) => s.selectElement);
  const plantName = useApp((s) => {
    const i = s.instances.find((x) => x.id === s.selectedId);
    return i ? s.library.species.find((x) => x.id === i.speciesId)?.common : undefined;
  });
  const elementName = useApp((s) => {
    const e = s.hardscape.find((x) => x.id === s.selectedElementId);
    return e ? e.name ?? s.engine.hardscape.types[e.type].label : undefined;
  });
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  const label = hiveSelected ? 'Beehive' : plantId ? plantName : elementId ? elementName : undefined;
  // Keep the card's bottom above the time controls, whatever their height (they wrap on a narrow yard).
  useEffect(() => {
    const dock = ref.current?.parentElement?.querySelector('.simdock');
    if (!dock) return;
    const measure = () => setLift(dock.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(dock);
    return () => ro.disconnect();
  }, [label]);
  if (!label) return null;
  const close = () => {
    select(null);
    selectElement(null);
    selectHive(false);
  };
  return (
    <div className="selcard" ref={ref} role="dialog" aria-label={`Edit ${label}`} style={{ bottom: GAP + lift + GAP, maxHeight: `calc(100% - ${GAP + lift + GAP}px - 110px)` }}>
      <button className="icon selcard-x" aria-label="Close" onClick={close}>✕</button>
      {hiveSelected ? <HiveInspector /> : plantId ? <PlantInspector growing={growing} /> : <HardscapeInspector />}
    </div>
  );
}
