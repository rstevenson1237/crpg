/**
 * items.js — Item registry and loot table roller.
 *
 * Items.loadRegistry — register all item definitions from JSON
 * Items.get(id)      — look up a single item definition
 * LootTables.load    — register loot table definitions
 * LootTables.roll(id) — weighted-random roll returning [{item_id, quantity}]
 *
 * Exposed as window.Items / window.LootTables for console testing.
 */

let _items      = new Map();  // item_id → def
let _lootTables = new Map();  // loot_table_id → def

export const Items = {

  /** @param {Array} arr — loaded from data/items/*.json */
  loadRegistry(arr) {
    for (const item of arr) _items.set(item.item_id, item);
    console.log(`[Items] Loaded ${arr.length} item definition(s).`);
  },

  /** @returns {object|null} item definition */
  get(itemId) { return _items.get(itemId) ?? null; },

  /** @returns {object[]} all registered item definitions */
  getAll() { return Array.from(_items.values()); },

  /** @returns {boolean} */
  hasTag(itemId, tag) {
    const def = _items.get(itemId);
    return def?.tags?.includes(tag) ?? false;
  },
};

export const LootTables = {

  /** @param {Array} arr — loot table definitions */
  load(arr) {
    for (const t of arr) _lootTables.set(t.loot_table_id, t);
    console.log(`[LootTables] Loaded ${arr.length} loot table(s).`);
  },

  /**
   * Perform weighted-random rolls and return the results.
   * @param {string} tableId
   * @returns {{ item_id: string, quantity: number }[]}
   */
  roll(tableId) {
    const table = _lootTables.get(tableId);
    if (!table) {
      console.warn(`[LootTables] Unknown table: ${tableId}`);
      return [];
    }

    const results = [];
    const rolls   = table.rolls ?? 1;

    for (let i = 0; i < rolls; i++) {
      const entry = _weightedPick(table.entries);
      if (!entry) continue;
      const min = entry.quantity_min ?? 1;
      const max = entry.quantity_max ?? min;
      const qty = min + Math.floor(Math.random() * (max - min + 1));
      // Merge duplicate items from multiple rolls
      const existing = results.find(r => r.item_id === entry.item_id);
      if (existing) existing.quantity += qty;
      else results.push({ item_id: entry.item_id, quantity: qty });
    }

    return results;
  },
};

function _weightedPick(entries) {
  if (!entries?.length) return null;
  const total = entries.reduce((s, e) => s + (e.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const e of entries) {
    r -= (e.weight ?? 1);
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

if (typeof window !== 'undefined') {
  window.Items      = Items;
  window.LootTables = LootTables;
}
