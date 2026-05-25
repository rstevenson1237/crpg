/**
 * progression.js — Character progression engine.
 *
 * Handles use-tracked ability milestones, mentor training, story unlocks,
 * and reputation-gated event triggers.
 *
 * Progression.recordUse(characterDef, abilityId)
 * Progression.checkThresholds(characterDef, abilityId)
 * Progression.grantSkillUnlock(characterDef, abilityId, label)
 * Progression.loadMentors(mentorArray)
 * Progression.getMentor(mentorId)
 * Progression.getMentorForNPC(npcId)
 * Progression.checkFactionUnlocks(factionId, newStanding)
 *
 * Exposed as window.Progression for console testing.
 */

import { Abilities } from './abilities.js';

// ─── Module-level state ──────────────────────────────────────────────────────

const _mentors = new Map();  // mentorId → mentorDef

// factionId → [{ threshold, fires_event, _fired: bool }]
const _factionUnlocks = new Map();

let _notificationHandler = null;  // (title, text, onDismiss) → void
let _worldLogHandler     = null;  // (text) → void
let _eventFireHandler    = null;  // (eventId) → void

// ─── Public API ──────────────────────────────────────────────────────────────

export const Progression = {

  setNotificationHandler(fn) { _notificationHandler = fn; },
  setWorldLogHandler(fn)     { _worldLogHandler = fn; },
  setEventFireHandler(fn)    { _eventFireHandler = fn; },

  // ── Mentor loading ────────────────────────────────────────────────────────

  loadMentors(mentorArray) {
    for (const m of mentorArray) _mentors.set(m.mentor_id, m);
    console.log(`[Progression] Loaded ${mentorArray.length} mentor(s).`);
  },

  getMentor(mentorId) { return _mentors.get(mentorId) ?? null; },

  getMentorForNPC(npcId) {
    for (const m of _mentors.values()) {
      if (m.npc_id === npcId) return m;
    }
    return null;
  },

  getAllMentors() { return [..._mentors.values()]; },

  // ── Faction unlock registration ───────────────────────────────────────────

  /**
   * Register a faction reputation unlock trigger.
   * Called from index.html after loading faction data.
   */
  registerFactionUnlock(factionId, threshold, eventId) {
    let list = _factionUnlocks.get(factionId);
    if (!list) { list = []; _factionUnlocks.set(factionId, list); }
    list.push({ threshold, fires_event: eventId, _fired: false });
    console.log(`[Progression] Faction unlock: ${factionId} ≥ ${threshold} → ${eventId}`);
  },

  /**
   * Called by Factions.modify() after any standing change.
   * Fires events whose threshold has now been crossed.
   */
  checkFactionUnlocks(factionId, newStanding) {
    const list = _factionUnlocks.get(factionId);
    if (!list) return;
    for (const entry of list) {
      if (!entry._fired && newStanding >= entry.threshold) {
        entry._fired = true;
        console.log(`[Progression] Faction threshold reached: ${factionId} ≥ ${entry.threshold} → ${entry.fires_event}`);
        if (_eventFireHandler) _eventFireHandler(entry.fires_event);
      }
    }
  },

  // ── Use tracking ─────────────────────────────────────────────────────────

  /**
   * Record a use of a use-tracked ability, then check for milestones.
   * Wraps Abilities.recordUse() and adds threshold checking.
   */
  recordUse(characterDef, abilityId) {
    Abilities.recordUse(characterDef, abilityId);
    this.checkThresholds(characterDef, abilityId);
  },

  /**
   * Check if any use milestone for abilityId has just been reached.
   * Called after every recordUse.
   */
  checkThresholds(characterDef, abilityId) {
    const ab = Abilities.get(abilityId);
    if (!ab?.use_milestones?.length) return;

    const count = characterDef.use_tracked_skills?.[abilityId] ?? 0;

    for (const m of ab.use_milestones) {
      if (count === m.uses) {
        const label = m.label ?? `${ab.ability_label} — milestone at ${m.uses} uses`;
        console.log(`[Progression] Milestone reached: ${abilityId} × ${m.uses} → ${m.reward_type}`);
        this._applyReward(characterDef, m.reward_type, m.reward, label);
      }
    }
  },

  // ── Story / event skill grants ────────────────────────────────────────────

  /**
   * Grant an ability unlock (from event action or mentor training).
   * Adds to abilities_unlocked, shows notification, writes journal entry.
   */
  grantSkillUnlock(characterDef, abilityId, label) {
    if (!characterDef) return;

    characterDef.abilities_unlocked ??= [];
    if (characterDef.abilities_unlocked.includes(abilityId)) {
      console.log(`[Progression] ${characterDef.character_id} already has ${abilityId}`);
      return;
    }

    characterDef.abilities_unlocked.push(abilityId);
    console.log(`[Progression] Skill unlocked: ${characterDef.character_id} → ${abilityId}`);

    const ab = Abilities.get(abilityId);
    const displayLabel = label ?? ab?.ability_label ?? abilityId;
    const text = `You have learned: ${displayLabel}`;

    if (_worldLogHandler) _worldLogHandler(text);
    _showNotification('Ability Learned', text);
  },

  // ── Mentor training ───────────────────────────────────────────────────────

  /**
   * Attempt to purchase a training from a mentor.
   * Returns { success, reason } — caller handles inventory deduction via
   * the trainResult.
   *
   * @param {string} mentorId
   * @param {string} trainingId
   * @param {object} characterDef
   * @param {object} inventory  — { has(itemId, qty): boolean, remove(itemId, qty): void }
   * @param {object} factions   — { getStanding(id): number }
   * @returns {{ success: boolean, reason?: string }}
   */
  purchaseTraining(mentorId, trainingId, characterDef, inventory, factions) {
    const mentor = _mentors.get(mentorId);
    if (!mentor) return { success: false, reason: 'Unknown mentor' };

    const t = (mentor.trainings ?? []).find(x => x.training_id === trainingId);
    if (!t) return { success: false, reason: 'Unknown training' };

    // Already learned?
    if (characterDef.abilities_unlocked?.includes(t.ability_granted)) {
      return { success: false, reason: 'Already learned' };
    }

    // Class check
    if (t.target_class && characterDef.class_id !== t.target_class) {
      return { success: false, reason: `Requires ${t.target_class} class` };
    }

    // Prerequisite abilities
    for (const prereq of (t.prerequisite_abilities ?? [])) {
      const hasPrereq = characterDef.abilities_unlocked?.includes(prereq) ||
        (Abilities.get(prereq) !== null &&
          // check starting abilities via class — caller should verify; we trust the check
          false);
      if (!hasPrereq) {
        const ab = Abilities.get(prereq);
        return { success: false, reason: `Requires: ${ab?.ability_label ?? prereq}` };
      }
    }

    // Faction standing check
    if (t.cost_faction_standing) {
      const standing = factions?.getStanding(t.cost_faction_standing.faction_id) ?? 0;
      if (standing < t.cost_faction_standing.minimum) {
        return {
          success: false,
          reason: `Requires ${t.cost_faction_standing.faction_id} standing ≥ ${t.cost_faction_standing.minimum} (have ${standing})`,
        };
      }
    }

    // Item costs
    for (const cost of (t.cost_items ?? [])) {
      if (!inventory?.has(cost.item_id, cost.quantity)) {
        return { success: false, reason: `Missing: ${cost.quantity}× ${cost.item_id}` };
      }
    }

    // All checks passed — deduct items, grant ability
    for (const cost of (t.cost_items ?? [])) {
      inventory.remove(cost.item_id, cost.quantity);
    }

    this.grantSkillUnlock(characterDef, t.ability_granted, t.training_label);

    return { success: true };
  },

  // ── Internal ──────────────────────────────────────────────────────────────

  _applyReward(characterDef, rewardType, reward, label) {
    switch (rewardType) {
      case 'stat_bonus': {
        const stat = reward.stat;
        if (stat === 'hp') {
          characterDef.base_stats.max_hp  = (characterDef.base_stats.max_hp  ?? 0) + reward.amount;
          characterDef.base_stats.hp      = (characterDef.base_stats.hp      ?? 0) + reward.amount;
        } else {
          characterDef.base_stats[stat] = (characterDef.base_stats[stat] ?? 0) + reward.amount;
        }
        console.log(`[Progression] Stat bonus: ${characterDef.character_id}.${stat} +${reward.amount}`);
        _showNotification('Experience Gained', `${label}\n+${reward.amount} ${stat.toUpperCase()}`);
        if (_worldLogHandler) _worldLogHandler(label);
        break;
      }

      case 'skill_unlock':
        this.grantSkillUnlock(characterDef, reward.ability_id, label);
        break;

      case 'ability_upgrade': {
        characterDef.abilities_unlocked ??= [];
        // Remove replaced ability
        if (reward.replaces_ability) {
          const idx = characterDef.abilities_unlocked.indexOf(reward.replaces_ability);
          if (idx !== -1) characterDef.abilities_unlocked.splice(idx, 1);
        }
        this.grantSkillUnlock(characterDef, reward.upgrade_id, label);
        break;
      }

      default:
        console.warn(`[Progression] Unknown reward type: ${rewardType}`);
    }
  },
};

function _showNotification(title, text) {
  if (_notificationHandler) {
    _notificationHandler(title, text, () => {});
  } else {
    console.log(`[Progression] ${title}: ${text}`);
  }
}

if (typeof window !== 'undefined') window.Progression = Progression;
