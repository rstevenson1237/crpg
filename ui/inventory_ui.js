/**
 * inventory_ui.js — Inventory and equipment panel.
 *
 * Press I to toggle.  Renders on LAYER.DIALOGUE.
 * Left pane: 8×6 item grid.  Right pane: equipment slots + stat block.
 * Party member tabs at top when multiple members exist.
 *
 * Context menu: right-click an item slot to see Equip/Use/Read/Drop/Examine.
 * Clicking an equipped slot unequips the item.
 *
 * Exposed as window.InventoryUI for console testing.
 */

import { LAYER }     from '../engine/renderer.js';
import { Inventory } from '../engine/inventory.js';
import { Equipment, SLOTS } from '../engine/equipment.js';
import { Items }     from '../engine/items.js';
import { GameState } from '../engine/gamestate.js';

// ── Layout constants ──────────────────────────────────────────────────────────

const W = 640, H = 480;
const TAB_H    = 26;          // member tab strip height
const DIVIDER  = 322;         // x split between left/right pane
const GRID_X   = 10;          // left pane grid origin x
const GRID_Y   = TAB_H + 28;  // left pane grid origin y
const SLOT_SIZE = 36;          // item slot (square)
const SLOT_GAP  = 2;
const SLOT_STEP = SLOT_SIZE + SLOT_GAP;
const COLS      = 8;
const ROWS      = 6;

// Equipment slot layout (rx = relative to pane start 322, ry = absolute)
const EQUIP_LAYOUT = [
  { id: 'helm',        label: 'HELM',  rx: 120, ry: TAB_H + 82  },
  { id: 'weapon',      label: 'WPN',   rx: 20,  ry: TAB_H + 140 },
  { id: 'armor',       label: 'ARMOR', rx: 120, ry: TAB_H + 140 },
  { id: 'off_hand',    label: 'OFF',   rx: 220, ry: TAB_H + 140 },
  { id: 'accessory_1', label: 'ACC 1', rx: 20,  ry: TAB_H + 198 },
  { id: 'accessory_2', label: 'ACC 2', rx: 220, ry: TAB_H + 198 },
];
const EQUIP_W = 42, EQUIP_H = 42;

// Item type colors (no icons in Phase 8 — colored squares)
const TYPE_COLORS = {
  weapon:     '#cc5544',
  armor:      '#4466cc',
  helm:       '#7744cc',
  accessory:  '#44ccaa',
  consumable: '#44bb44',
  key_item:   '#ffcc00',
  material:   '#aa8866',
  document:   '#cccc88',
  currency:   '#ffaa22',
  unknown:    '#556677',
};

// ── Module state ──────────────────────────────────────────────────────────────

let _renderer  = null;
let _input     = null;
let _open      = false;
let _memberIdx = 0;    // which party member's equipment is shown

let _hoveredSlot  = -1;   // grid slot index under cursor
let _selectedSlot = -1;   // grid slot index last clicked (left)
let _ctxMenu      = null; // { slotIdx, x, y, options:[{label,fn}] } | null
let _hoveredEquip = null; // equip slot id under cursor
let _statusMsg    = null; // { text, expiresMs } — brief status line
let _mouseX = 0, _mouseY = 0;

// ── Public API ────────────────────────────────────────────────────────────────

