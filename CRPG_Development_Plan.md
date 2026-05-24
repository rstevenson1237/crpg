# CRPG Engine — Phased Development Plan
**20 Phases | Coding Agent · Asset Generation · General AI**

---

## How to Use This Document

Each phase contains:
- **Type**: Who executes it — `Coding Agent`, `Asset Generation`, or `General AI`
- **Dependencies**: Phases that must be complete before starting
- **Prompt**: Ready to paste into the appropriate AI tool
- **Verification Tasks**: Concrete, testable completion criteria

Phases 1–15 are coding. Phases 16–18 are art generation. Phases 19–20 are campaign design and integration. Art generation phases can run in parallel with coding phases — they have no code dependencies.

---

## Phase 1 — Project Scaffold & Core Renderer
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: None

### Prompt
```
You are building a browser-based top-down CRPG engine in vanilla HTML5/JavaScript.
No frameworks, no build tools. A single index.html with modular JS files loaded as ES modules.

Create the foundational project structure and core rendering engine with these exact specifications:

PROJECT STRUCTURE:
/index.html           - Entry point, loads engine
/engine/
  renderer.js         - Canvas rendering engine
  camera.js           - Viewport/camera system
  spritesheet.js      - Sprite sheet loader and frame extractor
  input.js            - Keyboard and mouse input handler
  gameloop.js         - Main game loop (fixed-timestep logic, 60fps render)
/assets/
  tilesets/           - (empty, populated later)
  sprites/            - (empty, populated later)
/data/                - (empty, populated later)

RENDERER REQUIREMENTS:
- Primary canvas: 640×480 logical pixels
- Integer pixel scaling only: auto-detect best fit (2×, 3×, 4×) for the browser window
- Rendering layer stack (back to front), each a separate offscreen canvas composited in order:
    Layer 0: Terrain Base
    Layer 1: Terrain Detail
    Layer 2: Object Base
    Layer 3: Entity Shadows
    Layer 4: Characters & NPCs
    Layer 5: Object Overlay
    Layer 6: Weather Particles
    Layer 7: Lighting Overlay
    Layer 8: Effect Sprites
    Layer 9: UI Chrome
    Layer 10: Dialogue/Menu
    Layer 11: Transition Effects
- Each layer exposes: clear(), drawTile(tileId, x, y), drawSprite(sheet, frameX, frameY, x, y), drawRect(x, y, w, h, color, alpha)
- Lighting layer uses Canvas globalCompositeOperation 'multiply'
- Pixel art rendering: imageSmoothingEnabled = false on all contexts

CAMERA REQUIREMENTS:
- Tracks a target position (world tile coordinates)
- Soft centering with 8-frame lerp
- Clamps to map boundaries
- Exposes worldToScreen(tileX, tileY) and screenToWorld(pixelX, pixelY)
- Hard snap mode for instant repositioning (used on location transitions)

SPRITE SHEET REQUIREMENTS:
- Load image from URL, return a SpriteSheet object
- SpriteSheet.getFrame(col, row) returns ImageBitmap cropped to 32×32
- SpriteSheet.getAnimFrame(animDef, elapsedMs) returns current animation frame
- Animation definition: { frames: [[col,row], ...], fps: number, loop: boolean }

INPUT REQUIREMENTS:
- Track keydown/keyup state for WASD and arrow keys
- Track mouse position in screen pixels and world tile coordinates
- Track mousedown/mouseup/click events
- Expose: isKeyDown(key), getMouseTile(), onTileClick(callback)

GAME LOOP REQUIREMENTS:
- Fixed logic timestep: 100ms per tick (configurable)
- Render at 60fps, interpolate between ticks
- Expose: onTick(callback), onRender(callback), start(), stop()

Create a working demo in index.html that:
1. Fills the screen with a solid color background tile (flat green 32×32 squares in a grid)
2. Shows a white 32×32 placeholder rectangle as the "player" centered on screen
3. Player moves with WASD (one tile per keypress, not held)
4. Camera follows player
5. Console logs current tile position on each move

All code must be clean, well-commented, and export clearly named functions/classes.
```

### Verification Tasks
- [ ] Open `index.html` in a browser — canvas renders at correct scaled resolution
- [ ] Window resize auto-recalculates scale and re-centers canvas
- [ ] Player rectangle appears centered on screen
- [ ] WASD moves player one tile per press
- [ ] Camera follows player; player stays centered
- [ ] Console logs correct tile X/Y on every move
- [ ] No framework dependencies — confirmed by inspecting `index.html`
- [ ] All 12 layer canvases exist in renderer (confirm in DevTools)
- [ ] `worldToScreen` and `screenToWorld` return correct values for a known tile

---

## Phase 2 — Map Engine & Tile System
**Type**: Coding Agent
**Complexity**: Large
**Dependencies**: Phase 1

### Prompt
```
Continue building the CRPG engine from Phase 1. Add the map engine and tile system.

Add these files:
/engine/
  map.js              - Map loader, renderer, tile lookup
  tileset.js          - Tileset definition loader
  autotile.js         - Edge-matching autotile rules
/data/
  tilesets/           - Tileset JSON definitions
  maps/               - Map JSON files

MAP FILE FORMAT (implement a parser for exactly this schema):
{
  "map_id": string,
  "map_type": "overworld" | "town" | "dungeon" | "cave" | "ruin" | "castle" | "ship" | "shrine" | "wilderness_camp" | "set_piece",
  "display_name": string,
  "tileset": string,             // references a tileset definition file
  "width": number,               // in tiles
  "height": number,              // in tiles
  "floors": number,              // number of floors (1 = single level)
  "current_floor": number,       // active floor index (0-based)
  "ambient_light": "bright" | "dim" | "dark" | "pitch_black",
  "music_profile": string,
  "weather_enabled": boolean,
  "tiles": number[],             // flat array, width*height per floor, stacked floors sequentially
  "tile_detail": number[],       // Layer 1 detail tiles, same layout, 0 = empty
  "objects": [ ObjectDefinition ],
  "npcs": [],                    // populated in Phase 6
  "events": [],                  // populated in Phase 5
  "encounter_zones": []          // populated in Phase 13
}

TILESET DEFINITION FORMAT:
{
  "tileset_id": string,
  "image_path": string,          // path to tileset PNG (32×32 grid)
  "tile_width": 32,
  "tile_height": 32,
  "tiles": {
    "[tile_id]": {
      "passable": boolean,
      "transparent": boolean,    // for line-of-sight
      "animated": boolean,
      "animation_frames": number,
      "animation_fps": number,
      "movement_cost": number,   // 1 = normal, 2 = difficult, 999 = impassable
      "autotile_group": string | null,  // tiles in same group edge-match
      "tags": string[]           // e.g. ["water", "hazard", "road"]
    }
  }
}

OBJECT DEFINITION FORMAT (within map file):
{
  "object_id": string,
  "object_type": string,
  "tile_x": number,
  "tile_y": number,
  "floor": number,
  "facing": "north" | "south" | "east" | "west" | null,
  "sprite": string,              // sprite sheet id
  "passable": boolean,
  "interactable": boolean,
  "interaction_type": string | null,
  "state": string,               // e.g. "closed", "open", "locked", "broken"
  "requires_class": string[] | null,
  "requires_item": string | null,
  "requires_secret": string | null,
  "on_interact_event": string | null,
  "on_open_event": string | null
}

MAP ENGINE REQUIREMENTS:
- Load map JSON and its referenced tileset
- Render Layer 0 (terrain base) and Layer 1 (detail) from tile arrays
- Render Layer 2/5 objects sorted by Y position (painter's algorithm)
- Tile lookup: getTile(x, y, floor) returns tile definition
- isPassable(x, y, floor) respects tile and object passable flags
- getObjectAt(x, y, floor) returns object definition or null
- Floor switching: setFloor(index) re-renders all layers for the new floor
- Autotiling: tiles with the same autotile_group edge-match using a 4-neighbor bitmask to select the correct tile variant (implement standard RPG Maker-style 4-bit autotiling)

Visited tile tracking:
- Track which tiles the player has visited (Set of "x,y,floor" strings)
- Unvisited tiles: render at 0% (black)
- Visited but not currently visible: render at 40% saturation
- Currently visible (within 10 tiles of player): render at 100%

Create a sample map file at /data/maps/test_town.json:
- 40×30 tiles
- map_type: "town"
- Mix of grass terrain, a cobblestone road running east-west through center, and a 6×4 stone-walled building with a door on the south wall
- One locked chest object inside the building
- Use placeholder tile IDs (integers 0–10) — real art assets come in Phase 16

Create a sample tileset at /data/tilesets/tileset_test.json:
- Define tile IDs 0–10 with appropriate passable/movement_cost values
- Use a single flat-color test PNG (generate it procedurally via Canvas if no image exists)

Update index.html demo:
- Load test_town.json and render it
- Player navigates the town, respecting collision
- Visited tile fog-of-war active
- Floor transitions not yet tested (no multi-floor map in this phase)
```

### Verification Tasks
- [ ] `test_town.json` renders: grass visible, road visible, building walls solid
- [ ] Player cannot walk through wall tiles or the closed chest object
- [ ] Player can walk through the door opening
- [ ] Fog of war: unvisited tiles render black; visited tiles dim; visible tiles full color
- [ ] Object renders at correct Y-sorted position (chest appears inside building)
- [ ] `getTile(x, y, 0)` returns correct definition for a known coordinate
- [ ] `isPassable()` returns false for wall tile, true for grass
- [ ] `getObjectAt()` returns chest object at its defined coordinates
- [ ] Autotile bitmask correctly selects edge variants for road tiles adjacent to grass
- [ ] No rendering artifacts at map boundaries (camera clamps correctly)

---

## Phase 3 — Character Sprites, Movement & Party System
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: Phases 1, 2

### Prompt
```
Continue building the CRPG engine. Add the character animation system, party management, and refined movement.

Add these files:
/engine/
  character.js        - Character definition, stats, state
  party.js            - Party management (members, lead, roster)
  movement.js         - Turn-based movement, collision, interaction detection

CHARACTER DEFINITION FORMAT:
{
  "character_id": string,
  "display_name": string,
  "class_id": string,
  "sprite_sheet": string,        // path to 96×128 sprite sheet (4 directions × 3 frames)
  "portrait": string,            // path to 64×64 portrait PNG
  "base_stats": {
    "hp": number, "max_hp": number,
    "speed": number,
    "attack": number,
    "defense": number,
    "magic": number
  },
  "stat_bonuses": {},            // from equipment/progression
  "abilities_unlocked": string[],
  "equipment": {
    "weapon": null, "off_hand": null, "armor": null,
    "helm": null, "accessory_1": null, "accessory_2": null
  },
  "status_effects": [],
  "use_tracked_skills": {},
  "position": { "map_id": string, "tile_x": number, "tile_y": number, "floor": number }
}

SPRITE SHEET LAYOUT (96×128 total, 32×32 frames):
- Row 0: Facing South (toward camera) — frames: idle, step-left, step-right
- Row 1: Facing North (away from camera) — frames: idle, step-left, step-right
- Row 2: Facing East — frames: idle, step-left, step-right
- Row 3: Facing West — frames: idle, step-left, step-right

ANIMATION REQUIREMENTS:
- Walking: alternate step-left / step-right frames during movement, return to idle when stopped
- Idle breathe: after 2 seconds stationary, cycle between frame 0 and a subtle offset (implement as 2-frame idle sub-animation)
- Animation state machine: idle | walking | interacting | combat (combat used in Phase 10)
- All 4 party members render on Layer 4, sorted by Y (painter's algorithm)
- Non-lead party members: render 1 tile behind leader in a follow chain (each member follows the member ahead with 1-tile delay using a position history queue)

PARTY SYSTEM:
- Party has: active_members[] (max defined by game state, starts at 1), roster[] (all known party members), lead_index (which member the player controls)
- Party.addMember(characterDef) — adds to active if below max, else roster
- Party.removeMember(characterId) — moves to roster
- Party.setMax(n) — called by events to expand/contract party size
- Party.setLead(characterId) — changes who the player directly controls
- Party position: lead member is at tile (x,y); followers trail in formation
- Expose Party.getLeadPosition() → {tile_x, tile_y}

MOVEMENT REQUIREMENTS:
- Input: WASD/arrow keys. One tile per keypress. Brief 150ms cooldown between moves.
- Movement is always 4-directional (no diagonals)
- Before moving: check isPassable() on destination tile AND no object with passable:false there
- On successful move: update party positions, camera lerp to new lead position, increment game turn counter by 1
- On move into an interactable object or NPC: do not move, instead trigger interaction prompt ("Press E to interact" tooltip appears near object)
- Press E: fire interaction on the object/NPC the party is facing
- Facing direction: character faces the direction of last attempted move (including failed moves into walls)

GAME TURN COUNTER:
- Global integer, starts at 0
- Increments by 1 on every successful tile move
- Exposed as GameState.currentTurn
- Will be used by the Events engine in Phase 5

Create placeholder character data:
- One Fighter character with placeholder stats
- 2×2 colored rectangle as placeholder sprite (will be replaced in Phase 17)
- Character renders on the test_town map from Phase 2

HUD additions (Layer 9):
- Bottom-left: portrait frame (64×64 placeholder box) + character name + HP bar
- If party has multiple members: show up to 4 portrait slots in a row
- Current tile coordinates displayed top-right (debug, can be toggled with F1)
```

### Verification Tasks
- [ ] Fighter character renders on test_town map with correct facing direction
- [ ] Walk animation cycles during movement, returns to idle when stopped
- [ ] Idle breathe animation triggers after 2 seconds
- [ ] Party follow chain: add a second placeholder character; confirm it trails leader by 1 tile
- [ ] `Party.setMax(2)` allows two members; `setMax(1)` returns second to roster
- [ ] Attempted move into wall: character faces wall, does not move, turn does not increment
- [ ] Interaction prompt appears when facing an interactable object
- [ ] Press E while facing the locked chest: console logs "Interact: obj_chest_locked_01"
- [ ] `GameState.currentTurn` increments correctly — confirmed by logging after 5 moves
- [ ] HUD portrait bar renders at bottom-left (placeholder box + name + HP bar)
- [ ] F1 toggles tile coordinate debug overlay

---

## Phase 4 — Time System, Day/Night & Weather
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: Phase 3

