"""BlueTTS 2.5 worker (maxmelichov/BlueTTS, ONNX). Runs in ~/.venvs/otiyot-lab.

Input is IPA from the shared G2P worker (text_is_phonemes=True): phonikud for text with
nikud, so the app's nikud decides the pronunciation, and RenikudPlus (BlueTTS's own G2P)
for text without nikud. Output: 44.1 kHz 16-bit PCM WAV. The sampler is seeded per call, so a word always
sounds the same (the server also caches it).

Args: --repo PATH (git clone, holds voices/ and config/) --onnx-dir PATH [--voice-dir PATH ...]
"""
import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from protocol import serve  # noqa: E402


def setup():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--onnx-dir", required=True)
    ap.add_argument("--voice", action="append", default=[], help="id=path/to/style.json")
    args = ap.parse_args()
    repo = os.path.expanduser(args.repo)
    os.chdir(repo)                                   # BlueTTS resolves config/tts.json relative to cwd
    import numpy as np
    import soundfile as sf
    from blue_onnx import limit_peak, load_text_to_speech, load_voice_style
    tts = load_text_to_speech(os.path.expanduser(args.onnx_dir))
    voices = {}
    for spec in args.voice:
        vid, _, path = spec.partition("=")
        voices[vid] = os.path.expanduser(path)
    if not voices:
        for p in sorted(glob.glob(os.path.join(repo, "voices", "*.json"))):
            voices[os.path.splitext(os.path.basename(p))[0]] = p
    styles = {}
    first = next(iter(voices))
    styles[first] = load_voice_style([voices[first]])
    tts("ʃalˈom", lang="he", style=styles[first], total_step=5, text_is_phonemes=True)  # allocate graphs
    return {"tts": tts, "np": np, "sf": sf, "limit_peak": limit_peak, "load_voice_style": load_voice_style,
            "voices": voices, "styles": styles, "sr": tts.sample_rate,
            "info": {"voices": list(voices), "sample_rate": tts.sample_rate}}


def op_synth(state, req):
    voice = req.get("voice") or next(iter(state["voices"]))
    if voice not in state["voices"]:
        raise ValueError(f"unknown voice {voice!r}")
    if voice not in state["styles"]:
        state["styles"][voice] = state["load_voice_style"]([state["voices"][voice]])
    np = state["np"]
    phonemes = (req.get("phonemes") or "").strip()
    if not phonemes:
        raise ValueError("no phonemes")
    kw = dict(lang="he", style=state["styles"][voice], total_step=int(req.get("steps", 5)),
              speed=float(req.get("speed") or 1.0))
    seed = int(req.get("seed", 1234))
    sr = state["sr"]
    frame = max(1, int(sr * 0.02))

    def voiced(w):
        """Fraction of 20 ms frames with RMS >= 0.02 (-34 dBFS). Good takes: 0.45-0.95."""
        n = w.size // frame
        if n == 0 or not np.isfinite(w).all():
            return 0.0
        rms = np.sqrt((w[:n * frame].reshape(n, frame) ** 2).mean(axis=1))
        return float((rms >= 0.02).mean())

    # The sampler starts from noise; an unlucky seed can decode to (near) silence.
    # The bundled 'female' style is the unstable one: 'אַבָּא' is silent on seeds +0..+2,
    # and 'גְּלִידָה' on all of 12 seeds (a 0.07 peak blip at best, which Whisper hears as
    # 'תודה רבה'). noa/lily/adam/daniel are fine on seed 1234 (0.45-0.95 voiced).
    # Retry with the next seed, keep the most voiced take, and never return (and so
    # never cache) a silent file: the lab shows an error for that voice+word instead.
    best, best_v, best_seed = None, -1.0, seed
    for attempt in range(12):
        np.random.seed(seed + attempt)
        wav, _ = state["tts"](phonemes, text_is_phonemes=True, **kw)
        wav = np.asarray(wav, dtype=np.float32).reshape(-1)
        v = voiced(wav)
        if v > best_v:
            best, best_v, best_seed = wav, v, seed + attempt
        if v >= 0.4:
            break
    if best is None or best_v < 0.25:
        raise ValueError(f"הקול {voice} הפיק רק שקט במילה הזאת (נוסו 12 זרעים). כדאי לבחור קול אחר")
    wav, attempt = best, best_seed - seed
    wav = state["limit_peak"](wav)
    # the vocoder starts at full level on sample 0; 100 ms of silence on each side keeps
    # the first consonant from being clipped when a browser starts playback
    pad = np.zeros(int(sr * 0.1), dtype=np.float32)
    wav = np.concatenate([pad, wav, pad])
    state["sf"].write(req["out"], wav, sr, subtype="PCM_16", format="WAV")
    return {"sample_rate": sr, "duration_ms": int(len(wav) * 1000 / sr), "seed": seed + attempt}


if __name__ == "__main__":
    serve("bluetts", setup, {"synth": op_synth})
