/**
 * Boat tiers. Each tier is a model (world/protos.glb BOAT_Tn), a handling set (BoatTuning) and the
 * things it opens. T0 = the Little Troller (start), T1 = the Packer: bigger fish hold, faster, and
 * steady enough for the rough outer grounds (hotspots tagged tier "rare": fog bank, drop-off, spires).
 */
import { BOAT_T0, BOAT_TUNING, type BoatTuning } from '../boat';
import type { Hotspot } from '../../world/types';

export type BoatTierId = 'T0' | 'T1';

export interface BoatTier {
  id: BoatTierId;
  model: string;
  name: string;
  /** builder's plate line */
  plate: string;
  note: string;
  opens: string[];
  price: number;
  /** extra cooler slots from the boat's own hold */
  hold: number;
  /** may fish the rough outer grounds (hotspot tier "rare") */
  roughWater: boolean;
  tuning: BoatTuning;
}

export const BOAT_TIERS: Record<BoatTierId, BoatTier> = {
  T0: {
    id: 'T0', model: 'BOAT_T0', name: 'the Little Troller', plate: '22 ft · 4 hp gas engine · built 1912',
    note: "Gran's boat. Snug, nimble, and happiest in the channels.", opens: ['Inside waters and the channels'],
    price: 0, hold: 0, roughWater: false, tuning: { ...BOAT_T0 },
  },
  T1: {
    id: 'T1', model: 'BOAT_T1', name: 'the Packer', plate: '31 ft · 12 hp heavy-duty engine · wheelhouse',
    note: 'A cannery packer, re-planked. Carries a fish hold and rides out a chop.',
    opens: ['The rough outer grounds (fog bank, drop-off, spires)', 'Fish hold: +6 cooler slots', 'Faster, steadier at speed'],
    price: 1600, hold: 6, roughWater: true,
    tuning: {
      ...BOAT_T0,
      maxSpeed: 8.6, maxReverse: 2.8, accel: 5.2, brake: 9.5, coastDrag: 0.36, turnRate: 1.15, pivotTurn: 0.3,
      turnResponse: 7, grip: 6, camLookAhead: 6.5, camPullBack: 4, camFovBoost: 6, radius: 1.5,
    },
  },
};
export const TIER_ORDER: BoatTierId[] = ['T0', 'T1'];

/** Copy a tier's handling into the live BOAT_TUNING (wake + ?tune overlay hold that reference). */
export function applyBoatTier(id: BoatTierId) {
  Object.assign(BOAT_TUNING, BOAT_TIERS[id].tuning);
}

/** Rough outer grounds need a boat that can ride the chop. */
export function needsRoughWater(hs: Hotspot) { return hs.tier === 'rare'; }