### Prompt
```
Continue building the CRPG engine. Implement the time system, day/night lighting cycle, and weather system.

Add these files:
/engine/
  time.js             - Game time tracking and time-of-day states
  lighting.js         - Day/night lighting overlay (Layer 7)
  weather.js          - Weather state machine and particle system (Layer 6)

TIME SYSTEM:
- 1 game turn = 10 in-world minutes
- 144 turns per full day (24 hours)
- Time tracked as: GameTime.totalTurns (cumulative), GameTime.dayNumber, GameTime.turnOfDay (0–143)
- Time-of-day states (string constants):
    dawn:      turns 0–11
    morning:   turns 12–35
    noon:      turns 36–59
    afternoon: turns 60–83
    dusk:      turns 84–95
    evening:   turns 96–107
    night:     turns 108–131
    midnight:  turns 132–143
- GameTime.getState() → returns current state string
- GameTime.getHour() → 0–23 (for display)
- GameTime.getMinute() → 0, 10, 20, 30, 40, 50 (for display)
- GameTime.advance(turns) → advances time, fires time-change callbacks
- GameTime.onStateChange(callback) → callback fires when state changes (dawn→morning etc.)
- GameTime.skipToState(state) → advance turns until the next occurrence of that state

DAY/NIGHT LIGHTING (Layer 7, Canvas globalCompositeOperation: 'multiply'):
Lighting overlay is a full-viewport rectangle with color and opacity varying by time-of-day:
  dawn:      rgba(255, 200, 150, 0.25)  — warm early glow
  morning:   rgba(255, 255, 255, 0.0)   — no tint, full bright
  noon:      rgba(255, 255, 255, 0.0)   — no tint
  afternoon: rgba(255, 240, 200, 0.1)   — very slight warm
  dusk:      rgba(255, 160, 80, 0.35)   — amber dusk
  evening:   rgba(80, 60, 120, 0.5)     — purple-blue dusk
  night:     rgba(10, 10, 40, 0.72)     — near-dark, deep blue
  midnight:  rgba(0, 0, 20, 0.82)       — darkest

Interpolate smoothly between states using lerp on the RGBA values as turns tick.

TORCH/LANTERN RADII (night and midnight only):
- Characters with a torch or lantern item (item tag: "light_source") emit a radius
- Render a radial gradient (warm orange, transparent at edge) centered on the character
- Radius: torch = 4 tiles, lantern = 6 tiles
- Use globalCompositeOperation 'lighter' on a separate dark mask canvas
- Outside all light radii at night: tiles render through the dark mask (80% black)

Interior maps: if map.ambient_light is set, use that value instead of time-of-day:
  "bright"      → no overlay
  "dim"         → rgba(0,0,0,0.3) static
  "dark"        → rgba(0,0,0,0.65) static + torch radii apply
  "pitch_black" → rgba(0,0,0,0.95) static + torch radii apply

WEATHER SYSTEM (Layer 6):
Weather is a global state. States: "clear", "overcast", "rain", "heavy_rain", "fog", "snow", "blizzard", "storm"

Weather.setState(state) — transitions to new state over 3 seconds
Weather.getState() → current state string
Weather.update(deltaMs) — called each render frame to advance particles

Per-state particle and overlay behavior:
  clear:       no overlay, no particles
  overcast:    rgba(200,200,220,0.08) static overlay, no particles
  rain:        vertical falling particles (blue-grey, 1px wide, 8px tall, randomized speed/position)
               density: 200 particles across viewport
  heavy_rain:  same as rain, density 400, darker, add occasional lightning flash (full-screen white, 50ms)
               reduce visibility: clamp render distance to 6 tiles (darken beyond)
  fog:         layered white overlay planes scrolling slowly (2 layers at different speeds)
               opacity: 0.35, reduce render distance to 5 tiles
  snow:        white dot particles (2px), slow fall, slight horizontal drift
               density: 150 particles
  blizzard:    snow density 400, fast horizontal wind drift, reduce render distance to 4 tiles
  storm:       heavy rain + lightning every 8–15 seconds (random interval) + wind sound flag

Particles are pooled (pre-allocate 500 particle objects, reuse by wrapping at bottom of screen).

WEATHER GAMEPLAY EFFECTS (flags only — actual gameplay in later phases):
Weather.hasEffect(effect) → boolean
Effects to flag: "extinguishes_torches", "reduces_visibility", "slows_movement_on_dirt"

HUD addition:
- Top-right corner: small clock display showing HH:MM (in-world time), day number
- Small weather icon (text placeholder: "☀" "🌧" "❄" etc. — real icons in Phase 18)

Demo update:
- Cycle through all time states rapidly with a key (press T to advance 12 turns)
- Press W to cycle through weather states
- Confirm lighting overlay changes visually
- Confirm particle system runs smoothly
```

### Verification Tasks
- [ ] `GameTime.getState()` returns correct state string for known turn counts
- [ ] `GameTime.getHour()` returns 0–23 correctly across a full day cycle
- [ ] Press T repeatedly: lighting overlay visibly transitions through all day states
- [ ] Night state: dark blue overlay clearly dims the screen
- [ ] Torch radius: equip a placeholder "torch" item on player → warm radial glow appears at night
- [ ] Outside torch radius at night: tiles are nearly black (dark mask working)
- [ ] Interior map with `ambient_light: "dark"`: night-level darkness regardless of time
- [ ] Press W: rain particles appear, fall smoothly, no performance drop
- [ ] Heavy rain: lightning flash triggers occasionally
- [ ] Fog: white overlay scrolls slowly, creates atmospheric layering
- [ ] Snow: particles drift horizontally, wrap at bottom correctly
- [ ] Clock HUD shows correct HH:MM as turns advance
- [ ] `Weather.hasEffect("extinguishes_torches")` returns true during storm
- [ ] No frame drops during heavy_rain + night overlay simultaneously (confirm 60fps in DevTools)

---

## Phase 5 — Events & Scripting Engine
**Type**: Coding Agent
**Complexity**: Extra Large
**Dependencies**: Phases 3, 4

### Prompt
```
Continue building the CRPG engine. This phase implements the Events and Scripting Engine — the most critical system in the engine. Everything that is not pure rendering flows through this system.

Add these files:
/engine/
  events.js           - Event registry, trigger evaluation, action executor
  flags.js            - World flag and variable store
  gamestate.js        - Central game state (combines turn counter, flags, secrets, faction)

WORLD FLAG & VARIABLE STORE (flags.js):
- Flags: named booleans. Flags.set(id), Flags.clear(id), Flags.isSet(id) → boolean
- Variables: named values (integer or string). Vars.set(id, value), Vars.get(id), Vars.increment(id, amount)
- All flags and variables must serialize to JSON for save/load (Phase 16)

GAME STATE (gamestate.js):
Singleton. Exposes:
  GameState.currentTurn          — integer, incremented by movement
  GameState.party                — Party object from Phase 3
  GameState.flags                — Flags store
  GameState.vars                 — Vars store
  GameState.secrets              — Set of known secret IDs
  GameState.factions             — Map of faction_id → standing (0–100)
  GameState.currentMap           — currently loaded map
  GameState.worldLog             — array of { turn, text } log entries
  GameState.addSecret(id)        — adds to secrets set
  GameState.hasSecret(id)        — boolean
  GameState.modifyFaction(id, delta) — clamp 0–100
  GameState.getFactionStanding(id)   — 0–100

EVENT FILE FORMAT (implement a parser and executor for this schema exactly):
{
  "event_id": string,
  "event_label": string,
  "trigger": TriggerDefinition,
  "conditions": ConditionDefinition[],   // all must pass (AND logic)
  "condition_join": "and" | "or",        // default "and"
  "actions": ActionDefinition[],
  "repeat": boolean,                     // if false (default), event fires once then marks complete
  "on_complete_fire_event": string | null,
  "priority": number                     // higher fires first when multiple trigger simultaneously
}

TRIGGER TYPES (implement all):

timeline:
  { "type": "timeline", "reference": "game_start" | "event_complete", "after_event": string | null, "delay_turns": number }
  { "type": "timeline", "at_time_of_day": string, "on_day": number | null }

location:
  { "type": "location_enter", "map_id": string }
  { "type": "location_exit", "map_id": string }
  { "type": "location_tile", "map_id": string, "tile_x": number, "tile_y": number, "trigger_radius": number }

action:
  { "type": "action", "action_kind": "npc_dialogue_completed", "npc_id": string, "dialogue_node_id": string }
  { "type": "action", "action_kind": "item_used", "item_id": string, "on_map_id": string | null }
  { "type": "action", "action_kind": "secret_discovered", "secret_id": string }
  { "type": "action", "action_kind": "object_interacted", "object_id": string }
  { "type": "action", "action_kind": "party_member_joins", "character_id": string }
  { "type": "action", "action_kind": "combat_complete", "encounter_id": string }

CONDITION TYPES (implement all):
  flag_is_set: { "flag_id": string }
  flag_not_set: { "flag_id": string }
  event_complete: { "event_id": string }
  event_not_complete: { "event_id": string }
  party_includes_class: { "class_id": string }
  party_has_item: { "item_id": string }
  variable_gte: { "variable_id": string, "value": number }
  variable_lte: { "variable_id": string, "value": number }
  variable_equals: { "variable_id": string, "value": string | number }
  time_of_day_is: { "time": string }
  weather_is: { "weather": string }
  secret_known: { "secret_id": string }
  faction_standing_gte: { "faction_id": string, "value": number }
  party_size_equals: { "size": number }
  map_is: { "map_id": string }

ACTION TYPES (implement all — most just set state or queue a follow-on system call):
  set_flag: { "flag_id": string }
  clear_flag: { "flag_id": string }
  set_variable: { "variable_id": string, "value": string | number }
  increment_variable: { "variable_id": string, "amount": number }
  grant_secret: { "secret_id": string }
  revoke_secret: { "secret_id": string }
  show_dialogue: { "npc_id": string, "dialogue_root_id": string }       // queues to Interaction engine (Phase 6)
  show_narration: { "text": string, "title": string | null }             // shows full-screen text card
  spawn_npc: { "npc_id": string, "map_id": string, "tile_x": number, "tile_y": number }
  despawn_npc: { "npc_id": string }
  add_party_member: { "character_id": string }
  remove_party_member: { "character_id": string }
  lock_party_member: { "character_id": string }
  unlock_party_member: { "character_id": string }
  grant_item: { "item_id": string, "quantity": number }
  remove_item: { "item_id": string, "quantity": number }
  grant_skill_unlock: { "character_id": string, "skill_id": string }
  modify_npc_schedule: { "npc_id": string, "schedule_override_id": string }
  modify_npc_faction_standing: { "faction_id": string, "delta": number }
  modify_map_tile: { "map_id": string, "tile_x": number, "tile_y": number, "new_tile_id": number }
  modify_map_object: { "object_id": string, "new_state": string }
  place_loot_cache: { "map_id": string, "tile_x": number, "tile_y": number, "loot_table_id": string }
  trigger_encounter: { "encounter_pool_id": string }
  add_world_log_entry: { "text": string }
  fire_event: { "event_id": string }
  set_music_mood: { "mood": string, "override_duration_turns": number | null }
  set_weather: { "weather": string }
  set_time_of_day: { "time": string }
  teleport_party: { "map_id": string, "tile_x": number, "tile_y": number }
  screen_fade: { "direction": "in" | "out", "color": string, "duration_ms": number }
  show_narration: { "title": string | null, "text": string }
  grant_mentor_training: { "mentor_id": string }

EVENT ENGINE CORE:
- Events.load(eventArray) — registers events from a JSON array
- Events.tick(currentTurn) — called every game turn; evaluates all timeline triggers
- Events.fireActionTrigger(kind, context) — called by other systems when an action occurs
- Events.checkLocationTriggers(mapId, tileX, tileY) — called on every party move
- Events.checkMapEnter(mapId) — called when a map loads
- Events.checkMapExit(mapId) — called when a map unloads
- Internal: evaluateConditions(event) → boolean
- Internal: executeActions(event) → executes each action in sequence
- Internal: markComplete(eventId) — records completion turn, prevents re-fire if repeat:false
- Event execution queue: if multiple events fire simultaneously, process by priority DESC

Create a test event file at /data/events/test_events.json with these events:
1. Timeline event: 10 turns after game_start, show_narration: "The sun has moved. Ten turns have passed."
2. Location_tile event: entering tile (20,15) on test_town shows narration: "You stand at the crossroads."
3. Action event: when object obj_locked_chest_01 is interacted, set_flag "chest_touched" and add_world_log_entry "Someone touched the chest."
4. Chain: event 3's on_complete_fire_event triggers a second event that shows narration: "The chest rattles."

Narration card UI (Layer 10):
- Full-screen dimmed background
- Centered card: title (optional) + text + "Press any key to continue"
- Animate in (fade + slide up, 300ms)
- Dismiss on any keypress, fire on_dismiss callback

World log: accessible by pressing L (toggle). Shows last 20 entries with turn numbers.
```

### Verification Tasks
- [ ] Wait 10 turns (10 WASD moves): narration card appears with correct text
- [ ] Narration card: background dims, text readable, dismiss on keypress
- [ ] Walk to tile (20,15): location_tile event fires, narration appears
- [ ] Interact with chest (E key): `flag_is_set("chest_touched")` returns true
- [ ] Chain event fires: "The chest rattles." narration appears after chest interaction
- [ ] `Events.fireActionTrigger("object_interacted", {object_id: "obj_locked_chest_01"})` triggers correctly when called directly from console
- [ ] `evaluateConditions` correctly blocks events when conditions are not met
- [ ] `condition_join: "or"` fires when only one of two conditions is met
- [ ] Event marked complete does not fire again (repeat: false)
- [ ] Press L: world log shows timestamped entries for each fired event
- [ ] `GameState.worldLog` array contains correct entries
- [ ] `screen_fade` action: screen fades to black and back (test by manually calling action executor)
- [ ] `modify_map_tile` action changes tile in map data (verify with `getTile()`)

---

## Phase 6 — NPC System, Schedules & Dialogue
**Type**: Coding Agent
**Complexity**: Large
**Dependencies**: Phases 3, 5

