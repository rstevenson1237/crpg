# CRPG Engine — Game Design Document
**Version 0.1 | Platform: Browser/Web (HTML5/JS)**

---

## Table of Contents

1. [Vision & Design Philosophy](#1-vision--design-philosophy)
2. [Core Display Engine](#2-core-display-engine)
3. [Map Engine — Three-Tier World](#3-map-engine--three-tier-world)
4. [Events & Scripting Engine](#4-events--scripting-engine)
5. [Combat Engine](#5-combat-engine)
6. [Interaction Engine — Secrets & Storyline](#6-interaction-engine--secrets--storyline)
7. [Equipment & Inventory](#7-equipment--inventory)
8. [Classes & Unique Powers](#8-classes--unique-powers)
9. [Character Progression](#9-character-progression)
10. [Puzzle Solving](#10-puzzle-solving)
11. [Traps & Environmental Danger](#11-traps--environmental-danger)
12. [Day/Night Cycle & Weather](#12-daynight-cycle--weather)
13. [Music & Mood System](#13-music--mood-system)
14. [Art Asset Specification](#14-art-asset-specification)

---

## 1. Vision & Design Philosophy

### Core Statement
A browser-based top-down CRPG engine inspired by Ultima VI/VII's open world tile aesthetic, combining FFT-style tactical combat with rich narrative scripting. The engine is a platform first — any campaign, from tight linear story to sprawling sandbox, should be expressible through its configuration layer without touching engine code.

### Pillars

**Asymmetric Strategy over Balanced Fairness**
Classes are not interchangeable. A dungeon that demands a Thief is a dungeon with a Thief-shaped hole in it. The party's composition is itself a strategic resource, not a cosmetic choice.

**Narrative Momentum over Reward Loop**
Growth comes from the world, not from killing things. Characters improve because they found a mentor, read a forbidden tome, or survived something that changed them. Combat is one tool among many, not the engine's heartbeat.

**Secrets as a First-Class Resource**
Knowledge is currency. Talking to the right people, exploring the right spaces, and making the right connections unlocks capabilities that grinding never would. Secrets compound — one discovery enables another.

**Campaign Agnostic**
The engine makes no assumptions about genre, tone, or structure. A campaign config defines the world. The engine runs it. Story-driven and sandbox modes are not separate — they exist on a spectrum controlled by the scriptor.

**AI-Optimized Scripting**
The campaign scripting format is designed to be generated, extended, and modified by AI. Field names are verbose and self-describing. Structure is consistent and predictable. Every object type follows the same patterns.

---

## 2. Core Display Engine

### Technology Stack
- **Renderer**: HTML5 Canvas 2D API (primary), with optional WebGL layer for lighting/effects
- **Tile Size**: 32×32 pixels
- **Viewport**: 20×15 tile window (640×480 logical resolution, scaled to browser window)
- **Pixel Scaling**: Integer scaling only (2×, 3×, 4×) to maintain pixel-art fidelity
- **Target Framerate**: 60fps for animations, logic ticks decoupled (configurable turns/second)

### Rendering Layers (back to front)
```
Layer 0 — Terrain Base          (ground tiles, water, paths)
Layer 1 — Terrain Detail        (grass patches, floor variations)
Layer 2 — Object Base           (furniture, rocks, vegetation lower)
Layer 3 — Entity Shadow         (soft drop shadows beneath all entities)
Layer 4 — Characters & NPCs     (4-directional sprites, animated)
Layer 5 — Object Overlay        (vegetation upper, overhangs, tall objects)
Layer 6 — Weather Particles     (rain, snow, fog, dust)
Layer 7 — Lighting Overlay      (day/night gradient, torch radii, darkness)
Layer 8 — Effect Sprites        (spell FX, hit flashes, status indicators)
Layer 9 — UI Chrome             (HUD, portrait bar, minimap)
Layer 10 — Dialogue/Menu Layer  (dialogue boxes, menus, tooltips)
Layer 11 — Transition Effects   (fade in/out, screen wipes for location changes)
```

### Camera
- Follows party lead character with soft centering
- Smooth scroll between tiles (8-frame lerp)
- Hard snap on location transitions (fade to black → fade in)
- Combat view: animated zoom into tactical arena on engagement

### Sprite Animation
- Characters: 4-directional walk cycles, 3 frames per direction (idle, step-left, step-right)
- Idle animation: subtle 2-frame "breathe" loop when stationary for >2 seconds
- Combat sprites: separate larger sprite sheet (see Combat Engine)
- All animations defined in JSON sprite manifests referenced by the asset config

### Tile Rendering Rules
- Tiles flagged `passable: false` render their collision visually (walls, water, cliffs)
- Autotiling: edge-matching for terrain transitions (grass→dirt→sand→water follows contour rules)
- Animated tiles: water shimmer, torch flicker, lava glow — frame count and speed in tile definition
- Darkness: unvisited tiles render black; visited-but-not-visible tiles render at 40% desaturated

---

## 3. Map Engine — Three-Tier World

The world is organized into three distinct tiers, each with its own scale, purpose, and generation rules.

### Tier 1 — Overworld

**Purpose**: Large-scale exploration. Moving between named locations, discovering points of interest, surviving wilderness travel.

**Scale**: Up to 256×256 tiles. Each tile represents approximately 100 meters of in-world space.

**Design**: Fully handcrafted by the campaign designer. No procedural generation at this tier. The overworld is authored once and is the persistent, canonical world state.

**Contents**:
- Terrain biomes (plains, forest, desert, tundra, mountains, coast, ocean)
- Roads and trails (movement speed bonus, visual differentiation)
- Named location markers (towns, dungeons, ruins, shrines)
- Wilderness encounter zones (flagged regions where Tier 3 encounters can trigger)
- Points of interest: scripted objects, hidden passages, environmental storytelling tiles
- Day/night and weather fully visible at this tier

**Movement**: Party moves tile by tile. Each tile costs 1 movement unit. Terrain modifies cost (road: 0.5, forest: 2, mountain: 3, impassable: blocked). Movement triggers encounter checks in flagged zones.

**Minimap**: Persistent HUD element showing visited/revealed overworld tiles. Locations appear as icons once discovered.

---

### Tier 2 — Locations

**Purpose**: Named, meaningful places. Towns, dungeons, castles, caves, ships, temples — any authored space the party can enter.

**Scale**: Variable, up to 128×128 tiles per floor. Multi-floor locations supported (dungeon levels, building interiors, ship decks).

**Design**: Fully handcrafted. Each location is a discrete map file with its own tileset, NPC roster, object placements, event triggers, lighting profile, and music mood config.

**Location Types** (engine-supported, campaign-extendable):
| Type | Description | Typical Contents |
|---|---|---|
| `town` | Inhabited settlement | Shops, NPCs, housing, services |
| `dungeon` | Underground complex | Enemies, traps, puzzles, treasure |
| `cave` | Natural formation | Mixed enemies, environmental hazards |
| `ruin` | Abandoned structure | Atmospheric, heavy secrets density |
| `castle` | Fortified building | Factions, political encounters |
| `ship` | Waterborne vessel | Moving location, crew NPCs |
| `shrine` | Sacred/arcane site | Special interactions, class-locked content |
| `wilderness_camp` | Temporary refuge | Rest, merchant encounters |
| `set_piece` | Scripted unique location | Campaign-defined, anything goes |

**Floor Transitions**: Stairs, ladders, and portals link floors within a location. Each floor is a separate map. Party position is preserved on descent/ascent.

**Location Entry/Exit**:
- Entry fires `on_enter` location event (see Events Engine)
- Exit returns party to overworld at the location's overworld tile
- Some locations are one-way until an event condition is met

---

### Tier 3 — Encounters

**Purpose**: Tactical combat and contained challenge spaces. Procedurally assembled from handcrafted room templates.

**Scale**: 24×18 tiles — the full tactical viewport. No scrolling; all action visible simultaneously.

**Design**: Procedurally assembled from a campaign-provided template library. Each template is a handcrafted room layout (walls, terrain features, objects) that the engine selects based on context tags (biome, dungeon_type, difficulty_tier, encounter_type). Enemy placement, trap placement, and loot tables are also template-driven and randomized within defined ranges.

**Encounter Triggers**:
- Movement through a wilderness encounter zone (random, rate configurable per zone)
- Scripted forced encounter (event-triggered)
- Entering a specific tile in a Tier 2 location
- Action-based (attacking an NPC, tripping a wire)

**Transition**: Animated zoom from Tier 1/2 view into the tactical arena. Post-combat, zoom back out. Party position on the parent map is unchanged.

---

### Map File Format (AI-Optimized)
```json
{
  "map_id": "dungeon_ironhold_level1",
  "map_type": "dungeon",
  "display_name": "Ironhold — First Descent",
  "tileset": "tileset_stone_dungeon",
  "width": 40,
  "height": 32,
  "floors": 1,
  "ambient_light": "dark",
  "music_profile": "dungeon_tense",
  "weather_enabled": false,
  "tiles": [ /* flat array, width*height entries, each a tile_id */ ],
  "objects": [
    {
      "object_id": "obj_locked_door_01",
      "object_type": "door_locked",
      "tile_x": 12, "tile_y": 8,
      "facing": "north",
      "requires_class": ["thief"],
      "requires_item": "key_ironhold_warden",
      "on_open_event": "evt_ironhold_inner_wing_unlocked"
    }
  ],
  "npcs": [ /* NPC placement definitions — see Interaction Engine */ ],
  "events": [ /* location-scoped event definitions — see Events Engine */ ],
  "encounter_zones": [
    {
      "zone_id": "zone_lower_corridor",
      "tile_region": { "x1": 0, "y1": 20, "x2": 40, "y2": 32 },
      "encounter_pool": "encounter_pool_dungeon_undead_medium",
      "encounter_rate": 0.15,
      "max_encounters_per_visit": 4
    }
  ]
}
```

---

## 4. Events & Scripting Engine

### Design Principle
The scripting engine is the campaign's nervous system. Everything that is not pure engine behavior — story, consequence, NPC behavior, world change — flows through events. The format is designed to be written and extended by AI: verbose, self-consistent, and structured without requiring procedural logic.

### Event Anatomy
Every event is a named object with a trigger, conditions, and an action list. Events can be chained. Events have an execution state (pending, active, complete, suppressed).

```json
{
  "event_id": "evt_king_sends_army",
  "event_label": "The king dispatches soldiers to the borderlands",
  "trigger": {
    "type": "timeline",
    "after_event": "evt_player_refuses_kings_demand",
    "delay_turns": 72
  },
  "conditions": [
    {
      "condition_type": "flag_is_set",
      "flag_id": "flag_refused_king"
    },
    {
      "condition_type": "event_not_complete",
      "event_id": "evt_king_defeated"
    }
  ],
  "actions": [
    {
      "action_type": "spawn_npc_group",
      "npc_group_id": "npc_group_royal_soldiers",
      "map_id": "town_borderkeep",
      "tile_x": 5, "tile_y": 12
    },
    {
      "action_type": "set_flag",
      "flag_id": "flag_soldiers_in_borderkeep"
    },
    {
      "action_type": "add_world_log_entry",
      "text": "Royal soldiers have arrived in Borderkeep."
    }
  ],
  "on_complete_fire_event": null
}
```

### Trigger Types

#### Timeline Triggers
Fire after a set number of game turns have elapsed since a reference point.

```json
{
  "type": "timeline",
  "reference": "game_start",
  "delay_turns": 500
}
```
```json
{
  "type": "timeline",
  "after_event": "evt_ritual_begins",
  "delay_turns": 24
}
```
```json
{
  "type": "timeline",
  "at_time_of_day": "dawn",
  "on_day": 7
}
```

#### Location Triggers
Fire when the party enters (or exits) a defined map or tile region.

```json
{
  "type": "location_enter",
  "map_id": "dungeon_ironhold_level1"
}
```
```json
{
  "type": "location_tile",
  "map_id": "town_ashenvale",
  "tile_x": 14, "tile_y": 9,
  "trigger_radius": 2
}
```
```json
{
  "type": "location_exit",
  "map_id": "dungeon_ironhold_level1"
}
```

#### Action Triggers
Fire when the player or party completes a specific action.

```json
{
  "type": "action",
  "action_kind": "npc_dialogue_completed",
  "npc_id": "npc_elder_maris",
  "dialogue_node_id": "dlg_maris_confession"
}
```
```json
{
  "type": "action",
  "action_kind": "item_used",
  "item_id": "item_silver_mirror",
  "on_map_id": "dungeon_witchwood",
  "on_tile_object_id": "obj_dark_pool"
}
```
```json
{
  "type": "action",
  "action_kind": "secret_discovered",
  "secret_id": "secret_hidden_library"
}
```
```json
{
  "type": "action",
  "action_kind": "party_member_joins",
  "character_id": "char_thief_kael"
}
```

### Action Types (Event Payload)
The complete list of actions an event can execute. Campaigns can only use these primitives; new action types require engine modification.

| Action Type | Description |
|---|---|
| `set_flag` | Sets a boolean world flag |
| `clear_flag` | Clears a boolean world flag |
| `set_variable` | Sets a named integer/string variable |
| `grant_secret` | Adds a secret/knowledge entry to party record |
| `revoke_secret` | Removes a secret entry |
| `show_dialogue` | Opens a scripted dialogue tree |
| `show_narration` | Displays a full-screen text narration card |
| `play_cutscene` | Triggers a tile-animation cutscene sequence |
| `spawn_npc` | Places an NPC on a map |
| `despawn_npc` | Removes an NPC from a map |
| `spawn_npc_group` | Places a group of NPCs |
| `modify_npc_schedule` | Changes an NPC's time-based behavior |
| `modify_npc_faction_standing` | Adjusts party's standing with a faction |
| `add_party_member` | Adds a character to the party |
| `remove_party_member` | Removes a character from the party |
| `lock_party_member` | Makes a character temporarily unavailable |
| `unlock_party_member` | Returns a character to the available roster |
| `grant_item` | Adds an item to party inventory |
| `remove_item` | Removes an item from party inventory |
| `grant_skill_unlock` | Unlocks a skill on a character |
| `grant_mentor_training` | Opens a mentor training dialogue |
| `modify_map_tile` | Changes a tile's properties (open secret door, flood room, etc.) |
| `modify_map_object` | Changes an object's state (unlock door, break wall) |
| `place_loot_cache` | Spawns a loot container at a tile |
| `trigger_encounter` | Forces a Tier 3 encounter |
| `add_world_log_entry` | Adds a visible entry to the world log journal |
| `fire_event` | Immediately triggers another event |
| `set_music_mood` | Forces a music mood override |
| `set_weather` | Changes current weather state |
| `set_time_of_day` | Jumps to a specific time |
| `teleport_party` | Moves party to a map/tile coordinate |
| `screen_fade` | Triggers a screen fade (in/out, color) |

### Conditions
All events can gate on conditions. Multiple conditions use AND logic by default; `condition_join: "or"` switches to OR.

```json
"conditions": [
  { "condition_type": "flag_is_set", "flag_id": "flag_met_elder" },
  { "condition_type": "party_includes_class", "class_id": "mage" },
  { "condition_type": "party_has_item", "item_id": "item_elder_seal" },
  { "condition_type": "variable_gte", "variable_id": "var_faction_guild_standing", "value": 50 },
  { "condition_type": "time_of_day_is", "time": "night" },
  { "condition_type": "secret_known", "secret_id": "secret_guilds_true_name" },
  { "condition_type": "event_complete", "event_id": "evt_guild_initiation" }
]
```

### Event Chains
Events can trigger other events on completion, enabling arbitrarily complex story chains with no procedural scripting required.

```
evt_player_enters_temple
  → on_complete: evt_temple_guardian_awakens (timeline: +2 turns)
    → on_complete: evt_guardian_speaks (action: dialogue complete)
      → on_complete: evt_temple_secret_revealed
```

---

## 5. Combat Engine

### Overview
When combat is triggered, the view animates into a separate top-down tactical arena. Combat is turn-based with individual initiative ordering. Positioning, terrain, class abilities, and action economy are the strategic levers. Combat is one of several ways to resolve conflicts — the scripting engine can mark encounters as avoidable, negotiable, or mandatory.

### Initiative & Turn Order
- Each combatant (party member or enemy) has a Speed stat
- Initiative = Speed + d6 roll at combat start
- Displayed as a horizontal turn order strip in the HUD
- On their turn, each combatant gets: **1 Move Action** + **1 Standard Action**
- Some class abilities consume the Move Action, Standard Action, or both

### Movement
- Each combatant has a Movement Range (tiles they can move per turn)
- Movement is free within range — no path cost differentiation in base engine (terrain can add modifiers per campaign)
- After moving, a combatant can still act; after acting, they can still move remaining distance
- Some abilities interrupt movement (Thief's Dash, Fighter's Charge)

### Action Economy
Each turn allows:
| Slot | Options |
|---|---|
| Move | Move up to Movement Range |
| Standard | Attack, Use Ability, Use Item, Interact with Object, Defend (+20% dodge until next turn) |
| Free (1/turn) | Speak (short dialogue), Drop Item |
| Reaction (0 AP, triggered) | Counter, Parry (class-specific), Spell Shield |

### Combat Resolution
- **Attack**: Attacker rolls vs. target Defense. Hit deals weapon damage + stat modifier. Miss deals 0.
- **Abilities**: Each has its own resolution (see Classes)
- **Status Effects**: Applied by abilities, traps, or environment. Listed below.
- **Death**: Characters reduced to 0 HP are incapacitated. If all party members are incapacitated, the campaign's `on_party_defeat` event fires (engine does not force game over — the campaign decides the consequence).

### Status Effects
| Status | Effect | Duration |
|---|---|---|
| Poisoned | Lose HP each turn | Until cured or X turns |
| Burning | Lose HP, spread to adjacent | Until cured |
| Stunned | Skip next Standard Action | 1 turn |
| Slowed | Movement Range halved | X turns |
| Blinded | Attack accuracy severely penalized | X turns |
| Frightened | Must move away from source | X turns |
| Charmed | Acts on enemy side | X turns |
| Silenced | Cannot use spell abilities | X turns |
| Bleeding | Lose HP on movement | Until treated |
| Rooted | Cannot move, can still act | X turns |

### Terrain Features (Combat Arena)
Terrain in the encounter template can modify combat:

| Feature | Effect |
|---|---|
| Elevated tile | +1 attack range, +10% hit chance for ranged |
| Cover object | -25% chance to be hit by ranged attacks |
| Difficult terrain | Costs 2 movement to enter |
| Hazard tile | Deals damage on entry (fire, acid, spike pit) |
| Darkness tile | Imposes Blinded if no light source in party |
| Water tile | Prevents movement unless character has Swim |
| Choke point | Tactical positioning value (no mechanical bonus, designer intent) |

### Combat Non-Lethality
Combat does not always end in death. The scripting engine can configure:
- `surrender_threshold`: Enemies flee or yield below X% HP
- `capture_outcome`: Incapacitated party triggers capture event instead of defeat
- `talking_during_combat`: Certain NPCs can be spoken to mid-combat to end the fight

### Loot & Aftermath
- Post-combat loot defined in encounter template's `loot_table`
- Loot is not XP. Items, materials, currency.
- Campaign can fire an `on_combat_complete` event with full context (who participated, who fell, what was looted)

---

## 6. Interaction Engine — Secrets & Storyline

### Dialogue System
Branching menu-based dialogue. Clicking the party's lead interactable character opens the NPC's dialogue tree at its current root node.

**Dialogue Node Structure**:
```json
{
  "node_id": "dlg_merchant_root",
  "speaker_id": "npc_merchant_borven",
  "speaker_portrait": "portrait_merchant_borven",
  "text": "Travelers! Come, come. I have wares you won't find elsewhere. What can Borven do for you?",
  "options": [
    {
      "option_text": "Show me your goods.",
      "target_node": "dlg_merchant_shop_open",
      "action": { "action_type": "open_shop", "shop_id": "shop_borven_general" }
    },
    {
      "option_text": "What do you know about the old fortress?",
      "target_node": "dlg_merchant_fortress_knows_nothing",
      "visible_condition": { "condition_type": "flag_not_set", "flag_id": "flag_borven_told_fortress" }
    },
    {
      "option_text": "The warden mentioned your name.",
      "target_node": "dlg_merchant_warden_reveal",
      "visible_condition": {
        "condition_type": "secret_known",
        "secret_id": "secret_borven_warden_connection"
      },
      "on_select_fire_event": "evt_borven_secret_exposed"
    },
    {
      "option_text": "Farewell.",
      "target_node": null
    }
  ]
}
```

**Key features**:
- Options can be conditionally visible (secret-gated, flag-gated, class-gated, item-gated)
- Selecting an option can fire an event
- Completing a node can fire an event
- Speaker can change mid-tree (party member interjects, second NPC joins)
- Portrait displayed per speaker

### NPC Schedules
NPCs can have time-based schedule overrides. At defined time windows, their position, dialogue root, and availability change.

```json
{
  "npc_id": "npc_guard_captain",
  "default_position": { "tile_x": 8, "tile_y": 4 },
  "schedule": [
    { "time_start": "dawn", "time_end": "morning", "position": { "tile_x": 2, "tile_y": 14 }, "dialogue_root": "dlg_captain_morning_patrol" },
    { "time_start": "night", "time_end": "midnight", "position": { "tile_x": 18, "tile_y": 6 }, "available": false }
  ]
}
```

### Secrets System

Secrets are the engine's knowledge-currency. They are named, discrete pieces of information the party has acquired. They gate dialogue options, unlock events, enable class-independent interactions, and accumulate in a party-accessible journal.

**Secret Types**:

| Type | How Acquired | Effect |
|---|---|---|
| `spatial` | Walking through a hidden tile, interacting with an unmarked object | Reveals a location, object, or passage |
| `narrative` | Completing a dialogue branch, reading a document, overhearing NPC conversation | Unlocks dialogue options, event conditions |
| `skill_gated` | Attempting an interaction while possessing required class/skill | Deeper information than unskilled interaction yields |
| `chained` | Discovering one secret that references another | Secrets can spawn investigation threads |

**Secret Record**:
```json
{
  "secret_id": "secret_hidden_temple_location",
  "secret_label": "The Hidden Temple",
  "secret_description": "Maris spoke of a temple beneath the western marsh, accessible only when the river runs low.",
  "secret_type": "narrative",
  "acquired_from": "npc_elder_maris",
  "unlocks_map_marker": "location_sunken_temple",
  "unlocks_dialogue_options": ["dlg_ferryman_temple_question"],
  "enables_events": ["evt_temple_approach_recognized"]
}
```

**Secret Display**: Secrets accumulate in the party journal (Journal tab in UI). The journal is the player's primary record of discovered knowledge, active threads, and faction standings.

### Faction System
Factions are named groups with a standing value (0–100) per faction.

- Standing rises from: helping faction members, completing faction quests, discovering faction secrets, spending faction currency
- Standing falls from: opposing faction actions, helping enemy factions, reputation events
- Standing gates: dialogue options, NPC friendliness, access to faction-exclusive services, class ability unlocks tied to faction mentors
- Factions can be in conflict — raising one may lower another

---

## 7. Equipment & Inventory

### Inventory
- Party-shared inventory with configurable weight/slot limits (or unlimited — campaign-defined)
- Item types: Weapon, Armor, Accessory, Consumable, Key Item, Material, Document/Tome, Currency
- Key Items cannot be dropped or sold — they are plot-critical
- Documents/Tomes can be read (triggers a narrative action, may grant secrets or skills)

### Equipment Slots (per character)
| Slot | Contents |
|---|---|
| Weapon | Main weapon (class-specific restrictions apply) |
| Off-Hand | Shield, secondary weapon, or empty |
| Armor | Body armor (class-specific restrictions) |
| Helm | Head armor or accessory |
| Accessory 1 | Ring, amulet, charm |
| Accessory 2 | Second accessory slot |

### Item-Driven Progression
Items are the primary engine of character growth (see Progression). Mechanically, items can carry:
- Passive stat bonuses
- Active ability grants (equipping the item adds an ability to the character's action list)
- Skill unlock triggers (on-equip or on-use, grant a permanent ability to the character)
- Mentor unlock triggers (item grants access to a specific mentor's training)
- Secret grants (reading/using an item grants a secret entry)

### Item Definition Format
```json
{
  "item_id": "item_warden_signet",
  "item_label": "Warden's Signet",
  "item_type": "accessory",
  "description": "A heavy iron ring bearing the seal of the old Warden. Still recognized in some quarters.",
  "equip_slot": "accessory_1",
  "class_restriction": null,
  "stat_modifiers": { "defense": 1 },
  "ability_grants": [],
  "on_equip_events": ["evt_warden_signet_equipped"],
  "on_equip_grant_secrets": ["secret_borven_warden_connection"],
  "on_use_action": null,
  "tradeable": false,
  "weight": 0
}
```

---

## 8. Classes & Unique Powers

### Design Principle
Classes define the lens through which a character interacts with the world — not just in combat, but everywhere. A Mage doesn't just cast spells; they read glyphs that others cannot, identify magical traps before they trigger, and access hidden knowledge from arcane sources. Class identity must be legible in every tier of play.

### Hard vs. Soft Locks

**Hard Lock**: Only this class (or a defined set of classes) can perform this action. No fallback.
- Picking a master-craft lock (Thief only)
- Reading a magical glyph inscription (Mage only)
- Consecrating a corrupted shrine (Cleric only)
- Breaking a portcullis bare-handed (Fighter only — or with sufficient Strength item)

**Soft Lock**: Any class can attempt; the listed class does it better, faster, more quietly, or without consequence.
- Picking a simple lock (Thief: silent, automatic | Others: noisy, chance of failure, may alert nearby NPCs)
- Healing a wounded NPC (Cleric: full restoration | Others: partial, consumes a costly item)
- Negotiating with a hostile guard (Thief: deception route | Fighter: intimidation route | Cleric: appeal to duty | Mage: insight into their true concern)

The class lock type is always set in the object or event's config, not hardcoded in the engine. This keeps the engine flexible for campaign-defined classes.

### Core Four Classes

---

#### Fighter

**World Identity**: The Fighter's strength is physical authority. They open doors others cannot, command respect from soldiers and mercenaries, and endure punishment that would destroy lighter characters. They are the anvil the world breaks itself against.

**Combat Role**: Front-line, high HP, high armor, melee dominance. Controls space, protects allies, breaks formations.

**Unique Powers**:
| Ability | Type | Description |
|---|---|---|
| Weapon Mastery | Passive | Proficient with all weapon types; no attack penalties for exotic weapons |
| Shield Wall | Stance | Adjacent allies gain +15% dodge; Fighter cannot move this turn |
| Cleave | Standard Action | Attack hits primary target and all adjacent enemies for 60% damage |
| Charge | Move + Standard | Move in a straight line and attack; bonus damage scales with distance |
| Intimidate | Interaction | Can end non-boss combat by forcing surrender (soft lock: works on humanoids below 30% HP) |
| Fortify | Standard Action | Set a defensive position; next attack received is reduced by 50% |
| Breach | Standard Action | Destroy a locked door or barricade (hard lock for reinforced barriers) |

**World-Exclusive Interactions (Hard)**:
- Tear down reinforced barricades
- Force passage through physically blocked entries
- Arm-wrestle / test of strength social challenges
- Operate heavy siege mechanisms

---

#### Mage

**World Identity**: The Mage perceives the world's invisible layer — magical writing, arcane residue, enchantment signatures, dimensional anomalies. Where others see a blank wall, a Mage sees a glyph. Where others feel unease, a Mage identifies the source.

**Combat Role**: Ranged damage, area control, status application. Fragile but decisive. Resource-managed (spell uses limited, replenish at rest or via items).

**Unique Powers**:
| Ability | Type | Description |
|---|---|---|
| Arcane Bolt | Standard Action | Ranged magical attack, ignores physical armor |
| Area Hex | Standard Action | Target tile and adjacents take damage + status (Slowed, Silenced, or Burning) |
| Barrier | Standard Action | Create a temporary impassable magical wall on target tile (lasts 3 turns) |
| Blink | Move Action | Teleport to any visible tile within movement range |
| Identify | Interaction | Reveal all properties of a magical item (hard lock) |
| Glyph Reading | Interaction | Interpret magical inscriptions, runes, or arcane environmental features (hard lock) |
| Detect Magic | Passive/Active | Optional HUD overlay: magical objects, wards, and hidden arcane features pulse with a faint glow |

**World-Exclusive Interactions (Hard)**:
- Read and interpret magical glyphs and runic inscriptions
- Identify enchanted items
- Activate magically locked mechanisms
- Detect magical traps before triggering (Mage perception check vs. trap detection DC)
- Communicate with magical constructs

---

#### Thief

**World Identity**: The Thief navigates the world's hidden layer — back passages, locked spaces, the conversations happening behind closed doors. They exist in the gap between what is seen and what is real. Their greatest power is access.

**Combat Role**: High mobility, single-target burst damage, disruption. Avoids direct confrontation, excels at eliminating priority targets and controlling enemy turn order.

**Unique Powers**:
| Ability | Type | Description |
|---|---|---|
| Backstab | Standard Action | Attack deals triple damage if target has not acted this round and Thief is adjacent from behind |
| Shadow Step | Move Action | Teleport to any adjacent shadow tile; does not trigger reaction attacks |
| Pickpocket | Interaction | Remove an item from an NPC without their knowledge (soft lock: others can attempt with high failure/consequence) |
| Lockpick | Interaction | Open any locked container or door (hard lock for master-craft; soft lock for standard) |
| Eavesdrop | Interaction | Listen to NPC conversations from adjacent tile without being seen; may reveal secrets |
| Trap Detection | Passive | Traps within 3 tiles of the Thief are revealed on the map before triggering |
| Disarm Trap | Interaction | Remove a detected trap safely (hard lock; others who attempt an undetected trap suffer full effect) |
| Vanish | Standard Action | Enter stealth; enemies cannot target Thief until they act or are adjacent |

**World-Exclusive Interactions (Hard)**:
- Open master-craft locks
- Detect and disarm mechanical traps
- Access passages marked as thief-only infiltration routes
- Safely appraise black market value of goods (some merchants only deal with Thieves)

---

#### Cleric

**World Identity**: The Cleric mediates between the mortal world and whatever powers the campaign's theology defines. They carry authority over sacred spaces, corrupted ground, and the restless dead. Their presence changes what is possible in locations of spiritual significance.

**Combat Role**: Support and sustain, with meaningful offensive capability against undead and spiritually-marked enemies. The only class that can reliably heal combat wounds without consumables.

**Unique Powers**:
| Ability | Type | Description |
|---|---|---|
| Cure | Standard Action | Restore HP to one ally; removes Poisoned, Bleeding |
| Mass Cure | Standard Action | Restore minor HP to all allies in radius |
| Turn Undead | Standard Action | Forces undead enemies to flee for 3 turns; higher-power undead may resist |
| Smite | Standard Action | Melee attack dealing bonus damage to undead and spiritually-tainted enemies |
| Consecrate | Interaction | Purify a corrupted tile, object, or NPC (hard lock for certain shrines and cursed items) |
| Divine Insight | Passive | Cleric may sense the general moral/spiritual state of NPCs (lie detection soft lock) |
| Last Rites | Interaction | Prevent a defeated enemy from being reanimated later by necromantic events |
| Sanctuary | Stance | Combat aura: enemies must pass a check to target the Cleric directly |

**World-Exclusive Interactions (Hard)**:
- Consecrate corrupted shrines and objects
- Conduct sacred rituals that require divine authority
- Enter some holy locations that are passable only by the divine-touched
- Negotiate terms with undead entities capable of reason

---

### Engine-Level Class Config
Classes are fully data-driven. New classes can be added via campaign config without engine modification:

```json
{
  "class_id": "ranger",
  "class_label": "Ranger",
  "class_description": "Wilderness survivalist and tracker.",
  "combat_archetype": "ranged_skirmisher",
  "base_stats": { "hp": 28, "speed": 7, "attack": 5, "defense": 4, "magic": 2 },
  "equipment_restrictions": {
    "weapon": ["bow", "short_sword", "axe", "knife"],
    "armor": ["light", "medium"]
  },
  "abilities": [ /* ability definitions */ ],
  "world_hard_locks": ["track_hidden_trail", "survive_harsh_wilderness", "read_animal_sign"],
  "world_soft_locks": { "forage": "advantage", "navigate_wilderness": "advantage" },
  "progression_mentor_pool": ["mentor_hunter_guildmaster", "mentor_hermit_vethran"]
}
```

---

## 9. Character Progression

### Philosophy
No experience points. No kill counts. Characters grow because the world taught them something. Progression is discovery, relationship, and consequence — not accumulation.

### Growth Vectors

#### 1. Item-Based Unlocks
Equipping or using certain items grants permanent ability unlocks or stat improvements. The item may or may not be consumed in the process.
- *The Warden's Sword*: Equipping it grants the Fighter the "Command" ability — once per combat, issue a tactical order that grants an ally a free move action
- *A Forbidden Tome*: Reading it permanently unlocks the Mage's "Void Step" ability at the cost of a small max-HP reduction

#### 2. Mentor Training
Named NPCs in the world can train characters in new skills if the conditions are met (faction standing, quest completion, carrying a specific item, etc.). Training is a one-time interaction that grants a permanent ability.
- Mentors are scripted as events: `grant_mentor_training` action
- Multiple mentors may offer training in the same skill — the campaign can make them competing paths
- Some mentor training is class-locked; some is open

#### 3. Story Unlocks
Events can directly grant abilities as a narrative consequence. Surviving the dragon's breath. Successfully translating an ancient pact. Earning a faction's highest honor.
- Implemented via `grant_skill_unlock` event action
- Can carry narrative framing text (displayed as a brief card)

#### 4. Use-Based Improvement
Some skills improve through repetition. This is opt-in at the campaign level — a `use_tracked: true` flag on any ability means the engine tracks uses and grants minor improvements at defined milestones.
- *Lockpick*: 10 successful locks → reduced time; 25 → can attempt master-craft with soft lock
- *Backstab*: 15 successful backstabs → +10% damage

#### 5. Reputation-Gated Unlocks
Reaching standing thresholds with factions unlocks training, abilities, and equipment that cannot be obtained otherwise.
- The Thieves' Guild (standing 60+): Unlocks Thief's "Shadow Network" ability — fast-travel between guild safehouses
- The Temple Order (standing 75+): Cleric gains "Divine Shield" — absorbs a killing blow once per location

### Progression Records
Each character tracks:
```json
{
  "character_id": "char_fighter_aldric",
  "class_id": "fighter",
  "base_stats": { "hp": 35, "speed": 5, "attack": 7, "defense": 6, "magic": 1 },
  "stat_bonuses": { "hp": 8, "defense": 2 },
  "abilities_unlocked": ["cleave", "shield_wall", "command", "breach"],
  "use_tracked_skills": { "cleave": 14, "charge": 6 },
  "mentor_trainings_received": ["mentor_gladiator_mirela"],
  "story_unlocks_received": ["unlock_warden_authority"]
}
```

---

## 10. Puzzle Solving

### Puzzle Architecture
Puzzles are not a separate engine system — they are compositions of existing systems (objects, events, secrets, class locks, items, and the scripting engine). Every puzzle is a set of conditions and a trigger.

### Puzzle Types

**Spatial Puzzles**: Interacting with the environment in the right order or pattern.
- Move objects to pressure plates
- Activate switches in sequence (order stored in event flags)
- Illuminate symbols in a dark room with a light source

**Knowledge Puzzles**: Requiring secrets or dialogue knowledge to proceed.
- Enter a password revealed by a secret (`requires_secret: "secret_vault_password"`)
- Answer an NPC's riddle (answer sourced from a book found elsewhere)
- Identify an item correctly to unlock an interaction

**Class Puzzles**: Requiring a specific class's perception or ability.
- Mage detects a magical ward blocking a passage
- Thief threads a mechanical lock mechanism
- Cleric consecrates an altar to open a sealed door
- Fighter operates a counterweight mechanism

**Multi-step Puzzles**: Events chain; each solution enables the next stage.
```
Puzzle: The Sealed Archive
Step 1: Cleric must consecrate the outer altar (fires evt_archive_seal_weakened)
Step 2: Mage must read the revealed inscription (fires evt_archive_code_learned, grants secret_archive_code)
Step 3: Thief must open the inner lock using the code (fires evt_archive_open)
```

---

## 11. Traps & Environmental Danger

### Trap Taxonomy

**Punishing Traps**: Deal damage, apply status, or create dangerous consequences. The goal is resource pressure and consequence for careless play.
- Spike pit (floor tile, Blinded + Bleeding on fall)
- Poison needle (container, Poisoned on loot without detection)
- Fire jet (wall trigger, Burning + area denial for 3 turns)
- Alarm wire (alerts nearby enemies, triggers a spawn event)

**Puzzle Traps**: Can be navigated around, disabled, or converted to advantage.
- Pressure plate grid (visible if Thief in party; can be deactivated at a panel, or pattern-navigated)
- Collapsing floor section (requires weight distribution — split party across tiles)
- Magical ward (Mage can redirect it to a different trigger condition)
- Falling block (can be jammed with right inventory item)

**Hybrid Traps**: Punishing if triggered carelessly, puzzle-like if approached deliberately.
- Gas vent: triggers Poisoned on entry, but can be detected and disabled, or traversed with an item (sealed helm)
- Rune ward: deals Burning damage on trigger, but Mage can read the rune to learn its dismissal word

### Detection
- Thief passive: reveals traps within 3 tiles on HUD
- Active search: any character can use "Search" action on adjacent tiles to reveal traps (slower, less reliable)
- Mage Detect Magic: reveals magical traps with a visual indicator
- Trap objects are stored in the map definition; the engine manages visibility state

### Environmental Dangers

| Hazard | Effect | Counter |
|---|---|---|
| Darkness | Imposes Blinded, limits map visibility | Torch, Lantern, Mage Light spell |
| Deep Water | Impassable without Swim ability or boat | Item grant or class unlock |
| Extreme Cold | HP drain per turn in affected zones | Warm Cloak item, Cleric Warmth |
| Toxic Miasma | Gradual Poison in zone | Sealed Helm, Cleric Purify |
| Unstable Ground | Chance of collapse per turn spent | Move quickly (Thief dash), avoid |
| Flooding (scripted) | Rising water tiles, increases impassable area | Event-based — escape trigger |
| Cursed Ground | Status effects, morale penalties | Cleric Consecrate |

---

## 12. Day/Night Cycle & Weather

### Time System
- One game turn = 10 minutes of in-world time
- 144 turns per full day (24 hours)
- Time of day states: `dawn` (turns 0–12), `morning` (13–36), `noon` (37–60), `afternoon` (61–84), `dusk` (85–96), `evening` (97–108), `night` (109–132), `midnight` (133–144 → 0)
- Time advances automatically during travel and exploration; combat turns do not advance time (optional campaign setting)

### Visual Day/Night
- A lighting overlay layer (Canvas globalCompositeOperation: `multiply`) shifts from bright/none (noon) to deep amber/blue (dusk/dawn) to near-black with torch-radius cutouts (night)
- Torch and lantern items create visible radii of warm light at night
- Interior locations default to their own `ambient_light` setting

### NPC Response to Time
- NPC schedules move them between positions (home, work, patrol, sleep)
- Some NPCs are only available at specific times (the night fence, the dawn-patrol captain)
- Some events only trigger at specific times (the ritual at midnight, the merchant who only speaks at dusk)

### Weather System
Weather state is a persistent world variable, changed by the scripting engine or by campaign-defined random weather tables per region.

| Weather State | Visual Effect | Gameplay Effect |
|---|---|---|
| `clear` | No overlay | None |
| `overcast` | Slightly dimmed, flat light | None |
| `rain` | Particle rain layer, puddles on road tiles | Extinguishes exposed torches; NPC schedules shift |
| `heavy_rain` | Dense particles, lightning flashes | Reduced visibility (6-tile radius clamp), movement slow on dirt tiles |
| `fog` | Low-opacity white overlay, visibility radius 5 tiles | Enemy detection range reduced; overworld navigation harder |
| `snow` | Particle snow, white terrain tint | Tracks visible (Thief advantage), movement cost +1 on most terrain |
| `blizzard` | Heavy snow + wind particles | Visibility 4 tiles; impassable high-altitude tiles become dangerous |
| `storm` | Rain + lightning + wind | Random lightning events can interact with metal objects/tall structures |

Weather transitions smoothly between states using a blend parameter (0–1 alpha on the weather layer).

---

## 13. Music & Mood System

### Design Approach
No custom engine required. The mood system is a state machine built on the Web Audio API, managing a library of audio stems. Mood is a composite of four inputs: location profile, time of day, weather state, and active event flags.

### Mood States
| Mood | Description | Typical Context |
|---|---|---|
| `peaceful` | Warm, open, exploratory | Town in daylight, safe overworld |
| `mysterious` | Sparse, unresolved tension | Ruins, foggy areas, unknown territory |
| `tense` | Building unease | Dungeon exploration, night travel, hostile zone |
| `danger` | Active threat feeling | Near enemies, alarm triggered, countdown event |
| `combat` | Full tactical energy | Combat arena active |
| `melancholy` | Reflective, sad | Post-loss scenes, haunted locations |
| `triumphant` | Resolution, victory | Major story beat complete, combat won |
| `sacred` | Reverent, otherworldly | Temples, divine encounters |
| `dread` | Deep unease | Horror moments, cursed locations |

### Layered Stem Architecture
Each mood is a set of stems (looping audio files):
- `base`: Always playing when mood is active (ambient pad, rhythm bed)
- `tension`: Crossfades in when within a flagged zone or at night
- `melody`: Crossfades in for areas with higher peace/presence
- `stinger`: One-shot non-looping, fires on significant events (discovery, death, revelation)

Stems crossfade over 4 seconds. No hard cuts except on `screen_fade` transitions.

### Mood Resolution (Priority Order)
1. Active event flag overrides (highest priority — a `set_music_mood` event action overrides everything)
2. Combat state (combat mood active whenever tactical arena is open)
3. Location music profile (each map defines its base mood and any conditional overrides)
4. Time of day modifier (night shifts peaceful→mysterious, tense→dread)
5. Weather modifier (heavy rain shifts all moods toward tense/mysterious)
6. Default (peaceful)

### Campaign Music Config
```json
{
  "music_profile_id": "dungeon_tense",
  "base_mood": "tense",
  "stems": {
    "base": "audio/dungeon_base.ogg",
    "tension": "audio/dungeon_tension.ogg",
    "melody": null
  },
  "time_of_day_overrides": {
    "night": "dread",
    "midnight": "dread"
  },
  "weather_overrides": {
    "storm": "danger"
  },
  "event_flag_overrides": [
    { "flag_id": "flag_dungeon_boss_awakened", "override_mood": "danger" }
  ]
}
```

---

## 14. Art Asset Specification

**All assets are pixel art. All tiles are 32×32 pixels. Sprite sheets follow a defined grid layout. Color palette: maximum 256 colors, warm-earth Ultima-inspired tones. No anti-aliasing. No gradients within sprites (dithering acceptable). Top-down orthographic perspective.**

These specifications are designed to be passed directly to an AI art generation system.

---

### 14.1 Terrain Tiles (32×32, tilesheet format)

**Prompt structure for each**: *"Top-down pixel art RPG terrain tile, 32×32 pixels, warm earth-tone palette, Ultima VI/VII style, [description], no anti-aliasing, seamlessly tileable, orthographic view from directly above"*

| Asset ID | Description | Notes |
|---|---|---|
| `terrain_grass_base` | Medium green grass, slight texture variation | Seamless, 4 variants |
| `terrain_grass_dark` | Darker grass, denser, shadowed | Forest floor |
| `terrain_dirt_path` | Packed earth, tan-brown, foot-worn | Road tile |
| `terrain_cobblestone` | Grey-brown fitted stone | Town road, castle floor |
| `terrain_stone_floor` | Smooth cut grey stone | Dungeon/castle interior |
| `terrain_wood_floor` | Warm brown horizontal planks | Inn, ship interior |
| `terrain_sand` | Pale sandy grain texture | Desert, beach |
| `terrain_snow` | White-blue soft snow layer | Winter biome |
| `terrain_water_shallow` | Blue-green, transparent, rippled | Coast, ford |
| `terrain_water_deep` | Dark blue, animated shimmer (3 frames) | Ocean, lake |
| `terrain_lava` | Orange-red molten, animated glow (4 frames) | Volcanic dungeon |
| `terrain_swamp` | Dark muddy green, murky | Swamp biome |
| `terrain_cave_floor` | Dark grey rough stone | Cave/mine |
| `terrain_ice` | Pale blue reflective flat | Tundra interior |
| `terrain_cliff_face` | Brown-grey vertical rock face | Mountain wall tile |
| `terrain_mountain_peak` | Dark grey rough peak | Impassable summit |

---

### 14.2 Structural Tiles (32×32)

**Prompt prefix**: *"Top-down pixel art RPG structural tile, 32×32 pixels, Ultima VI/VII style, [description], no anti-aliasing, orthographic top-down view"*

| Asset ID | Description | Notes |
|---|---|---|
| `struct_wall_stone_ns` | North-south stone wall segment | Stone dungeon |
| `struct_wall_stone_ew` | East-west stone wall segment | |
| `struct_wall_stone_corner_nw` | Northwest corner, stone | |
| `struct_wall_stone_corner_ne` | Northeast corner, stone | |
| `struct_wall_stone_corner_sw` | Southwest corner, stone | |
| `struct_wall_stone_corner_se` | Southeast corner, stone | |
| `struct_wall_wood_ns` | North-south wooden wall | Cabin, inn |
| `struct_wall_wood_ew` | East-west wooden wall | |
| `struct_door_closed_n` | Closed wooden door, north-facing | 2 state: open/closed |
| `struct_door_open_n` | Open wooden door, north-facing | |
| `struct_door_locked_n` | Locked door, iron banding visible, north-facing | Distinct visual from unlocked |
| `struct_door_stone_closed` | Stone door, sealed, ancient | |
| `struct_door_iron` | Iron portcullis, up/down states | Dungeon/castle |
| `struct_stairs_down` | Stone stairs descending, top-down view | |
| `struct_stairs_up` | Stone stairs ascending, top-down view | |
| `struct_ladder` | Wooden ladder leaning, top-down reads as vertical | |
| `struct_window_n` | Wooden window frame, shuttered, north wall | |
| `struct_window_open_n` | Open window frame | |

---

### 14.3 Object / Furniture Sprites (32×32, placed on Layer 2/5)

| Asset ID | Description |
|---|---|
| `obj_chest_closed` | Wooden treasure chest, closed, iron banding |
| `obj_chest_open` | Same chest, open, empty interior visible |
| `obj_chest_locked` | Chest with visible padlock |
| `obj_barrel` | Wooden barrel, standing upright |
| `obj_barrel_cluster` | Two-three barrels grouped |
| `obj_crate` | Wooden shipping crate |
| `obj_bookshelf` | Tall bookshelf, spines visible, top-down foreshortened |
| `obj_table_small` | Small square wooden table |
| `obj_table_large` | Larger rectangular table (2×1 tile) |
| `obj_chair_n` | Simple wooden chair, facing north |
| `obj_chair_s` | Chair facing south |
| `obj_bed` | Single bed, pillow and blanket, top-down |
| `obj_fireplace` | Stone hearth, animated flame (3 frames) |
| `obj_torch_wall` | Wall-mounted torch, animated flame (3 frames) |
| `obj_lantern_floor` | Floor lantern, soft glow |
| `obj_altar` | Stone altar, top surface visible |
| `obj_altar_sacred` | Altar with candles and cloth, glowing |
| `obj_altar_corrupted` | Altar with dark staining, ominous rune |
| `obj_cauldron` | Iron cauldron, bubbling (2 frames) |
| `obj_well` | Stone well, rope and bucket |
| `obj_gravestone` | Simple carved gravestone |
| `obj_gravestone_ornate` | Ornate gravestone with carved relief |
| `obj_tree_deciduous` | Round-canopy tree, top-down, green |
| `obj_tree_conifer` | Pointed canopy tree, dark green |
| `obj_tree_dead` | Bare branching dead tree |
| `obj_rock_small` | Single grey-brown rock |
| `obj_rock_cluster` | 3-rock cluster |
| `obj_bush` | Low green shrub |
| `obj_flower_patch` | Small wildflower cluster |
| `obj_bridge_ns` | Wooden bridge, north-south |
| `obj_bridge_ew` | Wooden bridge, east-west |
| `obj_sign_post` | Wooden signpost, blank face |
| `obj_pressure_plate` | Stone floor with recessed square plate |
| `obj_pressure_plate_active` | Same, depressed, slightly different shade |
| `obj_lever_up` | Iron lever in up position |
| `obj_lever_down` | Iron lever in down position |
| `obj_statue_warrior` | Stone warrior statue, foreshortened top view |
| `obj_statue_deity` | Robed deity statue |
| `obj_pillar` | Single stone column, circular top view |
| `obj_portcullis_up` | Iron portcullis raised |
| `obj_portcullis_down` | Iron portcullis lowered |
| `obj_trap_spike_hidden` | Flush floor tile (visually identical to stone floor) |
| `obj_trap_spike_triggered` | Same tile, spikes extended |
| `obj_trap_wire` | Nearly invisible thin wire across tile gap |

---

### 14.4 Character Sprites

**Format**: Each character has a 96×128 sprite sheet. 4 rows (N/S/E/W facing), 3 columns (idle, step-left, step-right). Each frame 32×32.

**Prompt prefix**: *"Top-down pixel art RPG character sprite, 32×32 pixels per frame, Ultima VI/VII art style, [description], 4-directional walk cycle sprite sheet (north/south/east/west rows, 3 frames each: idle, step left, step right), warm earth palette, no anti-aliasing"*

| Asset ID | Description |
|---|---|
| `char_fighter_m` | Male Fighter, plate armor, sword at side |
| `char_fighter_f` | Female Fighter, plate armor, sword at side |
| `char_mage_m` | Male Mage, robes, staff |
| `char_mage_f` | Female Mage, robes, staff |
| `char_thief_m` | Male Thief, dark leather, hood |
| `char_thief_f` | Female Thief, dark leather, hood |
| `char_cleric_m` | Male Cleric, vestments, holy symbol |
| `char_cleric_f` | Female Cleric, vestments, holy symbol |

**NPC Archetypes** (same sheet format):

| Asset ID | Description |
|---|---|
| `npc_townsperson_farmer` | Simple rural clothing, both genders (2 sheets) |
| `npc_townsperson_merchant` | Apron, purse at belt |
| `npc_townsperson_noble` | Fine clothing, jewelry |
| `npc_townsperson_child` | Shorter sprite, simple clothes |
| `npc_guard_light` | Chainmail, spear |
| `npc_guard_heavy` | Full plate, halberd |
| `npc_soldier_enemy` | Dark armor, faction colors |
| `npc_innkeeper` | Apron, welcoming posture |
| `npc_priest` | Robes, holy symbol |
| `npc_old_man` | Elderly, walking staff |
| `npc_old_woman` | Elderly, simple dress |
| `npc_scholar` | Robes, book under arm |
| `npc_blacksmith` | Leather apron, hammer |

---

### 14.5 Enemy Sprites

**Format**: Facing-based sprite sheet, same 4×3 format as characters. Larger enemies use 48×48 or 64×64 base frames (noted).

| Asset ID | Description | Frame Size |
|---|---|---|
| `enemy_skeleton_warrior` | Animated skeleton, rusted armor, sword | 32×32 |
| `enemy_skeleton_archer` | Skeleton, shortbow | 32×32 |
| `enemy_zombie` | Shambling corpse, ragged clothes | 32×32 |
| `enemy_ghost` | Translucent wispy humanoid, slight glow | 32×32 |
| `enemy_wolf` | Grey wolf, four-legged, hunched | 32×32 |
| `enemy_giant_rat` | Large rat, aggressive posture | 32×32 |
| `enemy_goblin` | Small green humanoid, crude weapon | 32×32 |
| `enemy_orc_warrior` | Large grey-green humanoid, axe | 32×32 |
| `enemy_orc_shaman` | Orc in ritual garb, staff | 32×32 |
| `enemy_bandit` | Hooded human, short sword | 32×32 |
| `enemy_bandit_crossbow` | Hooded human, crossbow | 32×32 |
| `enemy_cultist` | Robed figure, dagger, symbol on chest | 32×32 |
| `enemy_golem_stone` | Roughly humanoid stone construct | 48×48 |
| `enemy_troll` | Large warty green creature, club | 48×48 |
| `enemy_dragon_young` | Quadruped, wings folded, 3-frame animated breath attack | 64×64 |
| `enemy_wraith` | Dark wispy entity, no legs, animated tendrils | 32×32 |

---

### 14.6 Portrait Assets (UI)

**Format**: 64×64 pixel portrait, square frame, pixel art.

**Prompt prefix**: *"Top-down pixel art RPG character portrait, 64×64 pixels, bust shot from slight above-angle, [description], warm earth palette, framed within a stone/wood border element, Ultima/Gold Box RPG style"*

One portrait per player class (male/female), one per major NPC archetype. Total: ~30 portraits.

---

### 14.7 UI Elements

| Asset ID | Description | Size |
|---|---|---|
| `ui_portrait_frame` | Stone-carved frame for character portrait | 72×72 |
| `ui_inventory_slot` | Square recessed slot for item | 36×36 |
| `ui_inventory_slot_hover` | Hover state for slot | 36×36 |
| `ui_dialogue_box` | Main dialogue container, parchment texture | 640×120 |
| `ui_dialogue_arrow` | Continuation indicator (animated bounce) | 12×8 |
| `ui_menu_bg` | Panel background, stone/wood border | scalable |
| `ui_button_normal` | Standard action button face | 120×28 |
| `ui_button_hover` | Hover state | 120×28 |
| `ui_button_disabled` | Disabled/unavailable state | 120×28 |
| `ui_hp_bar_fill` | Health bar fill (red gradient) | 1×8 (tiled) |
| `ui_hp_bar_bg` | Health bar background | 1×8 (tiled) |
| `ui_mp_bar_fill` | Magic/resource bar fill (blue) | 1×8 (tiled) |
| `ui_status_icon_poison` | Status icon: Poisoned | 16×16 |
| `ui_status_icon_burn` | Status icon: Burning | 16×16 |
| `ui_status_icon_stun` | Status icon: Stunned | 16×16 |
| `ui_status_icon_slow` | Status icon: Slowed | 16×16 |
| `ui_status_icon_blind` | Status icon: Blinded | 16×16 |
| `ui_minimap_bg` | Minimap panel background | 128×128 |
| `ui_minimap_player` | Player position indicator dot | 4×4 |
| `ui_minimap_location` | Location marker (town, dungeon) | 6×6 |
| `ui_cursor_default` | Custom pixel cursor | 16×16 |
| `ui_cursor_interact` | Interact cursor (hand with glow) | 16×16 |
| `ui_cursor_attack` | Attack cursor (crossed swords) | 16×16 |
| `ui_turn_order_slot` | Combat turn strip character slot | 40×40 |
| `ui_turn_order_active` | Active turn indicator | 40×40 |

---

### 14.8 Item Icons (32×32 each, packed into icon sheet)

| Category | Examples |
|---|---|
| Weapons | Sword, axe, mace, shortbow, staff, dagger, spear, crossbow |
| Armor | Chainmail, plate, leather, robe, shield |
| Helmets | Iron helm, hood, circlet, bishop's mitre |
| Accessories | Ring (gold), ring (silver), amulet, charm, bracer |
| Consumables | Health potion (red vial), antidote (green vial), torch, ration |
| Key Items | Old key (iron), sealed letter, ancient tome, signet ring, map fragment |
| Materials | Ore lump, cloth bolt, leather strip, alchemical powder |
| Documents | Scroll (rolled parchment), book (leather cover), map (folded) |

---

### 14.9 Effect Sprites

**Format**: Animated sprite, 3–6 frames, looping or one-shot.

| Asset ID | Description | Frames |
|---|---|---|
| `fx_hit_slash` | White slash flash on target | 3, one-shot |
| `fx_hit_blunt` | Star-burst impact | 3, one-shot |
| `fx_hit_magic` | Purple-white sparkle burst | 4, one-shot |
| `fx_heal` | Green upward particles | 4, one-shot |
| `fx_poison_cloud` | Green-grey puff | 4, looping |
| `fx_fire_small` | Small flame on tile (burning status) | 4, looping |
| `fx_fire_large` | Larger environmental flame | 4, looping |
| `fx_magic_bolt` | Small white-blue projectile | 3, directional |
| `fx_barrier` | Blue-white translucent wall tile | 3, looping |
| `fx_turn_undead` | White radial burst from source | 5, one-shot |
| `fx_consecrate` | Gold light spreading outward | 5, one-shot |
| `fx_secret_discover` | Gold sparkle shimmer on tile | 4, one-shot |
| `fx_level_transition` | Screen edge vignette (animated) | transition |
| `fx_torch_radius` | Warm orange radial gradient | static, composited |
| `fx_shadow_step` | Dark smoke puff on departure tile | 3, one-shot |
| `fx_backstab` | Red-black flash | 3, one-shot |
| `fx_rain_particle` | Single rain drop | 2, looping (tiled) |
| `fx_snow_particle` | Single snowflake | 3, looping (tiled) |
| `fx_fog_overlay` | Soft white drifting texture | 4, looping |
| `fx_lightning_flash` | Full-screen white flash | 2, one-shot |

---

### 14.10 Overworld Location Markers (16×16, on overworld minimap layer)

| Asset ID | Description |
|---|---|
| `marker_town` | Small house silhouette, warm tone |
| `marker_dungeon` | Skull or dark archway |
| `marker_cave` | Dark opening shape |
| `marker_ruins` | Broken column |
| `marker_shrine` | Simple cross or starburst |
| `marker_castle` | Tower silhouette |
| `marker_camp` | Tent shape |
| `marker_ship` | Boat shape |
| `marker_unknown` | Question mark (undiscovered location) |

---

*End of Document — Version 0.1*
*All systems are engine-level definitions. Campaign behavior is defined by config files conforming to the schemas defined herein. No campaign-specific content is hardcoded.*
