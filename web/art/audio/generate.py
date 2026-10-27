#!/usr/bin/env python3
"""Original Paseo theme cues. Python standard library only; no audio playback.

Run `python3 art/audio/generate.py` to regenerate the kit and its report.
Run with --check to validate committed WAVs and deterministic reproduction.
Run with --report to print per-cue features and the pairwise distance matrices.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import math
from pathlib import Path
import random
import struct
import wave

ROOT = Path(__file__).resolve().parent
RATE = 48_000
TAU = math.tau
THEMES = ("galaxy", "lake")


def hz(semitones_from_a4: float) -> float:
    return 440.0 * 2 ** (semitones_from_a4 / 12)


# D major is kept as the loose tonal home, but each event sits in its own
# register: tiny and high for select, low for focus and error, mid-high bells
# for completion and attention.
D3, A3, D4, Fs4, A4 = hz(-19), hz(-12), hz(-7), hz(-3), hz(0)
D5, Fs5, A5, D6, A6 = hz(5), hz(9), hz(12), hz(17), hz(24)
E2 = hz(-29)

# Peak targets intentionally vary by event; do not loudness-normalize these
# short transients to a music/streaming target during import.
EVENTS = {
    "select": {"duration": .12, "peak_dbfs": -19, "label": "Select",
               "shape": "One tiny, high, very short hit.",
               "trigger": "User selects a different world entity or fleet row."},
    "focus": {"duration": .5, "peak_dbfs": -19, "label": "Focus",
              "shape": "One low, warm, soft-edged tone that settles.",
              "trigger": "Explicit focus or overview action, when no selection cue was emitted."},
    "dispatch": {"duration": .62, "peak_dbfs": -16, "label": "Dispatch accepted",
                 "shape": "A bright rising sweep that lands on one confirming hit.",
                 "trigger": "A user-initiated dispatch/start is acknowledged by the server."},
    "complete": {"duration": 1.05, "peak_dbfs": -15, "label": "Completed",
                 "shape": "A quick four-note rising major arpeggio that rings out.",
                 "trigger": "An observed active run transitions into successful completion."},
    "attention": {"duration": .9, "peak_dbfs": -14, "label": "Needs attention",
                  "shape": "A two-tone high-low call, played twice: ding-dong, ding-dong.",
                  "trigger": "A new permission/input requirement arrives for an observed run."},
    "error": {"duration": .42, "peak_dbfs": -15, "label": "Action failed",
              "shape": "Two dull, low, dissonant hits, the second lower.",
              "trigger": "An attempted action fails, or an observed run newly fails."},
    "world-enter": {"duration": 1.6, "peak_dbfs": -20, "label": "Enter world",
                    "shape": "A long airy swell with a few faint sparkles near its crest.",
                    "trigger": "An explicit world change succeeds; use the destination theme."},
}
PALETTES = {
    "galaxy": "Synthetic instruments: sine pings, FM bells, resonant filtered-noise sweeps, chorused pads and a soft band-limited buzz.",
    "lake": "Crafted objects: wood block, marimba bar, plucked string, small bell, water drops, wooden thuds and a shoreline wash.",
}
CHARACTERS = {
    "galaxy": {
        "select": "A tiny high sine pip, gone in under a tenth of a second.",
        "focus": "A low chorused sine tone with a slow, soft edge, gliding down into place.",
        "dispatch": "A resonant filtered-noise whoosh rising to a bright FM ping.",
        "complete": "Four glassy FM bells climbing a D major arpeggio, then ringing.",
        "attention": "A clear two-tone sine-bell call, high-low, played twice.",
        "error": "Two low, beating, band-limited buzzes a semitone apart, sagging downwards.",
        "world-enter": "A long rising-and-falling air sweep over a chorused pad, with faint sparkles.",
    },
    "lake": {
        "select": "A tiny dry wood-block tick.",
        "focus": "One low, warm marimba bar struck with a soft mallet.",
        "dispatch": "A brushed swish rising into a single water-drop bloop.",
        "complete": "Four plucked-string notes climbing a D major arpeggio, then ringing.",
        "attention": "A small brass bell, high-low, rung twice.",
        "error": "Two dull, low wooden thuds with a clashing undertone, the second lower.",
        "world-enter": "A slow shoreline wash with three water drops falling into it.",
    },
}


def smooth(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def frames_for(seconds: float) -> int:
    return round(seconds * RATE)


def place(buffer: list[float], onset: float, voice: list[float], gain: float = 1.0) -> None:
    start = frames_for(onset)
    for index, sample in enumerate(voice):
        if start + index >= len(buffer):
            break
        buffer[start + index] += gain * sample


class SVF:
    """Topology-preserving state-variable filter; stable under fast sweeps."""

    def __init__(self) -> None:
        self.ic1 = self.ic2 = 0.0

    def run(self, x: float, cutoff: float, q: float) -> tuple[float, float]:
        g = math.tan(math.pi * min(cutoff, RATE * .45) / RATE)
        k = 1 / q
        a1 = 1 / (1 + g * (g + k))
        a2 = g * a1
        a3 = g * a2
        v3 = x - self.ic2
        v1 = a1 * self.ic1 + a2 * v3
        v2 = self.ic2 + a2 * self.ic1 + a3 * v3
        self.ic1 = 2 * v1 - self.ic1
        self.ic2 = 2 * v2 - self.ic2
        return v2, v1  # low-pass, band-pass


# ---------------------------------------------------------------------------
# Voices. Each returns mono float samples starting at its onset.

def partials(duration: float, freq: float, parts, attack: float, glide: float = 0.0,
             glide_time: float = .05) -> list[float]:
    """Sum of decaying sine partials: (ratio, amplitude, decay seconds[, detune cents])."""
    out = []
    phases = [0.0] * len(parts)
    for index in range(frames_for(duration)):
        t = index / RATE
        bend = 2 ** (glide * math.exp(-t / glide_time)) if glide else 1.0
        sample = 0.0
        for number, part in enumerate(parts):
            ratio, amplitude, decay = part[:3]
            detune = 2 ** (part[3] / 1200) if len(part) > 3 else 1.0
            phases[number] += TAU * freq * ratio * detune * bend / RATE
            sample += amplitude * math.sin(phases[number]) * math.exp(-t / decay)
        out.append(sample * smooth(t / attack))
    return out


def fm_bell(duration: float, freq: float, ratio: float, index_peak: float, index_decay: float,
            decay: float, attack: float = .002) -> list[float]:
    out = []
    for n in range(frames_for(duration)):
        t = n / RATE
        index = index_peak * math.exp(-t / index_decay)
        modulator = index * math.sin(TAU * freq * ratio * t)
        out.append(math.sin(TAU * freq * t + modulator) * math.exp(-t / decay) * smooth(t / attack))
    return out


def noise_sweep(rng: random.Random, duration: float, cutoff, q: float, envelope,
                mode: str = "band") -> list[float]:
    """Filtered white noise; cutoff and envelope are functions of time in seconds."""
    filt = SVF()
    out = []
    for n in range(frames_for(duration)):
        t = n / RATE
        low, band = filt.run(rng.uniform(-1, 1), cutoff(t), q)
        out.append((band if mode == "band" else low) * envelope(t))
    return out


def drop(duration: float, start_hz: float, end_hz: float, rise: float, decay: float) -> list[float]:
    """A water-drop bloop: a sine whose pitch rises quickly after impact."""
    out = []
    phase = 0.0
    for n in range(frames_for(duration)):
        t = n / RATE
        freq = end_hz + (start_hz - end_hz) * math.exp(-t / rise)
        phase += TAU * freq / RATE
        out.append(math.sin(phase) * math.exp(-t / decay) * smooth(t / .0015))
    return out


def pluck(duration: float, freq: float, decay: float, rng: random.Random) -> list[float]:
    """Additive plucked string: harmonics shaped by pluck position, upper ones die fast."""
    position = .21
    parts = []
    for k in range(1, 15):
        if freq * k > 5200:
            break
        amplitude = abs(math.sin(math.pi * k * position)) / k ** 1.4
        parts.append((k * (1 + .0004 * k * k), amplitude, decay / (1 + .35 * (k - 1) ** 1.3)))
    body = partials(duration, freq, parts, attack=.0012)
    # A short pick noise at the start of the string.
    filt = SVF()
    for n in range(frames_for(.006)):
        low, _ = filt.run(rng.uniform(-1, 1), 3000, .7)
        body[n] += .12 * low * (1 - n / frames_for(.006))
    return body


def buzz(duration: float, freq: float, sag: float, harmonics: int, attack: float,
         release: float) -> list[float]:
    """Band-limited saw with a slow pitch sag and soft edges; no hard square edges."""
    out = []
    phase = 0.0
    for n in range(frames_for(duration)):
        t = n / RATE
        phase += TAU * freq * 2 ** (-sag * t / duration) / RATE
        wave_ = sum(math.sin(k * phase) / k * (1 - k / (harmonics + 1)) for k in range(1, harmonics + 1))
        env = smooth(t / attack) * smooth((duration - t) / release)
        out.append(wave_ * env)
    return out


def thud(duration: float, freq: float, rng: random.Random, clash: float) -> list[float]:
    """A dull wooden thud: heavily damped low modes plus a muffled impact."""
    parts = ((1, 1, .07), (clash, .8, .06), (2.31, .25, .025), (3.9, .08, .012))
    body = partials(duration, freq, parts, attack=.003, glide=.25, glide_time=.02)
    filt = SVF()
    for n in range(frames_for(.03)):
        low, _ = filt.run(rng.uniform(-1, 1), 450, .8)
        body[n] += .9 * low * math.exp(-n / frames_for(.008))
    return body


# ---------------------------------------------------------------------------
# Cue recipes. Each event keeps the same shape in both worlds; only the
# instrument changes.

def galaxy(event: str, rng: random.Random, buf: list[float]) -> None:
    if event == "select":
        place(buf, 0, partials(.1, A6, ((1, 1, .018), (2, .08, .008)), attack=.0015, glide=.06,
                               glide_time=.01))
    elif event == "focus":
        chorus = [(1, .5, .2, -7), (1, .5, .2, 7), (2, .14, .1), (3, .04, .05)]
        place(buf, 0, partials(.5, A3, chorus, attack=.04, glide=.1, glide_time=.07))
    elif event == "dispatch":
        sweep = noise_sweep(rng, .25, lambda t: 260 * (1250 / 260) ** (t / .24), 5,
                            lambda t: 10 ** (-1.8 * max(0, 1 - t / .2)) * smooth((.25 - t) / .04))
        place(buf, 0, sweep, 1.1)
        place(buf, .25, fm_bell(.37, D6, 2, 1.1, .03, .09), .8)
    elif event == "complete":
        for number, (onset, note) in enumerate(((0, D5), (.075, Fs5), (.15, A5), (.225, D6))):
            decay = .5 if number == 3 else .22
            place(buf, onset, fm_bell(1.05 - onset, note, 3.5, 1.4, .06, decay), .55 + .15 * number)
    elif event == "attention":
        for onset, note in ((0, A5), (.15, Fs5), (.42, A5), (.57, Fs5)):
            parts = ((1, 1, .12), (2, .18, .05), (3, .05, .02))
            place(buf, onset, partials(.9 - onset, note, parts, attack=.003))
    elif event == "error":
        for onset, freq, gain in ((0, E2, 1.0), (.15, E2 * .75, .9)):
            pair = [a + b for a, b in zip(buzz(.12, freq, .12, 9, .008, .04),
                                          buzz(.12, freq * 1.0595, .12, 9, .008, .04))]
            place(buf, onset, pair, gain)
    elif event == "world-enter":
        air = noise_sweep(rng, 1.6, lambda t: 260 * 2 ** (2.6 * math.sin(math.pi * t / 1.6)), 1.6,
                          lambda t: math.sin(math.pi * min(1, t / 1.55)) ** 2)
        place(buf, 0, air, 1.3)
        pad = [(1, .3, 9, -6), (1, .3, 9, 6), (1.5, .18, 9, -4), (2, .12, 9, 5)]
        swell = partials(1.6, D3, pad, attack=.6)
        for n in range(len(swell)):
            swell[n] *= smooth((1.6 - n / RATE) / .8)
        place(buf, 0, swell, .45)
        for onset, note, gain in ((.6, D6, .16), (.8, A5, .12), (1.0, D6, .08)):
            place(buf, onset, partials(.4, note, ((1, 1, .12),), attack=.004), gain)


def lake(event: str, rng: random.Random, buf: list[float]) -> None:
    if event == "select":
        block = partials(.1, 1250, ((1, 1, .014), (1.58, .4, .008), (2.69, .12, .004)), attack=.0008)
        filt = SVF()
        for n in range(frames_for(.004)):
            low, _ = filt.run(rng.uniform(-1, 1), 2600, .7)
            block[n] += .5 * low * (1 - n / frames_for(.004))
        place(buf, 0, block)
    elif event == "focus":
        # Marimba bars are tuned roughly 1 : 4 : 10; the soft mallet keeps the top dull.
        bar = partials(.5, A3, ((1, 1, .24), (3.98, .12, .045), (9.9, .015, .012)), attack=.008)
        filt = SVF()
        for n in range(frames_for(.02)):
            low, _ = filt.run(rng.uniform(-1, 1), 300, .7)
            bar[n] += .25 * low * math.exp(-n / frames_for(.006))
        place(buf, 0, bar)
    elif event == "dispatch":
        swish = noise_sweep(rng, .24, lambda t: 320 * (1400 / 320) ** (t / .23), 2,
                            lambda t: 10 ** (-1.8 * max(0, 1 - t / .19)) * smooth((.24 - t) / .05))
        place(buf, 0, swish, 1.0)
        place(buf, .24, drop(.36, 700, 1500, .018, .07), 1.3)
    elif event == "complete":
        for number, (onset, note) in enumerate(((0, D5), (.075, Fs5), (.15, A5), (.225, D6))):
            decay = .55 if number == 3 else .3
            place(buf, onset, pluck(1.05 - onset, note, decay, rng), .6 + .12 * number)
    elif event == "attention":
        for onset, note in ((0, A5), (.15, Fs5), (.42, A5), (.57, Fs5)):
            parts = ((1, 1, .2), (2.0, .3, .09), (2.76, .2, .06), (5.4, .03, .02))
            place(buf, onset, partials(.9 - onset, note, parts, attack=.0015))
    elif event == "error":
        for onset, freq, gain in ((0, E2 * 1.2, 1.0), (.14, E2, .9)):
            place(buf, onset, thud(.3, freq, rng, 1.0595), gain)
    elif event == "world-enter":
        wash = noise_sweep(
            rng, 1.6, lambda t: 420 + 520 * math.sin(math.pi * t / 1.6) * (.8 + .2 * math.sin(TAU * 2.1 * t)),
            .7, lambda t: math.sin(math.pi * min(1, t / 1.55)) ** 2 * (.78 + .22 * math.sin(TAU * 3.1 * t)),
            mode="low")
        place(buf, 0, wash, 2.2)
        for onset, start, end, gain in ((.6, 620, 1300, .22), (.8, 520, 1100, .17), (1.0, 700, 1450, .12)):
            place(buf, onset, drop(.3, start, end, .02, .05), gain)


def synthesize(theme: str, event: str) -> bytes:
    spec = EVENTS[event]
    frames = frames_for(spec["duration"])
    seed = int.from_bytes(hashlib.sha256(f"paseo-v2:{theme}:{event}".encode()).digest()[:8], "big")
    rng = random.Random(seed)
    source = [0.0] * frames
    (galaxy if theme == "galaxy" else lake)(event, rng, source)
    # Gentle two-pole low-pass at 7 kHz: no harsh highs reach the file.
    filt = SVF()
    source = [filt.run(x, 7000, .6)[0] for x in source]
    stereo = [[], []]
    # Sparse quiet early reflections; dry center stays dominant and mono-safe.
    delays = ((.023, .043), (.031, .051)) if theme == "galaxy" else ((.013, .027), (.017, .031))
    for channel in range(2):
        for index, sample in enumerate(source):
            for delay, gain in zip(delays[channel], (.085, .035)):
                offset = round(delay * RATE)
                if index >= offset:
                    sample += source[index - offset] * gain
            stereo[channel].append(sample)
        mean = sum(stereo[channel]) / frames
        for index in range(frames):
            edge = smooth(index / (RATE * .0015)) * smooth((frames - 1 - index) / (RATE * .025))
            stereo[channel][index] = (stereo[channel][index] - mean) * edge
    peak = max(abs(x) for channel in stereo for x in channel)
    scale = 10 ** (spec["peak_dbfs"] / 20) / peak
    encoded = bytearray()
    for index in range(frames):
        edge = smooth(index / 72) * smooth((frames - 1 - index) / 72)
        for channel in range(2):
            # Seeded TPDF dither, faded at both file boundaries.
            dither = (rng.random() - rng.random()) * edge
            sample = round(stereo[channel][index] * scale * 32767 + dither)
            assert -32768 < sample < 32767, "unexpected clipping before WAV write"
            encoded.extend(struct.pack("<h", sample))
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setparams((2, 2, RATE, frames, "NONE", "not compressed"))
        wav.writeframes(encoded)
    return output.getvalue()


def db(value: float) -> float:
    return round(20 * math.log10(max(1e-12, value)), 3)


def decode(data: bytes) -> tuple[list[float], list[float]]:
    with wave.open(io.BytesIO(data), "rb") as wav:
        channels, width, rate, frames, compression, _ = wav.getparams()
        assert (channels, width, rate, compression) == (2, 2, RATE, "NONE")
        raw = wav.readframes(frames)
    samples = [value / 32768 for value in struct.unpack(f"<{len(raw) // 2}h", raw)]
    return samples[::2], samples[1::2]


def inspect(data: bytes, event: str) -> dict:
    left, right = decode(data)
    samples = left + right
    frames = len(left)
    peak = max(abs(value) for value in samples)
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    means = [sum(channel) / frames for channel in (left, right)]
    mono_rms = math.sqrt(sum(((l + r) * .5) ** 2 for l, r in zip(left, right)) / frames)
    jumps = max(abs(channel[index] - channel[index - 1])
                for channel in (left, right) for index in range(1, frames))
    boundary = max(abs(left[0]), abs(left[-1]), abs(right[0]), abs(right[-1]))
    assert frames == round(EVENTS[event]["duration"] * RATE)
    assert abs(db(peak) - EVENTS[event]["peak_dbfs"]) < .02
    assert peak < .25 and rms > .001
    assert max(abs(mean) for mean in means) < .0003, "DC offset exceeds -70 dBFS"
    assert boundary == 0, "nonzero WAV boundary"
    assert jumps < .1, "unexpected high-frequency impulse"
    assert db(mono_rms / rms) > -.5, "excessive cancellation on mono fold-down"
    return {"sample_rate_hz": RATE, "channels": 2, "encoding": "PCM signed 16-bit little-endian",
            "frames": frames, "duration_seconds": frames / RATE, "bytes": len(data),
            "sample_peak_dbfs": db(peak), "rms_dbfs": db(rms),
            "dc_dbfs": [db(abs(mean)) for mean in means],
            "mono_fold_down_db": db(mono_rms / rms), "largest_sample_step_dbfs": db(jumps),
            "boundary_sample_peak": boundary, "clipped_samples": sum(abs(x) >= 32767 / 32768 for x in samples),
            "sha256": hashlib.sha256(data).hexdigest()}


# ---------------------------------------------------------------------------
# Distinctness features. Simple, standard-library measures of the decoded
# mono fold-down, analysed in 5 ms frames. They are proxies for what a
# listener hears, not a perceptual model.

HOP = 240  # 5 ms
ACTIVE_DB = 30  # frames within 30 dB of the loudest frame count as audible
# Weights convert each feature into roughly "one unit = one clearly audible
# step": an octave of brightness, a doubling of length, and so on.
WEIGHTS = {"duration_log2": 1.0, "brightness_log2": 1.0, "contour_octaves": 1.5,
           "onsets": .5, "attack_log2": .4, "centroid": 2.0, "ioi_log2": .5}
MIN_DISTANCE = 1.5  # every pair of events within one world must be at least this far apart


def frame_db(signal: list[float], window: int = HOP) -> list[float]:
    """Energy in dB for each 5 ms hop, measured over `window` samples from that hop."""
    return [10 * math.log10(max(1e-12, sum(x * x for x in signal[i:i + window]) / window))
            for i in range(0, len(signal) - HOP + 1, HOP)]


def features(data: bytes) -> dict:
    left, right = decode(data)
    mono = [(l + r) * .5 for l, r in zip(left, right)]
    energy = frame_db(mono)
    top = max(energy)
    active = [i for i, value in enumerate(energy) if value > top - ACTIVE_DB]
    first, last = active[0], active[-1]
    span = last - first + 1
    duration = span * HOP / RATE
    # Attack: from first audible frame to the first frame within 6 dB of the loudest.
    attack = max(HOP / RATE, (next(i for i in active if energy[i] > top - 6) - first) * HOP / RATE)
    weights = [10 ** (energy[i] / 10) if energy[i] > top - ACTIVE_DB else 0.0 for i in range(len(energy))]
    centroid = (sum(i * w for i, w in enumerate(weights)) / sum(weights) - first) / span
    # Zero-crossing rate per frame in Hz (half the crossings per second).
    zcr = []
    for i in range(len(energy)):
        chunk = mono[i * HOP:(i + 1) * HOP]
        crossings = sum((a < 0) != (b < 0) for a, b in zip(chunk, chunk[1:]))
        zcr.append(crossings * RATE / (2 * HOP))
    brightness_hz = sum(z * w for z, w in zip(zcr, weights)) / sum(weights)
    # Onsets: a sharp rise in the second difference (which emphasises attacks over
    # ringing tails) that also raises the level, or a large level jump on its own,
    # which catches low hits whose second difference is buried in dither. Both
    # use 15 ms windows so a low pitch's individual cycles are not taken as hits.
    first_diff = [0.0] + [b - a for a, b in zip(mono, mono[1:])]
    second_diff = [0.0] + [b - a for a, b in zip(first_diff, first_diff[1:])]
    flux = frame_db(second_diff, 3 * HOP)
    level = frame_db(mono, 3 * HOP)
    level_top = max(level)
    onsets = []
    for i, value in enumerate(flux):
        # Compare with the adjacent preceding 15 ms; gradual swells rise too slowly.
        sharpening = value - flux[i - 3] if i >= 3 else 120.0
        rise = level[i] - level[i - 3] if i >= 3 else 120.0
        hit = (sharpening > 5 and rise > 2.5) or rise > 9
        if hit and level[i] > level_top - ACTIVE_DB and (not onsets or i - onsets[-1] >= 8):
            onsets.append(i)
    # Pitch contour: across hits, the change in crossing rate just after the first
    # and last onsets; for a single sustained sound, the change between its first
    # and last 40% of audible frames. Both in octaves.
    if len(onsets) > 1:
        def hit_pitch(onset: int) -> float:
            # Crossings over 50 ms just after the attack, for usable low-pitch resolution.
            chunk = mono[(onset + 1) * HOP:(onset + 11) * HOP]
            crossings = sum((a < 0) != (b < 0) for a, b in zip(chunk, chunk[1:]))
            return math.log2(max(1.0, crossings * RATE / (2 * len(chunk))))
        contour = hit_pitch(onsets[-1]) - hit_pitch(onsets[0])
    else:
        early = [zcr[i] for i in active if i < first + span * .4]
        late = [zcr[i] for i in active if i > last - span * .4]
        contour = math.log2(max(1.0, sum(late) / len(late)) / max(1.0, sum(early) / len(early)))
    ioi = ((onsets[-1] - onsets[0]) / (len(onsets) - 1) * HOP / RATE) if len(onsets) > 1 else duration
    return {"active_duration_s": round(duration, 3), "attack_s": round(attack, 3),
            "centroid": round(centroid, 3), "zcr_hz": round(brightness_hz, 1),
            "contour_octaves": round(contour, 3), "onsets": len(onsets),
            "onset_times_s": [round(o * HOP / RATE, 3) for o in onsets],
            "mean_ioi_s": round(ioi, 3)}


def vector(feature: dict) -> dict:
    return {"duration_log2": math.log2(feature["active_duration_s"]),
            "brightness_log2": math.log2(feature["zcr_hz"]),
            "contour_octaves": feature["contour_octaves"],
            "onsets": min(feature["onsets"], 6),
            "attack_log2": math.log2(feature["attack_s"] * 1000),
            "centroid": feature["centroid"],
            "ioi_log2": math.log2(feature["mean_ioi_s"])}


def distance(a: dict, b: dict) -> float:
    va, vb = vector(a), vector(b)
    return round(math.sqrt(sum((WEIGHTS[key] * (va[key] - vb[key])) ** 2 for key in WEIGHTS)), 3)


def distinctness(found: dict) -> dict:
    events = list(EVENTS)
    result = {"weights": WEIGHTS, "min_within_world": MIN_DISTANCE, "worlds": {}}
    for theme in THEMES:
        matrix = {a: {b: distance(found[theme, a], found[theme, b]) for b in events} for a in events}
        pairs = [(matrix[a][b], a, b) for i, a in enumerate(events) for b in events[i + 1:]]
        closest = min(pairs)
        assert closest[0] >= MIN_DISTANCE, (
            f"{theme}: {closest[1]} and {closest[2]} are too similar ({closest[0]} < {MIN_DISTANCE})")
        result["worlds"][theme] = {"matrix": matrix, "closest_pair": [closest[1], closest[2], closest[0]]}
    cross = {}
    for event in events:
        same = distance(found["galaxy", event], found["lake", event])
        nearest = min(events, key=lambda other: distance(found["galaxy", event], found["lake", other]))
        # The same meaning should stay recognisable across worlds: a Galaxy cue's
        # nearest Lake cue must be the same event.
        assert nearest == event, f"galaxy {event} is closer to lake {nearest} than to lake {event}"
        cross[event] = same
    result["same_event_across_worlds"] = cross
    return result


def report(found: dict, summary: dict) -> str:
    events = list(EVENTS)
    short = {"select": "sel", "focus": "foc", "dispatch": "dis", "complete": "com",
             "attention": "att", "error": "err", "world-enter": "wld"}
    lines = []
    for theme in THEMES:
        lines.append(f"\n{theme}: features")
        lines.append(f'  {"event":<12}{"dur s":>7}{"atk s":>7}{"cent":>6}{"zcr Hz":>8}'
                     f'{"contour":>9}{"onsets":>7}{"ioi s":>7}')
        for event in events:
            f = found[theme, event]
            lines.append(f'  {event:<12}{f["active_duration_s"]:>7}{f["attack_s"]:>7}{f["centroid"]:>6}'
                         f'{f["zcr_hz"]:>8}{f["contour_octaves"]:>+9.2f}{f["onsets"]:>7}{f["mean_ioi_s"]:>7}')
        matrix = summary["worlds"][theme]["matrix"]
        lines.append(f"{theme}: pairwise distance (minimum allowed {MIN_DISTANCE})")
        lines.append("  " + " " * 12 + "".join(f"{short[e]:>6}" for e in events))
        for a in events:
            lines.append(f"  {a:<12}" + "".join(f"{matrix[a][b]:>6.2f}" if a != b else f'{"-":>6}'
                                                 for b in events))
        closest = summary["worlds"][theme]["closest_pair"]
        lines.append(f"  closest pair: {closest[0]} / {closest[1]} = {closest[2]}")
    lines.append("\nsame event, Galaxy vs Lake (each is the nearest cross-world match):")
    lines.append("  " + ", ".join(f"{event} {value}" for event, value in summary["same_event_across_worlds"].items()))
    return "\n".join(lines)


def preview(manifest: dict) -> str:
    rows = []
    for event, spec in EVENTS.items():
        cells = []
        for theme in THEMES:
            entry = next(item for item in manifest["assets"] if item["theme"] == theme and item["event"] == event)
            cells.append(f'<td class="{theme}"><p>{html.escape(entry["character"])}</p>'
                         f'<audio controls preload="none" aria-label="{theme} {html.escape(spec["label"])}" '
                         f'src="{entry["file"]}"></audio><small>{spec["duration"]:g} s · '
                         f'{spec["peak_dbfs"]} dBFS peak</small></td>')
        rows.append(f'<tr><th scope="row">{html.escape(spec["label"])}'
                    f'<span>{html.escape(spec["shape"])}</span></th>{"".join(cells)}</tr>')
    return '''<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paseo world sounds — audition</title><style>
:root{font:16px/1.5 system-ui,sans-serif;color:#e7e7dc;background:#10191d;color-scheme:dark}
body{margin:0 auto;max-width:1100px;padding:32px 24px}h1{font-size:30px;margin:0 0 8px}
p{max-width:76ch}table{width:100%;border-collapse:collapse;margin-top:28px}th,td{text-align:left;padding:18px;vertical-align:top;border-bottom:1px solid #354248}
thead th{font-size:19px}.galaxy{border-left:3px solid #c8985c}.lake{border-left:3px solid #72a99d}
th span{display:block;font-weight:400;font-size:14px;color:#aab9bc;max-width:22ch;margin-top:4px}
td p{min-height:3em;margin:0 0 12px;color:#c4cccf}audio{max-width:100%;width:300px}small{display:block;color:#aab9bc;margin-top:8px}
button{font:inherit;padding:8px 16px;background:#293b43;color:inherit;border:1px solid #526770;border-radius:5px;cursor:pointer}
button:focus-visible,a:focus-visible{outline:3px solid #c8985c;outline-offset:3px}a{color:#c8b88a}.table-wrap{overflow:auto}
footer{font-size:14px;color:#aab9bc;margin-top:32px}
@media(max-width:700px){body{padding:20px 12px}th,td{padding:12px}audio{width:230px}table{min-width:660px}}
</style><h1>One fleet, two sound palettes</h1>
<p>Original draft cues for Galaxy and Lake Country, draft 2. Each event has its own shape (rhythm, contour,
length, register and timbre); each world plays that shape on its own instruments.
Playback starts only when you press a player control.
Each player begins at 35% volume; use a comfortable system level. Starting a cue pauses the others.</p>
<p>These assets passed file-level and measured-distinctness checks but have <strong>not been auditioned</strong>.
Listen down each column to judge whether every event is recognisable, and across each row to judge whether
the two worlds still mean the same thing.</p>
<button type="button" id="stop">Stop all</button>
<div class="table-wrap"><table><thead><tr><th>Event</th><th>Galaxy · synthetic instruments</th><th>Lake Country · crafted objects</th></tr></thead><tbody>
''' + "\n".join(rows) + '''</tbody></table></div>
<footer>No runtime audio is enabled by this page. No autoplay, network calls, external libraries or analytics.
<a href="manifest.json">Asset manifest, measurements and distance matrices</a> · <a href="README.md">Usage notes</a></footer>
<script>
const players = [...document.querySelectorAll('audio')];
for (const player of players) {
  player.volume = .35;
  player.addEventListener('play', () => {
    for (const other of players) if (other !== player) { other.pause(); other.currentTime = 0; }
  });
}
document.querySelector('#stop').addEventListener('click', () => {
  for (const player of players) { player.pause(); player.currentTime = 0; }
});
</script></html>
'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Validate without writing or playing anything.")
    mode.add_argument("--report", action="store_true",
                      help="Print features and distance matrices for the committed WAVs; writes nothing.")
    args = parser.parse_args()
    manifest = {"version": 2, "generator": "generate.py", "sample_rate_hz": RATE,
                "source": "Original deterministic procedural synthesis; no recordings, samples, models or external assets.",
                "rights": "Created for this private project. No third-party attribution or sample-license requirements. No separate public redistribution license granted.",
                "validation": "PCM format, duration, sample peak, RMS, DC, edge zeros, clipping, sample continuity, mono compatibility, SHA-256 and a minimum feature distance between events checked. No listening validation or loudness/true-peak certification.",
                "looping": False, "palettes": PALETTES, "assets": []}
    found = {}
    for theme in THEMES:
        if not (args.check or args.report):
            (ROOT / theme).mkdir(parents=True, exist_ok=True)
        for event, spec in EVENTS.items():
            path = ROOT / theme / f"{event}.wav"
            if args.report:
                data = path.read_bytes()
            else:
                data = synthesize(theme, event)
            measurements = inspect(data, event)
            if args.check:
                actual = path.read_bytes()
                inspect(actual, event)
                assert actual == data, f"WAV differs from generator: {path}"
            elif not args.report:
                path.write_bytes(data)
            found[theme, event] = features(data)
            manifest["assets"].append({"theme": theme, "event": event, "file": f"{theme}/{event}.wav",
                                       "shape": spec["shape"], "character": CHARACTERS[theme][event],
                                       "trigger": spec["trigger"],
                                       "target_sample_peak_dbfs": spec["peak_dbfs"], **measurements,
                                       "features": found[theme, event]})
    summary = distinctness(found)
    manifest["distinctness"] = summary
    if args.report:
        print(report(found, summary))
        return
    for filename, content in (("manifest.json", json.dumps(manifest, indent=2) + "\n"),
                              ("preview.html", preview(manifest))):
        if args.check:
            assert (ROOT / filename).read_text() == content, f"Generated {filename} is stale"
        else:
            (ROOT / filename).write_text(content)
    total = sum(item["bytes"] for item in manifest["assets"])
    seconds = sum(item["duration_seconds"] for item in manifest["assets"])
    print(f'{"Validated" if args.check else "Generated and validated"} {len(manifest["assets"])} original cues; '
          f'{total:,} bytes, {seconds:.2f} s; every event pair at least {MIN_DISTANCE} apart; no audio played.')


if __name__ == "__main__":
    main()
