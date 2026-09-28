"""Builds the engine plugins from lab/config.json.

Order here is the order the UI shows: TTS say, kokoro, bluetts; STT runpod-ivrit, local-ivrit.
Every engine answers available() -> (bool, note) cheaply (file checks only);
workers start on first use.
"""
import glob
import os

from .stt import LocalIvrit, RunPodIvrit
from .tts import BlueTTS, KokoroTTS, SayTTS
from .workerproc import WorkerProcess


def _p(path, base=None):
    if not path:
        return ""
    path = os.path.expanduser(path)
    if base and not os.path.isabs(path):
        path = os.path.join(base, path)
    return path


def _glob1(pattern):
    """First match of a path that may contain a glob (the HF cache has a snapshot hash in it)."""
    if not pattern:
        return ""
    if not glob.has_magic(pattern):
        return pattern
    hits = sorted(glob.glob(pattern))
    return hits[-1] if hits else ""


class Registry:
    def __init__(self, cfg, lab_dir, logs_dir):
        self.cfg = cfg
        workers_dir = os.path.join(lab_dir, "workers")
        venvs = cfg.get("venvs", {})
        lab_py = _p(venvs.get("lab", "~/.venvs/otiyot-lab/bin/python"))
        runpod_py = _p(venvs.get("runpod", "~/.venvs/lecture-transcriber/bin/python"))
        models = _p(cfg.get("models_dir", "~/.cache/otiyot-lab"))
        cwd = models if os.path.isdir(models) else None

        def worker(name, python, script, args, **kw):
            return WorkerProcess(name, python, os.path.join(workers_dir, script), args,
                                 log_path=os.path.join(logs_dir, f"{name}.log"), cwd=cwd, **kw)

        g2p_cfg = cfg.get("g2p", {})
        onnx = _p(g2p_cfg.get("phonikud_onnx", ""))
        reni = _glob1(_p(g2p_cfg.get("renikud_model", "")))
        self.g2p = worker("g2p", lab_py, "g2p_worker.py", ["--phonikud-onnx", onnx, "--renikud", reni],
                          start_timeout=120, call_timeout=60)
        self.renikud_model = reni

        self.tts, self.stt = [], []
        tcfg = cfg.get("tts", {})
        if tcfg.get("say", {}).get("enabled", True):
            self.tts.append(SayTTS(tcfg.get("say", {})))

        k = tcfg.get("kokoro", {})
        if k.get("enabled", True):
            model, voices, vocab = _p(k.get("model")), _p(k.get("voices")), _p(k.get("vocab"))
            w = worker("kokoro", lab_py, "kokoro_worker.py",
                       ["--model", model, "--voices", voices] + (["--vocab", vocab] if vocab else []),
                       start_timeout=180, call_timeout=60)
            self.tts.append(KokoroTTS(k, self.g2p, w, [
                (lab_py, "אין את סביבת הפייתון של המעבדה (~/.venvs/otiyot-lab)"),
                (model, "המודל kokoro.onnx לא הורד"), (voices, "הקובץ voices-hebrew.bin לא הורד"),
                (onnx, "המודל phonikud-onnx לא הורד")]))

        b = tcfg.get("bluetts", {})
        if b.get("enabled", True):
            repo, onnx_dir = _p(b.get("repo")), _p(b.get("onnx_dir"))
            voices = []
            for v in b.get("voices", []):
                path = _p(v.get("path"), repo)
                if os.path.exists(path):
                    voices.append({"id": v["id"], "name": v.get("name", v["id"]), "path": path})
            args = ["--repo", repo, "--onnx-dir", onnx_dir]
            for v in voices:
                args += ["--voice", f"{v['id']}={v['path']}"]
            w = worker("bluetts", lab_py, "bluetts_worker.py", args, start_timeout=180, call_timeout=90)
            self.tts.append(BlueTTS(b, self.g2p, w, [
                (lab_py, "אין את סביבת הפייתון של המעבדה (~/.venvs/otiyot-lab)"),
                (repo, "BlueTTS לא הותקן"), (os.path.join(onnx_dir, "vocoder.onnx"), "המודלים של BlueTTS לא הורדו"),
                (onnx, "המודל phonikud-onnx לא הורד"),
                (voices[0]["path"] if voices else "", "אין קבצי קול של BlueTTS")], voices))

        for e in self.tts:
            if hasattr(e, "g2p"):
                e.cache_tag = "renikud" if reni else "phonikud-onnx"

        scfg = cfg.get("stt", {})
        r = scfg.get("runpod-ivrit", {})
        if r.get("enabled", True):
            w = worker("runpod", runpod_py, "runpod_worker.py",
                       ["--env", _p(r.get("env_file")), "--model", r.get("model", "ivrit-ai/whisper-large-v3-turbo-ct2"),
                        "--language", r.get("language", "he"), "--mode", r.get("mode", "ivrit"),
                        "--timeout", str(r.get("timeout_s", 300))],
                       start_timeout=60, call_timeout=float(r.get("timeout_s", 300)) + 30)
            self.stt.append(RunPodIvrit(r, w, runpod_py))

        loc = scfg.get("local-ivrit", {})
        if loc.get("enabled", True):
            w = worker("mlx-whisper", lab_py, "mlx_whisper_worker.py",
                       ["--model", loc.get("model", "mlx-community/ivrit-ai-whisper-large-v3-turbo-mlx"),
                        "--language", loc.get("language", "he")],
                       start_timeout=300, call_timeout=90)
            self.stt.append(LocalIvrit(loc, w, lab_py))

    def get(self, kind, engine_id):
        for e in (self.tts if kind == "tts" else self.stt):
            if e.id == engine_id:
                return e
        return None

    def all_workers(self):
        seen, out = set(), []
        for e in self.tts + self.stt:
            for w in e.workers():
                if id(w) not in seen:
                    seen.add(id(w))
                    out.append(w)
        return out

    def stop(self):
        for w in self.all_workers():
            w.stop()
