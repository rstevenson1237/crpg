/**
 * manifest.js — Manifest registry, loader, and validator.
 *
 * All engine asset manifests are embedded here as the default library.
 * Additional manifests can be loaded from the JSON files in /tools/manifests/
 * or pasted directly into the UI.
 */

// ── Helpers to generate repetitive manifests ──────────────────────────────────

const DIRS  = ['s', 'n', 'e', 'w'];
const ANIMS = ['idle', 'l', 'r'];

function charManifest(id, label, fw = 32, fh = 32) {
  const files = [];
  let idx = 0;
  for (const d of DIRS) for (const a of ANIMS) files.push({ frame_index: idx++, file_key: `${id}_${d}_${a}` });
  return {
    asset_id: id, asset_label: label,
    output_file: `${id}.png`,
    output_width: fw * 3, output_height: fh * 4,
    frame_width: fw, frame_height: fh,
    layout_cols: 3, layout_rows: 4,
    transparency_mode: 'magic_pink',
    source: { mode: 'individual', files },
  };
}

function effectManifest(id, label, frameCount, fw, fh) {
  return {
    asset_id: id, asset_label: label,
    output_file: `${id}.png`,
    output_width: fw * frameCount, output_height: fh,
    frame_width: fw, frame_height: fh,
    layout_cols: frameCount, layout_rows: 1,
    transparency_mode: 'magic_pink',
    source: {
      mode: 'individual',
      files: Array.from({ length: frameCount }, (_, i) => ({ frame_index: i, file_key: `${id}_${i}` })),
    },
  };
}

function uiManifest(id, label, w, h) {
  return {
    asset_id: id, asset_label: label,
    output_file: `${id}.png`,
    output_width: w, output_height: h,
    frame_width: w, frame_height: h,
    layout_cols: 1, layout_rows: 1,
    transparency_mode: 'none',
    source: { mode: 'individual', files: [{ frame_index: 0, file_key: id }] },
  };
}

// ── Terrain tileset ───────────────────────────────────────────────────────────

const TERRAIN_FRAME_KEYS = [
  'grass_base_0','grass_base_1','grass_base_2','grass_base_3',
  'grass_dark_0','grass_dark_1','grass_dark_2','grass_dark_3',
  'dirt_path_0','dirt_path_1','dirt_path_2','dirt_path_3',
  'cobblestone_0','cobblestone_1','cobblestone_2','cobblestone_3',
  'stone_floor_0','stone_floor_1','stone_floor_2','stone_floor_3',
  'wood_floor_0','wood_floor_1','wood_floor_2','wood_floor_3',
  'sand_0','sand_1','sand_2','sand_3',
  'snow_0','snow_1','snow_2','snow_3',
  'water_shallow_0','water_shallow_1','water_shallow_2','water_shallow_3',
  'water_deep_0','water_deep_1','water_deep_2','water_deep_3',
  'lava_0','lava_1','lava_2','lava_3',
  'swamp_0','swamp_1','swamp_2','swamp_3',
  'cave_floor_0','cave_floor_1','cave_floor_2','cave_floor_3',
  'ice_0','ice_1','ice_2','ice_3',
  'cliff_face_0','cliff_face_1','cliff_face_2','cliff_face_3',
  'mountain_peak_0','mountain_peak_1','mountain_peak_2','mountain_peak_3',
];

const TERRAIN_MANIFEST = {
  asset_id: 'tileset_terrain', asset_label: 'Terrain Tileset (Mode A)',
  output_file: 'tileset_terrain.png',
  output_width: 512, output_height: 128,
  frame_width: 32, frame_height: 32,
  layout_cols: 16, layout_rows: 4,
  transparency_mode: 'none',
  source: {
    mode: 'individual',
    files: TERRAIN_FRAME_KEYS.map((k, i) => ({ frame_index: i, file_key: k })),
  },
};

// ── Player character sprites ──────────────────────────────────────────────────

const PLAYER_CHAR_MANIFESTS = [
  charManifest('char_fighter_m', 'Fighter (Male)'),
  charManifest('char_fighter_f', 'Fighter (Female)'),
  charManifest('char_mage_m',    'Mage (Male)'),
  charManifest('char_mage_f',    'Mage (Female)'),
  charManifest('char_thief_m',   'Thief (Male)'),
  charManifest('char_thief_f',   'Thief (Female)'),
  charManifest('char_cleric_m',  'Cleric (Male)'),
  charManifest('char_cleric_f',  'Cleric (Female)'),
];

