# Paseo world sound kit — draft 2

Fourteen original one-shot WAVs: seven shared event meanings, expressed separately
for Galaxy and Lake Country. The user approved draft 2 by listening, and the app
now plays it: `src/sounds.ts` imports these files directly (Vite bundles them as
`assets/sounds/<set>-<cue>-<hash>.wav`), so edit or regenerate them here.

Draft 2 answers listening feedback on draft 1 ("the sounds are all too similar
to each other"). Draft 1 gave every cue the same D/A pitch family, similar
envelopes, lengths and timbres. Draft 2 gives each **event** its own shape: number
of hits, rhythm, pitch contour, length, attack, register and timbre. Each
**world** plays those shapes on its own instruments.

Open [preview.html](preview.html) manually to compare the sets. It does not
autoplay. Each player starts at 35% volume, and starting another cue stops the
previous cue. The page works directly from disk and makes no network requests.
The user listened to draft 2 and approved it for use. The technical checks
below establish usable, measurably different files; device playback, Apple Music
interplay and comfort over a working day remain unmeasured.

| Event | Shared shape | Galaxy (synthetic) | Lake Country (crafted) | Length | File peak |
| --- | --- | --- | --- | ---: | ---: |
| Select | One tiny, high, very short hit | Sine pip, A6 | Dry wood-block tick | 0.12 s | −19 dBFS |
| Focus | One low, warm, soft-edged tone | Chorused sine, A3, gliding down into place | Soft-mallet marimba bar, A3 | 0.50 s | −19 dBFS |
| Dispatch accepted | A rising sweep that lands on one confirming hit | Resonant noise whoosh into an FM ping | Brushed swish into a rising water-drop bloop | 0.62 s | −16 dBFS |
| Completed | Quick four-note rising D major arpeggio that rings | Glassy FM bells | Plucked string | 1.05 s | −15 dBFS |
| Needs attention | Two-tone high-low call, twice ("ding-dong, ding-dong") | Sine bell | Small brass bell | 0.90 s | −14 dBFS |
| Action failed | Two dull, low, dissonant hits, the second lower | Beating band-limited buzzes a semitone apart | Wooden thuds with a clashing undertone | 0.42 s | −15 dBFS |
| Enter world | A long airy swell with faint sparkles near its crest | Air sweep over a chorused pad | Shoreline wash with three water drops | 1.60 s | −20 dBFS |

Files live at `galaxy/<event>.wav` and `lake/<event>.wav`. Event filenames are
`select`, `focus`, `dispatch`, `complete`, `attention`, `error`, `world-enter`.
The same event keeps the same rhythm, contour and register in both worlds, so its
meaning carries across a world change. Only the instrument changes. All
instrument names describe synthesis; no field recordings or sampled instruments
were used.

## Regenerate and validate

```sh
python3 art/audio/generate.py           # write WAVs, manifest.json and preview.html
python3 art/audio/generate.py --check   # validate only; writes nothing
python3 art/audio/generate.py --report  # print features and distance matrices
```

Python 3.9+ and its standard library are sufficient. The generator uses a fixed
per-cue random seed, explicit additive, modal and FM synthesis, state-variable
filtered noise, a gentle 7 kHz low-pass, quiet stereo early reflections, boundary
fades and seeded TPDF dither. The `--check` mode performs no writes and no
playback; it compares current bytes against regeneration and checks that the
manifest/preview are current. Different Python or math-library platforms could
differ at individual PCM rounding boundaries; the committed WAVs and their hashes
remain the distribution authority.

- WAV PCM, 48,000 Hz, signed 16-bit little-endian, stereo.
- 2,001,256 bytes total, including WAV headers; 10.42 seconds across both sets.
- About 2.0 MB of decoded float32 PCM for one complete theme, or 4.0 MB for both
  (decimal sizes). No continuous ambient loop or streaming audio is necessary.
- Distinct peak targets preserve the intended event hierarchy. Do not normalize
  every cue to the same loudness or apply a music/streaming LUFS target.
- All clips have exact-zero first/last samples, tapered tails, zero clipped
  samples, DC below −70 dBFS and less than 0.5 dB loss when folded to mono.
- Format, duration, sample peak, RMS, DC, edge samples, largest adjacent-sample
  step, mono fold-down and SHA-256 are recorded in [manifest.json](manifest.json).
- Measurements are file/sample based. RMS is not perceived loudness. True peak,
  device playback, headphone/speaker comfort and listening quality are unverified.
- These are one-shots, not loops. No seamless-loop claim is made.

### Measured distinctness

Because nobody had listened while the kit was made, every run measures how
different the cues are. Each WAV's mono fold-down is analysed in 5 ms frames for
seven simple features: audible duration (within 30 dB of the loudest frame),
attack time, temporal centroid, zero-crossing rate as a brightness proxy, pitch
contour (crossing rate after the first versus the last hit, or early versus late
for a single sound), onset count and mean time between onsets. A weighted
Euclidean distance compares two cues; the weights make one unit roughly one
clear step, such as an octave of brightness or a doubling of length.

Generation and `--check` fail unless every pair of events **within a world** is
at least 1.5 apart, and unless every Galaxy cue's nearest Lake cue is the same
event. The per-cue features and both matrices are stored under `features` and
`distinctness` in the manifest. In draft 2 the closest pairs are Galaxy
dispatch/world-enter (1.93) and Lake focus/error (1.65); most pairs are 2.3–6.0
apart. The same event across the two worlds is 0.12–1.38 apart. These are
signal proxies, not a model of hearing; listening still decides.

## Provenance and rights

Created specifically for this private Paseo Command project by procedural
synthesis in the accompanying source. There are **no external samples,
recordings, pretrained audio-model outputs or third-party assets**, and no
external attribution or sample-license obligations. The generator is the exact
source for every cue; the manifest records its output hashes and synthesis
description. No separate public redistribution license is granted by this kit.

For event routing, rate limits, opt-in behavior and a listening review checklist,
see [SOUND-DIRECTION.md](../../docs/unity/SOUND-DIRECTION.md).
