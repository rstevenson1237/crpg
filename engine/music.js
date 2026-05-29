/**
 * music.js — Music and mood system (Phase 14).
 *
 * Manages layered audio stems (base, tension, melody) using the Web Audio API.
 * Moods transition with 4-second gain crossfades. Real audio files can be
 * dropped in by replacing the procedural oscillators; the profile format and
 * priority resolution logic are production-ready.
 *
 * Mood priority (highest wins):
 *   1. forceMood() override (set_music_mood event action, with optional duration)
 *   2. Combat state
 *   3. Profile event_flag_overrides
 *   4. Profile time_of_day_overrides
 *   5. Profile weather_overrides
 *   6. Profile base_mood
 *   7. "peaceful" default
 *
 * Exposed as window.MusicEngine for console testing.
 */

const CROSSFADE_SEC = 4.0;

// ── Mood constants ────────────────────────────────────────────────────────────

export const MOOD_STATES = [
  'peaceful', 'mysterious', 'tense', 'danger',
  'combat', 'melancholy', 'triumphant', 'sacred', 'dread',
];

/**
 * Stem configuration per mood.
 * freq=0 → stem is silent for this mood.
 * gain → multiplier applied on top of STEM_BASE_GAIN.
 */
const MOOD_CONFIG = {
  peaceful:   { base: { freq: 220, gain: 1.0 }, tension: { freq: 0,   gain: 0   }, melody: { freq: 264, gain: 0.8 } },
  mysterious: { base: { freq: 196, gain: 1.0 }, tension: { freq: 110, gain: 0.5 }, melody: { freq: 0,   gain: 0   } },
  tense:      { base: { freq: 110, gain: 1.0 }, tension: { freq: 165, gain: 1.0 }, melody: { freq: 0,   gain: 0   } },
  danger:     { base: { freq: 80,  gain: 1.0 }, tension: { freq: 120, gain: 1.0 }, melody: { freq: 0,   gain: 0   } },
  combat:     { base: { freq: 80,  gain: 1.0 }, tension: { freq: 120, gain: 1.0 }, melody: { freq: 0,   gain: 0   } },
  melancholy: { base: { freq: 196, gain: 0.6 }, tension: { freq: 0,   gain: 0   }, melody: { freq: 220, gain: 1.0 } },
  triumphant: { base: { freq: 262, gain: 1.0 }, tension: { freq: 330, gain: 1.0 }, melody: { freq: 392, gain: 1.0 } },
  sacred:     { base: { freq: 174, gain: 1.0 }, tension: { freq: 0,   gain: 0   }, melody: { freq: 220, gain: 0.5 } },
  dread:      { base: { freq: 65,  gain: 0.8 }, tension: { freq: 87,  gain: 1.0 }, melody: { freq: 0,   gain: 0   } },
};

// Master per-stem gain so oscillators aren't deafening
const STEM_BASE_GAIN = 0.055;

// ── Stinger definitions ───────────────────────────────────────────────────────

// Each stinger is an array of { freq, dur } notes played in quick sequence.
const STINGER_CONFIG = {
  discovery:    [{ freq: 330, dur: 0.14 }, { freq: 440, dur: 0.14 }, { freq: 528, dur: 0.28 }],
  death:        [{ freq: 220, dur: 0.28 }, { freq: 146, dur: 0.35 }, { freq: 110, dur: 0.55 }],
  revelation:   [{ freq: 440, dur: 0.07 }, { freq: 528, dur: 0.07 }, { freq: 660, dur: 0.45 }],
  danger_spike: [{ freq: 160, dur: 0.05 }, { freq: 80,  dur: 0.28 }],
  victory:      [{ freq: 262, dur: 0.11 }, { freq: 330, dur: 0.11 }, { freq: 392, dur: 0.11 }, { freq: 524, dur: 0.38 }],
};

// ── Module state ──────────────────────────────────────────────────────────────

let _ctx         = null;   // AudioContext
let _masterGain  = null;   // GainNode → destination

// Per-stem active oscillator: { osc: OscillatorNode, gain: GainNode } | null
let _activeOscs = { base: null, tension: null, melody: null };

// Oscillators currently fading out: [{ osc, gain, stopAt }]
let _fadingOscs = [];

let _volume      = 0.5;
let _muted       = false;
let _initialized = false;

let _currentMood    = 'peaceful';
let _currentProfile = null;   // parsed profile JSON object
let _profiles       = new Map(); // profileId → parsed JSON

// Override state
let _forcedMood          = null;
let _forcedMoodTurnsLeft = 0;
let _combatMode          = false;

// External state providers
let _gameFlags   = null;
let _gameTime    = null;
let _gameWeather = null;

// ── MusicEngine exported object ───────────────────────────────────────────────

