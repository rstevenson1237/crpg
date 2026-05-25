/**
 * party.js — Party management and character rendering.
 *
 * Tracks active members (up to max), roster, and the lead character.
 * Maintains a position-history queue so followers trail the leader
 * with a 1-tile-per-step delay.
 */

import { LAYER } from './renderer.js';

const TILE_SIZE = 32;

export class Party {
  constructor() {
    this._active     = [];   // Character[] currently in the field
    this._roster     = [];   // Character[] in reserve
    this._leadIndex  = 0;
    this._maxSize    = 1;
    this._posHistory = [];   // [{tile_x, tile_y}] — lead positions, newest first
  }

  // ── Membership ──────────────────────────────────────────────────────────────

  /**
   * Add a character. Goes into active if below max, otherwise roster.
   * @param {import('./character.js').Character} character
   */
  addMember(character) {
    if (this._active.length < this._maxSize) {
      this._active.push(character);
    } else {
      this._roster.push(character);
    }
  }

  /**
   * Move a character from active to roster.
   * @param {string} characterId
   */
  removeMember(characterId) {
    const idx = this._active.findIndex(c => c.id === characterId);
    if (idx === -1) return;
    const [removed] = this._active.splice(idx, 1);
    this._roster.push(removed);
    if (this._leadIndex >= this._active.length) {
      this._leadIndex = Math.max(0, this._active.length - 1);
    }
  }

  /**
   * Set the maximum active party size, moving members in/out of roster.
   * @param {number} n
   */
  setMax(n) {
    this._maxSize = n;
    while (this._active.length < this._maxSize && this._roster.length > 0) {
      this._active.push(this._roster.shift());
    }
    while (this._active.length > this._maxSize) {
      this._roster.unshift(this._active.pop());
    }
    if (this._leadIndex >= this._active.length) {
      this._leadIndex = Math.max(0, this._active.length - 1);
    }
  }

  /**
   * Change which active member the player directly controls.
   * @param {string} characterId
   */
  setLead(characterId) {
    const idx = this._active.findIndex(c => c.id === characterId);
    if (idx !== -1) this._leadIndex = idx;
  }

  getLead() { return this._active[this._leadIndex] ?? null; }

  get active()  { return this._active; }
  get members() { return this._active; }   // alias for console convenience
  get roster()  { return this._roster; }

  // ── Position history ─────────────────────────────────────────────────────────

  /**
   * Record the lead's current tile before it moves.
   * Call this once per successful lead move.
   * @param {number} fromX
   * @param {number} fromY
   */
  recordLeadMove(fromX, fromY) {
    this._posHistory.unshift({ tile_x: fromX, tile_y: fromY });
    const maxHist = Math.max(this._active.length * 3, 6);
    if (this._posHistory.length > maxHist) {
      this._posHistory.length = maxHist;
    }
  }

  /**
   * Get the tile position for a party member by index.
   * Member 0 is at (leadX, leadY). Member N is N steps behind in history.
   * @param {number} leadX
   * @param {number} leadY
   * @param {number} memberIdx
   * @returns {{ tile_x: number, tile_y: number }}
   */
  getMemberPosition(leadX, leadY, memberIdx) {
    if (memberIdx === 0) return { tile_x: leadX, tile_y: leadY };
    return this._posHistory[memberIdx - 1] ?? { tile_x: leadX, tile_y: leadY };
  }

  getLeadPosition(leadX, leadY) { return { tile_x: leadX, tile_y: leadY }; }

  // ── Rendering ────────────────────────────────────────────────────────────────

  /**
   * Render all active party members on LAYER.CHARACTERS (Y-sorted).
   * @param {import('./renderer.js').Renderer} renderer
   * @param {import('./camera.js').Camera} camera
   * @param {number} leadX
   * @param {number} leadY
   * @param {number} deltaMs - for animation timer updates
   */
  render(renderer, camera, leadX, leadY, deltaMs) {
    renderer.clearLayer(LAYER.CHARACTERS);
    renderer.clearLayer(LAYER.ENTITY_SHADOW);

    const entries = this._active.map((char, idx) => {
      char.update(deltaMs);
      const pos = this.getMemberPosition(leadX, leadY, idx);
      return { char, pos };
    });

    // Painter's algorithm: sort by tile_y (tie-break by tile_x)
    entries.sort((a, b) => a.pos.tile_y - b.pos.tile_y || a.pos.tile_x - b.pos.tile_x);

    const shadowCtx = renderer.getLayerContext(LAYER.ENTITY_SHADOW);
    const charCtx   = renderer.getLayerContext(LAYER.CHARACTERS);

    for (const { char, pos } of entries) {
      const screen = camera.worldToScreen(pos.tile_x, pos.tile_y);

      // Elliptical drop shadow
      shadowCtx.fillStyle = 'rgba(0,0,0,0.3)';
      shadowCtx.fillRect(screen.x + 4, screen.y + 26, 24, 5);

      // Sprite frame
      const { col, row } = char.getCurrentFrame();
      charCtx.drawImage(
        char.getSpriteSheet(),
        col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
        screen.x, screen.y, TILE_SIZE, TILE_SIZE
      );
    }
  }
}
