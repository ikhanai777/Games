# PULSEGON — Game Design & Technical Specification

**Status:** Draft v0.1
**Genre:** Minimalist rhythm-survival / twitch arcade
**Platforms:** PC (Steam), Web (WebGL2/WebGPU), iOS, Android, Switch-class consoles
**Reference title:** *Super Hexagon* (Terry Cavanagh, 2012)

---

## 1. Pitch

You are a single point orbiting a pulsing polygon. Walls collapse inward in time with the music. Two buttons: rotate left, rotate right. Survive.

PULSEGON keeps everything that makes *Super Hexagon* great: two-button purity, brutal difficulty, instant restarts, and a hypnotic audiovisual trance. Then it fixes what the original never addressed: patterns that ignore the music, too little content, deaths you can't read, no way to practice, no depth beyond memorization, and a presentation that makes a real share of players motion-sick.

**The one-line goal:** every wall is a note, every death is readable, and every run teaches you something.

---

## 2. Keep vs. Improve

| Pillar | *Super Hexagon* | PULSEGON |
|---|---|---|
| Controls | 2 buttons | Still 2 buttons. Pressing both together triggers **Pulse** (§6.4), an optional skill layer. |
| Music sync | Loose: patterns run on a timer, and the pulse is only visual | **Beat-locked**: every wall spawns on a beat subdivision, and patterns are authored per song (§8) |
| Arena | Hexagon, sometimes squares/pentagons | **Morphing polygon**, 3–9 sides, changing mid-run on phrase boundaries (§5.2) |
| Content | 6 levels, ~60 s each to "beat" | 6 Movements × 3 tiers + Endless, Daily, Gauntlet, and a community editor (§9) |
| Death feedback | Instant cut to game over | **Death cam**: 400 ms freeze-frame and rewind scrub showing the fatal wall (skippable) |
| Practice | None; always start from 0 s | Checkpoint practice, slow-mo practice, and a named pattern library (§9.5) |
| Fairness | Mostly fair, some "cheap" transitions | Every generated sequence is **machine-verified solvable** with a margin (§11) |
| Depth | Mostly pattern memorization | Grazing, Pulse charges, rhythm accuracy, and a separate style leaderboard |
| Comfort | Heavy rotation, no options | Full comfort and accessibility suite (§13) |
| Competitive | Local best times | Replay-verified leaderboards, ghosts, and daily seeds (§15) |

---

## 3. Core Loop

```
┌─► Select stage ─► Run (15 s – ∞) ─► Die ─► Death cam (0.4 s, skippable)
│                                              │
│          ◄──── instant retry (< 150 ms) ◄────┤
│                                              ▼
└──── Unlocks / records / ghosts ◄──── Results (only if player pauses)
```

- **Micro loop (seconds):** read incoming walls → pick a gap → rotate → graze for charge.
- **Session loop (minutes):** chase the next 10-second milestone. Milestones are announced vocally ("LINE" → "TRIANGLE" → … → "NONAGON", then "PULSEGON" at 60 s).
- **Meta loop (days/weeks):** clear all 18 stages, then chase daily seeds, leaderboards, and community levels.

**Restart latency is a hard requirement:** from death to controllable player again in ≤ 150 ms when the player presses a button during the death cam, and ≤ 600 ms if they don't.

---

## 4. Controls & Input

| Action | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Rotate CCW | ←, A, Z | LB / D-Left / L-stick left | Hold left half |
| Rotate CW | →, D, M | RB / D-Right / L-stick right | Hold right half |
| Pulse | Both at once (≤ 40 ms apart) | Both, or A button | Two-finger tap |
| Retry | Any rotate key during death cam | Any | Tap |
| Pause | Esc / P | Start | Two-finger hold 0.3 s |

- **Input is sampled per simulation tick (240 Hz)**, not per render frame.
- **Input buffering:** a press registered up to 1 tick before a restart carries into the new run.
- **Opposing inputs:** if both are held longer than the Pulse window, the most recent press wins. This matches *Super Hexagon*'s feel and avoids jitter.
- Full rebinding, including binding Pulse to a dedicated key for players who find chording hard.
- **Latency target:** ≤ 1 frame from input to visible motion at 60 Hz, and ≤ 2 frames at 144 Hz+.

---

## 5. World & Geometry