// ── NPC sprites ───────────────────────────────────────────────────────────────

const NPC_MANIFESTS = [
  charManifest('npc_farmer_m',        'NPC: Farmer (Male)'),
  charManifest('npc_farmer_f',        'NPC: Farmer (Female)'),
  charManifest('npc_merchant',        'NPC: Merchant'),
  charManifest('npc_noble',           'NPC: Noble'),
  charManifest('npc_child',           'NPC: Child'),
  charManifest('npc_guard_light',     'NPC: Guard (Light)'),
  charManifest('npc_guard_heavy',     'NPC: Guard (Heavy)'),
  charManifest('npc_soldier_enemy',   'NPC: Enemy Soldier'),
  charManifest('npc_innkeeper',       'NPC: Innkeeper'),
  charManifest('npc_priest',          'NPC: Priest'),
  charManifest('npc_old_man',         'NPC: Old Man'),
  charManifest('npc_old_woman',       'NPC: Old Woman'),
  charManifest('npc_scholar',         'NPC: Scholar'),
  charManifest('npc_blacksmith',      'NPC: Blacksmith'),
];

// ── Enemy sprites ─────────────────────────────────────────────────────────────

const ENEMY_STANDARD_MANIFESTS = [
  charManifest('enemy_skeleton_warrior',  'Enemy: Skeleton Warrior'),
  charManifest('enemy_skeleton_archer',   'Enemy: Skeleton Archer'),
  charManifest('enemy_zombie',            'Enemy: Zombie'),
  charManifest('enemy_ghost',             'Enemy: Ghost'),
  charManifest('enemy_wolf',              'Enemy: Wolf'),
  charManifest('enemy_giant_rat',         'Enemy: Giant Rat'),
  charManifest('enemy_goblin',            'Enemy: Goblin'),
  charManifest('enemy_orc_warrior',       'Enemy: Orc Warrior'),
  charManifest('enemy_orc_shaman',        'Enemy: Orc Shaman'),
  charManifest('enemy_bandit',            'Enemy: Bandit'),
  charManifest('enemy_bandit_crossbow',   'Enemy: Bandit (Crossbow)'),
  charManifest('enemy_cultist',           'Enemy: Cultist'),
  charManifest('enemy_wraith',            'Enemy: Wraith'),
];

const ENEMY_LARGE_MANIFESTS = [
  charManifest('enemy_golem_stone',   'Enemy: Stone Golem (48×48)',  48, 48),
  charManifest('enemy_troll',         'Enemy: Troll (48×48)',        48, 48),
  charManifest('enemy_dragon_young',  'Enemy: Young Dragon (64×64)', 64, 64),
];

// ── Item icon sheet ───────────────────────────────────────────────────────────

const ITEM_ICON_KEYS = [
  // Weapons
  'icon_sword','icon_axe','icon_mace','icon_shortbow',
  'icon_staff','icon_dagger','icon_spear','icon_crossbow',
  // Armor
  'icon_chainmail','icon_plate','icon_leather_armor','icon_robe','icon_shield',
  // Helmets
  'icon_iron_helm','icon_hood','icon_circlet','icon_bishops_mitre',
  // Accessories
  'icon_ring_gold','icon_ring_silver','icon_amulet','icon_charm','icon_bracer',
  // Consumables
  'icon_health_potion','icon_antidote','icon_torch','icon_ration',
  // Key Items
  'icon_old_key','icon_sealed_letter','icon_ancient_tome','icon_signet_ring','icon_map_fragment',
  // Materials
  'icon_ore_lump','icon_cloth_bolt','icon_leather_strip','icon_alchemical_powder',
  // Documents
  'icon_scroll','icon_book','icon_map_folded',
];

const ITEM_ICON_MANIFEST = {
  asset_id: 'icons_items', asset_label: 'Item Icon Sheet',
  output_file: 'icons_items.png',
  output_width: 512, output_height: 192,
  frame_width: 32, frame_height: 32,
  layout_cols: 16, layout_rows: 6,
  transparency_mode: 'magic_pink',
  source: {
    mode: 'individual',
    files: ITEM_ICON_KEYS.map((k, i) => ({ frame_index: i, file_key: k })),
  },
};

// ── Status icon sheet ─────────────────────────────────────────────────────────

