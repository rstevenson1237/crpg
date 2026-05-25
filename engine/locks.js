/**
 * locks.js — Hard/soft lock resolver for world interactions.
 *
 * Every interactable object can carry:
 *   interaction_type  — the lock category (e.g. "lockpick", "glyph_reading")
 *   lock_type         — "hard" | "soft"
 *   soft_outcomes     — per-composition outcome definitions
 *
 * Lock.resolve(interactionType, lockType, partyMembers, softOutcomes)
 *   → ResolutionResult
 *
 * ResolutionResult shape:
 * {
 *   success:          boolean,
 *   outcome:          "class_advantage" | "class_disadvantage_success" |
 *                     "class_disadvantage_fail" | "no_class_success" |
 *                     "no_class_fail" | "hard_lock_fail",
 *   description:      string,
 *   action:           ActionDefinition | null,   // inline action to execute on success
 *   required_classes: { class_id, class_label }[] | null,  // for hard_lock_fail
 *   ability_id:       string | null,             // ability that performed the action
 *   acting_char_def:  object | null,             // character def that performed the action
 * }
 *
 * Exposed as window.Lock for console testing.
 */

import { Classes }   from './classes.js';
import { Abilities } from './abilities.js';

export const Lock = {

  /**
   * Resolve a lock check against the current active party.
   *
   * @param {string}   interactionType  — e.g. "lockpick"
   * @param {string}   lockType         — "hard" | "soft"
   * @param {object[]} partyMembers     — Character instances (with .def) or raw defs
   * @param {object}   [softOutcomes]   — soft_outcomes field from object definition
   * @returns {object} ResolutionResult
   */
  resolve(interactionType, lockType, partyMembers, softOutcomes = null) {
    // Normalise: accept either Character instances (.def) or raw defs
    const defs     = partyMembers.map(m => m.def ?? m);
    const classIds = defs.map(d => d.class_id).filter(Boolean);

    const linkedAbility = Abilities.getByWorldInteractionType(interactionType);

    if (lockType === 'hard') {
      return this._resolveHard(interactionType, classIds, defs, linkedAbility);
    }
    return this._resolveSoft(interactionType, classIds, defs, softOutcomes, linkedAbility);
  },

  // ── Hard lock ────────────────────────────────────────────────────────────────

  _resolveHard(interactionType, classIds, defs, linkedAbility) {
    const actingClassId = classIds.find(id => Classes.hasHardLock(id, interactionType));

    if (actingClassId) {
      const actingDef = defs.find(d => d.class_id === actingClassId) ?? null;
      return {
        success:         true,
        outcome:         'class_advantage',
        description:     `Your ${Classes.get(actingClassId)?.class_label ?? 'specialist'} handles it with practiced ease.`,
        action:          null,
        required_classes: null,
        ability_id:      linkedAbility?.ability_id ?? null,
        acting_char_def: actingDef,
      };
    }

    // No class can perform this — identify who could
    const owners = Classes.getHardLockOwners(interactionType);
    const ownerList = owners.length
      ? owners.map(c => `a ${c.class_label}`).join(' or ')
      : 'a specialist';
    return {
      success:         false,
      outcome:         'hard_lock_fail',
      description:     `This requires ${ownerList}.`,
      action:          null,
      required_classes: owners.map(c => ({ class_id: c.class_id, class_label: c.class_label })),
      ability_id:      null,
      acting_char_def: null,
    };
  },

  // ── Soft lock ────────────────────────────────────────────────────────────────

  _resolveSoft(interactionType, classIds, defs, softOutcomes, linkedAbility) {
    let advantageClassId    = null;
    let disadvantageClassId = null;

    for (const classId of classIds) {
      const outcome = Classes.getSoftLockOutcome(classId, interactionType);
      if (outcome === 'advantage'    && !advantageClassId)    advantageClassId    = classId;
      if (outcome === 'disadvantage' && !disadvantageClassId) disadvantageClassId = classId;
    }

    // ── Advantage path ──
    if (advantageClassId) {
      const spec    = softOutcomes?.class_advantage ?? {};
      const actDef  = defs.find(d => d.class_id === advantageClassId) ?? null;
      return {
        success:          true,
        outcome:          'class_advantage',
        description:      spec.description ?? `Your ${Classes.get(advantageClassId)?.class_label} handles this with expertise.`,
        action:           spec.action ?? null,
        required_classes: null,
        ability_id:       linkedAbility?.ability_id ?? null,
        acting_char_def:  actDef,
      };
    }

    // ── Disadvantage path ──
    if (disadvantageClassId) {
      const spec        = softOutcomes?.class_disadvantage ?? {};
      const failChance  = spec.failure_chance ?? 0.5;
      const failed      = Math.random() < failChance;
      const actDef      = defs.find(d => d.class_id === disadvantageClassId) ?? null;
      return {
        success:          !failed,
        outcome:          failed ? 'class_disadvantage_fail' : 'class_disadvantage_success',
        description:      spec.description ?? (failed ? 'You fail to manage it.' : 'You manage it with difficulty.'),
        action:           failed ? null : (spec.action ?? null),
        required_classes: null,
        ability_id:       failed ? null : (linkedAbility?.ability_id ?? null),
        acting_char_def:  failed ? null : actDef,
      };
    }

    // ── No class path ──
    const spec       = softOutcomes?.no_class ?? {};
    const failChance = spec.failure_chance ?? 0;
    const failed     = failChance > 0 && Math.random() < failChance;
    return {
      success:          !failed,
      outcome:          failed ? 'no_class_fail' : 'no_class_success',
      description:      failed
        ? (spec.failure_description ?? spec.description ?? 'You fail to manage it.')
        : (spec.success_description ?? spec.description ?? 'You manage it, but awkwardly.'),
      action:           failed ? null : (spec.action ?? null),
      required_classes: null,
      ability_id:       null,
      acting_char_def:  null,
    };
  },
};

if (typeof window !== 'undefined') window.Lock = Lock;
