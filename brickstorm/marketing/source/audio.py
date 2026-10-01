# Soundtrack for the reel: a 125 BPM synth beat + the game's own sound effects,
# placed at the exact frames where they happened in the captured gameplay.
import json, math, random, struct, wave, os
SR = 44100
DUR = 26.0
N = int(SR * DUR)
music = [0.0] * N
sfx = [0.0] * N
random.seed(3)
here = os.path.dirname(os.path.abspath(__file__))
meta = json.load(open(os.path.join(here, 'meta.json')))

def add(buf, start, samples):
    i0 = int(start * SR)
    for k, v in enumerate(samples):
        i = i0 + k
        if 0 <= i < N: buf[i] += v

def env_exp(n, attack, decay):
    a = max(1, int(attack * SR))
    return [(k / a) if k < a else math.exp(-(k - a) / (decay * SR)) for k in range(n)]

def tone(f, dur, kind='sine', vol=0.2, f2=None, attack=0.005):
    n = int(dur * SR); out = []; ph = 0.0
    env = env_exp(n, attack, dur / 5)
    for k in range(n):
        fr = f * (f2 / f) ** (k / n) if f2 else f
        ph += 2 * math.pi * fr / SR
        if kind == 'sine': v = math.sin(ph)
        elif kind == 'tri': v = 2 / math.pi * math.asin(math.sin(ph))
        elif kind == 'square': v = 1.0 if math.sin(ph) > 0 else -1.0
        else:  # saw
            v = 2 * ((ph / (2 * math.pi)) % 1) - 1
        out.append(v * vol * env[k])
    return out

def noise(dur, vol, color=0.0, hp=False):
    n = int(dur * SR); out = []; lp = 0.0; prev = 0.0
    env = env_exp(n, 0.001, dur / 5)
    for k in range(n):
        w = random.uniform(-1, 1)
        lp = lp + (1 - color) * (w - lp)
        v = (lp - prev) if hp else lp
        prev = lp
        out.append(v * vol * env[k])
    return out

