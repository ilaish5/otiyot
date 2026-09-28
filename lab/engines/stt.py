"""STT engines. transcribe(wav16k_path) -> {"text", "alternatives", "elapsed_ms", "cold", ...}."""
import glob
import os
import time

from .tts import EngineError
from .workerproc import WorkerError


def _call(worker, op, timeout=None, **params):
    try:
        return worker.call(op, timeout=timeout, **params)
    except WorkerError as e:
        raise EngineError(str(e), 504 if "timed out" in str(e) else 502)


class RunPodIvrit:
    """ivrit-ai/whisper-large-v3-turbo-ct2 on the lecture-transcriber RunPod endpoint."""
    id = "runpod-ivrit"
    kind = "stt"
    name = "ivrit.ai בענן (RunPod)"

    def __init__(self, cfg, worker, python):
        self.cfg = cfg
        self.worker = worker
        self.python = python
        self.env_file = os.path.expanduser(cfg.get("env_file", ""))
        self.cold_ms = int(cfg.get("cold_ms", 8000))
        self.timeout = float(cfg.get("timeout_s", 300))

    def _env_ok(self):
        try:
            keys = {}
            with open(self.env_file, encoding="utf-8") as f:
                for line in f:
                    k, sep, v = line.strip().partition("=")
                    if sep and not k.startswith("#"):
                        keys[k.strip()] = bool(v.strip().strip('"').strip("'"))
            return keys.get("RUNPOD_API_KEY", False) and keys.get("RUNPOD_ENDPOINT_ID", False)
        except OSError:
            return False

    def available(self):
        if not os.path.exists(self.python):
            return False, f"אין את סביבת הפייתון של lecture-transcriber ({self.python})"
        site = glob.glob(os.path.join(os.path.dirname(os.path.dirname(self.python)), "lib", "python3*", "site-packages", "ivrit"))
        if not site:
            return False, "חבילת ivrit לא מותקנת בסביבה של lecture-transcriber"
        if not os.path.exists(self.env_file):
            return False, f"לא נמצא קובץ ההגדרות של RunPod ({self.env_file})"
        if not self._env_ok():
            return False, "חסרים RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID בקובץ ה-.env"
        note = ("אותו מודל ואותו שרת של תמלול ההרצאות. השרת נכבה אחרי 5 שניות בלי עבודה, "
                "אז רוב המילים מחכות להפעלה: כ-5 שניות אחרי הפסקה קצרה, כ-18 שניות בהפעלה קרה (ולפעמים דקות). חם: כ-1.7 שניות")
        if self.worker.last_error and not self.worker.running:
            note += f" · שגיאה אחרונה: {self.worker.last_error[:160]}"
        return True, note

    def describe(self):
        ok, note = self.available()
        return {"id": self.id, "name": self.name, "available": ok, "note": note, "loaded": self.worker.running}

    def workers(self):
        return [self.worker]

    def transcribe(self, path, **_):
        t0 = time.monotonic()
        r = _call(self.worker, "transcribe", timeout=self.timeout + 30, path=path, language=self.cfg.get("language", "he"))
        # the local client start (a second or two, once) is lab overhead, not RunPod latency
        elapsed = r.get("wall_ms") if r.get("wall_ms") is not None else int((time.monotonic() - t0) * 1000)
        out = {"text": r.get("text", ""), "alternatives": r.get("alternatives") or [],
               "elapsed_ms": int(elapsed), "cold": bool(elapsed > self.cold_ms), "mode": r.get("mode")}
        for k in ("delay_ms", "exec_ms"):
            if r.get(k) is not None:
                out[k] = r[k]
        return out

    def warm(self, silence_path):
        """Boot the GPU worker with 0.5 s of silence (costs one short RunPod job)."""
        r = self.transcribe(silence_path)
        r["started"] = True
        return r


class LocalIvrit:
    """mlx-whisper + mlx-community/ivrit-ai-whisper-large-v3-turbo-mlx on this Mac's GPU."""
    id = "local-ivrit"
    kind = "stt"
    name = "ivrit.ai על המחשב (MLX)"

    def __init__(self, cfg, worker, python):
        self.cfg = cfg
        self.worker = worker
        self.python = python

    def _model_present(self):
        model = self.cfg.get("model", "")
        if model.startswith(("/", "~")):
            return os.path.exists(os.path.expanduser(model))
        hub = os.path.expanduser(os.environ.get("HF_HUB_CACHE") or "~/.cache/huggingface/hub")
        pat = os.path.join(hub, "models--" + model.replace("/", "--"), "snapshots", "*", "weights.*")
        return bool(glob.glob(pat))

    def available(self):
        if not os.path.exists(self.python):
            return False, f"אין את סביבת הפייתון של המעבדה ({self.python}). הוראות התקנה ב-lab/README.md"
        if not self._model_present():
            return False, f"המודל לא הורד ({self.cfg.get('model')}). הוראות ב-lab/README.md"
        note = ("אותו מודל ivrit.ai (turbo), רץ על הכרטיס הגרפי של ה-Mac, בלי אינטרנט ובלי עלות. "
                "טעינה ראשונה כ-5 עד 10 שניות, אחר כך כ-2 שניות למילה")
        if self.worker.last_error and not self.worker.running:
            note += f" · שגיאה אחרונה: {self.worker.last_error[:160]}"
        return True, note

    def describe(self):
        ok, note = self.available()
        return {"id": self.id, "name": self.name, "available": ok, "note": note, "loaded": self.worker.running}

    def workers(self):
        return [self.worker]

    def transcribe(self, path, **_):
        t0 = time.monotonic()
        r = _call(self.worker, "transcribe", path=path, language=self.cfg.get("language", "he"))
        out = {"text": r.get("text", ""), "alternatives": r.get("alternatives") or [],
               "elapsed_ms": int((time.monotonic() - t0) * 1000), "cold": bool(r.get("_started"))}
        if r.get("_started"):
            out["load_ms"] = r.get("_start_ms")
        for k in ("avg_logprob", "no_speech_prob"):
            if r.get(k) is not None:
                out[k] = r[k]
        return out

    def warm(self, silence_path=None):
        started = self.worker.ensure_started()
        return {"started": started, "load_ms": self.worker.load_ms if started else 0}
