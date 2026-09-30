# PULSEGON

A beat-locked, two-button survival game. Every wall is a note. The design is in [`specs/pulsegon.md`](specs/pulsegon.md).

## Play

The arena is drawn in 3D by default. **Options → Camera view** (or **V** at any time) switches between:
- **3D**: a camera straight above the center. The walls rise toward you.
- **Perspective**: a tilted camera looking across the arena.
- **Flat 2D**: the original look.

The view is cosmetic only. Collisions and the fairness checks are identical in all three.

```sh
npm start          # serves game/ at http://localhost:8080
```

The game has no build step and no dependencies. It is plain ES modules in `game/`, so any static file server works.

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Rotate left / right | ← → (or A/D, Z/M) | LB/RB, D-pad, left stick | Hold the left or right half of the screen |
| Pulse | Both rotate keys together, or Space | A | Two fingers |
| Rewind after death | Hold ← | Hold left | Hold the left half |
| Retry | → / Space / Enter | Right / A | Tap the right half |
| Pause | Esc / P | Start | ‖ button |
| Switch view (3D / Perspective / Flat) | V | — | Options → Camera view |

## Test

```sh
npm test           # unit + fairness tests (Node 20+)
npm run smoke      # boots the game in headless Chromium (needs Playwright)
```

The fairness suite generates every stage (6 Movements × 3 tiers, many seeds), plus Endless and Gauntlet. A bot then drives the actual simulation along the validator's path. If the validator ever accepts something the simulation can't survive, the bot dies and the test fails.

## Layout

| File | What it does |
|---|---|
| `game/src/sim.js` | Deterministic 240 Hz simulation: movement, side-contact sliding, head-on deaths, grazes, Pulse, glass, inverters |
| `game/src/validator.js` | Reachability over (angle × time) that proves each sequence is survivable; also finds the death-cam escape path |
| `game/src/generator.js` | Places patterns on the beat, morphs the polygon on bar lines, handles Gauntlet song switches, and rerolls anything the validator rejects |
| `game/src/patterns.js` | Pattern library, including a PGN (Pulsegon Notation) parser for hand-authored patterns |
| `game/src/timeline.js` | Audio-clock ⇄ beat mapping with swing and tempo changes. It is the single source of musical time. |
| `game/src/audio.js` | Procedural stem-based music (drums → bass → arp → pad → lead) and sound effects |
| `game/src/render3d.js` | WebGL renderer (the default): extruded walls, flat lighting, fog, and a top-down or tilted perspective camera. A post-projection fit keeps the r = 1 disc filling the screen, so the reaction window is the same in every view. |
| `game/src/render.js` | Flat 2D canvas renderer (fallback without WebGL, or chosen in Options); also owns the polygon-shape math both renderers share |
| `game/src/main.js`, `ui.js` | State machine, run lifecycle, death cam, menus, HUD |

## Spec coverage

**Built:**
- Two-button core with a hitbox smaller than the sprite, side-contact sliding, and 240 Hz fixed-step input
- Beat-locked walls, driven by the audio clock
- Morphing 3–9-sided arena, with a telegraph and safe transitions
- Grazing, Pulse charges, Glass walls and Perfect pulses
- The other wall types: Pendulum, Shutter, Echo and Inverter
- Six Movements × three tiers, with unlocks
- Endless, Daily Seed (3 ranked attempts, stored locally) and Gauntlet
- Practice: checkpoints, a 50–100% speed slider, and the pattern gym
- Death cam: freeze, hold to rewind, and escape-path overlay; instant retry and auto-retry
- Milestone announcer, stem layering and palette shifts; tap-to-beat calibration
- Accessibility and comfort:
  - rotation 0–100%, and tilt, zoom and flashes can each be turned off
  - photosensitivity mode
  - mono and colorblind-safe palettes, wall outlines
  - audio wall cues, game-speed assist, one-button mode, Classic mode
  - key rebinding
- Separate record categories (standard, classic, assisted, one-button), and gamepad and touch support

**Not built yet:**
- Online features (§15): leaderboards, server-side replay verification, ghosts and async challenges. Records are stored locally only.
- The level editor and Workshop (§9.6). The PGN parser that the editor would use is in place.
- Native builds for Steam, iOS, Android or consoles. This is the web build.
- Licensed music. The soundtrack is generated procedurally with WebAudio.

**Deviations from the spec:**
- The pattern library has about 30 base patterns, not 120. Random rotation and mirroring make each one appear in many forms.
- Difficulty ratings are hand-set, not computed from validator metrics.
- Milestone names are LINE → … → HEXAGON → PULSEGON at 60 s, then HEPTAGON → NONAGON for Movement VI's 90 s goal.
