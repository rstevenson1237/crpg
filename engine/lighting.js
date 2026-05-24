/**
 * lighting.js — Day/night lighting overlay rendered on Layer 7.
 *
 * Layer 7 uses Canvas globalCompositeOperation:'multiply' (set in renderer.js),
 * so drawing a dark colour on this layer darkens the scene proportionally.
 *
 * For night/dark-interior: a mask approach creates an 80%-dark screen with
 * warm torch-radius cutouts punched through using 'lighter' blending.
 *
 * Interior maps override time-of-day via their ambient_light property.
 */

import { LAYER } from './renderer.js';

const LOGICAL_W = 640;
const LOGICAL_H = 480;
const TILE_SIZE  = 32;

// RGBA colour per time-of-day state (used as multiply overlay)
const STATE_COLORS = {
  dawn:      { r: 255, g: 200, b: 150, a: 0.25 },
  morning:   { r: 255, g: 255, b: 255, a: 0.0  },
  noon:      { r: 255, g: 255, b: 255, a: 0.0  },
  afternoon: { r: 255, g: 240, b: 200, a: 0.1  },
  dusk:      { r: 255, g: 160, b:  80, a: 0.35 },
  evening:   { r:  80, g:  60, b: 120, a: 0.5  },
  night:     { r:  10, g:  10, b:  40, a: 0.72 },
  midnight:  { r:   0, g:   0, b:  20, a: 0.82 },
};

// Static multiply overlays for interior ambient_light settings
const AMBIENT_COLORS = {
  bright:      { r: 255, g: 255, b: 255, a: 0.0  },
  dim:         { r:   0, g:   0, b:   0, a: 0.3  },
  dark:        { r:   0, g:   0, b:   0, a: 0.65 },
  pitch_black: { r:   0, g:   0, b:   0, a: 0.95 },
};

// Light-source radii in screen pixels (32px per tile)
const LIGHT_RADII = {
  torch:   4 * TILE_SIZE,  // 128 px
  lantern: 6 * TILE_SIZE,  // 192 px
};

// Darkness level outside torch radii expressed as an RGB value (0–255 each).
// 80% black = 20% white = rgb(51,51,51).
const OUTER_DARK = 51;

const TRANSITION_MS = 2000;

export class Lighting {
  /**
   * @param {import('./renderer.js').Renderer} renderer
   * @param {import('./time.js').GameTime} gameTime
   */
  constructor(renderer, gameTime) {
    this._renderer = renderer;
    this._gameTime = gameTime;
    this._mapData  = null;

    // Colour transition state
    const init = { ...STATE_COLORS[gameTime.getState()] };
    this._fromColor = { ...init };
    this._toColor   = { ...init };
    this._transMs   = TRANSITION_MS;   // start fully arrived

    // Offscreen mask used when torch radii are active
    this._maskCanvas = new OffscreenCanvas(LOGICAL_W, LOGICAL_H);
    this._maskCtx    = this._maskCanvas.getContext('2d');
    this._maskCtx.imageSmoothingEnabled = false;

    gameTime.onStateChange((newState) => {
      this._fromColor = this._blendedColor();
      this._toColor   = { ...(STATE_COLORS[newState] ?? STATE_COLORS.dawn) };
      this._transMs   = 0;
    });
  }

  /** Provide the current map so ambient_light can override time-of-day. */
  setMapData(mapData) { this._mapData = mapData; }

