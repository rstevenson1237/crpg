/**
 * secrets.js — Secret registry and discovery system.
 *
 * Maintains the canonical list of all secret definitions and tracks which
 * the party has discovered. Granting a secret shows a 3s discovery toast and
 * fires a 'secret_discovered' action trigger. S-key spatial search is
 * dispatched from index.html and delegates to Secrets.search().
 *
 * Exposed as window.Secrets for console testing.
 */

import { GameState } from './gamestate.js';
import { Events }    from './events.js';

const TOAST_DURATION_MS = 3000;
const TOAST_FADE_MS     = 300;

let _registry = new Map();  // secret_id → def
let _toast    = null;       // { text, remainMs } | null

export const Secrets = {

  /** @param {Array} arr — loaded from data/secrets/*.json */
  load(arr) {
    for (const s of arr) _registry.set(s.secret_id, s);
    console.log(`[Secrets] Loaded ${arr.length} secret definition(s).`);
  },

  /**
   * Grant a secret. Idempotent — toast and trigger only fire on first discovery.
   * @param {string} secretId
   */
  grant(secretId) {
    const already = GameState.hasSecret(secretId);
    GameState.addSecret(secretId);
    if (!already) {
      const def   = _registry.get(secretId);
      const label = def?.label ?? secretId;
      _toast = { text: `Secret discovered: ${label}`, remainMs: TOAST_DURATION_MS };
      console.log(`[Secrets] Discovered: ${secretId}`);
      Events.fireActionTrigger('secret_discovered', { secret_id: secretId });
    }
  },

  /** Remove a secret from the party's knowledge. */
  revoke(secretId) {
    GameState.secrets.delete(secretId);
  },

  isKnown(secretId) { return GameState.hasSecret(secretId); },

  /** Returns array of known secret defs (ordered by grant time). */
  getKnown() {
    const out = [];
    for (const id of GameState.secrets) {
      const def = _registry.get(id) ?? { secret_id: id, label: id, summary: '' };
      out.push(def);
    }
    return out;
  },

  /**
   * Spatial search action. Checks all map objects within 1-tile radius of the
   * player for ones with a secret_id. Applies a d20 roll vs search_dc.
   * @param {import('./map.js').MapData} mapData
   * @param {number} px  player tile X
   * @param {number} py  player tile Y
   * @returns {boolean}  true if a new secret was found
   */
  search(mapData, px, py) {
    const floor = mapData.currentFloor;
    let found  = false;
    let hasAny = false;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const obj = mapData.getObjectAt(px + dx, py + dy, floor);
        if (!obj?.secret_id) continue;
        if (this.isKnown(obj.secret_id)) { hasAny = true; continue; }
        hasAny = true;
        const dc   = obj.search_dc ?? 0;
        const roll = Math.floor(Math.random() * 20) + 1;
        console.log(`[Secrets] Search roll: ${roll} vs DC ${dc}`);
        if (roll >= dc) {
          this.grant(obj.secret_id);
          found = true;
        } else {
          _toast = { text: 'You search carefully but find nothing.', remainMs: 1500 };
        }
      }
    }

    if (!hasAny) {
      _toast = { text: 'Nothing of interest nearby.', remainMs: 1200 };
    }
    return found;
  },

  /** Advance toast timer. Call every render frame. */
  updateToast(deltaMs) {
    if (!_toast) return;
    _toast.remainMs -= deltaMs;
    if (_toast.remainMs <= 0) _toast = null;
  },

  /**
   * Draw the discovery toast onto an existing 2D context (top-center of screen).
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
    ctx.strokeStyle = '#44aacc';
    ctx.lineWidth   = 1;
    ctx.strokeRect(bx, offsetY, tw, 22);
    ctx.fillStyle   = '#aaddff';
    ctx.fillText(_toast.text, 320, offsetY + 5);
    ctx.restore();
  },
};

if (typeof window !== 'undefined') window.Secrets = Secrets;