export const MusicEngine = {

  // ── Initialisation ──────────────────────────────────────────────────────────

  /**
   * Must be called from a user-interaction handler (button click, keydown, etc.)
   * to satisfy the browser's autoplay policy. Safe to call multiple times.
   */
  init() {
    if (_initialized) return;
    _ctx        = new AudioContext();
    _masterGain = _ctx.createGain();
    _masterGain.gain.value = _muted ? 0 : _volume;
    _masterGain.connect(_ctx.destination);
    _initialized = true;
    console.log('[Music] AudioContext initialized');

    // Apply the current mood immediately so tones start on first interaction
    _applyStemConfig(MOOD_CONFIG[_currentMood]);
  },

  // ── State providers ─────────────────────────────────────────────────────────

  setFlags(flags)    { _gameFlags   = flags; },
  setGameTime(t)     { _gameTime    = t; },
  setWeather(w)      { _gameWeather = w; },

  // ── Profile management ───────────────────────────────────────────────────────

  async loadProfile(profileId) {
    if (_profiles.has(profileId)) return;
    try {
      const data = await fetch(`/data/music/${profileId}.json`).then(r => r.json());
      _profiles.set(profileId, data);
      console.log(`[Music] Profile loaded: ${profileId}`);
    } catch {
      console.warn(`[Music] Profile not found: ${profileId} — using peaceful fallback`);
      _profiles.set(profileId, {
        profile_id: profileId,
        base_mood: 'peaceful',
        stems: {},
        time_of_day_overrides: {},
        weather_overrides: {},
        event_flag_overrides: [],
      });
    }
  },

  async setProfile(profileId) {
    await this.loadProfile(profileId);
    _currentProfile = _profiles.get(profileId);
    this.evaluate();
    console.log(`[Music] Profile active: ${profileId} (base: ${_currentProfile?.base_mood})`);
  },

  // ── Mood control ─────────────────────────────────────────────────────────────

  /**
   * Force a specific mood for durationTurns game turns.
   * Pass null for indefinite override (cleared only by another forceMood call or
   * calling clearForcedMood()).
   * @param {string} mood
   * @param {number|null} durationTurns
   */
  forceMood(mood, durationTurns = null) {
    if (!MOOD_STATES.includes(mood)) {
      console.warn(`[Music] Unknown mood for forceMood: ${mood}`);
      return;
    }
    _forcedMood          = mood;
    _forcedMoodTurnsLeft = durationTurns ?? Infinity;
    this.setMood(mood);
    console.log(`[Music] Forced mood: ${mood} for ${durationTurns ?? '∞'} turns`);
  },

  clearForcedMood() {
    _forcedMood          = null;
    _forcedMoodTurnsLeft = 0;
    this.evaluate();
  },

  /** Activate or deactivate the combat mood override. */
  setCombatMode(active) {
    _combatMode = active;
    this.evaluate();
  },

  /**
   * Re-run mood resolution and crossfade if the result differs from current mood.
   * Called each game turn, on time-state change, on weather change, and on flag change.
   */
  evaluate() {
    if (!_initialized) return;
    const resolved = _resolveMood();
    if (resolved !== _currentMood) this.setMood(resolved);
  },

  /**
   * Set mood immediately with 4-second crossfade.
   * @param {string} mood
   */
  setMood(mood) {
    if (!_initialized) return;
    if (!MOOD_STATES.includes(mood)) {
      console.warn(`[Music] Unknown mood: ${mood}`);
      return;
    }
    if (mood === _currentMood && _activeOscs.base) return; // already playing this mood
    _currentMood = mood;
    _applyStemConfig(MOOD_CONFIG[mood]);
    console.log(`[Music] Mood → ${mood}`);
  },

  /** Called each game turn to decrement forced-mood duration and clean up. */
  tick() {
    if (_forcedMood && _forcedMoodTurnsLeft !== Infinity) {
      _forcedMoodTurnsLeft--;
      if (_forcedMoodTurnsLeft <= 0) {
        _forcedMood          = null;
        _forcedMoodTurnsLeft = 0;
        console.log('[Music] Forced mood expired — reverting');
        this.evaluate();
      }
    }
    // Remove oscillators whose fade has completed
    if (_ctx) {
      const now = _ctx.currentTime;
      _fadingOscs = _fadingOscs.filter(entry => {
        if (now >= entry.stopAt) {
          try { entry.osc.stop(); } catch {}
          entry.gain.disconnect();
          return false;
        }
        return true;
      });
    }
  },

  // ── Volume / mute ────────────────────────────────────────────────────────────

  setVolume(vol) {
    _volume = Math.max(0, Math.min(1, vol));
    if (_masterGain && !_muted) _masterGain.gain.value = _volume;
  },

  getVolume()      { return _volume; },
  isMuted()        { return _muted; },
  getCurrentMood() { return _currentMood; },
  isInitialized()  { return _initialized; },

  mute() {
    _muted = true;
    if (_masterGain) _masterGain.gain.linearRampToValueAtTime(0, (_ctx?.currentTime ?? 0) + 0.3);
  },

  unmute() {
    _muted = false;
    if (_masterGain) _masterGain.gain.linearRampToValueAtTime(_volume, (_ctx?.currentTime ?? 0) + 0.3);
  },

  toggleMute() {
    if (_muted) this.unmute(); else this.mute();
  },

  // ── Stingers ─────────────────────────────────────────────────────────────────

  /**
   * Play a one-shot stinger over the current stems.
   * @param {"discovery"|"death"|"revelation"|"danger_spike"|"victory"} stingerId
   */
  playStinger(stingerId) {
    if (!_initialized) return;
    const notes = STINGER_CONFIG[stingerId];
    if (!notes) { console.warn(`[Music] Unknown stinger: ${stingerId}`); return; }

    let t = _ctx.currentTime;
    for (const note of notes) {
      const osc  = _ctx.createOscillator();
      const gain = _ctx.createGain();
      osc.type           = 'sine';
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.09, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + note.dur);
      osc.connect(gain);
      gain.connect(_masterGain);
      osc.start(t);
      osc.stop(t + note.dur + 0.05);
      t += note.dur * 0.6; // overlap notes slightly
    }
    console.log(`[Music] Stinger: ${stingerId}`);
  },
};