  /**
   * Render the lighting overlay. Call once per render frame.
   *
   * @param {number} deltaMs - render frame delta in milliseconds
   * @param {Array<{x:number, y:number, radius:number}>} lightSources
   *   Screen-pixel positions and radii of active light sources (torches/lanterns).
   *   Pass empty array when none are present.
   */
  render(deltaMs, lightSources = []) {
    this._transMs = Math.min(this._transMs + deltaMs, TRANSITION_MS);

    const ambientKey  = this._mapData?.def?.ambient_light;
    const baseColor   = ambientKey
      ? { ...(AMBIENT_COLORS[ambientKey] ?? AMBIENT_COLORS.bright) }
      : this._blendedColor();

    const state      = this._gameTime.getState();
    const isDark     = state === 'night' || state === 'midnight';
    const isIntDark  = ambientKey === 'dark' || ambientKey === 'pitch_black';
    const useTorches = (isDark || isIntDark) && lightSources.length > 0;

    this._renderer.clearLayer(LAYER.LIGHTING);
    const ctx = this._renderer.getLayerContext(LAYER.LIGHTING);

    if (useTorches) {
      this._renderTorchMask(ctx, baseColor, lightSources);
    } else if (baseColor.a > 0.001) {
      ctx.save();
      ctx.globalAlpha = baseColor.a;
      ctx.fillStyle = `rgb(${baseColor.r},${baseColor.g},${baseColor.b})`;
      ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      ctx.restore();
    }
    // alpha === 0 → layer stays clear → multiply has no effect (morning/noon)
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /** Lerp between _fromColor and _toColor based on elapsed transition time. */
  _blendedColor() {
    const t = Math.min(this._transMs / TRANSITION_MS, 1.0);
    return {
      r: Math.round(_lerp(this._fromColor.r, this._toColor.r, t)),
      g: Math.round(_lerp(this._fromColor.g, this._toColor.g, t)),
      b: Math.round(_lerp(this._fromColor.b, this._toColor.b, t)),
      a: _lerp(this._fromColor.a, this._toColor.a, t),
    };
  }

  /**
   * Build the torch-radius mask on the intermediate canvas then blit to Layer 7.
   *
   * Approach:
   *   1. Fill mask with OUTER_DARK (rgb(51,51,51)) — represents 80% darkness.
   *   2. Use 'lighter' blend to add warm radial gradients for each light source.
   *      The addition can push values up to white (255) at the torch centre,
   *      so Layer 7 * multiply ≈ normal brightness inside the torch radius.
   *   3. Copy mask to Layer 7 at full opacity.
   *
   * @param {CanvasRenderingContext2D} ctx  Layer 7 context
   * @param {{ r,g,b,a }} baseColor          Base darkness colour (unused here — torch mode overrides)
   * @param {Array<{x,y,radius}>} sources
   */
  _renderTorchMask(ctx, baseColor, sources) {
    const m = this._maskCtx;

    // 1. Solid dark background
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1.0;
    m.fillStyle = `rgb(${OUTER_DARK},${OUTER_DARK},${OUTER_DARK})`;
    m.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // 2. Warm light circles punched through with 'lighter'
    m.globalCompositeOperation = 'lighter';
    for (const { x, y, radius } of sources) {
      this._drawTorchGradient(m, x, y, radius);
    }

    // 3. Blit mask onto Layer 7 at full opacity
    m.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._maskCanvas, 0, 0);
  }

  /**
   * Draw a warm radial gradient onto the mask context using 'lighter'.
   * The base fill is OUTER_DARK; adding these values brings the centre
   * close to (255,255,200) — near-white warm — so multiply ≈ no darkening.
   */
  _drawTorchGradient(mctx, cx, cy, radius) {
    // We need to add enough to bring OUTER_DARK (51) up to near-255 at centre.
    // 255 - 51 = 204 needed.  Use rgba to control falloff via alpha.
    const g = mctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0.00, `rgba(204, 204, 150, 1.0)`);  // +204→255, warm white
    g.addColorStop(0.25, `rgba(180, 120,  40, 0.85)`); // warm mid-bright
    g.addColorStop(0.55, `rgba(120,  60,  10, 0.55)`); // warm dim
    g.addColorStop(0.80, `rgba( 40,  10,   0, 0.25)`); // fading warm edge
    g.addColorStop(1.00, `rgba(  0,   0,   0, 0.0 )`); // no addition at edge
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(cx, cy, radius, 0, Math.PI * 2);
    mctx.fill();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _lerp(a, b, t) { return a + (b - a) * t; }