### 5.1 Coordinate system
- The arena is polar: the player's position is angle `θ ∈ [0, 360°)` at a fixed radius `r_p = 0.18` (normalized, where 1.0 = screen half-diagonal).
- The center polygon has radius `r_c = 0.12` and pulses ±8 % on each beat.
- Walls are **annular sector segments**, each with a `lane` index, `thickness` (radial), and a spawn radius `r_spawn = 1.1`.
- Walls move inward at speed `v_wall` (radius units/s) and are destroyed at `r < r_c`.

### 5.2 Polygon morphing
- The side count `N ∈ {3..9}` determines the lane count. Each lane spans `360°/N`.
- A morph happens **only on a phrase boundary** (every 4 or 8 bars, as the song chart dictates).
- **Telegraph:** a full bar before the morph, the polygon outline flickers between the current and next shapes and a rising audio sweep plays.
- **Safe transition rule:** no wall may be within `r < r_p + 0.25` at the moment of a morph. The player's angular position is preserved, and the lane under them is guaranteed open for 1 beat after the morph.

### 5.3 Camera
- The arena rotates at `ω_cam` (default 60–180 °/s, varying by section) and reverses direction on authored cues.
- Perspective skew ("tilt") of up to 25° for pseudo-3D, on authored cues.
- **Zoom punch** of ±4 % on downbeats.
- All camera effects are cosmetic only. They never change collision, and they are scalable or disableable (§13).

---

## 6. Player Mechanics

### 6.1 Movement
- Angular speed is `ω_p = 480 °/s` at tier 1, 540 °/s at tier 2, and 600 °/s at tier 3. It is constant with no acceleration, for precision.
- Movement is continuous (not lane-snapped), so you can hug wall edges.

### 6.2 Collision
- The player is visually a triangle 0.022 wide, but its **hitbox is a 0.014-wide arc** (≈ 64 % of visual). This makes near-misses feel earned.
- **Head-on contact** (a wall's inner edge crosses `r_p` while overlapping the player's arc) = death.
- **Side contact** (rotating into the side of a wall) = blocked with no death, and the player slides along it. This matches *Super Hexagon* and must be preserved exactly.
- Collision is tested on the continuous path between ticks (swept arc vs. swept wall), so there is no tunneling at high speed.

### 6.3 Graze
- Passing within `0.010` angular-radius of a wall edge without collision earns a **graze**, with a spark and a pitch-shifted hi-hat tick.
- Grazes fill the **Pulse meter**: 1 graze = 1 pip, 12 pips = 1 charge, and the maximum is 3 charges.
- Grazes also feed the **Style score** (§10), never the Time score.

### 6.4 Pulse (optional depth layer)
- **Trigger:** both rotate inputs within 40 ms of each other, with ≥ 1 charge.
- **Effect:** the player becomes intangible to **Glass walls** for 1/8 note of the current song (e.g., 125 ms at 120 BPM). It has no effect on solid walls.
- **Glass walls** are a visually distinct wall type (translucent, hatched, with a unique shimmer sound). A pattern *may* use Glass walls to offer a shortcut, but **must never require Pulse to survive.** The validator (§11) enforces this.
- If Pulse lands exactly on a beat (±30 ms), it refunds half a charge and scores **Perfect**.
- **Classic mode** removes Pulse, grazing, and Glass walls entirely, for purists and for a separate leaderboard category.

---

## 7. Obstacles & Pattern System

### 7.1 Wall types
| Type | Behavior | First appears |
|---|---|---|
| Solid | Standard, lethal on head-on | Movement I |
| Glass | Passable with Pulse; otherwise solid | Movement II |
| Pendulum | Oscillates ± 1 lane on the beat while approaching | Movement III |
| Shutter | Opens and closes on off-beats (visible 1 beat ahead) | Movement IV |
| Echo | A faint ghost of an upcoming wall, 1 bar early | Movement V (tutorial for reading) |
| Inverter | Passing through its gap flips rotation controls for 1 bar, with a loud telegraph | Movement VI, Ultra tier only |

### 7.2 Patterns
Patterns are the unit of design, like *Super Hexagon*'s named patterns ("whirlpool", "ladder", etc.).

- A pattern is a list of `(beat_offset, lane_mask, thickness, type)` events, **authored relative to lane count**, so the same pattern works on any `N`.
- Patterns are written in a small text format (**PGN — Pulsegon Notation**):

```
pattern "ladder"   # alternating gaps, climbs 1 lane per beat
  meter 1/4
  sides any
  0    ##.###   solid
  1    ###.##   solid
  2    ####.#   solid
  3    #####.   solid
end
```

