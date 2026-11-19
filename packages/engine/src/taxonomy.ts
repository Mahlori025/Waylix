import type { Domain, Severity } from './types.ts';

/**
 * A hazard type definition. Each type carries its own physics: how far apart
 * two reports can be and still describe the same thing (`mergeRadiusM`), and
 * how fast evidence goes stale (`halfLifeHours`). A pothole persists for weeks;
 * an accident clears in hours. Adding a new domain (e.g. drones) is just
 * adding rows to this table.
 */
export interface HazardTypeDef {
  id: string;
  label: string;
  domains: Domain[];
  /** Point hazards are a spot; zones are an area (e.g. accident hotspot). */
  kind: 'point' | 'zone';
  defaultSeverity: Severity;
  mergeRadiusM: number;
  halfLifeHours: number;
  /** Distinct reporters required before the hazard can be `verified`. */
  minReportersForVerified: number;
  icon: string;
  color: string;
}

const H = 1;
const D = 24;

export const DEFAULT_TAXONOMY: readonly HazardTypeDef[] = [
  // ── Road surface ───────────────────────────────────────────────────────
  { id: 'pothole', label: 'Pothole', domains: ['road'], kind: 'point', defaultSeverity: 3, mergeRadiusM: 15, halfLifeHours: 30 * D, minReportersForVerified: 2, icon: '🕳️', color: '#E8590C' },
  { id: 'sinkhole', label: 'Sinkhole', domains: ['road', 'walkway'], kind: 'point', defaultSeverity: 5, mergeRadiusM: 30, halfLifeHours: 60 * D, minReportersForVerified: 2, icon: '⚠️', color: '#C92A2A' },
  { id: 'surface_damage', label: 'Cracked / broken surface', domains: ['road'], kind: 'point', defaultSeverity: 2, mergeRadiusM: 25, halfLifeHours: 45 * D, minReportersForVerified: 2, icon: '🧱', color: '#F08C00' },
  { id: 'missing_manhole_cover', label: 'Missing manhole cover', domains: ['road', 'walkway'], kind: 'point', defaultSeverity: 5, mergeRadiusM: 10, halfLifeHours: 30 * D, minReportersForVerified: 2, icon: '⭕', color: '#C2255C' },
  { id: 'flooding', label: 'Flooding', domains: ['road', 'walkway'], kind: 'point', defaultSeverity: 4, mergeRadiusM: 60, halfLifeHours: 12 * H, minReportersForVerified: 2, icon: '🌊', color: '#1971C2' },
  { id: 'debris', label: 'Debris / obstruction', domains: ['road'], kind: 'point', defaultSeverity: 3, mergeRadiusM: 25, halfLifeHours: 6 * H, minReportersForVerified: 2, icon: '🪨', color: '#868E96' },
  { id: 'roadworks', label: 'Roadworks', domains: ['road'], kind: 'point', defaultSeverity: 2, mergeRadiusM: 100, halfLifeHours: 14 * D, minReportersForVerified: 2, icon: '🚧', color: '#FAB005' },
  // ── Traffic events ─────────────────────────────────────────────────────
  { id: 'accident', label: 'Accident', domains: ['road'], kind: 'point', defaultSeverity: 5, mergeRadiusM: 80, halfLifeHours: 3 * H, minReportersForVerified: 2, icon: '💥', color: '#E03131' },
  { id: 'broken_down_vehicle', label: 'Broken-down vehicle', domains: ['road'], kind: 'point', defaultSeverity: 3, mergeRadiusM: 50, halfLifeHours: 2 * H, minReportersForVerified: 2, icon: '🚗', color: '#F76707' },
  { id: 'traffic_light_outage', label: 'Traffic lights out', domains: ['road'], kind: 'point', defaultSeverity: 3, mergeRadiusM: 40, halfLifeHours: 8 * H, minReportersForVerified: 2, icon: '🚦', color: '#5F3DC4' },
  { id: 'animal_on_road', label: 'Animal on road', domains: ['road'], kind: 'point', defaultSeverity: 3, mergeRadiusM: 80, halfLifeHours: 1 * H, minReportersForVerified: 2, icon: '🐄', color: '#2B8A3E' },
  // ── Zones (aggregate risk areas) ───────────────────────────────────────
  { id: 'high_accident_zone', label: 'High-accident zone', domains: ['road'], kind: 'zone', defaultSeverity: 4, mergeRadiusM: 400, halfLifeHours: 180 * D, minReportersForVerified: 3, icon: '☠️', color: '#A61E4D' },
  { id: 'bad_driving_zone', label: 'Reckless-driving zone', domains: ['road'], kind: 'zone', defaultSeverity: 3, mergeRadiusM: 400, halfLifeHours: 90 * D, minReportersForVerified: 3, icon: '🏎️', color: '#D6336C' },
  { id: 'crime_hotspot', label: 'Crime hotspot (smash-and-grab / hijacking)', domains: ['road', 'walkway'], kind: 'zone', defaultSeverity: 4, mergeRadiusM: 500, halfLifeHours: 90 * D, minReportersForVerified: 5, icon: '🚨', color: '#862E9C' },
  // ── Walkway ────────────────────────────────────────────────────────────
  { id: 'broken_sidewalk', label: 'Broken sidewalk', domains: ['walkway'], kind: 'point', defaultSeverity: 2, mergeRadiusM: 15, halfLifeHours: 60 * D, minReportersForVerified: 2, icon: '🚶', color: '#E67700' },
  { id: 'unlit_area', label: 'Unlit area', domains: ['walkway', 'road'], kind: 'zone', defaultSeverity: 3, mergeRadiusM: 150, halfLifeHours: 90 * D, minReportersForVerified: 3, icon: '🌑', color: '#343A40' },
  // ── Air (drone navigation) ─────────────────────────────────────────────
  { id: 'aerial_obstacle', label: 'Aerial obstacle (cables, crane, mast)', domains: ['air'], kind: 'point', defaultSeverity: 4, mergeRadiusM: 50, halfLifeHours: 180 * D, minReportersForVerified: 2, icon: '🏗️', color: '#495057' },
  { id: 'restricted_airspace', label: 'Restricted airspace', domains: ['air'], kind: 'zone', defaultSeverity: 5, mergeRadiusM: 1000, halfLifeHours: 365 * D, minReportersForVerified: 1, icon: '⛔', color: '#C92A2A' },
  { id: 'bird_activity', label: 'Bird activity', domains: ['air'], kind: 'zone', defaultSeverity: 2, mergeRadiusM: 300, halfLifeHours: 24 * H, minReportersForVerified: 2, icon: '🐦', color: '#0B7285' },
];

export class Taxonomy {
  private readonly byId = new Map<string, HazardTypeDef>();

  constructor(defs: readonly HazardTypeDef[] = DEFAULT_TAXONOMY) {
    for (const d of defs) this.register(d);
  }

  register(def: HazardTypeDef): void {
    if (!(def.mergeRadiusM > 0) || !(def.halfLifeHours > 0)) {
      throw new Error(`Invalid hazard type definition: ${def.id}`);
    }
    this.byId.set(def.id, def);
  }

  get(id: string): HazardTypeDef | undefined {
    return this.byId.get(id);
  }

  require(id: string): HazardTypeDef {
    const d = this.byId.get(id);
    if (!d) throw new Error(`Unknown hazard type: ${id}`);
    return d;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  list(domain?: Domain): HazardTypeDef[] {
    const all = [...this.byId.values()];
    return domain ? all.filter((d) => d.domains.includes(domain)) : all;
  }
}
