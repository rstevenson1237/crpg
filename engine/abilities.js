/**
 * abilities.js — Ability registry and world-interaction execution.
 *
 * Phase 9 scope: load all ability definitions, expose them to other systems,
 * record use-tracked ability uses.  Full combat resolution is in Phase 11.
 *
 * Abilities.loadRegistry(array)              — register all ability definitions
 * Abilities.get(abilityId)                   — look up one ability
 * Abilities.getAll()                         — all registered abilities
 * Abilities.getForCharacter(def, classDef)   — abilities available to a character
 * Abilities.getPassives(def, classDef)       — passive abilities (auto-apply)
 * Abilities.getActions(def, classDef)        — actionable abilities (shown in UI)
 * Abilities.getByWorldInteractionType(type)  — find ability linked to a lock type
 * Abilities.recordUse(characterDef, id)      — increment use-tracked count
 *
 * Exposed as window.Abilities for console testing.
 */

let _abilities = new Map();   // ability_id → def

export const Abilities = {

  loadRegistry(abilityArray) {
    for (const ab of abilityArray) _abilities.set(ab.ability_id, ab);
    console.log(`[Abilities] Loaded ${abilityArray.length} ability definitions.`);
  },

  /** @returns {object|null} */
  get(abilityId) { return _abilities.get(abilityId) ?? null; },

  /** @returns {object[]} */
  getAll() { return [..._abilities.values()]; },

  /**
   * All abilities available to a character: class starting abilities + unlocked extras.
   * @param {object} characterDef
   * @param {object|null} classDef
   * @returns {object[]}
   */
  getForCharacter(characterDef, classDef) {
    const ids = new Set([
      ...(classDef?.starting_abilities    ?? []),
      ...(characterDef?.abilities_unlocked ?? []),
    ]);
    return [...ids].map(id => _abilities.get(id)).filter(Boolean);
  },

  /**
   * Passive-type abilities — auto-apply, not shown in action menus.
   * @param {object} characterDef
   * @param {object|null} classDef
   * @returns {object[]}
   */
  getPassives(characterDef, classDef) {
    return this.getForCharacter(characterDef, classDef)
      .filter(ab => ab.ability_type === 'passive');
  },

  /**
   * Non-passive abilities — shown in combat/world action menus.
   * @param {object} characterDef
   * @param {object|null} classDef
   * @returns {object[]}
   */
  getActions(characterDef, classDef) {
    return this.getForCharacter(characterDef, classDef)
      .filter(ab => ab.ability_type !== 'passive');
  },

  /**
   * Find the ability (if any) linked to a world interaction type.
   * Used for use-tracking after a lock interaction resolves.
   * @param {string} interactionType
   * @returns {object|null}
   */
  getByWorldInteractionType(interactionType) {
    for (const ab of _abilities.values()) {
      if (ab.world_interaction_type === interactionType) return ab;
    }
    return null;
  },

  /**
   * Record a use of a use-tracked ability on the given character definition.
   * Mutates characterDef.use_tracked_skills in place.
   * @param {object} characterDef
   * @param {string} abilityId
   */
  recordUse(characterDef, abilityId) {
    const ab = _abilities.get(abilityId);
    if (!ab?.use_tracked) return;
    characterDef.use_tracked_skills ??= {};
    characterDef.use_tracked_skills[abilityId] =
      (characterDef.use_tracked_skills[abilityId] ?? 0) + 1;
    console.log(`[Abilities] Use tracked: ${abilityId} → ${characterDef.use_tracked_skills[abilityId]}`);
  },
};

if (typeof window !== 'undefined') window.Abilities = Abilities;
