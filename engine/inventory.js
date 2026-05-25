/**
 * inventory.js — Party-shared inventory.
 *
 * Items stack by item_id. Key items cannot be removed or dropped.
 * Handlers for use/read effects are wired from index.html via setHandlers().
 *
 * Exposed as window.Inventory for console testing.
 */

import { Items } from './items.js';

// item_id → quantity
let _slots = new Map();

// External callbacks wired from index.html
let _handlers = {
  onGrantSecret: null,    // (secretId) => void
  onFireEvent:   null,    // (eventId) => void
  onShowMsg:     null,    // (text) => void  — brief status message
};

export const Inventory = {

  /** Register callbacks for effects triggered by use/read actions. */
  setHandlers(h) { Object.assign(_handlers, h); },

  /**
   * Add quantity of an item to the party inventory.
   * @param {string} itemId
   * @param {number} [quantity=1]
   */
  add(itemId, quantity = 1) {
    const cur = _slots.get(itemId) ?? 0;
    _slots.set(itemId, cur + quantity);
    console.log(`[Inventory] +${quantity}x ${itemId}  (total: ${cur + quantity})`);
  },

  /**
   * Remove quantity of an item.  Key items cannot be removed.
   * @returns {boolean} true if removal succeeded
   */
  remove(itemId, quantity = 1) {
    const def = Items.get(itemId);
    if (def?.key_item) {
      _handlers.onShowMsg?.(`Cannot remove key item: ${def.item_label ?? itemId}`);
      return false;
    }
    const cur = _slots.get(itemId) ?? 0;
    if (cur < quantity) {
      console.warn(`[Inventory] Not enough ${itemId} (have ${cur}, need ${quantity})`);
      return false;
    }
    const next = cur - quantity;
    if (next === 0) _slots.delete(itemId);
    else _slots.set(itemId, next);
    return true;
  },

  /**
   * @param {string}  itemId
   * @param {number}  [quantity=1]
   * @returns {boolean}
   */
  has(itemId, quantity = 1) {
    return (_slots.get(itemId) ?? 0) >= quantity;
  },

  /**
   * @returns {{ item_def: object, quantity: number }[]}
   */
  getAll() {
    const out = [];
    for (const [id, qty] of _slots) {
      const def = Items.get(id) ?? { item_id: id, item_label: id, item_type: 'unknown', description: '' };
      out.push({ item_def: def, quantity: qty });
    }
    return out;
  },

  /**
   * Use a consumable item on a character.
   * Fires on_use_action and removes the item if consumable_on_use.
   * @param {string} itemId
   * @param {string} [characterId]
   */
  use(itemId, characterId) {
    const def = Items.get(itemId);
    if (!def) return;

    if (def.on_use_action && _handlers.onFireEvent) {
      _handlers.onFireEvent(def.on_use_action.event_id ?? def.on_use_action);
    }

    if (def.consumable_on_use) {
      this.remove(itemId, 1);
    }
  },

  /**
   * Read a document/tome item.
   * Grants secrets, fires events, and consumes if consumable_on_use.
   * @param {string} itemId
   */
  read(itemId) {
    const def = Items.get(itemId);
    if (!def) return;

    if (def.on_read_grant_secret && _handlers.onGrantSecret) {
      _handlers.onGrantSecret(def.on_read_grant_secret);
    }
    if (def.on_read_fire_event && _handlers.onFireEvent) {
      _handlers.onFireEvent(def.on_read_fire_event);
    }

    if (def.consumable_on_use) {
      this.remove(itemId, 1);
    }
  },

  /**
   * Drop one item (removed from inventory).  Key items cannot be dropped.
   * @returns {boolean}
   */
  drop(itemId) {
    const def = Items.get(itemId);
    if (def?.key_item) {
      _handlers.onShowMsg?.(`Cannot drop key item: ${def.item_label ?? itemId}`);
      return false;
    }
    return this.remove(itemId, 1);
  },

  /** Serialize to plain object for save/load. */
  serialize() {
    return Object.fromEntries(_slots);
  },

  /** Restore from serialized data. */
  deserialize(data) {
    _slots.clear();
    for (const [id, qty] of Object.entries(data)) _slots.set(id, qty);
  },

  /** Total unique item count (for UI badge). */
  get size() { return _slots.size; },
};

if (typeof window !== 'undefined') window.Inventory = Inventory;
