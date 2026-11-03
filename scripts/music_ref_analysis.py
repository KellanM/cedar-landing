"""Signal analysis of reference cues for docs/music_study.md.

python scripts/music_ref_analysis.py <dir-with-wavs> [out-dir]

The reference audio itself is NOT kept in the repo (download it yourself for study; see the URLs
in docs/music_study.md). For each mono WAV this writes a figure (chromagram with detected chord
boundaries, bass pitch class, loudness) and a JSON summary with:

- harmonic rhythm: seconds between detected chord changes (chroma novelty peaks)
- common tones: of the 4 strongest pitch classes, how many survive each change
- rough chord chart: template match (maj / min / sus2 / sus4 / 5 / add9 / m7) per segment
- mode estimate: best tonic + mode over the whole cue (Ionian/Dorian/Phrygian/Lydian/Mixolydian/Aeolian)
- pedal ratio: share of time the bass pitch class equals its most common value
- loudness: 1 s RMS in dB (p10 / p50 / p90), the near-silent share, onsets per second

All of this is approximate (a mixed orchestral recording, chroma folding, reverb tails). It is
evidence about rhythm and density, not a transcription.
"""
import json
import os
import sys

import numpy as np
import librosa
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

PCS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MODES = {
    "Ionian": [0, 2, 4, 5, 7, 9, 11],
    "Dorian": [0, 2, 3, 5, 7, 9, 10],
    "Phrygian": [0, 1, 3, 5, 7, 8, 10],
    "Lydian": [0, 2, 4, 6, 7, 9, 11],
    "Mixolydian": [0, 2, 4, 5, 7, 9, 10],
    "Aeolian": [0, 2, 3, 5, 7, 8, 10],
}
CHORDS = {
    "": [0, 4, 7], "m": [0, 3, 7], "sus2": [0, 2, 7], "sus4": [0, 5, 7], "5": [0, 7],
    "add9": [0, 2, 4, 7], "m7": [0, 3, 7, 10], "maj7": [0, 4, 7, 11], "m(add9)": [0, 2, 3, 7],
}


def templ(ivs, root, w=None):
    t = np.zeros(12)
    for k, iv in enumerate(ivs):
        t[(root + iv) % 12] = 1.0 if w is None else w[k]
    return t / np.linalg.norm(t)


def chord_name(v):
    v = v / (np.linalg.norm(v) + 1e-9)
    best, bs = "", -1
    for r in range(12):
        for name, ivs in CHORDS.items():
            s = float(v @ templ(ivs, r)) - 0.02 * (len(ivs) - 3)  # mild preference for simpler chords
            if s > bs:
                bs, best = s, PCS[r] + name
    return best, bs


def mode_of(prof):
    prof = prof / prof.sum()
    best, bs = None, -9
    for r in range(12):
        for name, sc in MODES.items():
            w = np.full(12, -0.6)
            for k, iv in enumerate(sc):
                w[(r + iv) % 12] = 1.6 if k in (0, 4) else 1.2 if k == 2 else 1.0
            s = float(prof @ w)
            # the tonic itself should be strong: weight the tonic pc a bit more
            s += 0.8 * prof[r]
            if s > bs:
                bs, best = s, (PCS[r], name)
    return best


