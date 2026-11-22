import type { SunHoursResult } from '../engine/sunhours';
import { useApp } from '../store/store';
import { HardscapeInspector } from './HardscapeInspector';
import { PlantInspector } from './PlantInspector';

/**
 * Whatever is selected in the yard, a plant or a hardscape element, opens here as a card floating over the
 * right panel, whichever tab is showing. The list underneath stays where it was.
 */
export function SelectionCard({ growing }: { growing: SunHoursResult | null }) {
  const plantId = useApp((s) => s.selectedId);
  const elementId = useApp((s) => s.selectedElementId);
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
  const label = plantId ? plantName : elementId ? elementName : undefined;
  if (!label) return null;
  const close = () => {
    select(null);
    selectElement(null);
  };
  return (
    <div className="selcard" role="dialog" aria-label={`Edit ${label}`}>
      <button className="icon selcard-x" aria-label="Close" onClick={close}>✕</button>
      {plantId ? <PlantInspector growing={growing} /> : <HardscapeInspector />}
    </div>
  );
}
