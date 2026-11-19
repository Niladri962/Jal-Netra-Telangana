// Geographic reference data for Telangana.
//
// VERIFIED / REAL: the 33 district names, approximate district headquarters coordinates,
// mandal names, and the named reservoirs/barrages (real water bodies, approximate coordinates).
// ILLUSTRATIVE / SIMULATED: which source feeds which district, treatment plants, service
// reservoirs, and every pipeline alignment. Pipelines are drawn as schematic straight
// connections and are NOT actual Mission Bhagiratha alignments.

import type { WaterSource } from './types';
import GEO from '../data/telangana_geo.json';

export interface DistrictSeed {
  id: string;
  name: string;
  hq: string;
  lat: number;
  lng: number;
  sourceId: string;
  mandals: string[];
}

// Shared with the Python backend generator so both use identical geography.
export const SOURCES: WaterSource[] = GEO.sources as WaterSource[];
export const DISTRICTS: DistrictSeed[] = GEO.districts as DistrictSeed[];

// Synthetic habitation names (built from common Telugu place-name stems). They are NOT
// intended to identify real villages; every record carries a "SIM" label in the UI.
export const NAME_STEMS = [
  'Rama', 'Gopal', 'Laxmi', 'Venkata', 'Sita', 'Konda', 'Pedda', 'Chinna', 'Nalla', 'Erra', 'Malla', 'Bhima',
  'Hanuma', 'Ananta', 'Raja', 'Siri', 'Ganga', 'Mutyala', 'Kotha', 'Mamidi', 'Vem', 'Tummala', 'Jangam', 'Gollа',
  'Nara', 'Pulla', 'Indra', 'Chandra', 'Surya', 'Bandla', 'Rayi', 'Kesava', 'Uppala', 'Damera', 'Kodur',
].map((s) => s.replace('а', 'a'));
export const NAME_SUFFIXES = ['puram', 'pally', 'gudem', 'pet', 'nagar', 'wada', 'thanda', 'palem', 'guda', 'kunta', 'varam', 'konda'];

export const TELANGANA_BOUNDS: [[number, number], [number, number]] = [
  [15.75, 77.1],
  [19.98, 81.4],
];
export const TELANGANA_CENTER: [number, number] = [17.95, 79.1];

// Monthly climatology used by the demand model (illustrative, roughly Telangana-like).
// [mean daily max °C, mean daily rainfall mm, demand seasonal multiplier]
export const CLIMATE: [number, number, number][] = [
  [30, 0.2, 0.97], // Jan
  [33, 0.3, 1.0], // Feb
  [36, 0.5, 1.06], // Mar
  [39, 0.8, 1.12], // Apr
  [41, 1.0, 1.16], // May
  [36, 4.0, 1.08], // Jun
  [31, 7.0, 0.94], // Jul
  [30, 7.5, 0.92], // Aug
  [31, 5.5, 0.94], // Sep
  [31, 3.0, 0.97], // Oct
  [30, 0.9, 0.97], // Nov
  [29, 0.3, 0.96], // Dec
];
