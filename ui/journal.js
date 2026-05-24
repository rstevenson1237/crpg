/**
 * journal.js — In-game journal panel.
 *
 * Renders on LAYER.DIALOGUE. Toggle with J. Tabs: Secrets | Factions |
 * World Log | Party. Switch tabs with 1–4 keys or click. Scroll with
 * arrow keys or mouse wheel.
 *
 * Exposed as window.Journal for console testing.
 */

import { LAYER }     from '../engine/renderer.js';
import { GameState } from '../engine/gamestate.js';
import { Secrets }   from '../engine/secrets.js';
import { Factions }  from '../engine/factions.js';

// ── Layout constants ──────────────────────────────────────────────────────────
const PANEL     = { x: 20, y: 20, w: 600, h: 440 };
const TAB_Y     = PANEL.y + 28;
const TAB_H     = 22;
const TABS      = ['Secrets', 'Factions', 'World Log', 'Party'];
const CONTENT_Y = TAB_Y + TAB_H + 8;
const CONTENT_H = (PANEL.y + PANEL.h) - CONTENT_Y - 8;
const LINE_H    = 16;

// ── Module-level state ────────────────────────────────────────────────────────
let _renderer = null;
let _input    = null;
let _open     = false;
let _tab      = 0;
let _scroll   = 0;
let _mouseX   = 0, _mouseY = 0;

// ── Public API ────────────────────────────────────────────────────────────────

