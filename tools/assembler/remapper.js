/**
 * remapper.js — Source-sheet extraction and frame remapping.
 *
 * Handles both pipeline modes:
 *   Mode A (individual) — loads each frame from its own File
 *   Mode B (sheet)      — extracts frames from a packed source sheet
 *
 * Source sheets are cached per file-key within a pipeline run.
 * Call remapper.clearCache() between runs to free memory.
 */

import { CanvasUtils } from './canvas_utils.js';

export class Remapper {
  constructor() {
    this._sheetCache = new Map();   // fileKey → ImageBitmap
    this._fileCache  = new Map();   // fileKey → ImageBitmap (individual mode)
  }

  // ── Public ──────────────────────────────────────────────────────────────────

  /**
   * Get the processed ImageBitmap for one output frame.
   *
   * @param {object}        manifest   — full manifest object
   * @param {number}        outputIdx  — 0-based frame position in output grid
   * @param {Map<string,File>} fileMap — uploaded files keyed by user label
   * @returns {Promise<ImageBitmap|null>}  null = missing source (caller fills placeholder)
   */
  async getFrame(manifest, outputIdx, fileMap) {
    const { source, frame_width: fw, frame_height: fh } = manifest;

    if (source.mode === 'individual') {
      return this._getIndividualFrame(source, outputIdx, fileMap, fw, fh);
    } else {
      return this._getSheetFrame(source, outputIdx, fileMap, fw, fh);
    }
  }

  clearCache() {
    this._sheetCache.clear();
    this._fileCache.clear();
  }

  // ── Mode A ───────────────────────────────────────────────────────────────────

  async _getIndividualFrame(source, outputIdx, fileMap, fw, fh) {
    const entry = source.files.find(f => f.frame_index === outputIdx);
    if (!entry) return null;

    const file = fileMap.get(entry.file_key);
    if (!file)  return null;

    // Cache decoded image per file key
    if (!this._fileCache.has(entry.file_key)) {
      const bmp = await CanvasUtils.fileToImageBitmap(file);
      this._fileCache.set(entry.file_key, bmp);
    }
    const src = this._fileCache.get(entry.file_key);

    // Already correct size? Return directly; otherwise resize.
    if (src.width === fw && src.height === fh) return src;
    return CanvasUtils.resizeNearest(src, fw, fh);
  }

  // ── Mode B ───────────────────────────────────────────────────────────────────

  async _getSheetFrame(source, outputIdx, fileMap, fw, fh) {
    const mapEntry = source.frame_map.find(f => f.output_index === outputIdx);
    if (!mapEntry) return null;

    const file = fileMap.get(source.sheet_key);
    if (!file) return null;

    // Load and cache the full source sheet
    if (!this._sheetCache.has(source.sheet_key)) {
      const bmp = await CanvasUtils.fileToImageBitmap(file);
      this._sheetCache.set(source.sheet_key, bmp);
    }
    const sheet = this._sheetCache.get(source.sheet_key);

    const sfx = mapEntry.source_col * source.source_frame_width;
    const sfy = mapEntry.source_row * source.source_frame_height;
    const raw = await CanvasUtils.extractFrame(
      sheet, sfx, sfy,
      source.source_frame_width, source.source_frame_height,
    );

    if (raw.width === fw && raw.height === fh) return raw;
    return CanvasUtils.resizeNearest(raw, fw, fh);
  }
}
