/**
 * flags.js — World flags and variables store.
 * Flags: named booleans. Vars: named integer/string values.
 * Both serialize to plain JSON for save/load (Phase 16).
 */

export class Flags {
  constructor() { this._set = new Set(); }

  set(id)   { this._set.add(id); }
  clear(id) { this._set.delete(id); }
  isSet(id) { return this._set.has(id); }

  toJSON()      { return [...this._set]; }
  fromJSON(arr) { this._set = new Set(arr); }
}

export class Vars {
  constructor() { this._map = new Map(); }

  set(id, value)            { this._map.set(id, value); }
  get(id, def = 0)          { return this._map.has(id) ? this._map.get(id) : def; }
  increment(id, amount = 1) { this._map.set(id, (this._map.get(id) ?? 0) + amount); }

  toJSON()       { return Object.fromEntries(this._map); }
  fromJSON(obj)  { this._map = new Map(Object.entries(obj)); }
}