// ── Private helpers ───────────────────────────────────────────────────────────

function _resolveMood() {
  // 1. Forced mood override
  if (_forcedMood) return _forcedMood;

  // 2. Combat override
  if (_combatMode) return 'combat';

  const profile = _currentProfile;
  if (!profile) return 'peaceful';

  // 3. Event flag overrides from current profile
  if (_gameFlags && profile.event_flag_overrides?.length) {
    for (const entry of profile.event_flag_overrides) {
      if (_gameFlags.isSet(entry.flag_id)) return entry.override_mood;
    }
  }

  // 4. Time-of-day overrides
  if (_gameTime && profile.time_of_day_overrides) {
    const tod = _gameTime.getState();
    if (profile.time_of_day_overrides[tod]) return profile.time_of_day_overrides[tod];
  }

  // 5. Weather overrides
  if (_gameWeather && profile.weather_overrides) {
    const wx = _gameWeather.getState();
    if (profile.weather_overrides[wx]) return profile.weather_overrides[wx];
  }

  // 6. Profile base mood
  return profile.base_mood ?? 'peaceful';
}

/**
 * Crossfade all three stems to the target configuration.
 * For each stem:
 *   - If freq=0: fade current oscillator out and stop it.
 *   - If freq > 0 and same as current: ramp gain only.
 *   - If freq > 0 and different (or no current): create new oscillator,
 *     fade it in while fading the old one out.
 */
function _applyStemConfig(config) {
  if (!_ctx) return;
  const now     = _ctx.currentTime;
  const fadeEnd = now + CROSSFADE_SEC;

  for (const stemName of ['base', 'tension', 'melody']) {
    const stemCfg    = config[stemName];
    const current    = _activeOscs[stemName];
    const targetGain = stemCfg.gain * STEM_BASE_GAIN;

    if (stemCfg.freq === 0) {
      // Stem should be silent — fade out and discard current oscillator
      if (current) {
        current.gain.gain.setValueAtTime(current.gain.gain.value, now);
        current.gain.gain.linearRampToValueAtTime(0.0001, fadeEnd);
        _fadingOscs.push({ osc: current.osc, gain: current.gain, stopAt: fadeEnd + 0.1 });
        _activeOscs[stemName] = null;
      }
    } else {
      const freqMatch = current && Math.abs(current.osc.frequency.value - stemCfg.freq) < 1;

      if (freqMatch) {
        // Same frequency — just ramp gain to new target level
        current.gain.gain.setValueAtTime(current.gain.gain.value, now);
        current.gain.gain.linearRampToValueAtTime(targetGain, fadeEnd);
      } else {
        // New frequency required — fade out old, create new
        if (current) {
          current.gain.gain.setValueAtTime(current.gain.gain.value, now);
          current.gain.gain.linearRampToValueAtTime(0.0001, fadeEnd);
          _fadingOscs.push({ osc: current.osc, gain: current.gain, stopAt: fadeEnd + 0.1 });
        }
        const osc  = _ctx.createOscillator();
        const gain = _ctx.createGain();
        osc.type            = 'sine';
        osc.frequency.value = stemCfg.freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(targetGain, fadeEnd);
        osc.connect(gain);
        gain.connect(_masterGain);
        osc.start(now);
        _activeOscs[stemName] = { osc, gain };
      }
    }
  }
}

if (typeof window !== 'undefined') window.MusicEngine = MusicEngine;
