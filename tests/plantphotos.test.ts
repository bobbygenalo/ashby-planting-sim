import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import species from '../src/data/species.json';
import type { Species } from '../src/engine/types';

const all = (species as { species: Species[] }).species;

describe('plant photos', () => {
  const withPhoto = all.filter((s) => s.photo);
  it('most species have a photo', () => expect(withPhoto.length).toBeGreaterThan(60));
  it('every photo file exists and is credited under a free licence', () => {
    for (const s of withPhoto) {
      const p = s.photo!;
      expect(existsSync(join(__dirname, '..', 'public', p.file)), s.id).toBe(true);
      expect(p.author.length, s.id).toBeGreaterThan(0);
      expect(p.page, s.id).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
      expect(p.license, s.id).toMatch(/^(CC0|Public domain|CC BY)/);
      expect(p.author, s.id).not.toMatch(/</);
    }
  });
});
