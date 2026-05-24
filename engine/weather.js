/**
 * weather.js — Weather state machine and particle system (Layer 6).
 *
 * Manages rain, snow, fog, and storm effects as screen-space particles
 * and overlays. Transitions between states over 3 seconds.
 * Exposes hasEffect() for gameplay code to query weather conditions.
 */

import { LAYER } from './renderer.js';

const LOGICAL_W = 640;
const LOGICAL_H = 480;
const POOL_SIZE  = 500;

const TRANSITION_MS  = 3000;
const LIGHTNING_BASE = 8000;   // minimum ms between lightning strikes
const LIGHTNING_VAR  = 7000;   // random additional ms

// Weather effect flags
const EFFECTS = {
  clear:       [],
  overcast:    [],
  rain:        ['slows_movement_on_dirt'],
  heavy_rain:  ['extinguishes_torches', 'reduces_visibility', 'slows_movement_on_dirt'],
  fog:         ['reduces_visibility'],
  snow:        ['slows_movement_on_dirt'],
  blizzard:    ['extinguishes_torches', 'reduces_visibility', 'slows_movement_on_dirt'],
  storm:       ['extinguishes_torches', 'reduces_visibility', 'slows_movement_on_dirt'],
};

// Visibility radius in pixels for states that clamp render distance
const VISIBILITY_RADIUS = {
  heavy_rain: 6 * 32,
  fog:        5 * 32,
  blizzard:   4 * 32,
};

// Cycle order for debug key cycling
export const WEATHER_CYCLE = ['clear', 'overcast', 'rain', 'heavy_rain', 'fog', 'snow', 'blizzard', 'storm'];

export class Weather {
  /**
   * @param {import('./renderer.js').Renderer} renderer
   */
  constructor(renderer) {
    this._renderer = renderer;
    this._state    = 'clear';
    this._prevState = 'clear';

    // Transition
    this._transMs      = TRANSITION_MS;
    this._transAlpha   = 1.0;  // 0→1 as new state fades in

    // Particle pool
    this._pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      this._pool.push({ x: 0, y: 0, dx: 0, dy: 0, active: false, size: 1, alpha: 1 });
    }
    this._activeCount = 0;

    // Fog scroll offsets (two independent layers)
    this._fogOffset1 = 0;
    this._fogOffset2 = 0;

    // Lightning state
    this._lightningTimer   = 0;
    this._lightningFlashMs = 0;
    this._lightningInterval = _randomLightningInterval();

    // Fog texture (generated once)
    this._fogTexture = _buildFogTexture();

