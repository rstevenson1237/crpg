/**
 * assembler.js — Core pipeline orchestrator.
 *
 * Usage:
 *   const asm = new Assembler(fileMap, logger);
 *   await asm.run('char_fighter_m');         // process + download
 *   await asm.preview('char_fighter_m', ctx); // render to canvas, no download
 *   await asm.runAll();                       // process every loaded manifest
 */

import { CanvasUtils }    from './canvas_utils.js';
import { Remapper }       from './remapper.js';
import { ManifestLibrary } from './manifest.js';

export class Assembler {
  /**
   * @param {Map<string, File>} fileMap  — uploaded files keyed by user label
   * @param {function(string):void} logger — receives formatted log lines
   */
  constructor(fileMap, logger = console.log) {
    this._files    = fileMap;
    this._log      = logger;
    this._remapper = new Remapper();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Run the full pipeline for one manifest and trigger a PNG download.
   * @param {string} assetId
   * @returns {Promise<ImageBitmap|null>}  the composed sheet, or null on failure
   */
  async run(assetId) {
    const manifest = ManifestLibrary.get(assetId);
    if (!manifest) {
      this._log(`[${assetId}] ✗ Manifest not found.`);
      return null;
    }
    const sheet = await this._process(manifest, true /* download */);
    return sheet;
  }

  /**
   * Render the composed sheet to a 2D canvas context at 4× zoom without downloading.
   * @param {string} assetId
   * @param {CanvasRenderingContext2D} ctx
   */
  async preview(assetId, ctx) {
    const manifest = ManifestLibrary.get(assetId);
    if (!manifest) {
      this._log(`[${assetId}] ✗ Manifest not found.`);
      return;
    }
    const sheet = await this._process(manifest, false /* no download */);
    if (!sheet) return;
    CanvasUtils.renderPreview(ctx, sheet, 4, manifest.frame_width, manifest.frame_height);
  }

  /**
   * Run all loaded manifests in sequence, downloading each.
   * Continues on individual failures.
   */
  async runAll() {
    const all = ManifestLibrary.getAll();
    this._log(`▶ Processing all ${all.length} manifest(s)…`);
    let ok = 0, fail = 0;
    for (const m of all) {
      const sheet = await this._process(m, true);
      if (sheet) ok++; else fail++;
    }
    this._log(`▶ Done. ${ok} succeeded, ${fail} failed.`);
  }

  // ── Internal pipeline ───────────────────────────────────────────────────────

  async _process(manifest, download) {
    const id = manifest.asset_id;
    this._log(`\n[${id}] Starting — ${manifest.asset_label}`);

    // 1. Validate manifest structure
    const { valid, errors } = ManifestLibrary.validate(manifest);
    if (!valid) {
      errors.forEach(e => this._log(`[${id}] ✗ Validation: ${e}`));
      return null;
    }

    // 2. Check for required source files
    const required = ManifestLibrary.getRequiredFileKeys(manifest);
    const missing  = required.filter(k => !this._files.has(k));
    if (missing.length > 0) {
      this._log(`[${id}] ⚠ Missing file key(s): ${missing.join(', ')}`);
      // Continue — missing frames will get magenta placeholders
    }

    // 3. Fetch + process each frame
    const totalFrames = manifest.layout_cols * manifest.layout_rows;
    const frames      = new Array(totalFrames).fill(null);
    this._remapper.clearCache();

    for (let i = 0; i < totalFrames; i++) {
      try {
        const raw = await this._remapper.getFrame(manifest, i, this._files);

        if (raw == null) {
          // No source mapped to this slot — use magenta placeholder
          frames[i] = await CanvasUtils.makePlaceholder(manifest.frame_width, manifest.frame_height);
          this._log(`[${id}] Frame ${i}/${totalFrames - 1}: ⬛ placeholder (no source mapped)`);
          continue;
        }

        // 4. Resize to target frame dimensions (nearest-neighbor)
        const sized = (raw.width === manifest.frame_width && raw.height === manifest.frame_height)
          ? raw
          : await CanvasUtils.resizeNearest(raw, manifest.frame_width, manifest.frame_height);

        // 5. Apply transparency normalisation
        frames[i] = await CanvasUtils.normalizeTransparency(sized, manifest.transparency_mode);
        this._log(`[${id}] Frame ${i}/${totalFrames - 1}: ✓  (${manifest.frame_width}×${manifest.frame_height})`);

      } catch (err) {
        // Error on one frame → log, use placeholder, continue
        frames[i] = await CanvasUtils.makePlaceholder(manifest.frame_width, manifest.frame_height);
        this._log(`[${id}] Frame ${i}/${totalFrames - 1}: ✗  ${err.message}`);
      }
    }

    // 6. Compose all frames into the output sheet
    const sheet = await CanvasUtils.composeSheet(
      frames, manifest.layout_cols, manifest.frame_width, manifest.frame_height,
    );

    // 7. Validate dimensions
    const dimCheck = CanvasUtils.validateDimensions(sheet, manifest.output_width, manifest.output_height);
    if (dimCheck.pass) {
      this._log(`[${id}] Output: ${dimCheck.actual} ✓`);
    } else {
      this._log(`[${id}] Output: ${dimCheck.actual} ✗  (expected ${manifest.output_width}×${manifest.output_height})`);
    }

    // 8. Transparency audit
    const transparentCount = await CanvasUtils.countTransparentPixels(sheet);
    if (manifest.transparency_mode !== 'none' && transparentCount === 0) {
      this._log(`[${id}] ⚠ Transparent pixels: 0 — check transparency_mode or source images`);
    } else {
      this._log(`[${id}] Transparent pixels: ${transparentCount}`);
    }

    // 9. Download if requested
    if (download) {
      CanvasUtils.downloadPNG(sheet, manifest.output_file);
      this._log(`[${id}] Downloaded: ${manifest.output_file}`);
    }

    return sheet;
  }
}
