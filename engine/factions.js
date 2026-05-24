/**
 * factions.js — Faction standing registry.
 *
 * Tracks NPC faction standings 0–100 (default 50 = Neutral).
 * Definitions may declare conflicts; improving one faction applies a
 * proportional penalty to its rivals. Standing changes show a 2.5s toast.
 *
 * Exposed as window.Factions for console testing.
 */

import { GameState } from './gamestate.js';

// Thresholds are inclusive lower bounds, ordered high→low
const STANDING_LABELS = [
  [80, 'Allied',      '#44ffaa'],
  [60, 'Friendly',    '#88ff88'],
  [40, 'Neutral',     '#ccdd88'],
  [20, 'Unfriendly',  '#ff9944'],
  [ 0, 'Hostile',     '#ff5555'],
];

const TOAST_DURATION_MS = 2500;
const TOAST_FADE_MS     = 300;

let _defs  = new Map();  // faction_id → def
let _toast = null;       // { text, remainMs, color } | null

export const Factions = {

  /** @param {Array} arr — loaded from data/factions/*.json */
  load(arr) {
    for (const f of arr) {
      _defs.set(f.faction_id, f);
      if (!GameState.factions.has(f.faction_id)) {
        GameState.factions.set(f.faction_id, f.default_standing ?? 50);
      }
    }
    console.log(`[Factions] Loaded ${arr.length} faction(s).`);
  },

  getStanding(factionId) { return GameState.getFactionStanding(factionId); },

  /** Returns a human-readable label for a numeric standing value. */
  getLabel(standing) {
    for (const [threshold, label] of STANDING_LABELS) {
      if (standing >= threshold) return label;
    }
    return 'Hostile';
  },

  /** Returns the accent color for a standing value. */
  getColor(standing) {
    for (const [threshold, , color] of STANDING_LABELS) {
      if (standing >= threshold) return color;
    }
    return '#ff5555';
  },

  /**
   * Modify standing for a faction, applying conflict penalties automatically.
   * @param {string} factionId
   * @param {number} delta  positive = improve, negative = worsen
   */
  modify(factionId, delta) {
    const def  = _defs.get(factionId);
    const prev = this.getStanding(factionId);
    GameState.modifyFaction(factionId, delta);
    const next   = this.getStanding(factionId);
    const actual = next - prev;

    if (actual !== 0) {
      const name  = def?.display_name ?? factionId;
      const color = this.getColor(next);
      const sign  = actual > 0 ? '+' : '';
      _toast = {
        text:     `${name}: ${sign}${actual} (${this.getLabel(next)})`,
        remainMs: TOAST_DURATION_MS,
        color,
      };

      // Apply conflict penalties to rival factions
      for (const conflictId of (def?.conflicts_with ?? [])) {
        const penalty = -Math.round(Math.abs(actual) * 0.5);
        if (penalty !== 0) GameState.modifyFaction(conflictId, penalty);
      }
    }
  },

  /** Returns all faction defs with current standing and label. */
  getAll() {
    return [..._defs.values()].map(f => ({
      ...f,
      standing: this.getStanding(f.faction_id),
      label:    this.getLabel(this.getStanding(f.faction_id)),
      color:    this.getColor(this.getStanding(f.faction_id)),
    }));
  },

  /** Advance toast timer. Call every render frame. */
  updateToast(deltaMs) {
    if (!_toast) return;
    _toast.remainMs -= deltaMs;
    if (_toast.remainMs <= 0) _toast = null;
  },

  /**
   * Draw the faction-standing toast onto an existing 2D context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} [offsetY=8]  vertical offset in logical pixels
   */
  renderToast(ctx, offsetY = 8) {
    if (!_toast) return;
    const alpha = Math.min(1, _toast.remainMs / TOAST_FADE_MS);
    ctx.save();
    ctx.globalAlpha  = alpha;
    ctx.font         = 'bold 11px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(_toast.text).width + 24;
    const bx = 320 - tw / 2;
    ctx.fillStyle   = 'rgba(10,20,30,0.90)';
    ctx.fillRect(bx, offsetY, tw, 22);
    ctx.strokeStyle = _toast.color ?? '#ccaa44';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx, offsetY, tw, 22);
    ctx.fillStyle   = _toast.color ?? '#ffddaa';
    ctx.fillText(_toast.text, 320, offsetY + 5);
    ctx.restore();
  },
};

if (typeof window !== 'undefined') window.Factions = Factions;