export const InventoryUI = {

  /**
   * @param {import('../engine/renderer.js').Renderer} renderer
   * @param {import('../engine/input.js').Input} input
   */
  init(renderer, input) {
    _renderer = renderer;
    _input    = input;

    const canvas = input._canvas;

    canvas.addEventListener('mousemove', e => {
      const { lx, ly } = _logical(e, canvas, input);
      _mouseX = lx; _mouseY = ly;
    });

    canvas.addEventListener('click', e => {
      if (!_open) return;
      const { lx, ly } = _logical(e, canvas, input);
      _handleClick(lx, ly);
    });

    canvas.addEventListener('contextmenu', e => {
      if (!_open) return;
      e.preventDefault();
      const { lx, ly } = _logical(e, canvas, input);
      _handleRightClick(lx, ly);
    });

    canvas.addEventListener('wheel', e => {
      if (!_open) return;
      e.preventDefault();
    }, { passive: false });
  },

  isOpen() { return _open; },
  open()   { _open = true;  _ctxMenu = null; _selectedSlot = -1; },
  close()  { _open = false; _ctxMenu = null; },
  toggle() { _open ? this.close() : this.open(); },

  /** Handle key presses while inventory is open. */
  handleKey(code) {
    if (code === 'Escape') {
      if (_ctxMenu) { _ctxMenu = null; return; }
      this.close();
    }
  },

  /** Show a brief status message at the bottom of the panel. */
  showMessage(text) {
    _statusMsg = { text, expiresMs: performance.now() + 2500 };
  },

  /** Called each render frame when the inventory is open. */
  render() {
    if (!_open || !_renderer) return;
    const ctx = _renderer.getLayerContext(LAYER.DIALOGUE);
    ctx.save();

    _drawBackground(ctx);
    _drawMemberTabs(ctx);
    _drawInventoryPane(ctx);
    _drawEquipmentPane(ctx);
    _drawDivider(ctx);
    _drawStatusBar(ctx);

    if (_ctxMenu) _drawContextMenu(ctx);

    ctx.restore();
  },
};

// ── Internal rendering ────────────────────────────────────────────────────────

function _drawBackground(ctx) {
  ctx.fillStyle = 'rgba(6,10,18,0.97)';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#3a4a5a';
  ctx.lineWidth = 1;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Header bar
  ctx.fillStyle = 'rgba(20,30,45,1)';
  ctx.fillRect(0, 0, W, TAB_H);
  ctx.strokeStyle = '#2a3a4a';
  ctx.beginPath();
  ctx.moveTo(0, TAB_H); ctx.lineTo(W, TAB_H);
  ctx.stroke();

  // Title top-right
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#445566';
  ctx.fillText('I — INVENTORY', W - 10, TAB_H / 2);
}

function _drawMemberTabs(ctx) {
  const party = GameState.party;
  if (!party) return;

  const members = party.active ?? [];
  const TAB_W   = 80;

  members.forEach((member, i) => {
    const tx = 8 + i * (TAB_W + 4);
    const active = i === _memberIdx;

    ctx.fillStyle = active ? 'rgba(50,80,110,1)' : 'rgba(20,30,45,1)';
    ctx.fillRect(tx, 3, TAB_W, TAB_H - 6);

    ctx.strokeStyle = active ? '#4488bb' : '#2a3a4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx, 3, TAB_W, TAB_H - 6);

    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = active ? '#88ccff' : '#556677';
    ctx.fillText(member.name, tx + TAB_W / 2, TAB_H / 2);

    // Store tab hit-rect for click detection
    member._tabRect = { x: tx, y: 3, w: TAB_W, h: TAB_H - 6 };
  });
}