### Prompt
```
Continue building the CRPG engine. Implement the NPC system, NPC schedules, and branching dialogue engine.

Add these files:
/engine/
  npc.js              - NPC definitions, placement, rendering, schedule management
  dialogue.js         - Branching dialogue tree renderer and state machine

NPC DEFINITION FORMAT:
{
  "npc_id": string,
  "display_name": string,
  "class_id": string | null,
  "sprite_sheet": string,
  "portrait": string,
  "faction_id": string | null,
  "dialogue_root": string,       // default starting dialogue node ID
  "map_id": string,
  "tile_x": number,
  "tile_y": number,
  "floor": number,
  "facing": "north" | "south" | "east" | "west",
  "schedule": ScheduleEntry[],   // optional, overrides position/availability by time
  "tags": string[]               // e.g. ["merchant", "quest_giver", "guard"]
}

SCHEDULE ENTRY:
{
  "time_start": string,          // time-of-day state name
  "time_end": string,
  "position": { "tile_x": number, "tile_y": number } | null,
  "dialogue_root_override": string | null,
  "available": boolean           // false = NPC hidden/unreachable
}

NPC SYSTEM:
- NPCs.load(npcArray) — register NPCs from JSON
- NPCs.spawn(npcId, mapId, tileX, tileY) — place NPC on map
- NPCs.despawn(npcId) — remove from map
- NPCs.getAtTile(mapId, tileX, tileY) → NPC or null
- NPCs.update(gameTime) — apply schedule overrides based on current time-of-day
- NPCs render on Layer 4, Y-sorted with party members
- Facing direction: NPCs face toward the player when the player is adjacent
- NPCs block movement (are not passable) unless tagged "passthrough"
- NPCs have an interaction radius of 1 tile (adjacent in any of 4 directions)

DIALOGUE NODE FORMAT:
{
  "node_id": string,
  "speaker_id": string,          // npc_id or "party_lead"
  "speaker_portrait": string,    // portrait path
  "text": string,
  "on_enter_fire_event": string | null,   // fires when this node is displayed
  "options": DialogueOption[]
}

DIALOGUE OPTION FORMAT:
{
  "option_text": string,
  "target_node": string | null,   // null = close dialogue
  "visible_condition": ConditionDefinition | null,
  "enabled_condition": ConditionDefinition | null,   // shows but greyed out if not met
  "on_select_fire_event": string | null,
  "action": ActionDefinition | null   // immediate action on select (e.g. open_shop)
}

DIALOGUE ENGINE:
- Dialogue.open(npcId, rootNodeId) — starts a dialogue session
- Internally loads the dialogue tree JSON for the NPC
- Renders on Layer 10:
    - Bottom portion of screen (below game view)
    - Speaker portrait (left), speaker name, dialogue text
    - Options rendered as a vertical list of clickable buttons
    - Options with failed enabled_condition render greyed-out with a small lock icon
    - Options with failed visible_condition are hidden entirely
    - Text renders character-by-character at 40 chars/sec (can be skipped with Space)
- On option select: evaluate conditions, fire event if set, advance to target_node
- If target_node is null: close dialogue, fire Events.fireActionTrigger("npc_dialogue_completed", {npc_id, node_id})
- Dialogue history: track which nodes have been visited per NPC (persists in GameState)
- Re-visited nodes can optionally show abbreviated text (flag: "use_short_text_on_revisit": true)

DIALOGUE FILE FORMAT:
{
  "dialogue_id": string,
  "nodes": DialogueNode[]        // flat array, engine looks up by node_id
}

Create a sample NPC and dialogue tree at:
/data/npcs/test_npcs.json — one NPC "npc_town_elder" placed in test_town at (15, 10)
/data/dialogue/npc_town_elder.json — dialogue tree with:
  - Root node: greeting, two options: "Tell me about the fortress." / "Farewell."
  - Fortress branch: elder says something, then asks if player knows a secret
  - If secret "secret_warden_letter" is known (visible_condition): new option appears
  - Selecting secret option fires event "evt_elder_revelation" and closes dialogue
  - Farewell: closes dialogue

Add to test_events.json:
  - Action event: when "evt_elder_revelation" fires, grant_secret "secret_fortress_location"
    and add_world_log_entry "The elder revealed the fortress location."

Interaction flow:
  1. Player walks adjacent to elder
  2. "Press E to talk" prompt appears
  3. Player presses E → dialogue opens
  4. Player selects option → text advances
  5. Secret-gated option hidden until secret is known
```

### Verification Tasks
- [ ] Elder NPC renders on test_town map at correct position
- [ ] Elder faces toward player when player is adjacent
- [ ] Player cannot walk through elder (NPC blocks movement)
- [ ] Press E while adjacent: dialogue box opens
- [ ] Speaker portrait and name display correctly
- [ ] Text types out character by character; Space skips to full text
- [ ] Both dialogue options are visible and clickable
- [ ] Secret-gated option is hidden (no `secret_warden_letter` in GameState)
- [ ] Selecting "Farewell" closes dialogue correctly
- [ ] After closing: `Events.fireActionTrigger("npc_dialogue_completed", ...)` fires
- [ ] Manually call `GameState.addSecret("secret_warden_letter")` in console, re-open dialogue: secret option now visible
- [ ] Selecting secret option fires `evt_elder_revelation` → `grant_secret "secret_fortress_location"` executes
- [ ] `GameState.hasSecret("secret_fortress_location")` returns true after the above
- [ ] World log shows "The elder revealed the fortress location."
- [ ] Advance time past elder's schedule window (if schedule defined): elder moves to scheduled position
- [ ] `NPCs.despawn("npc_town_elder")` removes elder from map visually

---

## Phase 7 — Secrets, Factions & Journal UI
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: Phases 5, 6

### Prompt
```
Continue building the CRPG engine. Implement the full Secrets system, Faction standing system, and Journal UI.

Add these files:
/engine/
  secrets.js          - Secret registry and knowledge management
  factions.js         - Faction definitions and standing management
/ui/
  journal.js          - Journal panel UI (Layer 10 overlay)

SECRET DEFINITION FORMAT (in a secrets registry file):
{
  "secret_id": string,
  "secret_label": string,
  "secret_description": string,   // shown to player in journal
  "secret_type": "spatial" | "narrative" | "skill_gated" | "chained",
  "acquired_from": string | null, // npc_id or object_id or null
  "unlocks_map_marker": string | null,   // location ID to reveal on minimap
  "unlocks_dialogue_options": string[],  // dialogue node IDs that become available
  "enables_events": string[],            // event IDs whose conditions this secret satisfies
  "chains_to_secrets": string[]          // secret IDs that become discoverable after this one
}

SECRETS SYSTEM:
- Secrets.loadRegistry(secretsArray) — load all secret definitions
- Secrets.grant(secretId) — adds to GameState.secrets, fires grant callbacks, shows discovery notification
- Secrets.revoke(secretId) — removes from GameState.secrets
- Secrets.isKnown(secretId) → boolean
- Discovery notification: brief toast at top of screen ("Secret discovered: [label]") 2s then fades
- On grant: automatically reveal any map markers, log to world log

SPATIAL SECRET DETECTION:
- Hidden tiles: objects with interaction_type "hidden_passage" or "hidden_object"
- These objects are invisible (not rendered) unless secret_id is known OR player is adjacent AND presses E
- On successful find: grant the associated secret, modify_map_object to reveal it
- "Search" action: press S to search the currently faced tile
  - Costs 1 turn
  - Checks for hidden objects on that tile
  - If found: trigger discovery. If not: show brief "Nothing found here."

SKILL-GATED SECRETS:
- Objects and dialogue options can have "skill_gate": { "class_id": string, "secret_granted": string }
- If player's party includes that class, interacting grants the skill-gated secret automatically
- Non-class parties see a generic interaction result; class parties see a richer one

FACTION DEFINITIONS FORMAT:
{
  "faction_id": string,
  "faction_name": string,
  "description": string,
  "standing_labels": {
    "0": "Hostile",
    "20": "Unfriendly",
    "40": "Neutral",
    "60": "Friendly",
    "80": "Honored",
    "100": "Exalted"
  },
  "conflicts_with": string[],    // increasing standing here decreases these factions
  "conflict_ratio": number       // how much conflicting factions decrease per point gained
}

FACTION SYSTEM:
- Factions.load(factionArray) — register factions
- Factions.getStanding(factionId) → 0–100 (from GameState.factions, default 50)
- Factions.modify(factionId, delta) — adjusts standing, clamps 0–100, applies conflict penalties
- Factions.getLabel(factionId) → standing label string for current value
- Standing changes show a toast: "+5 Town Guard • Friendly" in appropriate color (green/red)

JOURNAL UI (press J to open/close, Layer 10 overlay):
Panel covers right 40% of screen, slides in from right.
Four tabs (click to switch):
  1. Secrets — list of all discovered secrets, grouped by type
     Each entry: label (bold) + description + "Discovered from: [source]"
     Undiscovered secrets not shown (player doesn't know what they don't know)
  2. Factions — list of all factions encountered
     Each entry: faction name + standing bar (color-coded) + label
     Factions with standing 50 and never-interacted-with: shown as "Unknown"
  3. World Log — scrollable reverse-chronological list of log entries
     Format: "Turn 042 — The elder revealed the fortress location."
  4. Party — summary of each party member: name, class, HP, equipped items (placeholder for now)

Journal is read-only. Closes on J or Escape.

Add to test data:
  /data/secrets/test_secrets.json — define "secret_warden_letter", "secret_fortress_location", "secret_hidden_cellar"
  /data/factions/test_factions.json — define "faction_town_guard" (conflicts with "faction_thieves_guild"), "faction_thieves_guild"
  Add a hidden object to test_town: a cellar door at tile (8,8), hidden, reveals "secret_hidden_cellar" on Search
```

### Verification Tasks
- [ ] Press J: Journal panel slides in from right
- [ ] Secrets tab: empty initially; after elder dialogue, "Secret Fortress Location" entry appears
- [ ] Discovery toast appears for 2 seconds on secret grant
- [ ] Press S facing tile (8,8): hidden cellar door discovered → secret granted → object becomes visible
- [ ] Skill-gated test: add Fighter to party, interact with a skill-gated object → richer result fires
- [ ] Factions tab: shows `faction_town_guard` with standing bar at 50 (Neutral)
- [ ] `Factions.modify("faction_town_guard", 15)` → standing becomes 65 → label shows "Friendly" → toast shows
- [ ] Faction conflict: modifying `faction_town_guard` by +10 reduces `faction_thieves_guild` by `conflict_ratio`
- [ ] World Log tab: entries appear in reverse-chronological order with correct turn numbers
- [ ] Secrets.grant() for a chained secret reveals the chain indicator in Journal
- [ ] Journal closes on Escape
- [ ] `Secrets.isKnown("secret_fortress_location")` returns true after grant
- [ ] Map marker revealed on minimap after granting `unlocks_map_marker` secret

---

## Phase 8 — Inventory, Equipment & Items
**Type**: Coding Agent
**Complexity**: Large
**Dependencies**: Phases 3, 5, 7

### Prompt
```
Continue building the CRPG engine. Implement the item system, inventory management, and equipment with progression hooks.

Add these files:
/engine/
  items.js            - Item registry and item definition loader
  inventory.js        - Party inventory management
  equipment.js        - Per-character equipment slots and stat resolution
/ui/
  inventory_ui.js     - Inventory and equipment panel UI

ITEM DEFINITION FORMAT:
{
  "item_id": string,
  "item_label": string,
  "item_type": "weapon" | "armor" | "helm" | "accessory" | "consumable" | "key_item" | "material" | "document" | "currency",
  "description": string,
  "icon": string,                         // icon sheet coordinates [col, row]
  "equip_slot": string | null,            // "weapon", "off_hand", "armor", "helm", "accessory_1", "accessory_2"
  "class_restriction": string[] | null,   // null = any class can equip
  "stat_modifiers": { "hp"?: number, "attack"?: number, "defense"?: number, "speed"?: number, "magic"?: number },
  "ability_grants": string[],             // ability IDs active while equipped
  "on_equip_grant_secrets": string[],     // secrets granted on equip
  "on_equip_fire_events": string[],       // events fired on equip
  "on_unequip_fire_events": string[],
  "on_use_action": ActionDefinition | null,   // consumable use action
  "on_read_grant_secret": string | null,      // document type: reading grants secret
  "on_read_fire_event": string | null,
  "skill_unlock_on_equip": string | null,     // permanently unlocks a skill on equip (one-time)
  "mentor_unlock_on_equip": string | null,    // unlocks a mentor interaction
  "consumable_on_use": boolean,               // if true, item removed after use
  "tradeable": boolean,
  "key_item": boolean,                        // key items cannot be dropped or sold
  "weight": number,                           // 0 = weightless (weight system optional per campaign)
  "tags": string[]                            // e.g. ["light_source", "magical", "weapon_sword"]
}

INVENTORY SYSTEM:
- Party-shared inventory
- Items.loadRegistry(itemArray) — load all item definitions
- Inventory.add(itemId, quantity) — adds items; key items go to a separate protected slot
- Inventory.remove(itemId, quantity) — removes; prevents removal of key_items
- Inventory.has(itemId, quantity?) → boolean
- Inventory.getAll() → array of { item_def, quantity }
- Inventory.use(itemId, characterId) — triggers on_use_action and consumable removal
- Inventory.read(itemId) — triggers on_read events (document type)
- Inventory.drop(itemId) — removes from inventory if not key_item

EQUIPMENT SYSTEM (per character):
Slots: weapon, off_hand, armor, helm, accessory_1, accessory_2
- Equipment.equip(characterId, itemId, slot) — validates class restriction, computes new stats
- Equipment.unequip(characterId, slot) — returns item to inventory
- Equipment.getEffectiveStats(characterId) → base_stats + all equipped stat_modifiers
- Equipment.getGrantedAbilities(characterId) → union of all equipped ability_grants
- On equip: fire on_equip_fire_events, grant secrets, one-time skill_unlock check (track in character.skill_unlocks_received)

LOOT TABLES:
{
  "loot_table_id": string,
  "entries": [
    { "item_id": string, "quantity_min": number, "quantity_max": number, "weight": number }
  ],
  "rolls": number   // how many random selections to make
}
- LootTables.roll(tableId) → array of { item_id, quantity } — weighted random selection

INVENTORY UI (press I to open/close, Layer 10):
Full-screen panel divided left/right:
  Left side — Inventory Grid:
    - 8×6 grid of 36×36 slots
    - Each slot shows item icon (32×32) + quantity badge if >1
    - Key items shown with golden border
    - Click item: shows detail panel (right side)
    - Right-click item: context menu (Equip / Use / Read / Drop / Examine)
  Right side — Character Equipment:
    - Portrait + name + class at top
    - Visual equipment slot layout (helm top, armor center, weapon left, off-hand right, two accessories bottom)
    - Each slot: shows equipped item icon or empty slot placeholder
    - Click equipped item: unequip
    - Stat block below: shows effective stats with bonuses highlighted in green
  Tab switching: if multiple party members, small portrait tabs at top let you switch between them

Create test item data at /data/items/test_items.json:
  - "item_torch": consumable, tag "light_source", weight 0, tradeable true
  - "item_iron_sword": weapon, Fighter/Ranger class restriction, +2 attack
  - "item_warden_signet": accessory, no class restriction, on_equip_grant_secrets ["secret_borven_connection"], +1 defense
  - "item_scroll_of_secrets": document, on_read_grant_secret "secret_thieves_guild_sigil", consumable_on_use true
  - "item_ancient_tome": document, key_item true, on_read_fire_event "evt_tome_read_revelation"

Add to test_town: a chest at (10,8) containing loot table "loot_table_test_chest"
Create loot_table_test_chest: 2 rolls from [iron_sword (w:3), torch (w:5), warden_signet (w:1)]
```