    // Player screen position for visibility clamping
    this._playerX = LOGICAL_W / 2;
    this._playerY = LOGICAL_H / 2;
  }

  /** @returns {string} active weather state */
  getState() { return this._state; }

  /**
   * Transition to a new weather state over 3 seconds.
   * @param {string} state
   */
  setState(state) {
    if (state === this._state) return;
    this._prevState   = this._state;
    this._state       = state;
    this._transMs     = 0;
    this._transAlpha  = 0;
    this._lightningTimer = 0;
    this._lightningInterval = _randomLightningInterval();
    this._initParticles(state);
  }

  /**
   * @param {string} effect  One of the effect flag strings
   * @returns {boolean}
   */
  hasEffect(effect) {
    return (EFFECTS[this._state] ?? []).includes(effect);
  }

  /**
   * Set the player's screen-pixel position for visibility-clamp rendering.
   * @param {number} x
   * @param {number} y
   */
  setPlayerScreenPos(x, y) {
    this._playerX = x;
    this._playerY = y;
  }

  /**
   * Advance particle simulation and render to Layer 6.
   * Call once per render frame.
   * @param {number} deltaMs
   */
  update(deltaMs) {
    // Advance transition alpha
    this._transMs   = Math.min(this._transMs + deltaMs, TRANSITION_MS);
    this._transAlpha = this._transMs / TRANSITION_MS;

    this._renderer.clearLayer(LAYER.WEATHER);
    if (this._state === 'clear') return;

    const ctx = this._renderer.getLayerContext(LAYER.WEATHER);
    const a   = this._transAlpha;   // fade-in multiplier

    switch (this._state) {
      case 'overcast':    this._renderOvercast(ctx, a);                     break;
      case 'rain':        this._updateParticles(deltaMs);
                          this._renderRain(ctx, a, false);                   break;
      case 'heavy_rain':  this._updateParticles(deltaMs);
                          this._renderRain(ctx, a, true);
                          this._updateLightning(ctx, deltaMs, a, false);
                          this._renderVisibility(ctx, a, VISIBILITY_RADIUS.heavy_rain); break;
      case 'fog':         this._renderFog(ctx, deltaMs, a);
                          this._renderVisibility(ctx, a, VISIBILITY_RADIUS.fog);        break;
      case 'snow':        this._updateParticles(deltaMs);
                          this._renderSnow(ctx, a, false);                  break;
      case 'blizzard':    this._updateParticles(deltaMs);
                          this._renderSnow(ctx, a, true);
                          this._renderVisibility(ctx, a, VISIBILITY_RADIUS.blizzard);  break;
      case 'storm':       this._updateParticles(deltaMs);
                          this._renderRain(ctx, a, true);
                          this._updateLightning(ctx, deltaMs, a, true);
                          this._renderVisibility(ctx, a, VISIBILITY_RADIUS.heavy_rain); break;
    }
  }

  // ─── Private: rendering ─────────────────────────────────────────────────────

  _renderOvercast(ctx, a) {
    ctx.save();
    ctx.globalAlpha = 0.08 * a;
    ctx.fillStyle = 'rgb(200,200,220)';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.restore();
  }

  _renderRain(ctx, a, heavy) {
    const density = heavy ? 400 : 200;
    ctx.save();
    ctx.strokeStyle = heavy ? 'rgba(140,160,200,0.55)' : 'rgba(160,180,220,0.45)';
    ctx.lineWidth   = 1;
    ctx.globalAlpha = a;
    ctx.beginPath();
    let drawn = 0;
    for (let i = 0; i < POOL_SIZE && drawn < density; i++) {
      const p = this._pool[i];
      if (!p.active) continue;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.dx * 0.04, p.y + 8);  // 8px tall streaks
      drawn++;
    }
    ctx.stroke();
    ctx.restore();
  }

  _renderSnow(ctx, a, blizzard) {
    ctx.save();
    ctx.fillStyle = 'rgba(240,245,255,0.85)';
    ctx.globalAlpha = a;
    let drawn = 0;
    const density = blizzard ? 400 : 150;
    for (let i = 0; i < POOL_SIZE && drawn < density; i++) {
      const p = this._pool[i];
      if (!p.active) continue;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
      drawn++;
    }
    ctx.restore();
  }

  _renderFog(ctx, deltaMs, a) {
    this._fogOffset1 = (this._fogOffset1 + deltaMs * 0.018) % LOGICAL_W;
    this._fogOffset2 = (this._fogOffset2 + deltaMs * 0.011) % LOGICAL_W;

    ctx.save();
    ctx.globalAlpha = 0.22 * a;
    // Draw fog texture twice (to fill the scroll gap) at two offsets
    for (const offset of [this._fogOffset1, this._fogOffset2]) {
      const ox = Math.round(offset);
      ctx.drawImage(this._fogTexture, ox - LOGICAL_W, 0);
      ctx.drawImage(this._fogTexture, ox, 0);
    }
    ctx.restore();
  }

  /**
   * Render a radial visibility clamp: scene darkens beyond visRadius from player.
   */
  _renderVisibility(ctx, a, visRadius) {
    const px = this._playerX;
    const py = this._playerY;
    const outerR = Math.sqrt(LOGICAL_W * LOGICAL_W + LOGICAL_H * LOGICAL_H);

    ctx.save();
    ctx.globalAlpha = 0.68 * a;
    const g = ctx.createRadialGradient(px, py, visRadius, px, py, outerR);
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.25, 'rgba(0,0,0,0.5)');
    g.addColorStop(1.0,  'rgba(0,0,0,0.9)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    ctx.restore();
  }

  _updateLightning(ctx, deltaMs, a, storm) {
    this._lightningTimer += deltaMs;

    // Active flash rendering
    if (this._lightningFlashMs > 0) {
      this._lightningFlashMs -= deltaMs;
      ctx.save();
      ctx.globalAlpha = Math.min(1, (this._lightningFlashMs / 50)) * a;
      ctx.fillStyle = 'rgb(240,245,255)';
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      ctx.restore();
    }

    // Trigger next lightning
    const interval = storm ? this._lightningInterval : this._lightningInterval * 1.5;
    if (this._lightningTimer >= interval) {
      this._lightningTimer     = 0;
      this._lightningFlashMs   = 50;
      this._lightningInterval  = _randomLightningInterval();
    }
  }

  // ─── Private: particle management ───────────────────────────────────────────

  _initParticles(state) {
    // Deactivate all first
    for (const p of this._pool) p.active = false;

    let count = 0;
    switch (state) {
      case 'rain':        count = 200;  break;
      case 'heavy_rain':  count = 400;  break;
      case 'snow':        count = 150;  break;
      case 'blizzard':    count = 400;  break;
      case 'storm':       count = 400;  break;
      default:            return;
    }

    const isRain    = state === 'rain' || state === 'heavy_rain' || state === 'storm';
    const isBlizzard = state === 'blizzard';

    for (let i = 0; i < count; i++) {
      const p = this._pool[i];
      p.active = true;
      p.x = Math.random() * LOGICAL_W;
      p.y = Math.random() * LOGICAL_H;   // start spread across screen

      if (isRain) {
        p.dx = (Math.random() - 0.5) * 10;         // very slight horizontal drift
        p.dy = 180 + Math.random() * 80;            // 180–260 px/s
      } else if (isBlizzard) {
        p.dx = 80 + Math.random() * 50;             // strong right-ward wind
        p.dy = 60 + Math.random() * 50;
      } else {
        // snow
        p.dx = (Math.random() - 0.5) * 20;         // gentle horizontal drift
        p.dy = 30 + Math.random() * 30;             // 30–60 px/s
      }
    }
  }

  _updateParticles(deltaMs) {
    const dt   = deltaMs / 1000;   // convert to seconds
    const state = this._state;
    const isRain = state === 'rain' || state === 'heavy_rain' || state === 'storm';

    for (const p of this._pool) {
      if (!p.active) continue;

      p.x += p.dx * dt;
      p.y += p.dy * dt;

      // Wrap vertically
      if (p.y > LOGICAL_H) {
        p.y = -8;
        p.x = Math.random() * LOGICAL_W;
      }
      // Wrap horizontally for snow/blizzard
      if (!isRain) {
        if (p.x > LOGICAL_W) p.x -= LOGICAL_W;
        if (p.x < 0)         p.x += LOGICAL_W;
      }
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _randomLightningInterval() {
  return LIGHTNING_BASE + Math.random() * LIGHTNING_VAR;
}

/**
 * Generate a static fog texture: soft horizontal white bands on a transparent canvas.
 * Tiled and scrolled each frame to create drifting fog.
 */
function _buildFogTexture() {
  const c   = new OffscreenCanvas(LOGICAL_W, LOGICAL_H);
  const ctx = c.getContext('2d');

  const bandH  = 80;
  const bands  = Math.ceil(LOGICAL_H / bandH) + 1;

  for (let i = 0; i < bands; i++) {
    const cy = i * bandH + (Math.random() * bandH * 0.5);
    const g  = ctx.createLinearGradient(0, cy - bandH * 0.5, 0, cy + bandH * 0.5);
    const opacity = 0.08 + Math.random() * 0.12;
    g.addColorStop(0.0,  'rgba(255,255,255,0)');
    g.addColorStop(0.5,  `rgba(255,255,255,${opacity.toFixed(2)})`);
    g.addColorStop(1.0,  'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, cy - bandH * 0.5, LOGICAL_W, bandH);
  }

  return c;
}