const STATUS_ICON_MANIFEST = {
  asset_id: 'icons_status', asset_label: 'Status Icon Sheet',
  output_file: 'icons_status.png',
  output_width: 160, output_height: 16,
  frame_width: 16, frame_height: 16,
  layout_cols: 10, layout_rows: 1,
  transparency_mode: 'magic_pink',
  source: {
    mode: 'individual',
    files: [
      'poisoned','burning','stunned','slowed','blinded',
      'frightened','charmed','silenced','bleeding','rooted',
    ].map((k, i) => ({ frame_index: i, file_key: `status_${k}` })),
  },
};

// ── Effect sprites ────────────────────────────────────────────────────────────

const EFFECT_MANIFESTS = [
  effectManifest('fx_hit_slash',        'FX: Hit Slash',           3,  32, 32),
  effectManifest('fx_hit_blunt',        'FX: Hit Blunt',           3,  32, 32),
  effectManifest('fx_hit_magic',        'FX: Hit Magic',           4,  32, 32),
  effectManifest('fx_heal',             'FX: Heal',                4,  32, 32),
  effectManifest('fx_poison_cloud',     'FX: Poison Cloud',        4,  32, 32),
  effectManifest('fx_fire_small',       'FX: Fire Small',          4,  32, 32),
  effectManifest('fx_fire_large',       'FX: Fire Large',          4,  32, 32),
  effectManifest('fx_magic_bolt',       'FX: Magic Bolt',          3,  32, 32),
  effectManifest('fx_barrier',          'FX: Barrier',             3,  32, 32),
  effectManifest('fx_turn_undead',      'FX: Turn Undead',         5,  32, 32),
  effectManifest('fx_consecrate',       'FX: Consecrate',          5,  48, 48),
  effectManifest('fx_secret_discover',  'FX: Secret Discover',     4,  32, 32),
  effectManifest('fx_level_transition', 'FX: Level Transition',    4,  32, 32),
  effectManifest('fx_torch_radius',     'FX: Torch Radius',        1,  64, 64),
  effectManifest('fx_shadow_step',      'FX: Shadow Step',         3,  32, 32),
  effectManifest('fx_backstab',         'FX: Backstab',            3,  32, 32),
  effectManifest('fx_rain_particle',    'FX: Rain Particle',       2,  32, 32),
  effectManifest('fx_snow_particle',    'FX: Snow Particle',       3,  32, 32),
  effectManifest('fx_fog_overlay',      'FX: Fog Overlay',         4, 128,128),
  effectManifest('fx_lightning_flash',  'FX: Lightning Flash',     2, 640,480),
];

// ── UI elements ───────────────────────────────────────────────────────────────

const UI_MANIFESTS = [
  uiManifest('ui_portrait_frame',       'UI: Portrait Frame',         72, 72),
  uiManifest('ui_dialogue_box',         'UI: Dialogue Box',          640,120),
  uiManifest('ui_inventory_slot',       'UI: Inventory Slot',         36, 36),
  uiManifest('ui_inventory_slot_hover', 'UI: Inventory Slot (Hover)', 36, 36),
  uiManifest('ui_hp_bar_fill',          'UI: HP Bar Fill',              1,  8),
  uiManifest('ui_hp_bar_bg',            'UI: HP Bar Background',        1,  8),
  uiManifest('ui_mp_bar_fill',          'UI: MP Bar Fill',              1,  8),
];

// ── Built-in presets (shown as quick-load examples in the UI) ─────────────────

export const PRESET_A = {
  asset_id: 'char_fighter_m',
  asset_label: 'Preset A — Fighter (Male): Individual Files',
  output_file: 'char_fighter_m.png',
  output_width: 96, output_height: 128,
  frame_width: 32, frame_height: 32,
  layout_cols: 3, layout_rows: 4,
  transparency_mode: 'magic_pink',
  source: {
    mode: 'individual',
    files: [
      { frame_index: 0,  file_key: 'fighter_south_idle'   },
      { frame_index: 1,  file_key: 'fighter_south_step_l' },
      { frame_index: 2,  file_key: 'fighter_south_step_r' },
      { frame_index: 3,  file_key: 'fighter_north_idle'   },
      { frame_index: 4,  file_key: 'fighter_north_step_l' },
      { frame_index: 5,  file_key: 'fighter_north_step_r' },
      { frame_index: 6,  file_key: 'fighter_east_idle'    },
      { frame_index: 7,  file_key: 'fighter_east_step_l'  },
      { frame_index: 8,  file_key: 'fighter_east_step_r'  },
      { frame_index: 9,  file_key: 'fighter_west_idle'    },
      { frame_index: 10, file_key: 'fighter_west_step_l'  },
      { frame_index: 11, file_key: 'fighter_west_step_r'  },
    ],
  },
};