### Verification Tasks
- [ ] Open chest in test_town: loot table rolls, items appear in inventory
- [ ] Press I: inventory panel opens, items display in grid slots
- [ ] Right-click iron_sword: context menu shows; select Equip → appears in weapon slot
- [ ] Effective stats update: Fighter shows +2 attack after equipping iron_sword
- [ ] Trying to equip iron_sword on Mage (wrong class): action rejected, message shown
- [ ] Equip warden_signet: `GameState.hasSecret("secret_borven_connection")` becomes true
- [ ] Read scroll_of_secrets: secret granted, scroll removed from inventory (consumable)
- [ ] Read ancient_tome: `evt_tome_read_revelation` fires; tome remains (key_item: not consumable)
- [ ] Torch equipped/in inventory → lights up correctly at night (Phase 4 integration)
- [ ] Drop non-key item: removed from inventory
- [ ] Drop key_item (ancient_tome): rejected with message
- [ ] `LootTables.roll("loot_table_test_chest")` returns correct weighted distribution (test 20 times, verify warden_signet rare)
- [ ] Switch between party members in inventory UI: equipment slots update correctly

---

## Phase 9 — Classes, Abilities & Lock System
**Type**: Coding Agent
**Complexity**: Large
**Dependencies**: Phases 3, 8

### Prompt
```
Continue building the CRPG engine. Implement the class system, ability definitions, and the hard/soft lock interaction resolver.

Add these files:
/engine/
  classes.js          - Class registry and class definition loader
  abilities.js        - Ability definitions and execution engine
  locks.js            - Hard/soft lock resolver for world interactions

CLASS DEFINITION FORMAT:
{
  "class_id": string,
  "class_label": string,
  "class_description": string,
  "combat_archetype": string,
  "base_stats": { "hp": number, "speed": number, "attack": number, "defense": number, "magic": number },
  "equipment_restrictions": {
    "weapon": string[],    // allowed weapon tags
    "armor": string[]      // allowed armor tags
  },
  "starting_abilities": string[],
  "world_hard_locks": string[],   // interaction type IDs only this class can do
  "world_soft_locks": { "[interaction_type_id]": "advantage" | "disadvantage" },
  "progression_mentor_pool": string[]
}

Implement the four core classes: fighter, mage, thief, cleric
Load from /data/classes/core_classes.json

ABILITY DEFINITION FORMAT:
{
  "ability_id": string,
  "ability_label": string,
  "ability_description": string,
  "ability_type": "passive" | "stance" | "standard_action" | "move_action" | "reaction" | "interaction",
  "cost": { "type": "none" | "mp" | "use_count" | "cooldown_turns", "amount": number },
  "target": "self" | "single_ally" | "single_enemy" | "tile" | "area" | "facing_tile" | "none",
  "range_tiles": number,
  "area_radius": number | null,
  "effects": EffectDefinition[],
  "world_interaction_type": string | null,  // links ability to a lock type
  "combat_only": boolean,
  "world_only": boolean,
  "use_tracked": boolean,                   // Phase 12: track use count for progression
  "unlock_condition": null                  // set by progression system
}

EFFECT TYPES (implement these primitives):
  deal_damage: { "formula": "attack - defense" | "magic - defense" | "fixed", "value": number, "damage_type": string }
  apply_status: { "status_id": string, "duration_turns": number, "chance": number }
  remove_status: { "status_id": string }
  restore_hp: { "formula": "fixed" | "percent_max", "value": number }
  move_self: { "type": "teleport_to_target" | "straight_line", "distance": number }
  fire_event: { "event_id": string }
  grant_secret: { "secret_id": string }
  modify_map_object: { "object_id": "target", "new_state": string }

Implement abilities for all four classes as defined in the GDD:
  Fighter: weapon_mastery (passive), shield_wall, cleave, charge, intimidate, fortify, breach
  Mage: arcane_bolt, area_hex, barrier, blink, identify, glyph_reading, detect_magic
  Thief: backstab, shadow_step, pickpocket, lockpick, eavesdrop, trap_detection (passive), disarm_trap, vanish
  Cleric: cure, mass_cure, turn_undead, smite, consecrate, divine_insight (passive), last_rites, sanctuary

HARD/SOFT LOCK SYSTEM:
Every interactable object and dialogue option can carry:
  "interaction_type": string         — the lock category (e.g. "lockpick", "glyph_reading", "breach", "consecrate")
  "lock_type": "hard" | "soft"
  "soft_outcomes": {                 // for soft locks: what happens for each party composition
    "class_advantage": { "description": string, "action": ActionDefinition },
    "class_disadvantage": { "description": string, "action": ActionDefinition, "failure_chance": number },
    "no_class": { "description": string, "action": ActionDefinition | null, "failure_chance": number }
  }

Lock.resolve(interactionType, lockType, partyMembers) → ResolutionResult
  - Checks if any active party member's class has the interaction_type in world_hard_locks
  - For hard locks: if no class has it → return { success: false, reason: "requires_class", required_classes: [...] }
  - For hard locks: if class present → return { success: true, outcome: "class_advantage" }
  - For soft locks: determine which outcome applies (advantage/disadvantage/none)
  - For soft locks with failure_chance: roll Math.random() against failure_chance

Resolution result drives the Events engine: success fires on_interact_event, failure fires on_fail_event.

Show a lock resolution UI:
  - On hard lock failure: dialog "This requires a [Class] — [Ability description]"
  - On soft lock with advantage: brief green flash, result description shown
  - On soft lock failure: red flash, failure description shown
  - On soft lock without class (success path): show "You manage it, but awkwardly." + result

Add to test_town:
  - A locked door (interaction_type: "lockpick", lock_type: "hard") — only Thief can open
  - A magical inscription on a wall (interaction_type: "glyph_reading", lock_type: "hard") — Mage only
  - A heavy barricade (interaction_type: "breach", lock_type: "soft") — Fighter advantage (instant), others fail 70%
  - A suspicious barrel (interaction_type: "search_hidden", lock_type: "soft") — Thief finds secret inside
```

### Verification Tasks
- [ ] `Classes.get("fighter")` returns correct class definition with all abilities listed
- [ ] Party with only Fighter: attempt locked door → hard lock failure UI appears: "Requires a Thief"
- [ ] Switch party lead to Thief: locked door interaction → success, door opens
- [ ] Mage only: glyph on wall → success, glyph reading result fires
- [ ] Non-Mage party: glyph interaction → hard lock failure
- [ ] Fighter + barricade: soft lock advantage → instant success
- [ ] No-Fighter party + barricade: 70% failure chance visible in outcome (test 10 times, ~7 failures expected)
- [ ] Thief + suspicious barrel: finds secret (Thief advantage outcome)
- [ ] No-Thief + suspicious barrel: lesser/no outcome
- [ ] `Lock.resolve("lockpick", "hard", [{class_id:"mage"}])` returns `{success: false}`
- [ ] `Lock.resolve("lockpick", "hard", [{class_id:"thief"}])` returns `{success: true}`
- [ ] Abilities correctly categorized: `ability_type: "passive"` abilities auto-apply, not in action menu
- [ ] Ability use tracking: `GameState.party.members[0].use_tracked_skills["lockpick"]` increments on each use

---

## Phase 10 — Combat Engine: Arena, Grid & Turn Order
**Type**: Coding Agent
**Complexity**: Extra Large
**Dependencies**: Phases 3, 5, 8, 9

### Prompt
```
Continue building the CRPG engine. Implement the core combat engine: arena transition, tactical grid, initiative, and turn-order management.

Add these files:
/engine/
  combat.js           - Combat state machine, initiative, turn order
  combat_grid.js      - Tactical grid, movement range, pathfinding
  combat_ui.js        - Combat HUD, turn order strip, action menu

COMBAT TRIGGER:
Combat.initiate(encounterId, combatants, arenaTemplate) — called by Events engine
  combatants: array of { entity: Character|NPC, side: "party"|"enemy", tile_x, tile_y }
  arenaTemplate: tactical arena map definition (see Phase 13 for generation; for now use a hardcoded test arena)

ARENA TRANSITION:
1. Screen fades to black (300ms)
2. Camera hard-snaps to arena position
3. Combat mode activates: overworld input disabled
4. Arena tiles render on Layers 0–5 (separate from overworld)
5. Combatants render on Layer 4 at their arena positions
6. Combat HUD renders on Layer 9
7. Screen fades in (300ms)
On combat end: reverse transition, return to originating map

TEST ARENA (hardcoded for this phase):
24×18 tile grid. Stone floor tiles. 4-tile-wide walls on all edges. A few impassable cover objects (3 stone pillars at varied positions). Party spawns on left side (columns 1–3), enemies on right (columns 20–22).

TACTICAL GRID:
- 24×18 tile grid (full viewport, no scrolling)
- Each tile: 32×32, same rendering as map system
- Grid overlay: thin 1px lines, rgba(255,255,255,0.1) — visible only during combat
- combatGrid.isPassable(x, y) — checks tile + object + occupying combatant
- combatGrid.getOccupant(x, y) → combatant or null
- Movement range highlight: when it's a combatant's turn and they haven't moved, show reachable tiles in blue (rgba(100,150,255,0.25))
- Attack range highlight: show tiles in red (rgba(255,100,100,0.2)) when attack action is selected
- Tile hover: highlight hovered tile in white outline
- Selected combatant: render selection ring (white animated circle, 2px) beneath them

INITIATIVE & TURN ORDER:
- On combat start: each combatant rolls initiative = speed + Math.floor(Math.random() * 6)
- Turn order: sorted descending by initiative. Ties broken by party-first.
- TurnOrder.next() → advances to next combatant, wraps around (new round)
- TurnOrder.getCurrentCombatant() → combatant
- TurnOrder.getOrder() → full sorted array (for HUD display)

TURN ORDER STRIP (Layer 9, top of screen):
- Horizontal strip of portrait/icon thumbnails (40×40 each) in initiative order
- Active combatant: highlighted with bright border, slightly larger
- Upcoming combatants: in order to the right
- Dead/incapacitated combatants: greyed out, shown with X

COMBATANT STATE:
{
  entity: CharacterOrNPC,
  side: "party" | "enemy",
  tile_x, tile_y,
  current_hp, max_hp,
  current_mp, max_mp,
  initiative: number,
  action_state: {
    has_moved: boolean,
    has_acted: boolean,
    has_used_free: boolean
  },
  status_effects: []   // implemented in Phase 11
}

PLAYER TURN FLOW:
1. Combatant highlighted in turn strip
2. If party member: show action menu (Layer 10)
3. Action menu options: Move | Attack | Ability | Item | Defend | Wait
4. Select Move: show movement range, click destination tile → move combatant with smooth animation (8-frame lerp between tiles)
5. Select Attack: show attack range (adjacent tiles by default), click target → Phase 11 resolves damage
6. Select Ability: show ability list, then targeting → Phase 11 resolves
7. Select Defend: set defending flag, end turn
8. Select Wait: pass turn (mark both has_moved and has_acted)
9. After both actions used: auto-end turn, advance to next combatant

ENEMY TURN (placeholder AI for this phase):
Simple behavior: if enemy has not moved, move toward nearest party member. If adjacent to party member, attack them. Log actions to console. Phase 11 resolves actual damage.

COMBAT HUD (Layer 9):
- Top: turn order strip
- Bottom-left: active combatant name + HP + MP bars
- Bottom-right: action menu when it's a party turn
- Each combatant on the grid: small HP bar above their sprite

Create test scenario:
Fighter (party) vs. 2 Skeletons (enemy). Fighter has 35 HP, speed 5. Skeletons have 15 HP, speed 4.
Trigger combat by pressing C on the test_town map (temporary debug key).
```

### Verification Tasks
- [ ] Press C: fade to black, arena loads, combatants placed correctly
- [ ] Initiative rolls calculated correctly: `Fighter(speed5) + d6` vs `Skeleton(speed4) + d6`
- [ ] Turn order strip shows all 3 combatants in correct order
- [ ] Active combatant highlighted in strip and has selection ring on arena
- [ ] Select Move: blue tiles show movement range (Fighter: speed 5 tiles)
- [ ] Click unreachable tile: no movement
- [ ] Click reachable tile: combatant moves smoothly (8-frame lerp)
- [ ] After moving: has_moved = true, Move no longer selectable in action menu
- [ ] Select Attack: adjacent tiles highlighted red
- [ ] Click target: Phase 11 placeholder fires (console.log "Attack: [attacker] → [target]")
- [ ] Select Defend: defending flag set, turn ends
- [ ] Select Wait: both flags set, turn advances
- [ ] Enemy turn: skeleton moves toward Fighter, logs intended action
- [ ] After last combatant's turn: round 2 begins, turn strip resets initiative highlight
- [ ] Press Escape during combat: confirm dialog "Flee? Yes/No" — for now, Yes exits combat (real flee mechanics later)
- [ ] Combat end condition: all enemies defeated → `Combat.end()` fires → screen fades → overworld restored

