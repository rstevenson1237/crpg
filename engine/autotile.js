/**
 * autotile.js — Edge-matching autotile bitmask computation.
 *
 * Implements standard RPG Maker-style 4-bit autotiling:
 *   Bits: N=1, E=2, S=4, W=8  (cardinal neighbors only)
 *   Bitmask range: 0–15, each corresponding to one tile variant.
 *
 * Out-of-bounds neighbors are treated as belonging to the same group,
 * producing seamless edges at map boundaries.
 */

/**
 * Compute the 4-bit autotile bitmask for a tile.
 *
 * @param {(x:number, y:number, floor:number) => number|null} getTileIdFn
 *   Returns the raw tile ID at the given coordinate, or null if out of bounds.
 * @param {(tileId:number) => object|null} getTileDefFn
 *   Returns the tile definition for a tile ID.
 * @param {number} x
 * @param {number} y
 * @param {number} floor
 * @param {string} autotileGroup   The group name to match against neighbors.
 * @param {number} mapWidth
 * @param {number} mapHeight
 * @returns {number}  Bitmask 0–15.
 */
export function computeAutotileBitmask(
  getTileIdFn, getTileDefFn,
  x, y, floor,
  autotileGroup,
  mapWidth, mapHeight
) {
  const NEIGHBORS = [
    { dx:  0, dy: -1, bit: 1 }, // N
    { dx:  1, dy:  0, bit: 2 }, // E
    { dx:  0, dy:  1, bit: 4 }, // S
    { dx: -1, dy:  0, bit: 8 }, // W
  ];

  let mask = 0;
  for (const { dx, dy, bit } of NEIGHBORS) {
    const nx = x + dx;
    const ny = y + dy;

    // Out-of-bounds → treat as same group for seamless map edges
    if (nx < 0 || nx >= mapWidth || ny < 0 || ny >= mapHeight) {
      mask |= bit;
      continue;
    }

    const neighborId = getTileIdFn(nx, ny, floor);
    if (neighborId !== null) {
      const neighborDef = getTileDefFn(neighborId);
      if (neighborDef && neighborDef.autotile_group === autotileGroup) {
        mask |= bit;
      }
    }
  }

  return mask;
}

/**
 * Resolve the rendering tile ID for an autotile.
 * If the tile definition has an autotile_variants array of 16 entries,
 * returns the variant at index `mask`. Otherwise returns the base tile ID.
 *
 * @param {number} baseTileId
 * @param {object} tileDef
 * @param {number} mask  0–15
 * @returns {number}
 */
export function getAutotileVariantId(baseTileId, tileDef, mask) {
  if (
    tileDef.autotile_variants &&
    tileDef.autotile_variants.length === 16
  ) {
    return tileDef.autotile_variants[mask];
  }
  return baseTileId;
}