export const Journal = {

  /**
   * One-time initialisation.
   * @param {import('../engine/renderer.js').Renderer} renderer
   * @param {import('../engine/input.js').Input} input
   */
  init(renderer, input) {
    _renderer = renderer;
    _input    = input;

    input._canvas.addEventListener('mousemove', e => {
      const rect  = input._canvas.getBoundingClientRect();
      const scale = input._getScale();
      _mouseX = (e.clientX - rect.left) / (rect.width  / input._canvas.width)  / scale;
      _mouseY = (e.clientY - rect.top)  / (rect.height / input._canvas.height) / scale;
    });

    input._canvas.addEventListener('click', e => {
      if (!_open) return;
      const rect  = input._canvas.getBoundingClientRect();
      const scale = input._getScale();
      const lx = (e.clientX - rect.left) / (rect.width  / input._canvas.width)  / scale;
      const ly = (e.clientY - rect.top)  / (rect.height / input._canvas.height) / scale;
      _handleClick(lx, ly);
    });

    input._canvas.addEventListener('wheel', e => {
      if (!_open) return;
      e.preventDefault();
      _scroll = Math.max(0, _scroll + (e.deltaY > 0 ? 1 : -1));
    }, { passive: false });
  },

  isOpen() { return _open; },

  open() {
    _open   = true;
    _scroll = 0;
  },

  close() { _open = false; },

  toggle() { _open ? this.close() : this.open(); },

  /**
   * Handle key input while journal is open.
   * @param {string} code  KeyboardEvent.code
   */
  handleKey(code) {
    if (!_open) return;
    if (code === 'Escape' || code === 'KeyJ') { this.close(); return; }
    const m = code.match(/^Digit([1-4])$/);
    if (m) { _tab = parseInt(m[1]) - 1; _scroll = 0; return; }
    if (code === 'ArrowDown') _scroll++;
    if (code === 'ArrowUp')   _scroll = Math.max(0, _scroll - 1);
  },

  /** Render the journal panel onto LAYER.DIALOGUE. */
  render() {
    if (!_open || !_renderer) return;
    const ctx = _renderer.getLayerContext(LAYER.DIALOGUE);

    // ── Backdrop ──
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 0, 640, 480);

    // ── Panel body ──
    ctx.fillStyle   = 'rgba(8,12,20,0.98)';
    ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    ctx.strokeStyle = '#334455';
    ctx.lineWidth   = 1;
    ctx.strokeRect(PANEL.x, PANEL.y, PANEL.w, PANEL.h);

    // Top accent bar
    ctx.strokeStyle = '#3388aa';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(PANEL.x + 8, PANEL.y + 1);
    ctx.lineTo(PANEL.x + PANEL.w - 8, PANEL.y + 1);
    ctx.stroke();
    ctx.lineWidth = 1;

    // ── Title ──
    ctx.font         = 'bold 11px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#aaddff';
    ctx.fillText('JOURNAL', PANEL.x + 10, PANEL.y + 8);

    // ── Close hint ──
    ctx.font      = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#446688';
    ctx.fillText('[J / Esc] close', PANEL.x + PANEL.w - 8, PANEL.y + 10);

    // ── Tabs ──
    const tabW = Math.floor(PANEL.w / TABS.length);
    for (let i = 0; i < TABS.length; i++) {
      const tx      = PANEL.x + i * tabW;
      const active  = i === _tab;
      const hovered = _mouseX >= tx && _mouseX < tx + tabW &&
                      _mouseY >= TAB_Y && _mouseY < TAB_Y + TAB_H;

      ctx.fillStyle = active
        ? 'rgba(51,136,170,0.35)'
        : hovered ? 'rgba(51,136,170,0.15)' : 'rgba(20,30,44,0.8)';
      ctx.fillRect(tx + 1, TAB_Y, tabW - 2, TAB_H);

      ctx.strokeStyle = active ? '#3388aa' : '#334455';
      ctx.lineWidth   = 1;
      ctx.strokeRect(tx + 1, TAB_Y, tabW - 2, TAB_H);

      ctx.font         = active ? 'bold 10px monospace' : '10px monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = active ? '#aaddff' : '#778899';
      ctx.fillText(`${i + 1}. ${TABS[i]}`, tx + tabW / 2, TAB_Y + TAB_H / 2);
    }

    // ── Content area (clipped) ──
    ctx.save();
    ctx.beginPath();
    ctx.rect(PANEL.x + 4, CONTENT_Y, PANEL.w - 8, CONTENT_H);
    ctx.clip();

    switch (_tab) {
      case 0: _renderSecrets(ctx); break;
      case 1: _renderFactions(ctx); break;
      case 2: _renderWorldLog(ctx); break;
      case 3: _renderParty(ctx); break;
    }

    ctx.restore();

    // ── Footer scroll hint ──
    ctx.font         = '9px monospace';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle    = '#334455';
    ctx.fillText('[↑↓] scroll · [1–4] tabs', PANEL.x + PANEL.w - 8, PANEL.y + PANEL.h - 4);
  },
};

if (typeof window !== 'undefined') window.Journal = Journal;

// ── Click handling ────────────────────────────────────────────────────────────

function _handleClick(lx, ly) {
  const tabW = Math.floor(PANEL.w / TABS.length);
  for (let i = 0; i < TABS.length; i++) {
    const tx = PANEL.x + i * tabW;
    if (lx >= tx && lx < tx + tabW && ly >= TAB_Y && ly < TAB_Y + TAB_H) {
      _tab    = i;
      _scroll = 0;
      return;
    }
  }
}

// ── Tab renderers ─────────────────────────────────────────────────────────────

function _renderSecrets(ctx) {
  const secrets = Secrets.getKnown();
  if (!secrets.length) {
    _emptyLine(ctx, 'No secrets discovered yet.');
    return;
  }

  let y = CONTENT_Y - _scroll * LINE_H;
  for (const s of secrets) {
    const visible = y + LINE_H > CONTENT_Y && y < CONTENT_Y + CONTENT_H;

    if (visible) {
      ctx.font         = 'bold 10px monospace';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = '#aadd88';
      ctx.fillText(`▸ ${s.label}`, PANEL.x + 12, y);
    }
    y += LINE_H;

    if (s.summary) {
      for (const line of _wrap(ctx, s.summary, PANEL.w - 30, '9px monospace')) {
        if (y + 13 > CONTENT_Y && y < CONTENT_Y + CONTENT_H) {
          ctx.font      = '9px monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = '#99aabb';
          ctx.fillText(line, PANEL.x + 20, y);
        }
        y += 13;
      }
      y += 6;
    }
  }
}