---

## Phase 11 — Combat Resolution, Abilities & Status Effects
**Type**: Coding Agent
**Complexity**: Large
**Dependencies**: Phase 10

### Prompt
```
Continue building the CRPG engine. Implement full combat resolution: damage formulas, all class abilities in combat, status effects, and post-combat outcomes.

Add to /engine/combat.js and create /engine/status_effects.js

DAMAGE FORMULA:
Base melee hit chance: 75% + (attacker.attack - target.defense) * 5%, clamped to 10%–95%
Hit: damage = max(1, attacker.attack - target.defense) + weapon stat_modifier
Miss: 0 damage, brief "MISS" floating text

Ranged attacks use same formula, no adjacency requirement (use ability range_tiles)
Magic attacks: ignore physical defense, use attacker.magic vs target's magic resistance (default 0)

Floating combat text (Layer 8):
- Damage numbers float upward from target, fade out over 60 frames
- Miss: grey "MISS"
- Damage: white number (red for player taking damage)
- Healing: green number
- Status applied: colored status name text

COMBAT ABILITY RESOLUTION (implement per GDD spec):

Fighter:
  weapon_mastery: passive — no restriction checking on weapon type in combat
  shield_wall: stance — while active, adjacent allies get +15% dodge; Fighter cannot move (has_moved = true each turn)
  cleave: standard_action — attack primary target + all adjacents for 60% damage each
  charge: move+standard — Fighter must select a target tile in a straight line; moves all tiles up to speed toward it, attacks on arrival for +damage per tile traveled; cancels if path blocked
  fortify: standard_action — set "fortified" flag, next incoming attack reduced 50%
  intimidate: interaction/standard_action — targeting a non-boss humanoid enemy below 30% HP; check passes automatically, enemy flees (removed from combat as if defeated, no loot)
  breach: standard_action — destroy a cover object (impassable object becomes passable terrain)

Mage:
  arcane_bolt: standard_action — ranged (6 tile range), magic damage, ignores physical defense
  area_hex: standard_action — target tile + all 8 adjacents (3×3), magic damage + random status (Slowed/Silenced/Burning, roll per target)
  barrier: standard_action — target empty tile, place an impassable barrier object (lasts 3 turns, then auto-removes)
  blink: move_action — teleport to any visible tile within movement range, no reaction triggers
  identify: world_only (not in combat)
  glyph_reading: world_only
  detect_magic: passive — reveal hidden magical objects/traps on current map (handled in Phase 9/12)

Thief:
  backstab: standard_action — melee; triple damage IF target has not yet acted this round AND Thief approached from a non-facing tile; otherwise normal attack
  shadow_step: move_action — teleport to any shadow tile (tile tagged "shadow") within movement range; no reaction triggers
  vanish: standard_action — enter stealth state; enemies cannot target Thief in combat until Thief takes an action or an enemy moves adjacent
  pickpocket: world_only
  lockpick: world_only
  disarm_trap: world_only
  eavesdrop: world_only

Cleric:
  cure: standard_action — restore (magic * 2 + 8) HP to one ally, remove Poisoned and Bleeding
  mass_cure: standard_action — restore (magic + 4) HP to all allies in 3-tile radius
  turn_undead: standard_action — all undead enemies within 5 tiles must roll vs Cleric's magic; failures flee for 3 turns (apply Frightened)
  smite: standard_action — melee attack; +50% damage bonus if target tagged "undead" or "corrupted"
  sanctuary: stance — while active, enemies must succeed a magic-vs-Cleric-magic check to target Cleric; enemies that fail must choose another target
  last_rites: world_only (used post-combat on defeated enemy to prevent reanimation event)

STATUS EFFECTS SYSTEM (/engine/status_effects.js):
StatusEffects.apply(combatantId, statusId, duration, source) — apply a status
StatusEffects.tick(combatantId) — called at start of each combatant's turn; apply per-turn effects, decrement duration, remove expired
StatusEffects.has(combatantId, statusId) → boolean
StatusEffects.getAll(combatantId) → array of active statuses
StatusEffects.remove(combatantId, statusId)

Implement all statuses from GDD:
  poisoned:   -3 HP at turn start
  burning:    -4 HP at turn start; 20% chance to spread to adjacent combatant
  stunned:    skip Standard Action next turn (has_acted = true auto)
  slowed:     movement range halved (round up)
  blinded:    attack hit chance capped at 30%
  frightened: must use move action to move away from source each turn; cannot attack source
  charmed:    acts on enemy side for duration (enemy AI controls combatant)
  silenced:   cannot use abilities with "magic" in their effect types
  bleeding:   -2 HP whenever combatant moves (per tile moved)
  rooted:     has_moved = true auto each turn (cannot move)

Status icons: render 16×16 status icon below combatant's HP bar. Multiple statuses stack horizontally.

POST-COMBAT:
Combat.end(outcome) — outcome: "victory" | "defeat" | "flee" | "surrender"
  victory: collect loot from loot_table, fire "on_combat_complete" event trigger, transition back to map
  defeat: fire campaign's "on_party_defeat" event (campaign defines consequence — engine does NOT auto game-over)
  flee: party teleports 3 tiles back from entry point, encounter marked "fled" (re-triggers normally)
  surrender: campaign-specific event fires

POST-COMBAT loot UI:
  Simple list: "You found: [item icons and names]" — click to collect all, press Enter to skip
```

### Verification Tasks
- [ ] Fighter attacks Skeleton: hit/miss calculated correctly, damage floats up
- [ ] Cleave hits Fighter's target + all adjacent skeletons (test with 3 enemies grouped)
- [ ] Backstab: triple damage confirmed when Thief attacks enemy that hasn't acted + from behind tile
- [ ] Backstab: normal damage when enemy has already acted
- [ ] Arcane bolt fires from 6 tiles, deals magic damage, ignores Skeleton's defense stat
- [ ] Area_hex hits 3×3 area: all 9 tiles checked, status applied randomly
- [ ] Barrier: impassable tile appears in arena for 3 turns, then disappears
- [ ] Cure restores correct HP formula, removes Poisoned from ally
- [ ] Turn undead: undead enemies with failed rolls show Frightened status and move away
- [ ] Shield wall: adjacent ally takes 15% less damage (test with known damage values)
- [ ] Poisoned: -3 HP fires at turn start for correct number of turns
- [ ] Burning: spreads to adjacent combatant (test 20 times, confirm ~20% spread rate)
- [ ] Stunned: has_acted auto-set on afflicted combatant's turn
- [ ] Charmed: charmed party member is controlled by enemy AI for duration
- [ ] Intimidate: enemy below 30% HP removed from combat without loot drop
- [ ] Defeat: `on_party_defeat` event fires (confirm in event engine logs)
- [ ] Victory: loot table rolls, loot UI displays, items added to inventory on collection
- [ ] Status icons display correctly beneath HP bars for all active statuses

---

## Phase 12 — Progression System
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: Phases 8, 9, 11

### Prompt
```
Continue building the CRPG engine. Implement the full character progression system: use tracking, mentor training, story unlocks, and reputation-gated abilities.

Add these files:
/engine/
  progression.js      - Progression engine: use tracking, thresholds, skill grants
/ui/
  training_ui.js      - Mentor training dialogue UI

USE TRACKING:
- Abilities with "use_tracked": true have their use count stored in character.use_tracked_skills[ability_id]
- Progression.recordUse(characterId, abilityId) — call this every time a use-tracked ability is executed
- Progression.checkThresholds(characterId, abilityId) — checks use count against milestone table:

USE MILESTONES (defined in ability definition, "use_milestones" array):
{
  "uses": number,
  "reward_type": "stat_bonus" | "skill_unlock" | "ability_upgrade",
  "reward": { ... }   // depends on type:
    stat_bonus: { "stat": "attack"|"defense"|"speed"|"magic"|"hp", "amount": number }
    skill_unlock: { "ability_id": string }
    ability_upgrade: { "upgrade_id": string, "replaces_ability": string }
}

On milestone reached: show a brief notification card "Experience gained: [description]", apply reward immediately.

Example milestones for lockpick:
  10 uses → stat_bonus: speed +1
  25 uses → ability_upgrade: "lockpick_master" (unlocks soft-lock capability on master-craft locks)

Example milestones for arcane_bolt:
  15 uses → stat_bonus: magic +1
  30 uses → ability_upgrade: "arcane_bolt_II" (increased damage, replaces arcane_bolt)

MENTOR TRAINING:
A mentor is an NPC with a dialogue branch that can teach skills. Implemented as a special dialogue action: "open_mentor_training".

MENTOR DEFINITION:
{
  "mentor_id": string,
  "mentor_label": string,
  "npc_id": string,         // the NPC who teaches
  "available_condition": ConditionDefinition,   // when this mentor is accessible
  "trainings": [
    {
      "training_id": string,
      "training_label": string,
      "training_description": string,
      "target_class": string | null,   // null = any class can learn
      "ability_granted": string,
      "cost_items": [{ "item_id": string, "quantity": number }],
      "cost_faction_standing": { "faction_id": string, "minimum": number } | null,
      "prerequisite_abilities": string[],
      "already_learned_condition": "character_has_ability",
      "one_time": boolean
    }
  ]
}

MENTOR TRAINING UI:
Opens as a menu (Layer 10) over the dialogue:
  Title: "Training available from [Mentor Name]"
  List of training options, each showing:
    - Training label + description
    - Cost (item costs, faction requirement)
    - Lock indicator if prerequisites not met (with reason)
    - "Already Learned" badge if character already has it
    - Target class badge if class-restricted
  Select a training: deduct costs, grant ability, mark training as received in character record
  Dismiss: return to dialogue

STORY UNLOCKS:
Already wired via event action `grant_skill_unlock`. This phase ensures:
  - grant_skill_unlock fires a progression notification card
  - The skill appears in the character's ability list immediately
  - A journal entry is added: "You have learned: [skill label]"

REPUTATION-GATED UNLOCKS:
  - Mentors can require faction_standing minimum (see mentor definition above)
  - Additionally, events can define `reputation_unlock` triggers:
    { "type": "faction_threshold", "faction_id": string, "threshold": number, "fires_event": string }
  - Progression.checkFactionUnlocks(factionId, newStanding) — called when faction standing changes
  - If threshold crossed: fire the associated event (which may grant skills, open merchants, add NPCs)

Add test data:
  /data/progression/mentors.json — one mentor: "mentor_blacksmith_aldric"
    - npc_id: npc_town_elder (re-use for testing)
    - Training 1: "Heavy Strike" (fighter only, costs 1 iron_sword, prereq: cleave)
    - Training 2: "Fortified Stance" (any class, costs faction_town_guard standing >= 60)
  
  Add use_milestones to lockpick ability (5 uses → speed +1, 15 uses → lockpick_master unlock)
  Add use_milestones to arcane_bolt (10 uses → magic +1)

Add a reputation_unlock to faction_town_guard: at standing 70, fire evt_guard_captain_mentor_unlocked
  which spawns a new mentor NPC.
```

### Verification Tasks
- [ ] Use lockpick 5 times: milestone notification fires, Thief gains speed +1
- [ ] Use lockpick 15 more times: `lockpick_master` ability appears in Thief's ability list
- [ ] Use arcane_bolt 10 times: magic +1 granted, notification card shows
- [ ] `character.use_tracked_skills["lockpick"]` equals correct count after uses
- [ ] Interact with elder (mentor): mentor training UI opens
- [ ] Training requires fighter class: shown as locked for Mage
- [ ] Training requires iron_sword: shown as locked if not in inventory
- [ ] Deduct iron_sword from inventory on purchase: confirmed removed
- [ ] Ability appears in Fighter's ability list post-training
- [ ] Already-learned training shows "Already Learned" badge, cannot be repurchased
- [ ] `grant_skill_unlock` event action: ability granted immediately, journal entry added
- [ ] Raise `faction_town_guard` standing to 70: `evt_guard_captain_mentor_unlocked` fires, new NPC spawns
- [ ] Faction-gated training: unavailable at 50 standing, available at 60+
- [ ] Story unlock notification card text is correct and dismissable

---

## Phase 13 — Tier 3 Encounter Generation & Traps
**Type**: Coding Agent
**Complexity**: Large
**Dependencies**: Phases 2, 10, 11