function _drawInventoryPane(ctx) {
  // Pane title
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#4488bb';
  ctx.fillText('INVENTORY', GRID_X, TAB_H + 8);

  const items = Inventory.getAll();
  const slots = _buildGridSlots(items);

  for (let i = 0; i < COLS * ROWS; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const sx  = GRID_X + col * SLOT_STEP;
    const sy  = GRID_Y + row * SLOT_STEP;
    const entry = slots[i] ?? null;

    // Slot background
    const isHovered  = i === _hoveredSlot;
    const isSelected = i === _selectedSlot;
    ctx.fillStyle = isSelected ? 'rgba(50,90,130,0.8)' : isHovered ? 'rgba(30,50,70,0.8)' : 'rgba(14,20,30,0.9)';
    ctx.fillRect(sx, sy, SLOT_SIZE, SLOT_SIZE);

    // Slot border
    const isKeyItem = entry?.item_def?.key_item;
    ctx.strokeStyle = isKeyItem ? '#ffcc00' : isSelected ? '#4499cc' : '#2a3a4a';
    ctx.lineWidth   = isKeyItem ? 1.5 : 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, SLOT_SIZE - 1, SLOT_SIZE - 1);

    if (entry) {
      // Item color square (placeholder for Phase 18 icon)
      const color = TYPE_COLORS[entry.item_def.item_type] ?? TYPE_COLORS.unknown;
      ctx.fillStyle = color;
      ctx.fillRect(sx + 4, sy + 4, SLOT_SIZE - 8, SLOT_SIZE - 8);

      // First letter of item type as a quick visual cue
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText((entry.item_def.item_label ?? '?')[0], sx + SLOT_SIZE / 2, sy + SLOT_SIZE / 2);

      // Quantity badge (if > 1)
      if (entry.quantity > 1) {
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(sx + SLOT_SIZE - 14, sy + SLOT_SIZE - 11, 13, 10);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(entry.quantity, sx + SLOT_SIZE - 2, sy + SLOT_SIZE - 2);
      }
    }
  }

  // Detail panel below grid
  const detailY = GRID_Y + ROWS * SLOT_STEP + 8;
  _drawItemDetail(ctx, slots[_selectedSlot] ?? null, detailY);
}

function _drawItemDetail(ctx, entry, y) {
  const x = GRID_X;
  const w = DIVIDER - GRID_X - 10;

  // Separator
  ctx.strokeStyle = '#2a3a4a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 4); ctx.lineTo(x + w, y - 4);
  ctx.stroke();

  if (!entry) {
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#334455';
    ctx.fillText('No item selected. Click a slot to inspect.', x, y + 2);
    return;
  }

  const def = entry.item_def;

  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#eeddaa';
  ctx.fillText(def.item_label ?? def.item_id, x, y);

  ctx.font = '9px monospace';
  ctx.fillStyle = '#7799aa';
  const typeLabel = (def.item_type ?? 'item').toUpperCase();
  const classTag  = def.class_restriction?.length ? `  [${def.class_restriction.join('/')}]` : '';
  ctx.fillText(`${typeLabel}${classTag}   ×${entry.quantity}`, x, y + 14);

  // Description (word-wrapped)
  ctx.fillStyle = '#aabbcc';
  const desc  = def.description ?? '';
  const lines = _wrapText(ctx, desc, w, '9px monospace');
  lines.forEach((line, i) => ctx.fillText(line, x, y + 28 + i * 13));

  // Stat modifiers
  if (def.stat_modifiers && Object.keys(def.stat_modifiers).length) {
    const mods = Object.entries(def.stat_modifiers).map(([s, v]) => `${s}:${v > 0 ? '+' : ''}${v}`).join('  ');
    ctx.font = '9px monospace';
    ctx.fillStyle = '#66cc88';
    ctx.fillText(mods, x, y + 28 + lines.length * 13 + 4);
  }

  // Hint
  ctx.font = '8px monospace';
  ctx.fillStyle = '#334455';
  ctx.fillText('Right-click for actions', x, y + 28 + lines.length * 13 + 20);
}

