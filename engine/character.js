/**
 * character.js — Character definition wrapper with animation state machine
 * and procedural sprite sheet generation.
 *
 * Sprite sheet layout: 96×128, 32×32 per frame
 *   Row 0 = South, Row 1 = North, Row 2 = East, Row 3 = West
 *   Col 0 = idle,  Col 1 = step-left,  Col 2 = step-right
 */

const CLASS_COLORS = {
  fighter: '#5588bb',
  mage:    '#9955bb',
  thief:   '#336633',
  cleric:  '#bbaa22',
};
const DEFAULT_COLOR = '#887766';

const DIRECTION_ROWS = { south: 0, north: 1, east: 2, west: 3 };

const IDLE_BREATHE_DELAY_MS = 2000;
const IDLE_BREATHE_FRAME_MS = 800;

export class Character {
  /**
   * @param {object} def - parsed character JSON definition
   */
  constructor(def) {
    this.def = def;
    this._animState      = 'idle';   // idle | walking | interacting | combat
    this._facing         = 'south';  // south | north | east | west
    this._walkFrame      = 0;        // 0=idle col, 1=step-left, 2=step-right
    this._stationaryMs   = 0;
    this._idleBreathTimer = 0;
    this._idleBreathFrame = 0;       // 0 or 1
    this._spriteSheet    = _generateProceduralSprite(def);
  }

  get id()    { return this.def.character_id; }
  get name()  { return this.def.display_name; }
  get hp()    { return this.def.base_stats.hp; }
  get maxHp() { return this.def.base_stats.max_hp; }
  get facing(){ return this._facing; }

  setFacing(dir) { this._facing = dir; }

  setAnimState(state) {
    if (this._animState === state) return;
    this._animState = state;
    if (state === 'idle') {
      this._walkFrame      = 0;
      this._stationaryMs   = 0;
      this._idleBreathTimer = 0;
      this._idleBreathFrame = 0;
    }
  }

  /** Advance walk animation by one step. */
  onStep() {
    this._walkFrame = this._walkFrame === 1 ? 2 : 1;
    this._stationaryMs = 0;
  }

  /**
   * Update animation timers. Call every render frame.
   * @param {number} deltaMs
   */
  update(deltaMs) {
    if (this._animState === 'idle') {
      this._stationaryMs += deltaMs;
      if (this._stationaryMs >= IDLE_BREATHE_DELAY_MS) {
        this._idleBreathTimer += deltaMs;
        this._idleBreathFrame = Math.floor(this._idleBreathTimer / IDLE_BREATHE_FRAME_MS) % 2;
      }
    } else {
      this._stationaryMs    = 0;
      this._idleBreathTimer = 0;
      this._idleBreathFrame = 0;
    }
  }

  /**
   * Get the current sprite frame column and row for drawImage.
   * @returns {{ col: number, row: number }}
   */
  getCurrentFrame() {
    const row = DIRECTION_ROWS[this._facing] ?? 0;
    let col;
    if (this._animState === 'walking') {
      col = this._walkFrame || 1;
    } else {
      // Idle breathe: alternate between col 0 and col 2
      col = this._idleBreathFrame === 1 ? 2 : 0;
    }
    return { col, row };
  }

  getSpriteSheet() { return this._spriteSheet; }
}

// ─── Procedural sprite generation ─────────────────────────────────────────────

function _generateProceduralSprite(def) {
  const FW = 32, FH = 32;
  const canvas = new OffscreenCanvas(FW * 3, FH * 4); // 96×128
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const bodyColor = CLASS_COLORS[def.class_id] || DEFAULT_COLOR;
  const headColor = _lighten(bodyColor, 0.18);

  const dirs = ['south', 'north', 'east', 'west'];
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      _drawFrame(ctx, col * FW, row * FH, FW, FH, dirs[row], col, bodyColor, headColor);
    }
  }

  return canvas;
}

function _drawFrame(ctx, px, py, fw, fh, dir, frameCol, bodyColor, headColor) {
  // Subtle vertical bob on step frames
  const bobY = frameCol === 1 ? -1 : frameCol === 2 ? 1 : 0;

  // Body: 20×20 rectangle
  ctx.fillStyle = bodyColor;
  ctx.fillRect(px + 6, py + 10 + bobY, 20, 20);

  // Head: 14×12 rectangle above body
  ctx.fillStyle = headColor;
  ctx.fillRect(px + 9, py + 2 + bobY, 14, 12);

  // Direction indicator: small white dot on the facing edge
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const cx = px + fw / 2;
  const cy = py + fh / 2;
  let dx, dy;
  switch (dir) {
    case 'south': dx = cx - 2; dy = py + 27 + bobY; break;
    case 'north': dx = cx - 2; dy = py + 2  + bobY; break;
    case 'east':  dx = px + 25; dy = cy - 2 + bobY; break;
    default:      dx = px + 2;  dy = cy - 2 + bobY; break; // west
  }
  ctx.fillRect(dx, dy, 4, 4);
}

function _lighten(hex, amount) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const add = Math.floor(amount * 255);
  return `#${_h(r + add)}${_h(g + add)}${_h(b + add)}`;
}

function _h(n) { return Math.min(255, n).toString(16).padStart(2, '0'); }
