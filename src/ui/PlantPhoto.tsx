import type { Species } from '../engine/types';

/** The plant's photo with its credit, or nothing when the species has none. Files live in public/plants and carry their licence in species.json. */
export function PlantPhoto({ sp }: { sp: Species }) {
  const p = sp.photo;
  if (!p) return null;
  const src = `${import.meta.env.BASE_URL ?? '/'}${p.file}`;
  return (
    <figure className="plantphoto">
      <img src={src} alt={`${sp.common} (${sp.botanical})`} loading="lazy" />
      <figcaption className="muted small">
        {p.match === 'cultivar' ? 'Photo' : p.match === 'species' ? 'Photo of the species' : 'Photo of the genus'} by {p.author}, <a href={p.licenseUrl} target="_blank" rel="noreferrer">{p.license}</a>, via <a href={p.page} target="_blank" rel="noreferrer">Wikimedia Commons</a>
      </figcaption>
    </figure>
  );
}