function _drawEquipmentPane(ctx) {
  const party = GameState.party;
  if (!party) return;

  const member = (party.active ?? [])[_memberIdx];
  if (!member) return;

  const charId = member.id;
  const px = DIVIDER + 8;

  // Character name + class
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ccddee';
  ctx.fillText(member.name, px, TAB_H + 8);

  ctx.font = '9px monospace';
  ctx.fillStyle = '#556677';
  const classLabel = (member.def.class_id ?? 'unknown').toUpperCase();
  ctx.fillText(classLabel, px, TAB_H + 22);

  // Equipment slots
  for (const slot of EQUIP_LAYOUT) {
    const ax = DIVIDER + slot.rx;
    const ay = slot.ry;
    const itemDef = Equipment.getItemInSlot(charId, slot.id);
    const isHov   = _hoveredEquip === slot.id;

    // Slot box
    ctx.fillStyle = itemDef ? 'rgba(30,50,40,0.85)' : 'rgba(14,20,30,0.85)';
    ctx.fillRect(ax, ay, EQUIP_W, EQUIP_H);

    ctx.strokeStyle = isHov ? '#4499cc' : itemDef ? '#335544' : '#2a3a4a';
    ctx.lineWidth = 1;
    ctx.strokeRect(ax + 0.5, ay + 0.5, EQUIP_W - 1, EQUIP_H - 1);

    // Item color square if equipped
    if (itemDef) {
      const color = TYPE_COLORS[itemDef.item_type] ?? TYPE_COLORS.unknown;
      ctx.fillStyle = color;
      ctx.fillRect(ax + 4, ay + 4, EQUIP_W - 8, EQUIP_H - 8);

      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText((itemDef.item_label ?? '?')[0], ax + EQUIP_W / 2, ay + EQUIP_H / 2);
    }

    // Slot label below box
    ctx.font = '7px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = itemDef ? '#4488aa' : '#334455';
    ctx.fillText(slot.label, ax + EQUIP_W / 2, ay + EQUIP_H + 2);

    // Tooltip: item name on hover
    if (isHov && itemDef) {
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const name = itemDef.item_label ?? itemDef.item_id;
      const tw   = ctx.measureText(name).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.9)';
      ctx.fillRect(ax, ay - 14, tw, 12);
      ctx.fillStyle = '#ccddee';
      ctx.fillText(name, ax + 4, ay - 13);
    }

    // Store hit rect for click
    slot._rect = { x: ax, y: ay, w: EQUIP_W, h: EQUIP_H };
  }

  // Stats block
  const statsY = TAB_H + 255;
  _drawStats(ctx, charId, DIVIDER + 8, statsY);
}

function _drawStats(ctx, charId, x, y) {
  const party  = GameState.party;
  const member = party?.members?.find(m => m.id === charId);
  if (!member) return;

  // Separator
  ctx.strokeStyle = '#2a3a4a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - 4); ctx.lineTo(W - 8, y - 4);
  ctx.stroke();

  ctx.font = 'bold 9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#4488bb';
  ctx.fillText('STATS', x, y);

  const base     = member.def.base_stats ?? {};
  const bonuses  = member.def.stat_bonuses ?? {};
  const effective = Equipment.getEffectiveStats(charId);

  const statRows = [
    { key: 'hp',      label: 'HP' },
    { key: 'attack',  label: 'ATK' },
    { key: 'defense', label: 'DEF' },
    { key: 'speed',   label: 'SPD' },
    { key: 'magic',   label: 'MAG' },
  ];

  ctx.font = '9px monospace';
  statRows.forEach(({ key, label }, i) => {
    const ry     = y + 14 + i * 16;
    const bv     = base[key] ?? 0;
    const ev     = effective[key] ?? bv;
    const bonus  = ev - bv;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#556677';
    ctx.fillText(label, x, ry);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#aabbcc';
    ctx.fillText(bv, x + 60, ry);

    if (bonus !== 0) {
      ctx.fillStyle = bonus > 0 ? '#66cc88' : '#cc6644';
      ctx.fillText((bonus > 0 ? '+' : '') + bonus, x + 90, ry);
    }
  });

  // Equipped abilities hint
  const abilities = Equipment.getGrantedAbilities(charId);
  if (abilities.length) {
    const abY = y + 14 + statRows.length * 16 + 6;
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#336655';
    ctx.fillText('Abilities: ' + abilities.join(', '), x, abY);
  }
}

function _drawDivider(ctx) {
  ctx.strokeStyle = '#2a3a4a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(DIVIDER, TAB_H); ctx.lineTo(DIVIDER, H);
  ctx.stroke();
}