function _renderFactions(ctx) {
  const factions = Factions.getAll();
  if (!factions.length) {
    _emptyLine(ctx, 'No faction data available.');
    return;
  }

  let y = CONTENT_Y - _scroll * LINE_H;
  for (const f of factions) {
    const rowH = LINE_H + 6 + 10;  // name row + bar + gap
    if (y + rowH < CONTENT_Y || y > CONTENT_Y + CONTENT_H) { y += rowH; continue; }

    // Name + label
    ctx.font         = 'bold 10px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#ccddee';
    ctx.fillText(f.display_name ?? f.faction_id, PANEL.x + 12, y);
    ctx.font      = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = f.color;
    ctx.fillText(`${f.label} (${f.standing})`, PANEL.x + PANEL.w - 16, y);
    y += LINE_H;

    // Standing bar
    const barX = PANEL.x + 20;
    const barW = PANEL.w - 48;
    const barH = 6;
    ctx.fillStyle = '#1a2233';
    ctx.fillRect(barX, y, barW, barH);
    ctx.fillStyle = f.color;
    ctx.fillRect(barX, y, Math.floor(barW * f.standing / 100), barH);
    y += barH + 10;
  }
}

function _renderWorldLog(ctx) {
  const log = [...GameState.worldLog].reverse();
  if (!log.length) {
    _emptyLine(ctx, 'The world log is empty.');
    return;
  }

  let y = CONTENT_Y - _scroll * LINE_H;
  for (const entry of log) {
    const wrapped = _wrap(ctx, entry.text, PANEL.w - 60, '9px monospace');
    const entryH  = wrapped.length * 13;

    if (y + entryH > CONTENT_Y && y < CONTENT_Y + CONTENT_H) {
      ctx.font         = '9px monospace';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle    = '#446688';
      ctx.fillText(`T${entry.turn}`, PANEL.x + 12, y);
      ctx.fillStyle = '#aabbcc';
      for (let i = 0; i < wrapped.length; i++) {
        ctx.fillText(wrapped[i], PANEL.x + 52, y + i * 13);
      }
    }
    y += Math.max(LINE_H, entryH);
  }
}

function _renderParty(ctx) {
  const party = GameState.party;
  if (!party) { _emptyLine(ctx, 'No party data.'); return; }

  let y = CONTENT_Y - _scroll * LINE_H;
  for (const char of party.active) {
    const def    = char.def;
    const stats  = def.base_stats ?? {};
    const skills = def.skills ?? [];
    const blockH = LINE_H * (2 + (skills.length ? 1 : 0)) + 10;

    if (y + blockH < CONTENT_Y || y > CONTENT_Y + CONTENT_H) { y += blockH; continue; }

    ctx.font         = 'bold 11px monospace';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = '#eeddcc';
    ctx.fillText(def.name, PANEL.x + 12, y);
    ctx.font      = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#778899';
    ctx.fillText(def.class_id?.replace(/_/g, ' ') ?? '', PANEL.x + PANEL.w - 16, y);
    y += LINE_H;

    const statLine = Object.entries(stats)
      .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
      .join('  ');
    ctx.font      = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#99aabb';
    ctx.fillText(statLine, PANEL.x + 20, y);
    y += LINE_H;

    if (skills.length) {
      ctx.fillStyle = '#88aacc';
      ctx.fillText('Skills: ' + skills.join(', '), PANEL.x + 20, y);
      y += LINE_H;
    }
    y += 10;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _emptyLine(ctx, text) {
  ctx.font         = '10px monospace';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle    = '#556677';
  ctx.fillText(text, PANEL.x + PANEL.w / 2, CONTENT_Y + CONTENT_H / 2);
}

function _wrap(ctx, text, maxW, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
