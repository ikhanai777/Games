# Brickstorm promo reel

- **`brickstorm-reel.mp4`**: a 26-second Instagram Reel / TikTok / YouTube Shorts ad. It is 1080×1920, 30 fps, H.264 High with AAC stereo audio, loudness-normalized to −14 LUFS, with faststart for streaming.
- **`reel-cover.jpg`**: the cover frame (the "TITAN DOWN!" moment).

All gameplay in the reel is real footage of the actual game (`../index.html`), captured frame by frame. The sound effects are the game's own sounds, placed where they happened in that footage.

## Storyboard

| Time | Caption | Footage |
|---|---|---|
| 0–1.5s | ONE SWIPE | Finger drags the aim line |
| 1.5–3.6s | 60 BALLS. ONE SHOT. | The volley fires |
| 3.6–7.2s | COMBO UP TO ×5 | Bombs, lasers, ×3.5 combo |
| 7.2–9.8s | SMASH THE TITAN 👑 | Prism skin, Titan boss destroyed |
| 9.8–12.5s | CLEAR THE BOARD | The board is wiped out |
| 12.5–15s | PICK A POWER | Power choice screen, tap |
| 15–17.3s | UNLOCK SKINS | Shop, tap |
| 17.3–19.6s | DAILY CHALLENGE | Menu with missions and streak, tap |
| 19.6–21.8s | BEAT YOUR BEST | Game over screen with NEW BEST |
| 21.8–26s | End card | Icon, "PLAY NOW ▶", "Now on Android" |

## Suggested post caption

> One swipe. 60 balls. Total chaos. 💥
> Brickstorm is the brick breaker you can't put down: combos up to ×5, bomb chain reactions, boss Titans, and a new power every 10 levels. 🎮
> 📴 Plays offline · 🚫 No ads · ⚡ 60 KB
> Download now on Android 👉 link in bio
>
> #brickbreaker #mobilegames #androidgames #indiegame #puzzlegame #arcade #gaming #offlinegames #newgame #brickstorm

## Regenerate

Needs Node with Playwright (and its Chromium), Python 3 and ffmpeg. Run these from `source/`:

```sh
node capture.cjs                  # real gameplay frames -> frames/, plus meta.json (events, finger path)
node render.cjs 0 780             # 1080x1920 reel frames -> out/
python3 audio.py                  # soundtrack -> audio.wav
ffmpeg -framerate 30 -i out/%04d.jpg -i audio.wav \
  -filter_complex "[1:a]loudnorm=I=-14:TP=-1.5:LRA=11,aformat=channel_layouts=stereo,aresample=48000[a]" \
  -map 0:v -map "[a]" -c:v libx264 -profile:v high -preset slow -crf 17 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -movflags +faststart -shortest ../brickstorm-reel.mp4
```

Create `frames/` and `out/` first. They are git-ignored. Captions and timing are in `reel.html` (`SEG` and `CAPS`). The font is Poppins (SIL Open Font License).
