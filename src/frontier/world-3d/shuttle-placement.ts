/**
 * Where the transport stands on the hub landing terrace.
 *
 * These numbers are shared by the renderer (`ColonyShuttle`) and the pure scatter rules, so they live
 * in a plain module: `scatter.ts` is imported directly by the node test runner, which cannot load a
 * `.tsx` file.
 */

/**
 * Metres from the pad centre. The hull is 18 m by 11.3 m, so its half-diagonal is about 10.6 m
 * against an 11.5 m pad radius: much more offset than this and the tail overhangs the kerb.
 */
export const shuttleOffset = 0.9;
/** Radians about +Y: off-square so the fuselage crosses the pad markings. */
export const shuttleYaw = -0.42;
/**
 * Parcel-local centre of the parked shuttle, and the radius scatter keeps clear of it so nothing is
 * placed on the pad beside it.
 */
export const shuttleKeepOut = {
  x: shuttleOffset,
  z: -shuttleOffset * 0.6,
  radius: 13.5,
};
