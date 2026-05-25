/**
 * equipment.js — Per-character equipment slot management.
 *
 * Equipping removes the item from party inventory; unequipping returns it.
 * On equip: fires on_equip_fire_events, grants on_equip_grant_secrets,
 *           applies one-time skill_unlock_on_equip.
 * On unequip: fires on_unequip_fire_events.
 *
 * Equipment.initFromCharDef(characterId, def) bootstraps starting equipment
 * without deducting from inventory (used for character creation).
 *
 * Exposed as window.Equipment for console testing.
 */

import { Items }     from './items.js';
import { Inventory } from './inventory.js';

export const SLOTS = ['weapon', 'off_hand', 'armor', 'helm', 'accessory_1', 'accessory_2'];

// charId → { slotName → item_id | null }
const _equipped = new Map();

// charId → Set of skill IDs already received via skill_unlock_on_equip (one-time guard)
const _receivedUnlocks = new Map();

// External callbacks wired from index.html
let _handlers = {
  onFireEvent:   null,  // (eventId) => void
  onGrantSecret: null,  // (secretId) => void
  onGrantSkill:  null,  // (characterId, skillId) => void
  getParty:      null,  // () => Party  — needed for class-restriction checks
};

export const Equipment = {

  /** Register external callbacks. */
  setHandlers(h) { Object.assign(_handlers, h); },

  // ── Internal ──────────────────────────────────────────────────────────────

  _slots(charId) {
    if (!_equipped.has(charId)) {
      _equipped.set(charId, Object.fromEntries(SLOTS.map(s => [s, null])));
    }
    return _equipped.get(charId);
  },

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /**
   * Initialise equipment directly from a character definition's equipment map.
   * Does NOT deduct from inventory — used for characters joining with gear already on.
   * @param {string} characterId
   * @param {object} charDef  — full character JSON definition
   */
  initFromCharDef(characterId, charDef) {
    const src = charDef.equipment ?? {};
    const slots = this._slots(characterId);
    for (const slot of SLOTS) {
      slots[slot] = src[slot] ?? null;
    }
  },

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Equip an item onto a character.  Validates class restriction.
   * Unequips any existing item in the target slot first.
   * @param {string} characterId
   * @param {string} itemId
   * @param {string} [slot]  — if omitted, uses item's equip_slot field
   * @returns {boolean}
   */
  equip(characterId, itemId, slot) {
    const def = Items.get(itemId);
    if (!def) { console.warn(`[Equipment] Unknown item: ${itemId}`); return false; }
    if (!Inventory.has(itemId)) {
      console.warn(`[Equipment] Item not in inventory: ${itemId}`);
      return false;
    }

    const targetSlot = slot ?? def.equip_slot;
    if (!targetSlot || !SLOTS.includes(targetSlot)) {
      console.warn(`[Equipment] ${itemId} has no valid equip slot (${targetSlot})`);
      return false;
    }

    // Class restriction
    if (def.class_restriction?.length) {
      const party  = _handlers.getParty?.();
      const member = party?.active?.find(m => m.id === characterId);
      if (member && !def.class_restriction.includes(member.def.class_id)) {
        const allowed = def.class_restriction.join(', ');
        console.warn(`[Equipment] ${def.item_label} requires: ${allowed}`);
        return false;
      }
    }

    const slots = this._slots(characterId);

    // Unequip whatever is already in the slot
    if (slots[targetSlot]) this.unequip(characterId, targetSlot);

    // Remove from inventory (item is now worn, not carried)
    Inventory.remove(itemId, 1);
    slots[targetSlot] = itemId;

    // On-equip events
    if (def.on_equip_fire_events?.length) {
      for (const evtId of def.on_equip_fire_events) {
        _handlers.onFireEvent?.(evtId);
      }
    }

    // On-equip secrets
    if (def.on_equip_grant_secrets?.length) {
      for (const sid of def.on_equip_grant_secrets) {
        _handlers.onGrantSecret?.(sid);
      }
    }

    // One-time skill unlock
    if (def.skill_unlock_on_equip) {
      const received = _receivedUnlocks.get(characterId) ?? new Set();
      if (!received.has(def.skill_unlock_on_equip)) {
        received.add(def.skill_unlock_on_equip);
        _receivedUnlocks.set(characterId, received);
        _handlers.onGrantSkill?.(characterId, def.skill_unlock_on_equip);
      }
    }

    console.log(`[Equipment] ${characterId} equipped ${itemId} → ${targetSlot}`);
    return true;
  },

  /**
   * Unequip an item from a slot, returning it to party inventory.
   * @param {string} characterId
   * @param {string} slot
   * @returns {boolean}
   */
  unequip(characterId, slot) {
    const slots  = this._slots(characterId);
    const itemId = slots[slot];
    if (!itemId) return false;

    const def = Items.get(itemId);
    slots[slot] = null;

    // Return to inventory
    Inventory.add(itemId, 1);

    // On-unequip events
    if (def?.on_unequip_fire_events?.length) {
      for (const evtId of def.on_unequip_fire_events) {
        _handlers.onFireEvent?.(evtId);
      }
    }

    console.log(`[Equipment] ${characterId} unequipped ${itemId} from ${slot}`);
    return true;
  },

  /** Returns a copy of the equipped slots map for a character. */
  getEquipped(characterId) {
    return { ...this._slots(characterId) };
  },

  /**
   * Returns the item definition for an equipped item, or null.
   * @param {string} characterId
   * @param {string} slot
   * @returns {object|null}
   */
  getItemInSlot(characterId, slot) {
    const itemId = this._slots(characterId)[slot];
    return itemId ? Items.get(itemId) : null;
  },

  /**
   * Compute final stats: base + progression bonuses + all equipped modifiers.
   * @param {string} characterId
   * @returns {object}  stat map
   */
  getEffectiveStats(characterId) {
    const party  = _handlers.getParty?.();
    const member = party?.active?.find(m => m.id === characterId);

    const base    = member?.def?.base_stats   ?? {};
    const bonuses = member?.def?.stat_bonuses ?? {};

    const stats = { ...base };

    // Progression bonuses
    for (const [s, v] of Object.entries(bonuses)) {
      stats[s] = (stats[s] ?? 0) + v;
    }

    // Equipment modifiers
    for (const itemId of Object.values(this._slots(characterId))) {
      if (!itemId) continue;
      const def = Items.get(itemId);
      if (!def?.stat_modifiers) continue;
      for (const [s, v] of Object.entries(def.stat_modifiers)) {
        stats[s] = (stats[s] ?? 0) + v;
      }
    }

    return stats;
  },

  /**
   * Returns list of ability IDs currently active from equipped items.
   * @param {string} characterId
   * @returns {string[]}
   */
  getGrantedAbilities(characterId) {
    const set = new Set();
    for (const itemId of Object.values(this._slots(characterId))) {
      if (!itemId) continue;
      for (const ab of Items.get(itemId)?.ability_grants ?? []) set.add(ab);
    }
    return [...set];
  },

  /**
   * Check if a character has a light-emitting item equipped.
   * @param {string} characterId
   * @returns {{ radius: number }} radius in pixels (0 = none)
   */
  getLightRadius(characterId) {
    const RADII = { torch: 4 * 32, lantern: 6 * 32 };
    for (const itemId of Object.values(this._slots(characterId))) {
      if (!itemId) continue;
      const def = Items.get(itemId);
      if (!def?.tags) continue;
      if (def.tags.includes('light_source_lantern')) return { radius: RADII.lantern };
      if (def.tags.includes('light_source'))         return { radius: RADII.torch };
      if (itemId.includes('lantern')) return { radius: RADII.lantern };
      if (itemId.includes('torch'))   return { radius: RADII.torch };
    }
    return { radius: 0 };
  },

  /** Serialize for save/load. */
  serialize() {
    const out = {};
    for (const [id, slots] of _equipped) out[id] = { ...slots };
    return out;
  },

  /** Restore from serialized data. */
  deserialize(data) {
    _equipped.clear();
    for (const [id, slots] of Object.entries(data)) _equipped.set(id, { ...slots });
  },
};

if (typeof window !== 'undefined') window.Equipment = Equipment;