export const PRESET_B = {
  asset_id: 'tileset_terrain_sheet',
  asset_label: 'Preset B — Terrain Tileset: Source Sheet Remap',
  output_file: 'tileset_terrain.png',
  output_width: 512, output_height: 128,
  frame_width: 32, frame_height: 32,
  layout_cols: 16, layout_rows: 4,
  transparency_mode: 'none',
  source: {
    mode: 'sheet',
    sheet_key: 'terrain_source_sheet',
    source_frame_width: 32,
    source_frame_height: 32,
    source_cols: 16,
    // 1:1 identity remap — replace source_col/source_row to reorder from your pack
    frame_map: Array.from({ length: 64 }, (_, i) => ({
      output_index: i,
      source_col:   i % 16,
      source_row:   Math.floor(i / 16),
    })),
  },
};

// ── ManifestLibrary ───────────────────────────────────────────────────────────

export const ManifestLibrary = {
  _manifests: new Map(),

  /** Initialise with all built-in manifests. Called once at startup. */
  initDefaults() {
    const all = [
      TERRAIN_MANIFEST,
      ...PLAYER_CHAR_MANIFESTS,
      ...NPC_MANIFESTS,
      ...ENEMY_STANDARD_MANIFESTS,
      ...ENEMY_LARGE_MANIFESTS,
      ITEM_ICON_MANIFEST,
      STATUS_ICON_MANIFEST,
      ...EFFECT_MANIFESTS,
      ...UI_MANIFESTS,
      PRESET_A,
      PRESET_B,
    ];
    for (const m of all) this._manifests.set(m.asset_id, m);
    return all.length;
  },

  /** Load from a JSON string (array or single object). Returns count added. */
  loadJSON(json) {
    const parsed = JSON.parse(json);
    const arr    = Array.isArray(parsed) ? parsed : [parsed];
    for (const m of arr) this._manifests.set(m.asset_id, m);
    return arr.length;
  },

  /**
   * Attempt to fetch and load a manifest JSON file (requires HTTP server).
   * @returns {Promise<number>} manifests loaded
   */
  async fetchFile(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    const arr = await resp.json();
    return this.loadJSON(JSON.stringify(arr));
  },

  get(assetId)  { return this._manifests.get(assetId) ?? null; },
  getAll()      { return [...this._manifests.values()]; },
  has(assetId)  { return this._manifests.has(assetId); },
  count()       { return this._manifests.size; },

  // ── Validation ─────────────────────────────────────────────────────────────

  validate(m) {
    const errors = [];
    const need = (...keys) => { for (const k of keys) if (m[k] == null) errors.push(`Missing: ${k}`); };
    need('asset_id','output_file','output_width','output_height',
         'frame_width','frame_height','layout_cols','layout_rows',
         'transparency_mode','source');

    if (m.source) {
      if (!['individual','sheet'].includes(m.source.mode))
        errors.push(`Invalid source.mode: "${m.source.mode}"`);
      if (m.source.mode === 'individual' && !Array.isArray(m.source.files))
        errors.push('source.files must be an array');
      if (m.source.mode === 'sheet') {
        if (!m.source.sheet_key)                errors.push('Missing source.sheet_key');
        if (!Array.isArray(m.source.frame_map)) errors.push('source.frame_map must be an array');
        if (!m.source.source_frame_width)        errors.push('Missing source.source_frame_width');
        if (!m.source.source_frame_height)       errors.push('Missing source.source_frame_height');
      }
    }
    // Dimension consistency
    if (m.output_width  !== m.layout_cols * m.frame_width)
      errors.push(`output_width ${m.output_width} ≠ layout_cols ${m.layout_cols} × frame_width ${m.frame_width}`);
    if (m.output_height !== m.layout_rows * m.frame_height)
      errors.push(`output_height ${m.output_height} ≠ layout_rows ${m.layout_rows} × frame_height ${m.frame_height}`);

    return { valid: errors.length === 0, errors };
  },

  getRequiredFileKeys(m) {
    if (m.source.mode === 'individual')
      return [...new Set(m.source.files.map(f => f.file_key))];
    return [m.source.sheet_key];
  },
};
