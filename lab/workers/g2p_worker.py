"""Hebrew G2P worker: text (with or without nikud) -> IPA phonemes for the open TTS models.

Runs in ~/.venvs/otiyot-lab. One front end feeds every phoneme-based engine, so
the app's nikud decides the pronunciation:

  text WITH nikud   : stress lexicon (engines/hebrew.py) -> phonikud-onnx stress
                      prediction for unknown words (only the stress/vocal-shva marks
                      are transplanted, the given nikud is kept) -> phonikud.phonemize()
  text WITHOUT nikud: RenikudPlus (renikud-plus, the G2P BlueTTS ships with; it predicts
                      vowels AND stress from bare letters). If its model is missing:
                      phonikud-onnx diacritizer -> phonikud.phonemize() (phonikud-tts path).

Args: --phonikud-onnx PATH, --renikud PATH (model files; both optional, loaded lazily).
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))          # lab/ -> "engines" package

from protocol import log, serve  # noqa: E402
from engines import hebrew as H  # noqa: E402


def setup():
    ap = argparse.ArgumentParser()
    ap.add_argument("--phonikud-onnx", default="")
    ap.add_argument("--renikud", default="")
    args = ap.parse_args()
    from phonikud import phonemize
    phonemize("שָׁלוֹם")                               # warm the regex/FST tables
    import phonikud
    return {
        "phonemize": phonemize,
        "onnx_path": os.path.expanduser(args.phonikud_onnx),
        "diacritizer": None,
        "renikud_path": os.path.expanduser(args.renikud),
        "renikud": None,
        "info": {"phonikud": getattr(phonikud, "__version__", "?"),
                 "lexicon_words": len(H.LEXICON), "lexicon_version": H.LEXICON_VERSION},
    }


def diacritizer(state):
    if state["diacritizer"] is None:
        path = state["onnx_path"]
        if not path or not os.path.exists(path):
            raise RuntimeError(f"phonikud-onnx model not found: {path}")
        from phonikud_onnx import Phonikud
        log("loading phonikud-onnx", path)
        state["diacritizer"] = Phonikud(path)
    return state["diacritizer"]


def renikud(state):
    if state["renikud"] is None:
        from renikud_onnx import G2P
        log("loading RenikudPlus", state["renikud_path"])
        # explicit path + datastore=None: renikud-plus 0.5.0 otherwise asks the HF repo for a
        # datastore.json that it does not have (404) and fails
        state["renikud"] = G2P(state["renikud_path"], datastore=None)
    return state["renikud"]


def predict_marks(state, word):
    """Stress (and vocal shva) for one vocalized word the lexicon does not know.

    The model re-vocalizes from the bare letters, so only the positions of its
    OLE/METEG marks are copied onto the given word, and a METEG only where the
    given word really has a shva."""
    plain = H.strip_nikud(word)
    pred = diacritizer(state).add_diacritics(plain)
    if H.letters(pred) != H.letters(word):
        return word, False
    out = word
    for idx in H.marked_letter_indices(pred, H.METEG):
        if H.letter_has_mark(out, idx, H.SHVA):
            out = H.insert_after_letter(out, idx, H.METEG)
    for idx in H.marked_letter_indices(pred, H.OLE)[:1]:
        out = H.insert_after_letter(out, idx, H.OLE)
    return out, True


def op_phonemize(state, req):
    text = H.nfc(req.get("text", "")).strip()
    if not text:
        raise ValueError("empty text")
    phonemize = state["phonemize"]
    if H.has_nikud(text):
        marked, info = H.apply_lexicon(text)
        sources = {"lexicon": 0, "explicit": 0, "model": 0, "default": 0}
        if any(src is None for _, src in info) and req.get("predict_stress", True):
            parts = []
            for is_word, chunk in H.split_words(marked):
                if is_word and H.OLE not in chunk and H.has_nikud(chunk) \
                        and H.lexicon_lookup(chunk) is None and len(H.letters(chunk)) > 2:
                    try:
                        new, ok = predict_marks(state, chunk)
                    except Exception as e:  # noqa: BLE001 - fall back to phonikud's default
                        log("stress prediction failed:", e)
                        new, ok = chunk, False
                    sources["model" if ok and new != chunk else "default"] += 1
                    parts.append(new)
                else:
                    parts.append(chunk)
            marked = "".join(parts)
        for _, src in info:
            if src in ("lexicon", "explicit"):
                sources[src] += 1
        g2p = "phonikud+" + "+".join(k for k, v in sources.items() if v)
        return {"phonemes": phonemize(marked), "marked": marked, "g2p": g2p, "vocalized": True}
    if state["renikud_path"] and os.path.exists(state["renikud_path"]):
        return {"phonemes": renikud(state).phonemize(text), "marked": text,
                "g2p": "renikud-plus", "vocalized": False}
    vocalized = diacritizer(state).add_diacritics(text)
    return {"phonemes": phonemize(vocalized), "marked": vocalized,
            "g2p": "phonikud-onnx-diacritizer+phonikud", "vocalized": False}


if __name__ == "__main__":
    serve("g2p", setup, {"phonemize": op_phonemize})
