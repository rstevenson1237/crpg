/**
 * spritesheet.js — Sprite sheet loader and frame extractor.
 * Loads an image by URL and provides frame/animation access.
 */

const FRAME_W = 32;
const FRAME_H = 32;

export class SpriteSheet {
  /**
   * @param {HTMLImageElement|ImageBitmap} image - loaded image
   * @param {number} frameWidth
   * @param {number} frameHeight
   */
  constructor(image, frameWidth = FRAME_W, frameHeight = FRAME_H) {
    this._image = image;
    this._fw = frameWidth;
    this._fh = frameHeight;
    this._frameCache = new Map();
  }

  /**
   * Return the raw source image (for drawImage calls).
   */
  getImage() {
    return this._image;
  }

  /**
   * Get the pixel coordinates for a frame at (col, row).
   * @returns {{ sx: number, sy: number, sw: number, sh: number }}
   */
  getFrameRect(col, row) {
    return {
      sx: col * this._fw,
      sy: row * this._fh,
      sw: this._fw,
      sh: this._fh,
    };
  }

  /**
   * Get an ImageBitmap for a specific frame. Cached after first call.
   * @param {number} col
   * @param {number} row
   * @returns {Promise<ImageBitmap>}
   */
  async getFrame(col, row) {
    const key = `${col},${row}`;
    if (this._frameCache.has(key)) return this._frameCache.get(key);

    const bmp = await createImageBitmap(
      this._image,
      col * this._fw,
      row * this._fh,
      this._fw,
      this._fh
    );
    this._frameCache.set(key, bmp);
    return bmp;
  }

  /**
   * Synchronously get frame rect for use in drawImage.
   * Returns { image, sx, sy, sw, sh } for direct use.
   */
  getFrameSync(col, row) {
    return {
      image: this._image,
      sx: col * this._fw,
      sy: row * this._fh,
      sw: this._fw,
      sh: this._fh,
    };
  }

  /**
   * Get the current animation frame based on elapsed time.
   * @param {{ frames: [number, number][], fps: number, loop: boolean }} animDef
   * @param {number} elapsedMs - total elapsed ms since animation started
   * @returns {{ image, sx, sy, sw, sh }}
   */
  getAnimFrame(animDef, elapsedMs) {
    const { frames, fps, loop } = animDef;
    const frameDuration = 1000 / fps;
    const totalFrames = frames.length;
    const totalDuration = frameDuration * totalFrames;

    let frameIndex;
    if (loop) {
      const t = elapsedMs % totalDuration;
      frameIndex = Math.floor(t / frameDuration);
    } else {
      frameIndex = Math.min(
        Math.floor(elapsedMs / frameDuration),
        totalFrames - 1
      );
    }

    const [col, row] = frames[frameIndex];
    return this.getFrameSync(col, row);
  }
}

/**
 * Load a SpriteSheet from a URL.
 * @param {string} url
 * @param {number} [frameWidth=32]
 * @param {number} [frameHeight=32]
 * @returns {Promise<SpriteSheet>}
 */
export async function loadSpriteSheet(url, frameWidth = FRAME_W, frameHeight = FRAME_H) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(new SpriteSheet(img, frameWidth, frameHeight));
    img.onerror = () => reject(new Error(`Failed to load sprite sheet: ${url}`));
    img.src = url;
  });
}

/**
 * Create a SpriteSheet from an OffscreenCanvas or HTMLCanvasElement (procedurally generated).
 * @param {OffscreenCanvas|HTMLCanvasElement} canvas
 * @param {number} [frameWidth=32]
 * @param {number} [frameHeight=32]
 * @returns {SpriteSheet}
 */
export function spriteSheetFromCanvas(canvas, frameWidth = FRAME_W, frameHeight = FRAME_H) {
  return new SpriteSheet(canvas, frameWidth, frameHeight);
}
