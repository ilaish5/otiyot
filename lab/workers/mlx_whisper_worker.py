"""Local ivrit.ai Whisper worker: mlx-whisper on the Apple GPU. Runs in ~/.venvs/otiyot-lab.

Model: mlx-community/ivrit-ai-whisper-large-v3-turbo-mlx (1.6 GB, Hugging Face cache).
The model is loaded and warmed once at startup, so every request measures only inference.
Input: 16 kHz mono PCM WAV path (the server converts everything first).

Args: --model HF_REPO_OR_PATH [--language he]
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from protocol import serve  # noqa: E402


def setup():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--language", default="he")
    args = ap.parse_args()
    os.environ.setdefault("HF_HUB_OFFLINE", "1")        # the model is already downloaded; no network per call
    import numpy as np
    import soundfile as sf
    import mlx_whisper
    model = os.path.expanduser(args.model) if args.model.startswith(("~", "/")) else args.model
    silence = np.zeros(16000, dtype=np.float32)
    mlx_whisper.transcribe(silence, path_or_hf_repo=model, language=args.language,
                           temperature=0.0, condition_on_previous_text=False)
    return {"mw": mlx_whisper, "np": np, "sf": sf, "model": model, "language": args.language,
            "info": {"model": args.model}}


def op_transcribe(state, req):
    np, sf = state["np"], state["sf"]
    audio, sr = sf.read(req["path"], dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != 16000:
        raise ValueError(f"expected 16 kHz audio, got {sr}")
    r = state["mw"].transcribe(audio.astype(np.float32), path_or_hf_repo=state["model"],
                               language=req.get("language") or state["language"],
                               temperature=0.0, condition_on_previous_text=False,
                               without_timestamps=True)
    text = (r.get("text") or "").strip()
    segs = r.get("segments") or []
    out = {"text": text, "alternatives": [text] if text else []}
    if segs:
        out["avg_logprob"] = round(float(np.mean([s.get("avg_logprob", 0.0) for s in segs])), 3)
        out["no_speech_prob"] = round(float(max(s.get("no_speech_prob", 0.0) for s in segs)), 3)
    return out


if __name__ == "__main__":
    serve("mlx-whisper", setup, {"transcribe": op_transcribe})