### Prompt
```
Continue building the CRPG engine. Implement procedural Tier 3 encounter generation from templates and the full trap system.

Add these files:
/engine/
  encounters.js       - Encounter pool management and encounter triggering
  arena_generator.js  - Procedural arena assembly from room templates
  traps.js            - Trap detection, triggering, and resolution

ENCOUNTER ZONE (already in map format, implement the trigger):
On every party move in Tier 1 or Tier 2, check if current tile is in any encounter_zone.
Roll Math.random() < encounter_rate. If true and max_encounters_per_visit not reached:
  Select a random encounter from the pool.
  Load the encounter's arena template.
  Call Combat.initiate() with the encounter's enemy roster.

ENCOUNTER POOL FORMAT:
{
  "pool_id": string,
  "context_tags": string[],    // e.g. ["dungeon", "undead", "medium"]
  "encounters": [
    {
      "encounter_id": string,
      "weight": number,
      "arena_template_tags": string[],   // which templates can be used
      "enemy_groups": [
        {
          "enemy_id": string,
          "count_min": number,
          "count_max": number,
          "level_modifier": number
        }
      ],
      "loot_table": string,
      "is_boss": boolean,
      "scripted_intro_event": string | null
    }
  ]
}

ARENA TEMPLATE FORMAT:
{
  "template_id": string,
  "template_tags": string[],
  "width": 24,
  "height": 18,
  "tileset": string,
  "tiles": number[],           // flat array, handcrafted layout
  "objects": [ ObjectDefinition ],   // cover objects, terrain features
  "party_spawn_zone": { "x1": number, "y1": number, "x2": number, "y2": number },
  "enemy_spawn_zone": { "x1": number, "y1": number, "x2": number, "y2": number },
  "terrain_features": []       // optional: elevated tiles, water, hazards
}

ARENA GENERATOR:
ArenaGenerator.generate(templateId, encounter) →
  1. Load specified template
  2. Place party members in random passable tiles within party_spawn_zone
  3. Place enemies in random passable tiles within enemy_spawn_zone, one per tile
  4. Apply loot table to defeated-enemy tracking
  5. Return populated arena ready for Combat.initiate()

ArenaGenerator.selectTemplate(tags) — weighted random selection from templates matching all tags

Create template files at /data/arenas/:
  arena_stone_corridor.json — narrow corridor, 4 tiles wide, cover pillars
  arena_open_field.json — open grass area, few rocks for cover
  arena_dungeon_chamber.json — square room with pillars at corners

Create encounter pool at /data/encounters/pool_test_wilderness.json:
  2 encounters: "2 wolves" (weight 3), "3 bandits" (weight 2)
  Add to test_town overworld: an encounter_zone covering the eastern portion of the map, rate 0.12

TRAP SYSTEM:

TRAP OBJECT FORMAT (extends base ObjectDefinition):
{
  "object_id": string,
  "object_type": "trap",
  "trap_type": "spike_pit" | "poison_needle" | "fire_jet" | "alarm_wire" | "gas_vent" | "rune_ward" | "collapsing_floor" | "pressure_plate",
  "trap_subtype": "punishing" | "puzzle" | "hybrid",
  "tile_x": number,
  "tile_y": number,
  "hidden": boolean,            // not rendered until detected
  "detected": false,            // runtime state
  "triggered": false,           // runtime state
  "detection_dc": number,       // difficulty for passive/active detection
  "on_trigger_effects": EffectDefinition[],   // damage, status, event
  "disarm_interaction_type": string | null,   // e.g. "disarm_trap"
  "disarm_dc": number,
  "on_disarm_event": string | null,
  "puzzle_hint": string | null   // shown when trap is examined but not yet disarmed
}

TRAP DETECTION:
Passive (Thief in party):
  - Each turn, Traps.passiveCheck(partyPosition, partyMembers) runs
  - Any trap within 3 tiles of party lead: detection roll = d20 + thief_skill vs trap.detection_dc
  - On success: trap.detected = true, render trap sprite, show a subtle HUD indicator ("Trap detected!")

Active (Search action — press S facing a tile):
  - Traps.activeSearch(targetTile, partyMembers)
  - Any class: detection roll = d20 vs (detection_dc + 5) — harder than Thief passive
  - Thief active: d20 + skill vs detection_dc (same as passive)

TRAP TRIGGERING:
- On party move: check if destination tile has an undetected trap → trigger
- Detected trap: player can choose to interact (attempt disarm) or navigate around
- Trap.trigger(trap, combatant) → applies on_trigger_effects, fires event if set, sets triggered=true
- Triggered traps: some reset after N turns (alarm_wire, fire_jet), some are permanent (spike_pit)

DISARMING:
- Face detected trap, press E → Lock.resolve("disarm_trap", "hard", partyMembers)
- Success: trap.triggered = false, trap.detected = true (visible but safe), fire on_disarm_event
- Failure: trap triggers (applying effects to the disarmer)

Add to test_town dungeon wing (add a new room to the test map):
  - 3 hidden spike traps (punishing)
  - 1 pressure plate (puzzle, connected to on_trigger_event that closes a door elsewhere)
  - 1 gas vent (hybrid: disarmable, but punishing if triggered)
```

### Verification Tasks
- [ ] Move through eastern test_town zone 20 times: approximately 2–3 encounters trigger (rate 0.12)
- [ ] Correct encounter selected from pool with weighted distribution
- [ ] Arena template loaded: party spawns in party_spawn_zone, enemies in enemy_spawn_zone
- [ ] Both arena templates render correctly (stone_corridor narrow, open_field open)
- [ ] Template selection by tag works: `ArenaGenerator.selectTemplate(["dungeon"])` returns dungeon template
- [ ] No two enemies spawn on same tile
- [ ] Thief in party: walk near spike trap → passive detection fires, trap sprite reveals
- [ ] No Thief: active search (S key) on same tile → detection succeeds at harder DC
- [ ] Step on undetected trap: trigger fires, damage/status applied
- [ ] Step on detected, undisarmed trap: prompt appears "Trap ahead — interact to disarm"
- [ ] Thief disarms gas vent: success, on_disarm_event fires
- [ ] Non-Thief attempts disarm: hard lock failure message
- [ ] Pressure plate triggered: connected door closes (modify_map_object action fires)
- [ ] Fire jet trap: resets after 3 turns (retriggers if walked through again)
- [ ] `Traps.passiveCheck` not called when no Thief in party

---

## Phase 14 — Music & Mood System
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: Phases 4, 5

### Prompt
```
Continue building the CRPG engine. Implement the music and mood system using the Web Audio API with layered stems and event-driven mood transitions.

Add these files:
/engine/
  music.js            - Mood state machine, stem management, crossfading
/data/
  music/              - Music profile JSON definitions (audio files are placeholders)

MOOD STATES (implement as constants):
  "peaceful", "mysterious", "tense", "danger", "combat", "melancholy", "triumphant", "sacred", "dread"

MUSIC PROFILE FORMAT:
{
  "profile_id": string,
  "base_mood": string,
  "stems": {
    "base": string | null,       // audio file path
    "tension": string | null,
    "melody": string | null
  },
  "time_of_day_overrides": { "[time_state]": "[mood]" },
  "weather_overrides": { "[weather_state]": "[mood]" },
  "event_flag_overrides": [
    { "flag_id": string, "override_mood": string }
  ]
}

STEM ARCHITECTURE:
Each mood has up to 3 looping stems: base, tension, melody.
At any time, one or more stems may be active. Stems crossfade over 4 seconds.

MOOD RESOLUTION (priority order, highest first):
1. Active event flag override (set_music_mood action with duration, or flag-based override)
2. Combat state active → always "combat"
3. Location music profile event_flag_overrides (check all flags, first match wins)
4. Location music profile time_of_day_overrides
5. Location music profile weather_overrides
6. Location music profile base_mood
7. Default: "peaceful"

MusicEngine implementation:
- MusicEngine.init() — create AudioContext on first user interaction (browser autoplay policy)
- MusicEngine.loadProfile(profileId) — load stems for a profile (cache loaded buffers)
- MusicEngine.setProfile(profileId) — switch active profile, resolve initial mood
- MusicEngine.setMood(mood) — crossfade to new mood's stem configuration:
    - Create new GainNodes for incoming stems, ramp gain 0→1 over 4 seconds
    - Ramp outgoing stems 1→0 over 4 seconds, then disconnect
- MusicEngine.evaluate() — called each turn: re-run mood resolution, call setMood if result changed
- MusicEngine.forceMood(mood, durationTurns) — event override, reverts after duration
- MusicEngine.setCombatMode(bool) — activates/deactivates combat mood override
- MusicEngine.mute() / MusicEngine.unmute()
- MusicEngine.setVolume(0–1)

STEM BEHAVIOR PER MOOD:
  peaceful:    base active, melody active, tension off
  mysterious:  base active, tension 50% volume, melody off
  tense:       base active, tension active, melody off
  danger:      base active, tension active (full), melody off — faster base tempo expected
  combat:      base active (full), tension active (full), melody off
  melancholy:  base at 60%, melody active, tension off
  triumphant:  all three active, full volume
  sacred:      base active, melody active (soft), tension off
  dread:       base at 80%, tension active, melody off

STINGERS:
One-shot non-looping audio clips for events:
  MusicEngine.playStinger(stingerId) — play immediately over stems without interrupting them
Stinger IDs: "discovery", "death", "revelation", "danger_spike", "victory"

PLACEHOLDER AUDIO:
Since real audio assets don't exist yet, use the Web Audio API to generate simple procedural tones:
- Each stem: a looping oscillator (sine/square wave) at a mood-appropriate frequency
  peaceful: 220Hz sine, low gain
  tense: 110Hz sine + 165Hz sine (minor third), medium gain
  combat: 80Hz square wave, high gain
  etc.
These will be replaced by real audio files in the campaign asset phase.

INTEGRATION:
- On map load: MusicEngine.setProfile(map.music_profile), call evaluate()
- On GameTime.onStateChange: MusicEngine.evaluate()
- On Weather.setState: MusicEngine.evaluate()
- On Flags.set / Flags.clear: MusicEngine.evaluate()
- On Combat.initiate: MusicEngine.setCombatMode(true)
- On Combat.end: MusicEngine.setCombatMode(false)
- On Events action set_music_mood: MusicEngine.forceMood(mood, duration)

HUD: Small mute button (top-right, 🔊/🔇 text). Volume slider in a settings panel (press O).

Create music profiles at /data/music/:
  music_town_peaceful.json — base_mood: peaceful, time overrides: night→mysterious
  music_dungeon_tense.json — base_mood: tense, time overrides: midnight→dread, flag override: flag_boss_awakened→danger
```

### Verification Tasks
- [ ] Load test_town: peaceful oscillator tones play
- [ ] Advance time to night: mysterious tones crossfade in over 4 seconds
- [ ] Enter dungeon map: tense tones crossfade in
- [ ] Set flag `flag_boss_awakened`: danger tones activate
- [ ] Trigger combat: combat tones immediately override
- [ ] End combat: dungeon tense tones resume after combat
- [ ] `MusicEngine.forceMood("triumphant", 5)`: triumphant for 5 turns, then reverts
- [ ] Mute button: audio silences/resumes
- [ ] Volume slider adjusts gain correctly (confirm with AudioContext.destination inspection)
- [ ] Stinger "discovery": plays over current stems without interrupting them
- [ ] Evaluate runs each turn: mood auto-adjusts as time, weather, flags change
- [ ] Crossfade: no audio clicks or pops during transition (smooth gain ramp)
- [ ] Heavy rain weather: mysterious map shifts to tense weather override

---

## Phase 15 — Save/Load System & UI Polish
**Type**: Coding Agent
**Complexity**: Medium
**Dependencies**: All preceding phases

### Prompt
```
Continue building the CRPG engine. Implement the save/load system and final UI polish pass.

Add these files:
/engine/
  save.js             - State serialization and persistence (IndexedDB)
/ui/
  main_menu.js        - Main menu / title screen
  hud_polish.js       - Final HUD refinements

SAVE SYSTEM:
Use IndexedDB for persistence (not localStorage — save files can be large).
Database name: "crpg_engine_saves"
Object store: "saves" with key: save_slot (integer 0–2, three save slots)

SAVE STATE SERIALIZATION (SaveState object):
{
  "version": "1.0",
  "timestamp": ISO date string,
  "save_label": string,          // auto-generated: "[map_name] — Turn [n] — [time_of_day]"
  "gamestate": {
    "currentTurn": number,
    "flags": { [flag_id]: boolean },
    "vars": { [var_id]: string|number },
    "secrets": string[],
    "factions": { [faction_id]: number },
    "worldLog": [ { turn, text } ]
  },
  "party": {
    "maxSize": number,
    "leadIndex": number,
    "members": [ CharacterDefinition ],
    "roster": [ CharacterDefinition ]
  },
  "inventory": {
    "items": [ { item_id, quantity } ],
    "key_items": [ { item_id, quantity } ]
  },
  "world": {
    "currentMapId": string,
    "currentFloor": number,
    "partyPosition": { tile_x, tile_y },
    "visitedTiles": { [map_id]: string[] },   // array of "x,y,floor" strings
    "mapObjectStates": { [object_id]: string },   // state overrides from events
    "spawnedNpcs": [ { npc_id, map_id, tile_x, tile_y } ],
    "despawnedNpcs": string[]
  },
  "events": {
    "completedEvents": { [event_id]: number },   // event_id → turn completed
    "pendingTimeline": [ { event_id, fire_at_turn: number } ]
  },
  "time": {
    "totalTurns": number,
    "dayNumber": number
  },
  "weather": {
    "currentState": string
  }
}

Save.save(slot) — serialize all of the above, write to IndexedDB
Save.load(slot) — read from IndexedDB, deserialize and restore all engine state
Save.getSaveInfo(slot) → { exists, label, timestamp } | null (for menu display)
Save.deleteSave(slot)

MAIN MENU:
Appears on page load (before any map loads).
Pixel-art styled title screen:
  - Title text: "CRPG ENGINE" in a large pixelated font (use a pixel font loaded via CSS)
  - Subtitle: "A Configurable Adventure Platform"
  - Background: slowly scrolling tile pattern (reuse renderer)
  - Menu options (keyboard navigable with arrow keys + Enter, also clickable):
      New Game
      Continue  (greyed out if no saves exist)
      Load Game
      Settings
  - New Game: load initial campaign config, create fresh GameState, load starting map
  - Load Game: opens save slot selection panel (shows 3 slots with save info or "Empty")
  - Settings: volume slider, display scale selector, key rebinding (basic)

IN-GAME SAVE/LOAD:
  - Press Escape: opens pause menu with: Resume | Save Game | Load Game | Main Menu | Quit
  - Save Game: open slot selection, select slot → Save.save(slot) → "Game Saved!" confirmation
  - Load Game: slot selection → Save.load(slot) with confirmation ("Unsaved progress will be lost")

UI POLISH (pass over all existing UI):
  Consistent panel style: all panels use a shared CSS variable set (background, border, text color)
  Pixel font: load a free pixel font (e.g. "Press Start 2P" from Google Fonts) for all UI text
  Panel animations: all panels slide or fade in (100–200ms), slide or fade out on dismiss
  Button hover states: all buttons have clear hover highlight (1px brighter border + background tint)
  Tooltips: hovering over ability icons, item icons, or status icons shows a tooltip (name + description)
  Minimap: polish — location icons for discovered Tier 2 locations (colored dots by type)
  HUD HP bars: animate HP changes (smooth decrease, brief red flash on damage taken)
  Transition: all map transitions use screen_fade action (fade out → load → fade in)

CAMPAIGN ENTRY CONFIG:
Create /data/campaign.json:
{
  "campaign_id": "test_campaign",
  "campaign_title": "The Test Campaign",
  "starting_map": "test_town",
  "starting_position": { "tile_x": 5, "tile_y": 5 },
  "starting_time_of_day": "morning",
  "starting_weather": "clear",
  "starting_party": [ "char_fighter_aldric" ],
  "starting_inventory": [ { "item_id": "item_torch", "quantity": 2 } ],
  "starting_flags": [],
  "starting_factions": { "faction_town_guard": 50 },
  "on_party_defeat_event": "evt_party_defeated_default",
  "event_files": [ "data/events/test_events.json" ],
  "map_files": [ "data/maps/test_town.json" ],
  "npc_files": [ "data/npcs/test_npcs.json" ],
  "item_files": [ "data/items/test_items.json" ],
  "class_files": [ "data/classes/core_classes.json" ],
  "secret_files": [ "data/secrets/test_secrets.json" ],
  "faction_files": [ "data/factions/test_factions.json" ],
  "dialogue_files": [ "data/dialogue/" ],
  "music_files": [ "data/music/" ],
  "encounter_files": [ "data/encounters/" ],
  "arena_files": [ "data/arenas/" ]
}
```

