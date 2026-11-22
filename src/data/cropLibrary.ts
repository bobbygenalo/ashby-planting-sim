import raw from './crops.json';
import type { Crop } from '../engine/types';

export const CROPS = raw.crops as unknown as Crop[];
