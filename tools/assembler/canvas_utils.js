/**
 * canvas_utils.js — Shared Canvas 2D operations for the sprite assembler.
 *
 * All rasterisation uses nearest-neighbor interpolation only.
 * imageSmoothingEnabled is set to false on every context, defensively.
 */

export const CanvasUtils = {

  // ── Core operations ─────────────────────────────────────────────────────────

  /**
   * Crop a rectangular region from a source image/bitmap.
   * @param {ImageBitmap|HTMLImageElement|HTMLCanvasElement} src
   * @returns {Promise<ImageBitmap>}
   */
  async extractFrame(src, sx, sy, sw, sh) {
    const c = new OffscreenCanvas(sw, sh);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return c.transferToImageBitmap();
  },

  /**
   * Scale using nearest-neighbor ONLY. Never bilinear, never smoothed.
   * @returns {Promise<ImageBitmap>}
   */
  async resizeNearest(src, targetW, targetH) {
    const c = new OffscreenCanvas(targetW, targetH);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, targetW, targetH);
    return c.transferToImageBitmap();
  },

  /**
   * Replace a background colour with full transparency.
   *
   * mode "magic_pink" — RGB (255, 0, 255) ± 8 per channel → alpha 0
   * mode "white_bg"   — RGB (255, 255, 255) ± 8 per channel → alpha 0
   * mode "none"       — pass-through unchanged
   *
   * @param {ImageBitmap} src
   * @param {"magic_pink"|"white_bg"|"none"} mode
   * @returns {Promise<ImageBitmap>}
   */
  async normalizeTransparency(src, mode) {
    if (mode === 'none') return src;

    const w = src.width, h = src.height;
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);

    const id   = ctx.getImageData(0, 0, w, h);
    const data = id.data;
    const TOL  = 8;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      let hit = false;
      if (mode === 'magic_pink') hit = r >= 255 - TOL && g <= TOL && b >= 255 - TOL;
      else if (mode === 'white_bg') hit = r >= 255 - TOL && g >= 255 - TOL && b >= 255 - TOL;
      if (hit) data[i + 3] = 0;
    }

    ctx.putImageData(id, 0, 0);
    return c.transferToImageBitmap();
  },

  /**
   * Compose an array of frames into a row-major grid.
   * null entries become empty (transparent) cells.
   *
   * @param {Array<ImageBitmap|null>} frames  — length = layout_cols × layout_rows
   * @param {number} cols
   * @param {number} frameW
   * @param {number} frameH
   * @returns {Promise<ImageBitmap>}
   */
  async composeSheet(frames, cols, frameW, frameH) {
    const rows  = Math.ceil(frames.length / cols);
    const c     = new OffscreenCanvas(cols * frameW, rows * frameH);
    const ctx   = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    for (let i = 0; i < frames.length; i++) {
      if (frames[i] == null) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      ctx.drawImage(frames[i], col * frameW, row * frameH, frameW, frameH);
    }

    return c.transferToImageBitmap();
  },

  /**
   * Create a magenta placeholder frame for missing/errored slots.
   * @returns {Promise<ImageBitmap>}
   */
  async makePlaceholder(w, h) {
    const c   = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FF00FF';
    ctx.fillRect(0, 0, w, h);
    // Dark "?" so it's visible against the magenta
    ctx.fillStyle    = 'rgba(0,0,0,0.6)';
    ctx.font         = `bold ${Math.max(6, Math.floor(Math.min(w, h) * 0.45))}px monospace`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', w / 2, h / 2);
    return c.transferToImageBitmap();
  },

  // ── I/O ─────────────────────────────────────────────────────────────────────

  /**
   * Load a File or Blob as an ImageBitmap.
   * @param {File|Blob} file
   * @returns {Promise<ImageBitmap>}
   */
  async fileToImageBitmap(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload  = resolve;
        img.onerror = () => reject(new Error(`Cannot decode image: ${file.name ?? '(blob)'}`));
        img.src = url;
      });
      return createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  },

  /**
   * Trigger a browser PNG download from an ImageBitmap.
   * @param {ImageBitmap} bitmap
   * @param {string} filename
   */
  downloadPNG(bitmap, filename) {
    const c   = document.createElement('canvas');
    c.width   = bitmap.width;
    c.height  = bitmap.height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);
    c.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href    = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }, 'image/png');
  },

  // ── Validation ───────────────────────────────────────────────────────────────

  /**
   * @returns {{ pass: boolean, actual: string }}
   */
  validateDimensions(bitmap, expectedW, expectedH) {
    const pass = bitmap.width === expectedW && bitmap.height === expectedH;
    return { pass, actual: `${bitmap.width}×${bitmap.height}` };
  },

  /**
   * Count fully-transparent pixels (alpha = 0).
   * @returns {Promise<number>}
   */
  async countTransparentPixels(bitmap) {
    const c   = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] === 0) n++;
    return n;
  },

  // ── Preview helpers ──────────────────────────────────────────────────────────

  /**
   * Render a bitmap to a 2D canvas at a given pixel scale (nearest-neighbor).
   * Draws a red grid overlay and frame-index labels.
   *
   * @param {CanvasRenderingContext2D} ctx   — target 2D context (HTMLCanvasElement)
   * @param {ImageBitmap} bitmap
   * @param {number} scale                  — integer display multiplier (e.g. 4)
   * @param {number} frameW                 — logical frame cell width
   * @param {number} frameH                 — logical frame cell height
   */
  renderPreview(ctx, bitmap, scale, frameW, frameH) {
    const dw = bitmap.width  * scale;
    const dh = bitmap.height * scale;
    ctx.canvas.width  = dw;
    ctx.canvas.height = dh;
    ctx.clearRect(0, 0, dw, dh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0, dw, dh);

    // Frame boundary grid
    ctx.strokeStyle = 'rgba(255,0,0,0.35)';
    ctx.lineWidth   = 1;
    const cols = bitmap.width  / frameW;
    const rows = bitmap.height / frameH;

    for (let c = 0; c <= cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * frameW * scale, 0);
      ctx.lineTo(c * frameW * scale, dh);
      ctx.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      ctx.beginPath();
      ctx.moveTo(0, r * frameH * scale);
      ctx.lineTo(dw, r * frameH * scale);
      ctx.stroke();
    }

    // Frame index labels
    const fontSize = Math.max(8, Math.min(12, frameH * scale * 0.22));
    ctx.font         = `bold ${fontSize}px monospace`;
    ctx.fillStyle    = 'rgba(255,255,255,0.85)';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillText(String(r * cols + c), c * frameW * scale + 2, r * frameH * scale + 2);
      }
    }
  },
};
