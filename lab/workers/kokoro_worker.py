"""Kokoro Hebrew TTS worker (thewh1teagle/kokoro-hebrew-nc via kokoro-onnx). Runs in ~/.venvs/otiyot-lab.

Input is IPA from the G2P worker (phonikud), because the model was trained on
phonikud IPA of vocalized Hebrew. Output: 24 kHz 16-bit PCM WAV.

Args: --model kokoro.onnx --voices voices-hebrew.bin [--vocab config.json]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from protocol import serve  # noqa: E402


def setup():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--voices", required=True)
    ap.add_argument("--vocab", default="")
    args = ap.parse_args()
    from kokoro_onnx import Kokoro
    import soundfile as sf
    vocab = os.path.expanduser(args.vocab) if args.vocab else None
    k = Kokoro(os.path.expanduser(args.model), os.path.expanduser(args.voices),
               vocab_config=vocab if vocab and os.path.exists(vocab) else None)
    voices = list(k.get_voices())
    k.create("ʃalˈom", voice=voices[0], is_phonemes=True)         # first run allocates the graph
    return {"k": k, "sf": sf, "voices": voices, "info": {"voices": voices}}


def op_synth(state, req):
    phonemes = (req.get("phonemes") or "").strip()
    if not phonemes:
        raise ValueError("no phonemes")
    voice = req.get("voice") or state["voices"][0]
    if voice not in state["voices"]:
        raise ValueError(f"unknown voice {voice!r}")
    speed = float(req.get("speed") or 1.0)
    samples, sr = state["k"].create(phonemes, voice=voice, speed=speed, is_phonemes=True)
    state["sf"].write(req["out"], samples, sr, subtype="PCM_16", format="WAV")
    return {"sample_rate": sr, "duration_ms": int(len(samples) * 1000 / sr)}


if __name__ == "__main__":
    serve("kokoro", setup, {"synth": op_synth})
