import type { SunHoursResult } from '../engine/sunhours';
import { useApp } from '../store/store';
import { HardscapeInspector } from './HardscapeInspector';
import { PlantInspector } from './PlantInspector';
import { HiveInspector } from './HiveInspector';

/**
 * Whatever is selected in the yard, a plant, a hardscape element or the hive, is the right panel while it is selected:
 * its details and controls replace the Design, Analyze and Outputs tabs (which are only hidden, so their state stays).
 * Escape, or the close button, clears the selection and the tabs come back.
 */
export function SelectionPanel({ growing }: { growing: SunHoursResult | null }) {
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
  const label = hiveSelected ? 'Beehive' : plantId ? plantName : elementId ? elementName : undefined;
  if (!label) return null;
  const close = () => {
    select(null);
    selectElement(null);
    selectHive(false);
  };
  return (
    <div className="selpanel" role="region" aria-label={`Edit ${label}`}>
      <button className="icon selpanel-x" aria-label="Close (Esc)" title="Close (Esc)" onClick={close}>✕</button>
      {hiveSelected ? <HiveInspector /> : plantId ? <PlantInspector growing={growing} /> : <HardscapeInspector />}
    </div>
  );
}