def analyse(path, out_dir):
    name = os.path.splitext(os.path.basename(path))[0]
    y, sr = librosa.load(path, sr=22050, mono=True)
    if np.abs(y).max() < 1e-4:
        return None  # silent (e.g. a CPU-baseline render)
    dur = len(y) / sr
    hop = 2048
    C = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, bins_per_octave=36)
    fps = sr / hop
    # smooth over ~1.5 s (reverb + bowing)
    k = max(1, int(1.5 * fps))
    Cs = np.apply_along_axis(lambda r: np.convolve(r, np.ones(k) / k, mode="same"), 1, C)
    # novelty: cosine distance between 3 s windows before / after
    w = int(3 * fps)
    nov = np.zeros(Cs.shape[1])
    for i in range(w, Cs.shape[1] - w):
        a = Cs[:, i - w:i].mean(1)
        b = Cs[:, i:i + w].mean(1)
        nov[i] = 1 - (a @ b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9)
    # peaks: at least 2.5 s apart, above an adaptive threshold
    thr = max(0.025, np.percentile(nov, 70))
    peaks = librosa.util.peak_pick(nov, pre_max=int(1.2 * fps), post_max=int(1.2 * fps), pre_avg=int(4 * fps), post_avg=int(4 * fps), delta=0.004, wait=int(2.5 * fps))
    peaks = [p for p in peaks if nov[p] >= thr]
    bounds = [0] + list(peaks) + [Cs.shape[1] - 1]
    segs = []
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
    rdb = 20 * np.log10(rms + 1e-6)
    loud_ref = np.percentile(rdb, 95)
    for a, b in zip(bounds[:-1], bounds[1:]):
        if b - a < 2:
            continue
        v = C[:, a:b].mean(1)
        quiet = rdb[a:b].mean() < loud_ref - 30
        nm, sc = chord_name(v)
        top = list(np.argsort(v)[::-1][:4])
        segs.append({"t0": round(a / fps, 1), "t1": round(b / fps, 1), "chord": "(silence)" if quiet else nm, "fit": round(sc, 2), "top4": [PCS[i] for i in top]})
    # common tones across changes (non-silent neighbours)
    commons = []
    for s0, s1 in zip(segs[:-1], segs[1:]):
        if "(silence)" in (s0["chord"], s1["chord"]):
            continue
        commons.append(len(set(s0["top4"]) & set(s1["top4"])))
    lens = [s["t1"] - s["t0"] for s in segs if s["chord"] != "(silence)"]
    # bass: chroma of the low band only
    yb = librosa.effects.preemphasis(y, coef=-0.97)  # de-emphasise highs a little
    Cb = librosa.feature.chroma_cqt(y=yb, sr=sr, hop_length=hop, fmin=librosa.note_to_hz("C1"), n_octaves=3, bins_per_octave=36)
    bass_pc = Cb.argmax(0)
    m = min(len(bass_pc), len(rdb), C.shape[1])
    bass_pc, rdb, C = bass_pc[:m], rdb[:m], C[:, :m]
    act = rdb > loud_ref - 30
    bp = bass_pc[act]
    pedal_pc = int(np.bincount(bp, minlength=12).argmax()) if len(bp) else 0
    pedal_ratio = float((bp == pedal_pc).mean()) if len(bp) else 0
    # loudness on 1 s blocks
    blk = int(fps)
    r1 = np.array([rdb[i:i + blk].mean() for i in range(0, len(rdb) - blk, blk)])
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time", delta=0.25)
    centroid = float(np.median(librosa.feature.spectral_centroid(y=y, sr=sr)))
    prof = C[:, act].mean(1) if act.any() else C.mean(1)
    tonic, mode = mode_of(prof)
    summary = {
        "track": name, "seconds": round(dur, 1),
        "mode_estimate": f"{tonic} {mode}",
        "pc_profile": {PCS[i]: round(float(prof[i] / prof.max()), 2) for i in range(12)},
        "segments": len(segs),
        "harmonic_rhythm_s": {"median": round(float(np.median(lens)), 1) if lens else None, "p25": round(float(np.percentile(lens, 25)), 1) if lens else None, "p75": round(float(np.percentile(lens, 75)), 1) if lens else None},
        "common_tones_of_top4": {"mean": round(float(np.mean(commons)), 2) if commons else None, "hist": {str(n): commons.count(n) for n in range(5)}},
        "bass_pedal": {"pc": PCS[pedal_pc], "ratio": round(pedal_ratio, 2)},
        "loudness_db": {"p10": round(float(np.percentile(r1, 10)), 1), "p50": round(float(np.percentile(r1, 50)), 1), "p90": round(float(np.percentile(r1, 90)), 1), "near_silent_pct": round(float((r1 < loud_ref - 30).mean() * 100), 1)},
        "onsets_per_s": round(len(onsets) / dur, 2),
        "centroid_hz": round(centroid),
        "chart": segs,
    }
    # figure
    fig, ax = plt.subplots(3, 1, figsize=(16, 7.5), sharex=True, gridspec_kw={"height_ratios": [3, 1, 1]})
    t = np.arange(Cs.shape[1]) / fps
    ax[0].imshow(Cs, aspect="auto", origin="lower", extent=[0, t[-1], -0.5, 11.5], cmap="magma")
    ax[0].set_yticks(range(12)); ax[0].set_yticklabels(PCS, fontsize=7)
    for s in segs:
        ax[0].axvline(s["t0"], color="cyan", lw=0.7, alpha=0.7)
        ax[0].text(s["t0"] + 0.5, 11.9, s["chord"], color="white", fontsize=6, rotation=60, va="bottom", clip_on=True)
    ax[0].set_title(f"{name} — chroma (1.5 s smoothing), detected changes; mode ≈ {tonic} {mode}; median chord {summary['harmonic_rhythm_s']['median']} s; pedal {PCS[pedal_pc]} {pedal_ratio:.0%}", fontsize=9)
    ax[1].plot(t, bass_pc, ".", ms=1.5, color="#2a6")
    ax[1].set_yticks(range(12)); ax[1].set_yticklabels(PCS, fontsize=5); ax[1].set_ylabel("bass pc", fontsize=7)
    ax[2].plot(np.arange(len(rdb)) / fps, rdb, lw=0.6, color="#444"); ax[2].set_ylabel("RMS dB", fontsize=7); ax[2].set_xlabel("s")
    fig.tight_layout()
    fig.savefig(os.path.join(out_dir, f"music_ref_{name}.png"), dpi=90)
    plt.close(fig)
    return summary


if __name__ == "__main__":
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "screenshots"
    os.makedirs(out, exist_ok=True)
    res = []
    for f in sorted(os.listdir(src)):
        if f.endswith(".wav"):
            s = analyse(os.path.join(src, f), out)
            if s is None:
                continue
            res.append(s)
            print(f"{s['track']:26s} {s['seconds']:6.0f}s mode~{s['mode_estimate']:16s} chord med {s['harmonic_rhythm_s']['median']}s (p25 {s['harmonic_rhythm_s']['p25']}, p75 {s['harmonic_rhythm_s']['p75']}) common {s['common_tones_of_top4']['mean']} pedal {s['bass_pedal']['pc']} {s['bass_pedal']['ratio']} loud p10/50/90 {s['loudness_db']['p10']}/{s['loudness_db']['p50']}/{s['loudness_db']['p90']} silent {s['loudness_db']['near_silent_pct']}% onsets/s {s['onsets_per_s']} centroid {s['centroid_hz']}")
    with open(os.path.join(out, "music_ref_analysis.json"), "w", encoding="utf-8") as fh:
        json.dump(res, fh, indent=1)
