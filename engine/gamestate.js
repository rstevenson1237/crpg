/**
 * gamestate.js — Global game state singleton.
 * Shared by all engine modules; serializable for save/load (Phase 16).
 */

import { Flags, Vars } from './flags.js';

export const GameState = {
  currentTurn: 0,
  party:       null,
  gameTime:    null,
  flags:       new Flags(),
  vars:        new Vars(),
  secrets:     new Set(),
  factions:    new Map(),
  currentMap:  null,
  worldLog:    [],  // [{ turn, text }, ...]

  addSecret(id)          { this.secrets.add(id); },
  hasSecret(id)          { return this.secrets.has(id); },
  modifyFaction(id, d)   {
    const cur = this.factions.get(id) ?? 50;
    this.factions.set(id, Math.max(0, Math.min(100, cur + d)));
  },
  getFactionStanding(id) { return this.factions.get(id) ?? 50; },
};
