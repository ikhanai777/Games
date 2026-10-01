# BRICKSTORM

A brick-breaker in the Brick Blast / Ballz style, with more to chase: roguelite powers, a combo multiplier, special bricks, daily challenges, missions and permanent upgrades.

It is fully standalone: one file (`index.html`), no dependencies and no build step. It shares nothing with the rest of this repo.

## Play

Open `brickstorm/index.html` in any modern browser, or serve the folder:

```sh
npx serve brickstorm      # or: python3 -m http.server -d brickstorm
```

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Aim | Drag on the board | ← → |
| Fire | Release | Space / Enter |
| Cancel a shot | Drag back down to the floor | — |
| Speed up (1× / 2× / 3×) | ⏩ button | F |
| Recall all balls | ⤓ button | R |
| Pause | ❚❚ button | P / Esc |
| Mute | 🔊 button | M |

## What it adds to the classic formula

- **Powers.** At level 5 and every 10 levels, pick 1 of 3: Heavy Hitter, Deadeye crits, Chain Lightning, Mitosis ghost balls, Demolition, Greed, Twin Pickups, Foresight, Velocity, Phoenix revive, Reinforcements. Each run becomes a different build.
- **Combo multiplier.** Kills in a single turn raise the score multiplier up to ×5. Every hit plays the next note of a rising melody, so big turns sound big.
- **Special bricks.** Bombs (they chain-react), gold bricks (coins), crystal bricks (+1 ball), and a 3-wide **TITAN** boss every 15 levels.
- **Power-ups on the board.** +1 ball, coins, row and column lasers, fire (2× damage), and splitters (ghost balls).
- **Board clear bonus** when you wipe out every brick.
- **Revive.** When bricks breach the floor, pay coins (or use Phoenix) to wipe out the bottom 4 rows.
- **Meta progression.** Coins buy 7 ball skins with trails, and 4 permanent upgrades (starting balls, luck, crit, coin gain).
- **Missions.** 3 rotating missions that pay coins and get harder as you complete them.
- **Daily Challenge.** A seeded board that is the same for everyone each day, with a daily best score and a streak bonus.
- **Auto-save.** Close the tab mid-run and continue later from the start of your last turn.
- **Speed control.** Long turns speed up on their own, plus a manual 3× and a recall button.

All progress is stored in `localStorage` under keys prefixed `brickstorm.`.
