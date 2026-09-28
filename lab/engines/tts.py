"""TTS engines. synth(text, voice, rate, tmp_dir) -> (wav_bytes, meta)."""
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time

from .workerproc import WorkerError


def _read_and_remove(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


class EngineError(Exception):
    """An engine failed; `status` is the HTTP status to report."""

    def __init__(self, msg, status=502):
        super().__init__(msg)
        self.status = status


class SayTTS:
    """macOS `say` (the same Apple voices an iPad uses) -> AIFF -> WAV via afconvert."""
    id = "say"
    kind = "tts"
    name = "הקול של Mac (say)"
    cache_version = 1

    def __init__(self, cfg):
        self.cfg = cfg
        self.say = cfg.get("say_bin") or "/usr/bin/say"
        self.afconvert = cfg.get("afconvert_bin") or "/usr/bin/afconvert"
        self.base_wpm = int(cfg.get("base_wpm", 180))
        self._voices = None
        self._voices_at = 0
        self._lock = threading.Lock()

    def voices(self):
        with self._lock:
            if self._voices is not None and time.time() - self._voices_at < 300:
                return self._voices
            found = []
            try:
                out = subprocess.run([self.say, "-v", "?"], capture_output=True, text=True, timeout=20).stdout
                for line in out.splitlines():
                    m = re.match(r"^(.+?)\s+([a-z]{2,3}[_-][A-Za-z0-9]{2,4})\s+#", line)
                    if m and m.group(2).replace("-", "_").lower() in ("he_il", "iw_il"):
                        vid = m.group(1).strip()
                        found.append({"id": vid, "name": vid})
            except (OSError, subprocess.TimeoutExpired):
                pass
            # better voices first: Premium > Enhanced > default
            rank = lambda v: 0 if "Premium" in v["id"] else 1 if "Enhanced" in v["id"] else 2  # noqa: E731
            self._voices = sorted(found, key=lambda v: (rank(v), v["id"]))
            self._voices_at = time.time()
            return self._voices

    def available(self):
        if not os.path.exists(self.say) or not os.path.exists(self.afconvert):
            return False, "אין say או afconvert (רק ב-macOS)"
        v = self.voices()
        if not v:
            return False, "אין קול עברי מותקן. הגדרות מערכת ← נגישות ← תוכן מדובר ← קול מערכת ← ניהול קולות ← עברית"
        return True, f"{len(v)} קולות עבריים. ניקוד: הקול של Apple מחליט לבד איך לקרוא"

    def describe(self):
        ok, note = self.available()
        return {"id": self.id, "name": self.name, "available": ok, "note": note,
                "voices": self.voices() if ok else []}

    def default_voice(self):
        v = self.voices()
        return v[0]["id"] if v else None

    def synth(self, text, voice, rate, tmp_dir):
        voice = voice or self.default_voice()
        if voice not in {v["id"] for v in self.voices()}:
            raise EngineError(f"קול לא מוכר: {voice}", 400)
        t0 = time.monotonic()
        d = tempfile.mkdtemp(prefix="say-", dir=tmp_dir)
        try:
            txt, aiff, wav = (os.path.join(d, n) for n in ("in.txt", "out.aiff", "out.wav"))
            with open(txt, "w", encoding="utf-8") as f:
                f.write(text)
            cmd = [self.say, "-v", voice, "-o", aiff, "-f", txt]
            if abs(rate - 1.0) > 1e-3:
                cmd[1:1] = ["-r", str(int(round(self.base_wpm * rate)))]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if r.returncode != 0 or not os.path.exists(aiff):
                raise EngineError(f"say נכשל: {r.stderr.strip()[:200]}")
            r = subprocess.run([self.afconvert, "-f", "WAVE", "-d", "LEI16", aiff, wav],
                               capture_output=True, text=True, timeout=30)
            if r.returncode != 0 or not os.path.exists(wav):
                raise EngineError(f"afconvert נכשל: {r.stderr.strip()[:200]}")
            data = _read_and_remove(wav)
        except subprocess.TimeoutExpired:
            raise EngineError("say: תם הזמן", 504)
        finally:
            shutil.rmtree(d, ignore_errors=True)
        return data, {"elapsed_ms": int((time.monotonic() - t0) * 1000), "cold": False, "g2p": "apple"}

    def warm(self):
        return {"started": False}

    def workers(self):
        return []


class _PhonemeTTS:
    """Base for open models fed with phonikud IPA from the shared G2P worker."""
    kind = "tts"
    cache_version = 1
    cache_tag = ""             # which no-nikud G2P is configured (part of the TTS cache key)

    def __init__(self, cfg, g2p, worker, checks):
        self.cfg = cfg
        self.g2p = g2p
        self.worker = worker
        self.checks = checks            # [(path, note_if_missing)]

    def available(self):
        for path, note in self.checks:
            if not path or not os.path.exists(path):
                return False, note
        if self.worker.last_error and not self.worker.running:
            return True, f"{self.note} · שגיאה אחרונה: {self.worker.last_error[:160]}"
        return True, self.note

    def describe(self):
        ok, note = self.available()
        return {"id": self.id, "name": self.name, "available": ok, "note": note,
                "voices": self.voices() if ok else [],
                "loaded": self.worker.running}

    def workers(self):
        return [self.g2p, self.worker]

    def warm(self):
        started = [w for w in (self.g2p, self.worker) if w.ensure_started()]
        return {"started": bool(started), "load_ms": sum(w.load_ms or 0 for w in started)}

    def phonemes(self, text):
        return self.g2p.call("phonemize", text=text)

    def _call(self, fn):
        try:
            return fn()
        except WorkerError as e:
            raise EngineError(str(e), 504 if "timed out" in str(e) else 502)


class KokoroTTS(_PhonemeTTS):
    id = "kokoro"
    name = "Kokoro עברית (שאול)"
    note = ("מודל פתוח (StyleTTS2, 82M), רץ על המעבד. הקול של שאול אמסטרדמסקי. "
            "עם ניקוד: phonikud כולל הטעמה. בלי ניקוד: RenikudPlus. רישיון: שימוש לא מסחרי")

    def voices(self):
        return [{"id": "he_shaul", "name": "שאול (גבר)"}]

    def synth(self, text, voice, rate, tmp_dir):
        voice = voice or "he_shaul"
        if voice not in {v["id"] for v in self.voices()}:
            raise EngineError(f"קול לא מוכר: {voice}", 400)
        t0 = time.monotonic()
        ph = self._call(lambda: self.phonemes(text))
        fd, out = tempfile.mkstemp(suffix=".wav", prefix="kokoro-", dir=tmp_dir)
        os.close(fd)
        try:
            r = self._call(lambda: self.worker.call("synth", phonemes=ph["phonemes"], voice=voice, speed=rate, out=out))
            data = _read_and_remove(out)
        finally:
            if os.path.exists(out):
                os.remove(out)
        return data, {"elapsed_ms": int((time.monotonic() - t0) * 1000),
                      "cold": bool(ph.get("_started") or r.get("_started")),
                      "g2p": ph.get("g2p"), "phonemes": ph.get("phonemes"), "marked": ph.get("marked")}


class BlueTTS(_PhonemeTTS):
    id = "bluetts"
    cache_version = 5          # 2: retry near-silent outputs with the next seed; 3: 100 ms padding; 5: up to 12 seeds by voiced share, error instead of silence
    name = "BlueTTS 2.5"
    note = ("מודל פתוח (flow matching), רץ על המעבד, קולות של נשים וגברים. "
            "עם ניקוד: phonikud כולל הטעמה. בלי ניקוד: RenikudPlus (ה-G2P של BlueTTS). רישיון MIT")

    def __init__(self, cfg, g2p, worker, checks, voices):
        super().__init__(cfg, g2p, worker, checks)
        self._voices = voices

    def voices(self):
        return [{"id": v["id"], "name": v.get("name") or v["id"]} for v in self._voices]

    def synth(self, text, voice, rate, tmp_dir):
        voice = voice or (self._voices[0]["id"] if self._voices else None)
        if voice not in {v["id"] for v in self._voices}:
            raise EngineError(f"קול לא מוכר: {voice}", 400)
        t0 = time.monotonic()
        params = dict(voice=voice, speed=rate, steps=int(self.cfg.get("steps", 5)), seed=int(self.cfg.get("seed", 1234)))
        ph = self._call(lambda: self.phonemes(text))
        params["phonemes"] = ph["phonemes"]
        fd, out = tempfile.mkstemp(suffix=".wav", prefix="blue-", dir=tmp_dir)
        os.close(fd)
        try:
            r = self._call(lambda: self.worker.call("synth", out=out, **params))
            data = _read_and_remove(out)
        finally:
            if os.path.exists(out):
                os.remove(out)
        return data, {"elapsed_ms": int((time.monotonic() - t0) * 1000),
                      "cold": bool(ph.get("_started") or r.get("_started")),
                      "g2p": ph.get("g2p") or r.get("g2p"), "phonemes": ph.get("phonemes"),
                      "marked": ph.get("marked")}