function _drawStatusBar(ctx) {
  if (!_statusMsg || performance.now() > _statusMsg.expiresMs) {
    _statusMsg = null;
    return;
  }
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.fillRect(0, H - 16, W, 16);
  ctx.fillStyle = '#ffcc88';
  ctx.fillText(_statusMsg.text, W / 2, H - 2);
}

function _drawContextMenu(ctx) {
  if (!_ctxMenu) return;
  const { x, y, options } = _ctxMenu;

  const ITEM_H  = 18;
  const MENU_W  = 110;
  const MENU_H  = options.length * ITEM_H + 6;
  const mx = Math.min(x, W - MENU_W - 4);
  const my = Math.min(y, H - MENU_H - 4);

  ctx.fillStyle = 'rgba(10,16,24,0.97)';
  ctx.fillRect(mx, my, MENU_W, MENU_H);
  ctx.strokeStyle = '#3a5a7a';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + 0.5, my + 0.5, MENU_W - 1, MENU_H - 1);

  options.forEach((opt, i) => {
    const oy = my + 3 + i * ITEM_H;
    const { lx, ly } = { lx: _mouseX, ly: _mouseY };
    const hov = lx >= mx && lx < mx + MENU_W && ly >= oy && ly < oy + ITEM_H;

    if (hov) {
      ctx.fillStyle = 'rgba(30,60,90,0.85)';
      ctx.fillRect(mx + 1, oy, MENU_W - 2, ITEM_H);
    }

    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = opt.disabled ? '#334455' : hov ? '#aaddff' : '#8899aa';
    ctx.fillText(opt.label, mx + 8, oy + ITEM_H / 2);

    // Store hit rect on option
    opt._rect = { x: mx, y: oy, w: MENU_W, h: ITEM_H };
  });

  _ctxMenu._rect = { x: mx, y: my, w: MENU_W, h: MENU_H };
}

// ── Hit testing and interaction ───────────────────────────────────────────────

function _handleClick(lx, ly) {
  // Context menu takes priority
  if (_ctxMenu) {
    let hit = false;
    for (const opt of _ctxMenu.options) {
      if (opt._rect && _inRect(lx, ly, opt._rect) && !opt.disabled) {
        opt.fn();
        hit = true;
        break;
      }
    }
    // Click outside menu closes it
    if (!hit && _ctxMenu._rect && !_inRect(lx, ly, _ctxMenu._rect)) {
      _ctxMenu = null;
    } else if (!hit) {
      _ctxMenu = null;
    }
    return;
  }

  // Member tab clicks
  const party = GameState.party;
  const members = party?.members ?? [];
  for (let i = 0; i < members.length; i++) {
    const r = members[i]._tabRect;
    if (r && _inRect(lx, ly, r)) {
      _memberIdx = i;
      _selectedSlot = -1;
      return;
    }
  }

  // Equipment slot clicks (unequip)
  for (const slot of EQUIP_LAYOUT) {
    if (slot._rect && _inRect(lx, ly, slot._rect)) {
      const member = members[_memberIdx];
      if (member) {
        const charId = member.id;
        const hadItem = Equipment.getItemInSlot(charId, slot.id);
        if (hadItem) {
          Equipment.unequip(charId, slot.id);
          InventoryUI.showMessage(`Unequipped ${hadItem.item_label}`);
        }
      }
      return;
    }
  }

  // Inventory grid click (select slot)
  const gridSlot = _gridSlotAt(lx, ly);
  if (gridSlot >= 0) {
    _selectedSlot = (_selectedSlot === gridSlot) ? -1 : gridSlot;
    return;
  }

  _selectedSlot = -1;
}