- Transforms that can be applied at spawn time: `mirror`, `rotate(k)`, `stretch(×2)`, `thin`, `glassify(p)`.
- The library ships with ≥ 120 named patterns. Each has a difficulty rating derived from validator metrics (§11.3).

### 7.3 Sequencing
- **Movement stages** use a hand-authored **chart** per song: an ordered list of patterns bound to bar numbers, with optional random pools per section ("bars 33–48: pick from {spiral, ladder, cage} weighted").
- **Endless** uses a generator. It picks patterns by target difficulty curve, song energy (from the chart's intensity lane), and the previous pattern's exit lane, so transitions flow.

---

## 8. Music & Rhythm Sync

This is the biggest single upgrade over *Super Hexagon*.

- Every song ships with a **chart**: BPM map (supports tempo changes), time signature, phrase markers, intensity lane (0–1), and cue lane (camera flips, morphs, color shifts).
- **Walls spawn so their inner edge hits `r_p` exactly on the intended beat.** Spawn time is back-computed: `t_spawn = t_beat − (r_spawn − r_p) / v_wall`.
- `v_wall` is derived from BPM and tier, so that walls stay a readable **~2.25 beats** on screen at Normal and ~1.5 beats at Ultra.
- **Audio clock is the master clock.** The simulation reads the audio DSP time and drift-corrects the fixed-step sim by at most ±1 tick per 250 ms. There is never a visible jump.
- **Calibration screen:** a tap-to-the-beat test measures audio and visual offset and stores it per output device.
- **Adaptive music:** each track has stems (drums, bass, lead, pads). Stems layer in as the player crosses 10 s milestones, and all non-drum stems duck on death. The music **never restarts on retry**. It keeps playing and the new run joins at the next bar with a quantized start (≤ 1 bar wait, skippable to "start now"), for continuous trance flow.

---

## 9. Modes & Content

### 9.1 Movements (campaign)
Six Movements, each with its own song, palette, signature wall type, and 3 tiers:

| # | Movement | BPM | Signature | Tier goals (Normal / Hyper / Ultra) |
|---|---|---|---|---|
| I | *Ignition* | 128 | Solid walls, hexagon only | 60 s each |
| II | *Refraction* | 138 | Glass walls, square↔hex morph | 60 s each |
| III | *Swing* | 112 (swung) | Pendulums, triangles | 60 s each |
| IV | *Aperture* | 150 | Shutters, off-beat reading | 60 s each |
| V | *Echo Chamber* | 160 | Echo walls, 3–9 side morphs | 60 s each |
| VI | *Pulsegon* | 174 | Everything + Inverters | 90 s each |

- Clearing any tier unlocks the next tier of that Movement plus the next Movement's tier 1.
- **Movement VI Ultra** is the "you beat the game" moment, with a secret ending sequence similar to *Super Hexagon*'s hyper-level reveal.

### 9.2 Endless
Choose a Movement's song and palette. The generator runs indefinitely with difficulty ramping per the §11.3 curve, and there are separate leaderboards per song.

### 9.3 Daily Seed
One global seed per day (UTC) over a rotating song. There are **3 attempts** that count toward the board, plus unlimited practice attempts that don't.

### 9.4 Gauntlet
All six Movements back-to-back at a chosen tier, with seamless song crossfades and polygon morphs at the transitions. A single life.

### 9.5 Practice
- **Checkpoint start:** begin any cleared stage from any 10 s milestone you have previously reached.
- **Speed slider:** 50 %–100 % speed. Pitch-corrected music keeps the rhythm intact.
- **Pattern gym:** loop any named pattern from the library. The death cam shows the optimal path overlay.
- Practice runs never post to leaderboards.

### 9.6 Editor & Workshop
- An in-game editor with a timeline view (bars × lanes) and live preview. Import your own audio (OGG/MP3/FLAC) with auto BPM detection plus a manual tap-tempo override.
- The validator (§11) must pass before publishing, which blocks impossible levels.
- Workshop features: ratings, "verified by author" badge (the author must clear their own level), and weekly featured picks.

---

## 10. Scoring & Progression

- **Time** (primary, to 1/100 s) is the only thing that matters for Movement clears, matching *Super Hexagon*'s clarity.
- **Style** (secondary board) is computed as `Σ grazes × 10 + Perfect Pulses × 50 + time_bonus`. The multiplier increases every 10 s survived without using Pulse.
- **Milestones** at 10 / 20 / 30 / 40 / 50 / 60 s trigger a voice callout, a palette shift, a stem layer, and a (subtle) screen shift.
- **Unlockables:** palettes, player shapes (cosmetic only, same hitbox), announcer voices, visualizer modes, and the editor's advanced wall types.
- There is no XP, no currency, and no gameplay-affecting unlocks. **Skill is the only progression.**

---

## 11. Difficulty & Fairness

### 11.1 Reaction budget
For every wall, there must be a path the player can physically take:

```
t_available = (r_spawn_visible − r_p) / v_wall          # time wall is on screen
t_required  = Δθ_min / ω_p + t_react(tier)              # travel + reaction
Require: t_available ≥ t_required
```

`t_react` is 220 ms for Normal, 170 ms for Hyper, and 130 ms for Ultra.

### 11.2 Solvability validator
- Discretize angle into 720 steps and time into sim ticks (240 Hz). Run a reachability search over `(θ, t)` given `ω_p` and side-contact sliding.
- A sequence is **valid** if a surviving path exists with an angular clearance margin of ≥ 1.5 × hitbox width at every head-on crossing, without using Pulse.
- The validator runs:
  - at build time over all authored charts (CI blocks the build on failure),
  - at runtime on every generator output 2 bars ahead (if a candidate fails, it is rerolled; the budget is 5 rerolls, then it falls back to a known-safe pattern),
  - in the editor before publishing.

### 11.3 Difficulty metrics
Each pattern and sequence gets a measured score from validator output:
- **Path width:** mean angular width of the safe corridor.
- **Turn density:** direction reversals per second on the optimal path.
- **Commitment:** number of forks where the wrong choice is fatal within 1 beat.

The Endless difficulty curve targets a smooth ramp of these metrics over time, with deliberate "breather" bars every 16 bars.

### 11.4 Anti-cheap rules
- There are no walls spawning inside the visible radius, ever.
- There are no rotation-direction flips of the camera within 1 beat of a commitment fork.
- The first 2 bars of any run are a fixed warm-up pattern, so there is no death on spawn.

---

## 12. Presentation

### 12.1 Visuals
- A flat vector aesthetic with **3-color palettes per section** (background A/B stripes, walls, player/center). Palettes cross-fade on phrase boundaries.
- Rendering uses MSAA 4× or analytic AA on all edges. The render resolution is independent of the sim.
- **Beat-reactive elements:** the center polygon pulse, background stripe brightness, and a wall edge glow on kick drums.
- **Readability rule:** walls must keep ≥ 4.5:1 luminance contrast against both background stripes at all times, including during palette transitions. This is enforced in the palette tooling.

### 12.2 Death cam
- Freeze for 400 ms with a red flash on the killing wall edge and the player's last 0.5 s trail drawn.
- Hold rotate-left to scrub back up to 2 s, with the optimal escape path drawn as a dotted line.
- Pressing rotate-right (or any key in "quick retry" mode) restarts immediately.

### 12.3 Audio feedback
- Graze tick, Pulse whoosh, and a glass-shatter sound when passing Glass during Pulse.
- The milestone announcer and a death "record scratch" play as a quantized one-shot so they stay on beat.

---

## 13. Accessibility & Comfort

| Option | Range / Values |
|---|---|
| Camera rotation intensity | 0 %–100 % (0 % = static arena, gameplay-identical) |
| Tilt / zoom punch / flashes | Individually toggleable |
| Photosensitivity mode | Caps luminance change to ≤ 3 flashes/s (meets WCAG 2.3.1) |
| Colorblind palettes | Protan, deutan, and tritan-safe; high-contrast mono |
| Wall outline mode | Thick outlines, independent of palette |
| Audio cues for walls | Spatialized stereo tick panned to each approaching wall's angle |
| Game speed assist | 70 %–100 %. Runs are flagged "Assisted", with their own boards. |
| One-button mode | Tap to reverse direction (constant rotation). Separate boards. |
| Motion sickness preset | Rotation 20 %, no tilt, no zoom, steady background |

**Principle:** comfort options that don't change difficulty (rotation, colors, flashes) keep full leaderboard eligibility. Options that do change difficulty (speed, one-button) get their own boards, and no one is shamed for using them.

---

## 14. Technical Specification

### 14.1 Architecture
- **Deterministic fixed-step simulation at 240 Hz** in fixed-point (Q16.16) or strictly ordered float with no FMA variance. The sim is pure: `state' = step(state, input_bits)`.
- The renderer interpolates between the last two sim states and is uncapped (supports 60–360 Hz displays and VRR).
- **Reference stack:** TypeScript + WebGL2 (WebGPU when available) for the web build. The same sim core compiles to WASM and native via a shared Rust or C++ crate. The sim core has **zero engine dependencies** so it can be validated headless.

### 14.2 Performance budgets
| Target | Budget |
|---|---|
| Sim tick | ≤ 0.2 ms |
| Frame (render) | ≤ 2 ms on integrated GPU at 1080p |
| Cold start to menu | ≤ 2 s (desktop), ≤ 3 s (mobile) |
| Retry | ≤ 150 ms (see §3) |
| Memory | ≤ 256 MB |
| Web bundle (excl. music) | ≤ 5 MB gzip |

### 14.3 Replays
- A replay is `(game_version, stage_id, seed, input_bitstream)`, compressed with RLE, so ~1 KB per minute.
- Replays are used for ghosts, death cam scrubbing, leaderboard verification, and bug reproduction.

### 14.4 Save data
Local JSON plus optional cloud sync. It stores records, unlocks, settings, and calibration offsets per audio device.

---

## 15. Online

- **Leaderboards** are organized per stage × tier × category (Classic / Standard / Assisted / One-button) × metric (Time / Style), with filters for friends, global, and daily.
- **Anti-cheat:** every top-1000 submission includes its replay, and the server re-simulates it headlessly. If the result mismatches, the score is rejected.
- **Ghosts:** race your PB or any leaderboard replay. The ghost is rendered as a translucent player marker.
- **Async challenges:** send a friend a seed plus your time.

---

## 16. UX Flow

- **Title → stage select in one input.** Stage select is itself a rotating polygon, where rotating left/right picks the Movement and a vertical input picks the tier. The level's music previews live.
- There are no confirmation dialogs anywhere in the play path.
- Pause shows the current time, PB, and a pattern name of the last wall ("You died to: LADDER ×2 mirrored"), which links to the pattern gym.
- **Tutorials** are integrated: Movement I's first 20 s is a teaching chart with no text. Mechanics are introduced by isolated, forgiving patterns.

---

## 17. Success Criteria

| Metric | Target |
|---|---|
| Median retry latency (telemetry) | < 200 ms |
| Deaths rated "unfair" in playtests (post-death 1-tap survey) | < 3 % |
| D1 / D7 retention | 45 % / 20 % |
| Share of players using the death cam scrub at least once | > 30 % |
| Workshop levels published in 90 days | > 5,000 |
| Motion sickness complaints in reviews | < 1 % |
| Median session length | > 12 min |

---

## 18. Milestones

| Phase | Scope | Exit criteria |
|---|---|---|
| **M0 — Feel prototype** (4 wks) | Sim core, 2-button movement, solid walls, hexagon, 1 song, beat-locked spawns | Blind playtesters prefer its feel vs. *Super Hexagon* in ≥ 50 % of A/B sessions |
| **M1 — Vertical slice** (8 wks) | Movement I–II all tiers, morphing, graze, Pulse, Glass, death cam, validator in CI | 0 validator failures; retry < 150 ms on min-spec |
| **M2 — Content complete** (12 wks) | All 6 Movements, Endless, Practice, accessibility suite | All 18 stages cleared by QA without assists |
| **M3 — Online & Editor** (8 wks) | Replays, leaderboards, anti-cheat re-sim, Daily, Editor, Workshop | Replay re-sim matches on 100 % of 10k fuzzed runs across platforms |
| **M4 — Polish & launch** (6 wks) | Perf, localization, platform certs, trailer | Hits all §14.2 budgets on every target |

---

## 19. Open Questions

1. Should Pulse be in the *default* mode, or should it be an unlockable after clearing Movement I Hyper to protect first-impression purity?
2. Should the licensed soundtrack come from a single artist (cohesion, like Chipzel for *Super Hexagon*) or from several?
3. Inverter walls may be too hostile even at Ultra. We need playtest data before committing.
4. Should the mobile hitbox be more generous to offset touch latency, which would require separate boards?
5. Should the Workshop allow custom wall *behaviors* (scripting), or only the fixed wall types (safer and easier to validate)?