### Verification Tasks
- [ ] Main menu renders on page load with correct layout and pixel font
- [ ] "New Game" loads campaign.json, initializes state, loads starting map
- [ ] Play for a few turns, save to slot 0: `Save.getSaveInfo(0)` returns correct label and timestamp
- [ ] Reload page: "Continue" is now active; loads from slot 0 correctly
- [ ] All engine state restored: same position, same flags, same inventory, same world log
- [ ] Load game from menu: slot panel shows save info for all 3 slots
- [ ] Delete a save: slot shows "Empty" after deletion
- [ ] Pause menu opens on Escape; resume returns to game with no state change
- [ ] All UI panels use consistent font and color style
- [ ] Hover over ability icon: tooltip shows name and description
- [ ] Hover over status icon: tooltip shows status name and remaining turns
- [ ] HP bar animates smoothly when taking damage
- [ ] All map transitions: fade out → fade in (no hard cuts)
- [ ] Minimap shows discovered location dots in correct positions
- [ ] Settings: volume change persists across save/load cycle

---

## Phase 16 — Core Art Assets: Terrain, Structures & Objects
**Type**: Asset Generation
**Complexity**: Large
**Dependencies**: None (can run parallel to coding phases)

### Prompt Template
Use this prompt structure for each asset batch. Submit to your AI image generation tool of choice (Midjourney, DALL-E 3, Stable Diffusion with pixel art model, etc.).

**Master style prompt to prepend to all terrain/structure/object asset requests:**
```
Pixel art, top-down orthographic view, 32x32 pixels per tile, Ultima VI/VII CRPG aesthetic, warm earth-tone color palette (ochres, tans, muted greens, stone greys, dark blues for water), no anti-aliasing, hard pixel edges, seamlessly tileable where noted, old-school DOS-era RPG style, clean readable silhouettes
```

**TERRAIN TILES** (each must tile seamlessly):
Generate separately, then arrange in a single PNG tileset grid (16 tiles across):

1. "...grass tile, medium green, slight texture variation from blade patterns, seamlessly tileable, no borders"
2. "...dark forest floor tile, dense dark green with brown leaf litter, seamlessly tileable"
3. "...packed earth dirt path tile, tan-brown, foot-worn smooth texture, seamlessly tileable"
4. "...grey-brown cobblestone road tile, fitted irregular stones with mortar lines, seamlessly tileable"
5. "...smooth cut grey stone floor tile, dungeon interior, faint chisel marks, seamlessly tileable"
6. "...warm brown horizontal wood plank floor tile, inn or ship interior, grain visible, seamlessly tileable"
7. "...pale sandy grain tile, beach or desert, fine texture, seamlessly tileable"
8. "...white-blue snow tile, soft powdery surface, subtle crystalline texture, seamlessly tileable"
9. "...shallow water tile, blue-green translucent, rippled surface, animated 3-frame shimmer"
10. "...deep water tile, dark navy blue, slow animated surface shimmer, 3 frames"
11. "...orange-red lava tile, molten rock with bright veins, animated glow 4 frames"
12. "...dark muddy swamp tile, dark olive green with murky patches, seamlessly tileable"
13. "...dark grey rough cave floor tile, uneven natural stone, seamlessly tileable"
14. "...pale blue reflective ice tile, flat polished, seamlessly tileable"
15. "...brown-grey vertical cliff face tile, layered rock strata, seamlessly tileable, viewed from above"
16. "...dark grey mountain peak tile, jagged rough summit, impassable visual cue, seamlessly tileable"

**STRUCTURE TILES:**
17–22: Stone wall segments: north-south, east-west, four corner variants (NW, NE, SW, SE)
    "...grey stone dungeon wall segment, [orientation], mortared stone blocks, thick wall, top-down view, matches adjacent wall tiles"
23–26: Wooden wall segments: north-south, east-west, two corner variants
    "...rough-hewn wooden cabin wall, [orientation], visible timber framing, top-down view"
27–30: Doors: wooden closed/open (north-facing), iron portcullis up/down
    "...wooden door, [state], iron banding, top-down view, fits in wall tile gap"
31–32: Stairs descending, stairs ascending (stone, top-down aerial view)
33: "...wooden window frame with shutters, embedded in wall, top-down"

**OBJECT SPRITES** (32×32 each, transparent background):
34. "...wooden treasure chest, closed, iron banding and padlock, top-down 3/4 view"
35. "...same chest, open, empty interior visible"
36. "...wooden barrel, upright, top-down slight angle, wood grain and iron bands"
37. "...wooden shipping crate, top-down, rope-tied planks"
38. "...tall bookshelf packed with books, top-down foreshortened view showing spine colors"
39. "...simple wooden table, small square, top-down"
40. "...plain wooden chair facing south (toward camera), top-down"
41. "...single bed, pillow and folded blanket, top-down aerial view"
42. "...stone fireplace and hearth, animated flame, 3 frames"
43. "...iron wall torch, mounted bracket, animated flame, 3 frames"
44. "...stone altar, rectangular, smooth top surface visible, top-down"
45. "...ancient stone altar with candles and cloth, sacred, soft glow"
46. "...same altar but corrupted: dark staining, ominous rune carved in surface"
47. "...iron cauldron, round, bubbling liquid, 2-frame animation"
48. "...stone well with wooden frame, rope and bucket, top-down"
49. "...simple carved gravestone, weathered, top-down front visible"
50. "...round-canopy deciduous tree, top-down aerial view, green, casts subtle shadow"
51. "...pointed conifer tree, top-down aerial, dark green"
52. "...dead bare tree, branching silhouette, top-down aerial"
53. "...wooden bridge planks, north-south orientation, top-down"
54. "...wooden signpost, single arm, top-down 3/4 view"
55. "...stone floor with recessed square pressure plate, subtle but visible, top-down"
56. "...iron lever mounted on wall/floor, upright position, top-down"
57. "...same lever, pulled down"
58. "...stone warrior statue, foreshortened top-down view, heroic pose"
59. "...stone column/pillar, circular cross-section, top-down aerial view"
60. "...iron portcullis in doorway, lowered and raised states (2 sprites)"

### Verification Tasks
- [ ] All terrain tiles are exactly 32×32 pixels
- [ ] Seamless tiles: place 4×4 grid of each tile — no visible seams or repetition artifacts
- [ ] Color palette consistent across all terrain tiles (earth tones, no neon or saturated colors)
- [ ] Animated tiles (water, lava, fire): exactly 3 or 4 frames as specified, frames differ visibly
- [ ] All structure tiles align correctly when placed edge-to-edge (wall segments connect cleanly)
- [ ] Object sprites have transparent backgrounds (not white or colored fill)
- [ ] Objects have clear readable silhouettes at 32×32 (not too detailed, not too sparse)
- [ ] Door open/closed states are clearly distinguishable
- [ ] Chest open/closed states clearly different
- [ ] Art style consistent across all 60 assets (same palette, same pixel density, same perspective)
- [ ] Assemble all terrain tiles into one tileset PNG: `/assets/tilesets/tileset_test.png`

---

## Phase 17 — Character & Enemy Sprites
**Type**: Asset Generation
**Complexity**: Large
**Dependencies**: None (parallel)

### Prompt Template

**Master style prompt:**
```
Pixel art RPG sprite sheet, top-down orthographic view, 32x32 pixels per frame, Ultima VI/VII aesthetic, warm earth-tone palette, no anti-aliasing, hard pixel edges, 4-directional walk cycle format: 4 rows (south/north/east/west), 3 columns (idle/step-left/step-right), total sheet size 96x128 pixels, transparent background
```

**PLAYER CLASS SPRITES** (one sheet each, 96×128):

Fighter (Male): "...armored male warrior, plate armor with chainmail, broadsword at side, sturdy build, [direction] facing, walk cycle"
Fighter (Female): "...armored female warrior, plate armor, longsword, confident stance, [direction] facing, walk cycle"
Mage (Male): "...male wizard, long dark robes with arcane symbols, tall staff with crystal, slight build, [direction] facing, walk cycle"
Mage (Female): "...female wizard, hooded robes, ornate staff, graceful, [direction] facing, walk cycle"
Thief (Male): "...male thief/rogue, dark leather armor, hood up, short blades at belt, wiry build, [direction] facing, walk cycle"
Thief (Female): "...female thief, dark hooded cloak, daggers, athletic build, [direction] facing, walk cycle"
Cleric (Male): "...male cleric, white and gold vestments, holy symbol on chest, mace, [direction] facing, walk cycle"
Cleric (Female): "...female cleric, layered robes, holy symbol staff, serene posture, [direction] facing, walk cycle"

**NPC SPRITES** (same sheet format, 96×128):
- Townsperson farmer (male): simple roughspun clothing, tool at belt
- Townsperson farmer (female): dress, apron
- Merchant: apron, belt purse, friendly portly build
- Noble: fine clothing, jewelry visible
- Child: shorter sprite (24px tall, centered in 32px frame), simple clothes
- Town guard (light): chainmail, spear
- Town guard (heavy): full plate, halberd
- Innkeeper: apron, welcoming gesture idle
- Priest: robes, holy symbol
- Elder (male): elderly, hunched, walking staff
- Scholar: robes, book under arm
- Blacksmith: heavy leather apron, hammer

**ENEMY SPRITES** (same 96×128 format):
- Skeleton warrior: animated skeleton in rusted armor with sword, bones visible through gaps
- Skeleton archer: bow-carrying skeleton
- Zombie: shambling decomposed figure in ragged clothing
- Ghost: translucent wispy humanoid, no legs, floating — use transparency/dithering for ghostly effect
- Wolf: grey wolf, four-legged — adapt the 4-direction format for a quadruped
- Giant rat: oversized rat, aggressive forward-crouched posture
- Goblin: small green humanoid, crude spear, large ears
- Orc warrior: large grey-green humanoid, greataxe, intimidating bulk
- Bandit: hooded human, short sword and crossbow
- Cultist: dark hooded robe, ritual dagger, symbol on chest

**LARGER ENEMY SPRITES** (48×48 per frame, 144×192 sheet):
- Stone golem: roughly humanoid construct, blocky stone form, cracks and moss
- Troll: large warty green creature, club, hunched posture

**PORTRAITS** (64×64 each, separate PNG per portrait, slight above-angle bust shot):
```
Pixel art RPG character portrait, 64x64 pixels, bust shot from slight above-angle, [description], warm earth palette, stone/wood carved frame border integrated into image, Ultima VI Gold Box RPG style, no anti-aliasing
```
Generate one portrait per player class character (8 total: 4 classes × 2 genders).
Generate portraits for: town_elder, merchant_borven, blacksmith, guard_captain, innkeeper, scholar, cultist_leader (7 NPC portraits).

### Verification Tasks
- [ ] Each player class sprite sheet is exactly 96×128 pixels
- [ ] 4 rows (S/N/E/W) × 3 columns (idle/step-left/step-right) visible and distinct
- [ ] South-facing idle frame: character faces camera, clear class identity visible
- [ ] Walk cycle: step-left and step-right frames create believable walking motion when animated
- [ ] All 8 player sprites immediately distinguishable from each other
- [ ] NPC sprites readable at 32×32 — occupation/role recognizable from silhouette
- [ ] Ghost sprite: transparency/dithering creates ghostly appearance
- [ ] Wolf sprite: quadruped adapted to top-down 4-direction format credibly
- [ ] Golem/Troll at 48×48: clearly larger than standard sprites, imposing
- [ ] All portraits: consistent angle (slight above-looking-down), stone frame visible
- [ ] Portraits match their corresponding sprite (same color palette, same design)
- [ ] All sprites use same color palette range as terrain/structure assets
- [ ] No sprite has white or solid-color background (all transparent PNG)

---

## Phase 18 — UI Elements, Item Icons & Effect Sprites
**Type**: Asset Generation
**Complexity**: Medium
**Dependencies**: None (parallel)

### Prompt Template

**UI ELEMENTS** (exact sizes required):

Portrait frame (72×72):
"Pixel art RPG character portrait frame, 72x72 pixels, ornate stone-carved border with rounded corners, inner area transparent (to show portrait beneath), warm grey-brown stone, Ultima VI style, no anti-aliasing"

Inventory slot (36×36):
"Pixel art RPG inventory slot, 36x36 pixels, recessed square indentation in wood or stone surface, darker inner area, subtle border highlight, indicates an item can be placed here, no anti-aliasing"

Dialogue box (640×120):
"Pixel art RPG dialogue box, 640x120 pixels, parchment or aged paper texture background, ornate wooden or stone border with corner decorations, Ultima VI CRPG style, room for portrait on left and text on right, no anti-aliasing"

HP/MP bars (tileable 1×8 strips):
"Pixel art RPG health bar fill, 1x8 pixels tileable, deep red gradient with lighter red highlight line on top, clean pixel edges, for tiling into a health bar of any length"
"Pixel art RPG mana/magic bar fill, 1x8 pixels tileable, deep blue with lighter blue highlight"
"Pixel art RPG bar background, 1x8 pixels tileable, dark grey recessed channel"

**STATUS EFFECT ICONS** (16×16 each, transparent background):
Generate one icon per status effect with a clear symbolic representation:
- Poisoned: green drip or skull
- Burning: orange flame
- Stunned: yellow stars circling
- Slowed: blue snail or downward arrow
- Blinded: grey eye with X
- Frightened: purple running figure
- Charmed: pink heart with spiral
- Silenced: white speech bubble with X
- Bleeding: red blood drop
- Rooted: brown vine wrapped around foot

