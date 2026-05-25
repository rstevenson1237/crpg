/**
 * encounters.js — Encounter pool management and random encounter triggering.
 *
 * Manages encounter pools, tracks encounter counts per zone per visit,
 * and fires combat when the party walks through a flagged wilderness zone.
 */

class EncounterManager {
  constructor() {
    this._pools    = new Map();          // pool_id → pool definition
    this._counts   = new Map();          // mapId → Map(zoneId → count)
    this._onTrigger = null;              // async (encounter, pool) => void
  }

  /**
   * Load one or more encounter pool definitions.
   * @param {object|object[]} poolData
   */
  loadPool(poolData) {
    const pools = Array.isArray(poolData) ? poolData : [poolData];
    for (const pool of pools) {
      this._pools.set(pool.pool_id, pool);
      console.log(`[Encounters] Loaded pool: ${pool.pool_id} (${pool.encounters.length} encounters)`);
    }
  }

  /**
   * Callback invoked when an encounter is selected.
   * The handler is responsible for initiating combat.
   * @param {(encounter: object, pool: object) => void} cb
   */
  setOnTrigger(cb) { this._onTrigger = cb; }

  /** Reset per-visit encounter counts when a new map is entered. */
  resetForMap(mapId) {
    this._counts.set(mapId, new Map());
  }

  /**
   * Check if the party's current tile is inside any encounter zone and
   * potentially trigger a random encounter.
   *
   * @param {string} mapId
   * @param {number} tileX
   * @param {number} tileY
   * @param {object} mapDef   — raw map JSON with encounter_zones array
   * @returns {boolean} true if an encounter was triggered
   */
  checkZones(mapId, tileX, tileY, mapDef) {
    const zones = mapDef?.encounter_zones;
    if (!zones || zones.length === 0) return false;
    if (!this._onTrigger) return false;

    // Get or init per-map count table
    if (!this._counts.has(mapId)) this._counts.set(mapId, new Map());
    const mapCounts = this._counts.get(mapId);

    for (const zone of zones) {
      const { tile_region: r, encounter_pool, encounter_rate, max_encounters_per_visit } = zone;

      // Bounds check
      if (tileX < r.x1 || tileX > r.x2 || tileY < r.y1 || tileY > r.y2) continue;

      // Max-per-visit check
      const count = mapCounts.get(zone.zone_id) ?? 0;
      if (count >= (max_encounters_per_visit ?? Infinity)) continue;

      // Probability roll
      if (Math.random() >= encounter_rate) continue;

      // Pool lookup
      const pool = this._pools.get(encounter_pool);
      if (!pool) {
        console.warn(`[Encounters] Pool not found: ${encounter_pool}`);
        continue;
      }

      const encounter = this._selectEncounter(pool);
      if (!encounter) continue;

      // Record count BEFORE triggering so nested re-entry is guarded
      mapCounts.set(zone.zone_id, count + 1);

      console.log(`[Encounters] Triggered: ${encounter.encounter_id} in zone ${zone.zone_id}`);
      this._onTrigger(encounter, pool);
      return true;
    }
    return false;
  }

  /**
   * Weighted-random selection from a pool's encounters array.
   * @param {object} pool
   * @returns {object|null}
   */
  _selectEncounter(pool) {
    const total = pool.encounters.reduce((s, e) => s + (e.weight ?? 1), 0);
    let roll = Math.random() * total;
    for (const enc of pool.encounters) {
      roll -= enc.weight ?? 1;
      if (roll <= 0) return enc;
    }
    return pool.encounters[pool.encounters.length - 1] ?? null;
  }

  /** Return the named pool definition, or null. */
  getPool(poolId) { return this._pools.get(poolId) ?? null; }
}

export const Encounters = new EncounterManager();