# ---------------- music
BPM = 125; beat = 60 / BPM
END_CARD = 21.8
prog = [57, 53, 48, 55]  # A, F, C, G (midi roots)
midi = lambda m: 440 * 2 ** ((m - 69) / 12)
kick = [math.sin(2 * math.pi * (45 * k / SR + 105 * (1 - math.exp(-k / (0.04 * SR))) * 0.04)) * math.exp(-k / (0.16 * SR)) * 0.9 for k in range(int(0.4 * SR))]
clap = noise(0.18, 0.35, 0.3)
hat = noise(0.05, 0.25, 0.0, hp=True)
nb = int(DUR / beat) + 1
for b in range(nb):
    t = b * beat
    if t >= DUR: break
    final = t >= END_CARD
    if t < 0.0: continue
    add(music, t, [v * (0.75 if final else 1) for v in kick])
    if b % 2 == 1 and not final: add(music, t, clap)
    add(music, t + beat / 2, hat)
    if not final: add(music, t + beat / 4, [v * 0.5 for v in hat]); add(music, t + 3 * beat / 4, [v * 0.5 for v in hat])
    root = prog[(b // 4) % 4]
    for h, o in ((0, 0), (0.5, 12)):  # octave bass on 8ths
        add(music, t + h * beat, tone(midi(root - 24 + o), beat * 0.48, 'saw', 0.10, attack=0.004))
    # arpeggio 16ths (minor-ish triad)
    chord = [0, 3, 7, 12] if root == 57 else [0, 4, 7, 12]
    for q in range(4):
        add(music, t + q * beat / 4, tone(midi(root + chord[(b * 4 + q) % 4]), beat / 4 * 0.9, 'tri', 0.035))
# whooshes into each new segment
for s in [7.2, 12.5, 15.0, 17.3, 19.6, 21.8]:
    n = int(0.45 * SR); w = []
    lp = 0.0
    for k in range(n):
        lp += 0.15 * (random.uniform(-1, 1) - lp)
        w.append(lp * 0.6 * (k / n) ** 2)
    add(music, s - 0.45, w)
# end card: big chord swell + impact
for m in (57, 60, 64, 69, 72):
    add(music, END_CARD, tone(midi(m), 3.6, 'saw', 0.035, attack=0.02))
add(music, END_CARD, noise(0.8, 0.5, 0.6))

# ---------------- game sound effects (same recipes as the game's WebAudio Sfx)
def sfx_event(t, name, a):
    if name == 'hit':
        sc = [0, 2, 4, 7, 9]; i = int(a) % 15; semi = sc[i % 5] + 12 * (i // 5)
        add(sfx, t, tone(392 * 2 ** (semi / 12), 0.09, 'tri', 0.13))
    elif name == 'brk':
        add(sfx, t, noise(0.12, 0.22, 0.2)); add(sfx, t, tone(880, 0.08, 'square', 0.03, 1760))
    elif name == 'launch': add(sfx, t, tone(180, 0.14, 'sine', 0.3, 80))
    elif name == 'pick': add(sfx, t, tone(988, 0.07, 'sine', 0.14)); add(sfx, t + 0.06, tone(1319, 0.11, 'sine', 0.14))
    elif name == 'coin': add(sfx, t, tone(1568, 0.06, 'square', 0.04)); add(sfx, t + 0.05, tone(2093, 0.13, 'square', 0.04))
    elif name == 'boom': add(sfx, t, noise(0.5, 0.6, 0.85)); add(sfx, t, tone(120, 0.4, 'sine', 0.45, 40))
    elif name == 'laser': add(sfx, t, tone(1400, 0.16, 'saw', 0.06, 280))
    elif name == 'zap': add(sfx, t, noise(0.09, 0.18, 0.0, hp=True))
    elif name == 'combo':
        for i, s_ in enumerate((0, 4, 7)): add(sfx, t + i * 0.05, tone(523 * 2 ** ((s_ + a * 2) / 12), 0.13, 'tri', 0.13))
    elif name == 'clear':
        for i, s_ in enumerate((0, 4, 7, 12, 16, 19, 24)): add(sfx, t + i * 0.06, tone(523 * 2 ** (s_ / 12), 0.2, 'tri', 0.12))

GATE = {'hit': 0.034, 'brk': 0.045, 'pick': 0.04, 'coin': 0.04, 'boom': 0.06, 'laser': 0.06, 'zap': 0.07}
SEGS = {'A': (0.0, 7.2), 'B': (7.2, 12.5)}
for key, (s0, s1) in SEGS.items():
    last = {}
    for frame, name, a in meta['scenes'][key]['events']:
        f = frame - 4  # event at virtual frame k is first visible on captured frame k-4
        t = s0 + f / 30
        if t < s0 or t >= s1 - 0.05: continue
        if name in GATE and t - last.get(name, -9) < GATE[name]: continue
        last[name] = t
        sfx_event(t, name, a)
# UI taps on the stills
for t in (12.5 + 1.3, 15.0 + 1.2, 17.3 + 1.2):
    sfx_event(t, 'pick', 0)
sfx_event(19.6 + 0.15, 'clear', 0)  # new best fanfare

# ---------------- mix, master, write
out = []
fade_in, fade_out = int(0.05 * SR), int(0.9 * SR)
for i in range(N):
    v = music[i] * 0.55 + sfx[i] * 0.8
    v = math.tanh(v * 1.3) * 0.92
    if i < fade_in: v *= i / fade_in
    if i > N - fade_out: v *= (N - i) / fade_out
    out.append(v)
peak = max(abs(v) for v in out) or 1
with wave.open(os.path.join(here, 'audio.wav'), 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(b''.join(struct.pack('<h', int(v / peak * 0.95 * 32767)) for v in out))
print('wrote audio.wav', DUR, 's')