"Pixel art status effect icon, 16x16 pixels, [description], clear readable silhouette, bright saturated color on dark background, no anti-aliasing, transparent background"

**ITEM ICONS** (32×32 each, transparent background, pack into one icon sheet PNG):
```
Pixel art RPG item icon, 32x32 pixels, warm earth tones with one distinctive accent color, clean readable at small size, slight 3/4 view angle, transparent background, Ultima VI style
```
Weapons: iron_sword, battle_axe, wooden_mace, shortbow (strung), wizard_staff, dagger, iron_spear, crossbow
Armor: chainmail_shirt, plate_armor, leather_armor, wizard_robe, wooden_shield, iron_shield
Helms: iron_helm, leather_hood, golden_circlet, bishop_mitre
Accessories: gold_ring, silver_ring, holy_amulet, thief_charm, iron_bracer
Consumables: health_potion (red vial), antidote (green vial), lit_torch, travel_ration, blank_scroll
Key items: iron_key, sealed_letter, ancient_tome, signet_ring, folded_map
Materials: iron_ore, cloth_bolt, leather_strip, alchemical_powder
Currency: gold_coin (stack)

**EFFECT SPRITES** (animated, transparent background):
"Pixel art RPG combat effect sprite, [frame_count] frame animation strip, [size] pixels per frame, [description], bright accent colors on transparent background, no anti-aliasing"

- hit_slash (32×32, 3 frames): white slash arc, fades quickly
- hit_blunt (32×32, 3 frames): yellow starburst impact
- hit_magic (32×32, 4 frames): purple-white sparkle burst
- heal (32×32, 4 frames): green upward rising particles
- poison_cloud (32×32, 4 frames): green-grey expanding puff
- fire_small (32×32, 4 frames): small orange flame flicker
- fire_large (32×32, 4 frames): larger fire, more dramatic
- magic_bolt (16×32, 3 frames): white-blue elongated projectile, oriented vertically (rotate in code)
- consecrate (48×48, 5 frames): golden light rippling outward
- secret_discover (32×32, 4 frames): golden sparkle shimmer

**WEATHER ICONS** (16×16, for HUD clock area):
Sun (clear), cloud (overcast), rain drops (rain), heavy rain, fog swirl, snowflake, blizzard, lightning bolt (storm)

**OVERWORLD MAP MARKERS** (16×16, transparent background):
Town (house silhouette), Dungeon (skull), Cave (dark opening), Ruin (broken column), Shrine (star), Castle (tower), Camp (tent), Ship (boat), Unknown (question mark)

### Verification Tasks
- [ ] Portrait frame at 72×72: inner area genuinely transparent (checkerboard visible)
- [ ] Inventory slot: visually distinct from surrounding UI; clearly indicates "place item here"
- [ ] Dialogue box at 640×120: parchment texture, border frames entire box
- [ ] HP bar strip: tiles seamlessly to any length without gaps or mismatches
- [ ] All 10 status icons: symbol instantly recognizable without text label (show to a colleague and ask them to guess)
- [ ] All item icons: readable at 32×32 — type (weapon/armor/potion) identifiable without tooltip
- [ ] Icon sheet: all icons arranged in consistent grid, no overlapping, easy to reference by column/row
- [ ] Effect sprites: animation clearly reads as intended action (slash vs. magic vs. heal)
- [ ] Heal effect: green particles visually upward motion
- [ ] Magic bolt: elongated shape works as projectile when rotated in code
- [ ] Weather icons: instantly recognizable at 16×16 in the HUD
- [ ] All overworld markers distinct from each other at 16×16
- [ ] No sprite bleeds past its boundary box
- [ ] All assets exported as PNG with transparency (not JPG)

---

## Phase 19 — Sample Campaign Design
**Type**: General AI
**Complexity**: Large
**Dependencies**: GDD, Phases 1–15 (for format understanding)

### Prompt
```
You are a campaign designer for a browser-based CRPG engine. Using the engine's scripting format (AI-optimized JSON config), design a complete starter campaign called "The Warden's Keep."

The campaign should demonstrate every major engine system:
- Three-tier world (overworld, 2+ locations, encounter zones)
- All four classes used meaningfully (Fighter, Mage, Thief, Cleric)
- Hard and soft class locks in play
- All three event trigger types (timeline, location, action)
- Secrets as a discovery chain (at least 5 connected secrets)
- Two factions with standing consequences
- At least one mentor NPC per class
- Day/night and weather events affecting gameplay
- Combat and non-combat paths to major obstacles
- Item-based and mentor-based progression moments
- A central mystery that unfolds through secrets, not cutscenes

CAMPAIGN CONCEPT:
A derelict warden's keep on the edge of a wilderness region. The warden is missing.
The party (starting with 1 character, class chosen by player at start) must discover:
  - What happened to the warden
  - Why the keep's eastern wing is sealed
  - What the merchants in the nearby town are afraid of
  - Who, or what, is leaving the tracks found outside the keep

The answer should involve betrayal, a creature that isn't what it seems, and one NPC who knows more than they admit.
The campaign should be resolvable in 60–90 minutes of play.
It should support both a "story-first" player (follows secrets and dialogue) and an "explorer" player (finds things spatially).

PRODUCE THE FOLLOWING FILES in the engine's exact JSON format:

1. campaign.json — campaign entry config
2. maps/overworld_wardens_region.json — overworld map (30×30 tiles, sketch the layout as tile arrays)
3. maps/town_millhaven.json — the nearby town (25×20 tiles)
4. maps/dungeon_wardens_keep.json — the keep (30×25 tiles, 2 floors)
5. npcs/millhaven_npcs.json — all town NPCs with schedules
6. npcs/keep_npcs.json — keep NPCs and the hidden creature
7. dialogue/ — one dialogue file per major NPC (at minimum: merchant_borven, innkeeper, elder_maris, warden_ghost, creature_reveal)
8. events/main_events.json — all campaign events using timeline, location, and action triggers
9. secrets/campaign_secrets.json — all 8+ secrets with chain connections
10. factions/campaign_factions.json — two factions (Town Merchants, Warden's Order) with conflict setup
11. items/campaign_items.json — key items, a mentor-unlocking item, a secret-granting document
12. progression/campaign_mentors.json — one mentor per class
13. encounters/campaign_encounters.json — encounter pools for wilderness and keep zones
14. music/campaign_music_profiles.json — music profiles for all locations

For each map, provide a written legend explaining tile layout decisions (don't need real tile arrays — just a written map description + ASCII sketch is acceptable for the map files).

Ensure every event uses the exact schema from the GDD. Every NPC dialogue uses the branching menu format. Every secret uses the secret definition format.
```

### Verification Tasks
- [ ] campaign.json references all other files correctly and completely
- [ ] All four classes have at least one hard-lock moment in the keep
- [ ] Secret chain: tracing secrets 1→2→3→4→5+ forms a coherent investigation arc
- [ ] Both factions appear in dialogue options and standing consequences
- [ ] Timeline event: at least one event fires on a turn-based delay after another event
- [ ] Location event: at least one event fires on entering each major location
- [ ] Action event: at least one event fires from a specific dialogue completion
- [ ] A non-combat path to the final encounter exists (requires secrets + class skills)
- [ ] Each mentor requires a meaningful unlock condition (not just "talk to them")
- [ ] Day/night creates a gameplay difference (NPC available only at night, event only at dawn)
- [ ] The creature's reveal is gated behind a secret chain, not just map entry
- [ ] All JSON is valid (paste into jsonlint.com — no errors)
- [ ] All event_id references in on_complete_fire_event exist as actual events
- [ ] All secret_id references in enables_events exist as actual events
- [ ] Reading campaign.json + events + dialogue forms a coherent story (do a narrative review)

---

## Phase 20 — Integration Testing & Full Playthrough
**Type**: Coding Agent + General AI
**Complexity**: Large
**Dependencies**: All phases

### Prompt (Coding Agent)
```
The CRPG engine is now complete with all systems implemented and the "Warden's Keep" sample campaign designed. 

Perform a full integration pass:

1. CAMPAIGN LOADER:
   Load campaign.json and wire all file references into engine systems automatically.
   Engine should be able to boot from a single campaign.json path with no other hardcoded references.
   
2. ASSET INTEGRATION:
   Replace all placeholder sprites with the generated art assets from Phases 16–18.
   Update all tileset references in map files to point to real tileset PNGs.
   Update all sprite_sheet references in character/NPC/enemy definitions to real sprite sheet PNGs.
   Update all icon references in item definitions to real icon sheet coordinates.
   Update all portrait references to real portrait PNGs.

3. AUDIO INTEGRATION:
   Replace procedural oscillator stubs in MusicEngine with real audio file loading.
   If campaign provides audio files: load via AudioBuffer. If not, retain oscillators.
   All stinger sound IDs should map to real or procedural audio.

4. BUG SWEEP — test and fix the following known integration points:
   a. Event chain: elder dialogue → secret → keep map marker revealed → keep event fires on entry
   b. Class lock: Thief-only door in keep correctly blocks Fighter/Mage/Cleric parties
   c. Day/night NPC schedule: innkeeper moves from tavern to quarters at night
   d. Combat → post-combat → map restoration: no tile state regression after encounter
   e. Save → load → continue: all flags, secrets, faction standings preserved exactly
   f. Mentor training: purchasing training deducts item, grants ability, persists through save/load
   g. Encounter rate in wilderness zone: test 50 moves, confirm rate approximates configured value
   h. Trap detection → disarm → traversal: all three states (hidden, detected, disarmed) transition correctly
   i. Music mood: entering keep at midnight → dread mood; entering in morning → tense mood
   j. Weather + night + dungeon: all three overlays composite correctly without artifacts

5. PERFORMANCE:
   Profile render loop with browser DevTools.
   Target: consistent 60fps during normal play.
   Flag any layer or system that drops below 55fps.
   Optimize identified bottlenecks (common culprits: particle system, fog-of-war redraw, large map tile iteration).

6. CAMPAIGN PLAYTHROUGH SCRIPT:
   Execute the following as automated test steps (add a debug test mode triggered by pressing F5):
   Step 1: New game, select Fighter, verify starting position and HUD
   Step 2: Move to elder, complete full dialogue tree
   Step 3: Secret granted — verify journal entry, verify map marker
   Step 4: Travel to keep entrance — verify location event fires
   Step 5: Trigger a wilderness encounter — complete combat, collect loot
   Step 6: Enter keep — verify music mood changes
   Step 7: Find Thief-locked door — verify hard lock message
   Step 8: Find a trap — verify detection and disarm flow
   Step 9: Save game, reload, verify all state restored
   Step 10: Advance to day 2 — verify day/night transition and NPC schedule change
   
   Log: PASS/FAIL for each step with details.
```

### Prompt (General AI — Narrative Review)
```
Review the complete "Warden's Keep" campaign script (all dialogue files, event files, and secret definitions) and perform a narrative audit:

1. Story coherence: Does the mystery resolve logically? Are all clues discoverable?
2. Class balance: Do all four classes have meaningful moments? Is any class dead weight?
3. Secret chain: Can a player who skips all combat still complete the campaign?
4. Pacing: Estimate the turn count for a completionist run vs. a direct-path run. Flag any bottlenecks.
5. Dialogue quality: Flag any NPC dialogue that contradicts known world state or repeats information the player already has.
6. Missing events: Identify any story beat that has no corresponding event trigger (things that "should happen" but won't).
7. Recommend 3 optional content additions (side secrets, alternate NPC paths, hidden areas) that fit the campaign's tone.

Output: A structured review document with PASS/FAIL/NEEDS REVISION per category, plus specific line-item fixes.
```

### Verification Tasks
- [ ] Engine boots from campaign.json with zero hardcoded references to specific files
- [ ] All real art assets display correctly (no placeholder squares remain)
- [ ] F5 playthrough test: all 10 steps log PASS
- [ ] No console errors during full playthrough
- [ ] Save/load round-trip: byte-by-byte comparison of critical state values pre- and post-load
- [ ] 60fps confirmed in DevTools during: night + rain + 4-party-member movement in large map
- [ ] Thief-locked door: Fighter gets correct lock failure UI; Thief opens it
- [ ] Day 2 NPC schedule change: innkeeper at new position confirmed
- [ ] Music audit: all 9 mood states trigger correctly across the campaign
- [ ] Trap system: hidden → detected → disarm chain completes without state errors
- [ ] Narrative review: no FAIL categories remain after fixes
- [ ] Campaign completable without combat (secret/skill path verified)
- [ ] Encounter rate matches config within ±5% over 50-move test
- [ ] Loot from defeated enemies appears in inventory post-combat
- [ ] All secrets in chain are discoverable in-game (no orphaned secrets requiring unreachable conditions)

---

## Summary Table

| Phase | Name | Type | Complexity | Parallel OK |
|---|---|---|---|---|
| 1 | Project Scaffold & Core Renderer | Coding | M | — |
| 2 | Map Engine & Tile System | Coding | L | — |
| 3 | Character Sprites, Movement & Party | Coding | M | — |
| 4 | Time System, Day/Night & Weather | Coding | M | — |
| 5 | Events & Scripting Engine | Coding | XL | — |
| 6 | NPC System, Schedules & Dialogue | Coding | L | — |
| 7 | Secrets, Factions & Journal | Coding | M | — |
| 8 | Inventory, Equipment & Items | Coding | L | — |
| 9 | Classes, Abilities & Lock System | Coding | L | — |
| 10 | Combat Engine: Arena & Turn Order | Coding | XL | — |
| 11 | Combat Resolution, Abilities & Status | Coding | L | — |
| 12 | Progression System | Coding | M | — |
| 13 | Encounter Generation & Traps | Coding | L | — |
| 14 | Music & Mood System | Coding | M | — |
| 15 | Save/Load & UI Polish | Coding | M | — |
| 16 | Art: Terrain, Structures & Objects | Asset Gen | L | ✓ |
| 17 | Art: Character & Enemy Sprites | Asset Gen | L | ✓ |
| 18 | Art: UI, Icons & Effects | Asset Gen | M | ✓ |
| 19 | Sample Campaign Design | General AI | L | ✓ (after GDD) |
| 20 | Integration Testing & Playthrough | Coding + AI | L | — |

**Critical path**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 20
**Parallel track**: 16, 17, 18, 19 (can run concurrently with coding phases 1–15)