function _handleRightClick(lx, ly) {
  // Close any open context menu first
  _ctxMenu = null;

  const gridSlot = _gridSlotAt(lx, ly);
  if (gridSlot < 0) return;

  const items = Inventory.getAll();
  const slots = _buildGridSlots(items);
  const entry = slots[gridSlot];
  if (!entry) return;

  const def    = entry.item_def;
  const party  = GameState.party;
  const member = (party?.members ?? [])[_memberIdx];
  const charId = member?.id;

  const options = [];

  // Equip — only for equippable items
  if (def.equip_slot && SLOTS.includes(def.equip_slot)) {
    options.push({
      label: 'Equip',
      fn() {
        if (!charId) return;
        const ok = Equipment.equip(charId, def.item_id, def.equip_slot);
        if (ok) InventoryUI.showMessage(`Equipped ${def.item_label}`);
        else    InventoryUI.showMessage(`Cannot equip ${def.item_label}`);
        _ctxMenu = null;
      },
    });
  }

  // Use — consumables and items with on_use_action
  if (def.item_type === 'consumable' || def.on_use_action) {
    options.push({
      label: 'Use',
      fn() {
        Inventory.use(def.item_id, charId);
        InventoryUI.showMessage(`Used ${def.item_label}`);
        _ctxMenu = null;
      },
    });
  }

  // Read — documents
  if (def.item_type === 'document') {
    options.push({
      label: 'Read',
      fn() {
        Inventory.read(def.item_id);
        InventoryUI.showMessage(`Read ${def.item_label}`);
        _ctxMenu = null;
      },
    });
  }

  // Drop — not for key items
  options.push({
    label: 'Drop',
    disabled: !!def.key_item,
    fn() {
      if (def.key_item) {
        InventoryUI.showMessage('Key items cannot be dropped.');
      } else {
        Inventory.drop(def.item_id);
        if (_selectedSlot >= Inventory.size) _selectedSlot = -1;
        InventoryUI.showMessage(`Dropped ${def.item_label}`);
      }
      _ctxMenu = null;
    },
  });

  // Examine — always available
  options.push({
    label: 'Examine',
    fn() {
      _selectedSlot = gridSlot;
      _ctxMenu = null;
    },
  });

  _selectedSlot = gridSlot;
  _ctxMenu = { slotIdx: gridSlot, x: lx, y: ly, options };
}

// ── Hover tracking (called from render loop indirectly via mousemove) ─────────

function _updateHover() {
  _hoveredSlot  = _gridSlotAt(_mouseX, _mouseY);
  _hoveredEquip = null;
  for (const slot of EQUIP_LAYOUT) {
    if (slot._rect && _inRect(_mouseX, _mouseY, slot._rect)) {
      _hoveredEquip = slot.id;
      break;
    }
  }
}

// Override render to also update hover
const _originalRender = InventoryUI.render.bind(InventoryUI);
InventoryUI.render = function() {
  _updateHover();
  _originalRender();
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function _buildGridSlots(items) {
  // items = [{ item_def, quantity }]; spread items into linear slot array
  const slots = new Array(COLS * ROWS).fill(null);
  items.forEach((entry, i) => { if (i < slots.length) slots[i] = entry; });
  return slots;
}

function _gridSlotAt(lx, ly) {
  if (lx < GRID_X || lx >= GRID_X + COLS * SLOT_STEP) return -1;
  if (ly < GRID_Y || ly >= GRID_Y + ROWS * SLOT_STEP) return -1;
  const col = Math.floor((lx - GRID_X) / SLOT_STEP);
  const row = Math.floor((ly - GRID_Y) / SLOT_STEP);
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
  return row * COLS + col;
}

function _inRect(x, y, r) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

function _logical(e, canvas, input) {
  const rect  = canvas.getBoundingClientRect();
  const scale = input._getScale();
  return {
    lx: (e.clientX - rect.left) / (rect.width  / canvas.width)  / scale,
    ly: (e.clientY - rect.top)  / (rect.height / canvas.height) / scale,
  };
}

function _wrapText(ctx, text, maxW, font) {
  ctx.font = font;
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

if (typeof window !== 'undefined') window.InventoryUI = InventoryUI;
