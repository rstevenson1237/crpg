/**
 * classes.js — Class registry and definition loader.
 *
 * Classes.load(array)                       — register class definitions
 * Classes.get(classId)                      — look up a class by ID
 * Classes.getAll()                          — all registered classes
 * Classes.hasHardLock(classId, type)        — does this class own this hard lock?
 * Classes.getSoftLockOutcome(classId, type) — "advantage" | "disadvantage" | null
 * Classes.getHardLockOwners(type)           — all classes that own a hard lock type
 *
 * Exposed as window.Classes for console testing.
 */

let _classes = new Map();   // class_id → def

export const Classes = {

  load(classArray) {
    for (const cls of classArray) _classes.set(cls.class_id, cls);
    console.log(`[Classes] Loaded ${classArray.length} class(es).`);
  },

  /** @returns {object|null} class definition */
  get(classId) { return _classes.get(classId) ?? null; },

  /** @returns {object[]} all registered class definitions */
  getAll() { return [..._classes.values()]; },

  /**
   * Does this class own the given interaction type as a hard lock?
   * @param {string} classId
   * @param {string} interactionType
   * @returns {boolean}
   */
  hasHardLock(classId, interactionType) {
    return _classes.get(classId)?.world_hard_locks?.includes(interactionType) ?? false;
  },

  /**
   * Does this class have a soft-lock outcome for the given interaction type?
   * @param {string} classId
   * @param {string} interactionType
   * @returns {"advantage" | "disadvantage" | null}
   */
  getSoftLockOutcome(classId, interactionType) {
    return _classes.get(classId)?.world_soft_locks?.[interactionType] ?? null;
  },

  /**
   * Find all classes that own a given hard lock type.
   * Used for "This requires a [Class]" failure messages.
   * @param {string} interactionType
   * @returns {object[]} class definitions
   */
  getHardLockOwners(interactionType) {
    const owners = [];
    for (const cls of _classes.values()) {
      if (cls.world_hard_locks?.includes(interactionType)) owners.push(cls);
    }
    return owners;
  },

  /**
   * Find all classes that have soft-lock advantage for a given interaction type.
   * @param {string} interactionType
   * @returns {object[]} class definitions
   */
  getSoftLockAdvantageOwners(interactionType) {
    const owners = [];
    for (const cls of _classes.values()) {
      if (cls.world_soft_locks?.[interactionType] === 'advantage') owners.push(cls);
    }
    return owners;
  },

  /** Serialize / deserialize (future save/load use). */
  serialize()          { return [..._classes.keys()]; },
  deserialize(idArray) { /* class defs are static — nothing to restore */ },
};

if (typeof window !== 'undefined') window.Classes = Classes;
