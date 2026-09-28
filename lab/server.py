#!/usr/bin/env python3
"""Speech lab server for "אותיות נפגשות" (stdlib only; run with plain python3).

    python3 lab/server.py            -> http://127.0.0.1:8766/lab/

Serves the project directory as static files (so /lab/ and /js/ work) plus the
/api/* contract used by lab/lab.js: TTS and STT engines, stored recordings,
ratings. Heavy models run in their own venvs as worker subprocesses
(lab/workers/*), started on first use. Binds to 127.0.0.1 only; requests from
other web sites (Origin / Sec-Fetch-Site / Host checks) are refused, so a page
open in the browser cannot reach the child's recordings or spend RunPod time.
"""
import argparse
import copy
import hashlib
import json
import mimetypes
import os
import posixpath
import re
import secrets
import shutil
import signal
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, unquote, urlsplit

LAB_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(LAB_DIR)
sys.path.insert(0, LAB_DIR)
sys.dont_write_bytecode = True          # no __pycache__ in the (iCloud-synced) project folder

from engines import audio as A  # noqa: E402
from engines import hebrew as H  # noqa: E402
from engines.registry import Registry  # noqa: E402
from engines.tts import EngineError  # noqa: E402

VERSION = "1.0"
MAX_AUDIO = 25 * 1024 * 1024
MAX_JSON = 8 * 1024 * 1024
MAX_TEXT = 300
ID_RX = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
LABELS = (None, "correct", "wrong", "unclear")
BROWSER_HINT = ("ב-Safari ההקראה והזיהוי הם של Apple, כמו באייפד. ב-Chrome הזיהוי נשלח ל-Google. "
                "לבדיקה שהכי דומה לאייפד: לפתוח ב-Safari את http://127.0.0.1:{port}/lab/")
MIME = {
    ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".ico": "image/x-icon", ".wav": "audio/wav", ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4", ".webm": "audio/webm", ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8", ".sql": "text/plain; charset=utf-8",
    ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf",
}


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- config

def load_config(path):
    if not os.path.exists(path):
        example = os.path.join(LAB_DIR, "config.example.json")
        shutil.copyfile(example, path)
        log(f"created {path} from config.example.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve(path, base=LAB_DIR):
    path = os.path.expanduser(path)
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(base, path))


def write_json_atomic(path, obj):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=d)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except (OSError, ValueError) as e:
        # never silently replace a damaged file: keep a copy next to it
        bad = f"{path}.broken-{int(time.time())}"
        try:
            shutil.copyfile(path, bad)
        except OSError:
            pass
        log(f"WARNING: could not read {path} ({e}); a copy was saved as {bad}")
        return default


# ---------------------------------------------------------------- storage

class Store:
    """recordings.json + recordings/<id>.wav + ratings.json, one lock for all writes."""

    def __init__(self, data_dir):
        self.dir = data_dir
        self.rec_dir = os.path.join(data_dir, "recordings")
        self.rec_json = os.path.join(data_dir, "recordings.json")
        self.ratings_json = os.path.join(data_dir, "ratings.json")
        os.makedirs(self.rec_dir, exist_ok=True)
        self.lock = threading.RLock()
        recs = read_json(self.rec_json, [])
        self.recs = recs if isinstance(recs, list) else []

    def _save(self):
        write_json_atomic(self.rec_json, self.recs)

    def wav_path(self, rid):
        return os.path.join(self.rec_dir, f"{rid}.wav")

    # Responses get deep copies taken under the lock: a record's nested "results"
    # dict is mutated by /run while another thread may be serializing it.
    def list(self):
        with self.lock:
            return sorted((copy.deepcopy(r) for r in self.recs), key=lambda r: r.get("ts") or 0, reverse=True)

    def get(self, rid):
        """The live record (callers hold no reference across requests); use snapshot() for responses."""
        with self.lock:
            for r in self.recs:
                if r.get("id") == rid:
                    return r
        return None

    def snapshot(self, rid):
        with self.lock:
            r = self.get(rid)
            return copy.deepcopy(r) if r is not None else None

    def add(self, rec):
        with self.lock:
            self.recs.append(rec)
            self._save()

    def update(self, rid, fn):
        with self.lock:
            r = self.get(rid)
            if r is None:
                return None
            fn(r)
            self._save()
            return copy.deepcopy(r)

    def delete(self, rid):
        with self.lock:
            before = len(self.recs)
            self.recs = [r for r in self.recs if r.get("id") != rid]
            if len(self.recs) == before:
                return False
            self._save()
        try:
            os.remove(self.wav_path(rid))
        except OSError:
            pass
        return True

    def ratings(self):
        with self.lock:
            r = read_json(self.ratings_json, {})
            return r if isinstance(r, dict) else {}

    def save_ratings(self, obj):
        with self.lock:
            write_json_atomic(self.ratings_json, obj)


# ---------------------------------------------------------------- app

class HttpError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


class App:
    def __init__(self, cfg, data_dir, port, config_path=None):
        self.cfg = cfg
        self.port = port
        self.data_dir = data_dir
        self.config_path = config_path or os.path.join(LAB_DIR, "config.json")
        self.tmp = os.path.join(data_dir, "tmp")
        self.cache = os.path.join(data_dir, "tts-cache")
        self.logs = os.path.join(data_dir, "logs")
        for d in (self.tmp, self.cache, self.logs):
            os.makedirs(d, exist_ok=True)
        for name in os.listdir(self.tmp):                     # leftovers of a crash
            p = os.path.join(self.tmp, name)
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                try:
                    os.remove(p)
                except OSError:
                    pass
        self.ffmpeg = cfg.get("ffmpeg") or shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
        self.store = Store(data_dir)
        self.reg = Registry(cfg, LAB_DIR, self.logs)
        self.trim = bool(cfg.get("stt", {}).get("trim_silence", True))
        self.origins = {f"http://127.0.0.1:{port}", f"http://localhost:{port}", f"http://[::1]:{port}"}
        self.hosts = {f"127.0.0.1:{port}", f"localhost:{port}", f"[::1]:{port}"}

    # ----- helpers
    def private_ids(self):
        """(st_dev, st_ino) of what static serving must never expose: the data dir and the config.

        Compared by file identity, not by name, so /LAB/Data/... (macOS is case-insensitive),
        a --data-dir elsewhere inside the project, or a symlink all stay blocked."""
        ids = set()
        for p in (self.data_dir, self.config_path, os.path.join(LAB_DIR, "config.json"), os.path.join(LAB_DIR, "data")):
            try:
                st = os.stat(p)
                ids.add((st.st_dev, st.st_ino))
            except OSError:
                pass
        return ids

    def tts_engine(self, eid):
        e = self.reg.get("tts", eid)
        if e is None:
            raise HttpError(404, f"מנוע הקראה לא מוכר: {eid}")
        ok, note = e.available()
        if not ok:
            raise HttpError(503, f"{e.name} לא זמין: {note}")
        return e

    def stt_engine(self, eid):
        e = self.reg.get("stt", eid or "")
        if e is None:
            raise HttpError(404, f"מנוע זיהוי לא מוכר: {eid}")
        ok, note = e.available()
        if not ok:
            raise HttpError(503, f"{e.name} לא זמין: {note}")
        return e

    def convert(self, body, content_type, out_path):
        if not body or len(body) < 100:
            raise HttpError(400, "ההקלטה ריקה")
        mime = (content_type or "").split(";")[0].strip().lower()
        fd, src = tempfile.mkstemp(suffix=A.EXT_BY_MIME.get(mime, ".bin"), prefix="in-", dir=self.tmp)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(body)
            A.to_wav16k(self.ffmpeg, src, out_path)
        except A.AudioError as e:
            raise HttpError(400, f"לא הצלחתי לפענח את ההקלטה ({mime or 'unknown'}): {e}")
        finally:
            try:
                os.remove(src)
            except OSError:
                pass

    def run_stt(self, engine, wav_path):
        """Trim silence (all engines get the same audio), then transcribe."""
        cleanup = []
        try:
            use, extra = wav_path, {"audio_ms": A.duration_ms(wav_path)}
            if self.trim:
                fd, trimmed = tempfile.mkstemp(suffix=".wav", prefix="trim-", dir=self.tmp)
                os.close(fd)
                cleanup.append(trimmed)
                try:
                    info = A.trim_silence(wav_path, trimmed)
                except (A.AudioError, OSError, EOFError) as e:
                    info = {"silent": False, "trimmed": False, "path": wav_path}
                    log("trim failed:", e)
                if info.get("silent"):
                    return {"text": "", "alternatives": [], "elapsed_ms": 0, "cold": None, "silent": True,
                            "note": "ההקלטה שקטה לגמרי, לא נשלחה למנוע", **extra}
                if info.get("trimmed"):
                    use = info["path"]
                    extra["sent_ms"] = info["end_ms"] - info["start_ms"]
            res = engine.transcribe(use)
            return {**res, **extra}
        except EngineError as e:
            raise HttpError(e.status, f"{engine.name}: {e}")
        finally:
            for p in cleanup:
                try:
                    os.remove(p)
                except OSError:
                    pass

    def silence(self):
        fd, p = tempfile.mkstemp(suffix=".wav", prefix="silence-", dir=self.tmp)
        os.close(fd)
        A.silence_wav(p)
        return p

    # ----- endpoints
    def engines(self):
        return {"tts": [e.describe() for e in self.reg.tts],
                "stt": [e.describe() for e in self.reg.stt],
                "browserHint": BROWSER_HINT.format(port=self.port)}

    def status(self):
        return {"version": VERSION, "data_dir": self.data_dir, "trim_silence": self.trim,
                "workers": {w.name: w.status() for w in self.reg.all_workers()}}

    def tts(self, body):
        eid = body.get("engine")
        text = H.nfc(str(body.get("text") or "")).strip()
        if not isinstance(eid, str) or not eid:
            raise HttpError(400, "חסר engine")
        if not text:
            raise HttpError(400, "חסר טקסט")
        if len(text) > MAX_TEXT:
            raise HttpError(400, f"טקסט ארוך מדי (עד {MAX_TEXT} תווים)")
        try:
            rate = float(body.get("rate", 1.0) or 1.0)
        except (TypeError, ValueError):
            raise HttpError(400, "rate לא תקין")
        rate = min(1.5, max(0.5, rate))
        e = self.tts_engine(eid)
        voice = body.get("voice") or None
        if voice is not None and not isinstance(voice, str):
            raise HttpError(400, "voice לא תקין")
        voice = voice or (e.voices()[0]["id"] if e.voices() else "")
        key = hashlib.sha1(json.dumps([e.id, e.cache_version, getattr(e, "cache_tag", ""), H.LEXICON_VERSION,
                                       voice, text, round(rate, 2)],
                                      ensure_ascii=False).encode()).hexdigest()
        wav_p, meta_p = os.path.join(self.cache, key + ".wav"), os.path.join(self.cache, key + ".json")
        if os.path.exists(wav_p) and os.path.exists(meta_p):
            with open(wav_p, "rb") as f:
                data = f.read()
            meta = read_json(meta_p, {})
            return data, meta, True
        try:
            data, meta = e.synth(text, voice, rate, self.tmp)
        except EngineError as ex:
            raise HttpError(ex.status, f"{e.name}: {ex}")
        meta = {**meta, "engine": e.id, "voice": voice, "text": text, "rate": rate}
        # unique temp name: two identical uncached requests may finish at the same time
        fd, part = tempfile.mkstemp(prefix=".part-", suffix=".wav", dir=self.cache)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(data)
            os.replace(part, wav_p)
        except BaseException:
            try:
                os.remove(part)
            except OSError:
                pass
            raise
        write_json_atomic(meta_p, meta)
        return data, meta, False

    def stt(self, query, body, ctype):
        e = self.stt_engine(query.get("engine"))
        fd, wav = tempfile.mkstemp(suffix=".wav", prefix="stt-", dir=self.tmp)
        os.close(fd)
        try:
            self.convert(body, ctype, wav)
            res = self.run_stt(e, wav)
        finally:
            try:
                os.remove(wav)
            except OSError:
                pass
        return {"engine": e.id, "target": query.get("target", ""), **res}

    def warm(self, query):
        eid = query.get("engine", "")
        e = self.reg.get("tts", eid) or self.reg.get("stt", eid)
        if e is None:
            raise HttpError(404, f"מנוע לא מוכר: {eid}")
        ok, note = e.available()
        if not ok:
            raise HttpError(503, f"{e.name} לא זמין: {note}")
        t0 = time.monotonic()
        sil = None
        try:
            if e.kind == "stt":
                sil = self.silence()
                res = e.warm(sil)
            else:
                res = e.warm()
        except EngineError as ex:
            raise HttpError(ex.status, f"{e.name}: {ex}")
        except Exception as ex:  # noqa: BLE001 - WorkerError from ensure_started
            raise HttpError(502, f"{e.name}: {ex}")
        finally:
            if sil:
                try:
                    os.remove(sil)
                except OSError:
                    pass
        return {"engine": e.id, "wall_ms": int((time.monotonic() - t0) * 1000), **res}

    def add_recording(self, query, body, ctype):
        word_id = str(query.get("wordId", ""))[:100]
        target = H.nfc(str(query.get("target", "")))[:200]
        rid = time.strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3)
        path = self.store.wav_path(rid)
        # convert into tmp/ first, so a failed or half-written conversion never lands in recordings/
        fd, tmp_wav = tempfile.mkstemp(suffix=".wav", prefix="rec-", dir=self.tmp)
        os.close(fd)
        try:
            self.convert(body, ctype, tmp_wav)
            os.replace(tmp_wav, path)
        finally:
            try:
                os.remove(tmp_wav)
            except OSError:
                pass
        rec = {"id": rid, "wordId": word_id or None, "target": target, "ts": int(time.time() * 1000),
               "label": None, "webspeech": None, "results": {},
               "duration_ms": A.duration_ms(path), "mime": (ctype or "").split(";")[0].strip() or None}
        try:
            self.store.add(rec)
        except BaseException:
            try:
                os.remove(path)
            except OSError:
                pass
            raise
        return copy.deepcopy(rec)

    def patch_recording(self, rid, body):
        if not isinstance(body, dict):
            raise HttpError(400, "צריך אובייקט JSON")
        if "label" in body and body["label"] not in LABELS:
            raise HttpError(400, "label צריך להיות correct / wrong / unclear / null")
        if "webspeech" in body:
            ws = body["webspeech"]
            if ws is not None and not isinstance(ws, dict):
                raise HttpError(400, "webspeech צריך להיות אובייקט או null")
            if len(json.dumps(ws, ensure_ascii=False)) > 100_000:
                raise HttpError(400, "webspeech גדול מדי")

        def fn(r):
            if "label" in body:
                r["label"] = body["label"]
            if "webspeech" in body:
                r["webspeech"] = body["webspeech"]
        rec = self.store.update(rid, fn)
        if rec is None:
            raise HttpError(404, "הקלטה לא נמצאה")
        return rec

    def run_recording(self, rid, query):
        rec = self.store.get(rid)
        if rec is None:
            raise HttpError(404, "הקלטה לא נמצאה")
        path = self.store.wav_path(rid)
        if not os.path.exists(path):
            raise HttpError(404, "קובץ ההקלטה חסר")
        e = self.stt_engine(query.get("engine"))
        res = self.run_stt(e, path)
        res["ts"] = int(time.time() * 1000)

        def fn(r):
            r.setdefault("results", {})[e.id] = res
        saved = self.store.update(rid, fn) is not None
        return {"engine": e.id, **res, "saved": saved}

    def put_ratings(self, body):
        if not isinstance(body, dict):
            raise HttpError(400, "הדירוגים צריכים להיות אובייקט JSON")
        for k, v in body.items():
            if not isinstance(k, str) or not (v is None or isinstance(v, dict)):
                raise HttpError(400, f"דירוג לא תקין: {str(k)[:60]}")
        self.store.save_ratings(body)
        return {"ok": True, "count": len(body)}


# ---------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "otiyot-lab/" + VERSION
    app = None  # set in main()

    # quieter, path-only log line
    def log_message(self, fmt, *args):
        pass

    def _log(self, status, t0):
        path = urlsplit(self.path).path
        if path.startswith("/api/") or status >= 400:
            shown = re.sub(r"[\x00-\x1f\x7f]", "?", unquote(path))     # no forged log lines via %0a
            log(f"{self.command} {shown} -> {status} ({int((time.monotonic() - t0) * 1000)} ms)")

    # ----- responses
    def _send(self, status, body=b"", ctype="application/json; charset=utf-8", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if ctype.startswith(("application/json", "audio/")) else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        if self.close_connection:
            self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        self._status = status

    def _json(self, status, obj):
        self._send(status, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _error(self, status, msg):
        # a body we never read would corrupt the next request on this keep-alive connection
        if not self._body_read and int(self.headers.get("Content-Length") or 0) > 0:
            self.close_connection = True
        self._json(status, {"error": msg})

    # ----- request plumbing
    def _read_body(self, limit):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise HttpError(400, "Content-Length לא תקין")
        if n > limit:
            # drain a moderately oversized body so the client gets the 413 JSON instead of a reset
            if n <= 4 * MAX_AUDIO:
                left = n
                while left > 0:
                    chunk = self.rfile.read(min(left, 1 << 20))
                    if not chunk:
                        break
                    left -= len(chunk)
                self._body_read = left == 0
            raise HttpError(413, "הבקשה גדולה מדי")
        data = self.rfile.read(n) if n > 0 else b""
        self._body_read = True
        return data

    def _json_body(self):
        raw = self._read_body(MAX_JSON)
        if not raw:
            return {}
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise HttpError(400, "JSON לא תקין")

    def _guard(self, api):
        app = self.app
        host = (self.headers.get("Host") or "").lower()
        if host not in app.hosts:
            raise HttpError(403, "Host לא מורשה (השרת מקבל רק 127.0.0.1 / localhost)")
        origin = self.headers.get("Origin")
        if origin and origin != "null" and origin not in app.origins:
            raise HttpError(403, "בקשה מאתר אחר נחסמה")
        if api and (self.headers.get("Sec-Fetch-Site") or "").lower() == "cross-site":
            raise HttpError(403, "בקשה מאתר אחר נחסמה")
        if origin == "null" and self.command not in ("GET", "HEAD"):
            raise HttpError(403, "בקשה ממקור לא ידוע נחסמה")

    def _dispatch(self):
        t0 = time.monotonic()
        self._status = 0
        self._body_read = False
        parts = urlsplit(self.path)
        path = parts.path
        api = path.startswith("/api/")
        try:
            self._guard(api)
            if api:
                query = {k: v[0] for k, v in parse_qs(parts.query, keep_blank_values=True).items()}
                self._api(path, query)
            elif self.command in ("GET", "HEAD"):
                self._static(path)
            else:
                self._read_body(MAX_AUDIO)
                raise HttpError(405, "method not allowed")
        except HttpError as e:
            self._error(e.status, str(e))
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        except Exception as e:  # noqa: BLE001 - JSON error instead of a dropped connection
            log("ERROR", self.command, path, f"{type(e).__name__}: {e}")
            traceback.print_exc(file=sys.stderr)
            try:
                self._error(500, f"שגיאה בשרת: {type(e).__name__}: {e}")
            except OSError:
                pass
        self._log(self._status or 0, t0)

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = _dispatch

    def do_OPTIONS(self):
        self._body_read = False
        self._error(405, "CORS is not supported (same origin only)")

    # ----- API routing
    def _api(self, path, q):
        app, m = self.app, self.command
        seg = [unquote(s) for s in path[len("/api/"):].split("/") if s]
        if seg == ["engines"] and m == "GET":
            return self._json(200, app.engines())
        if seg == ["status"] and m == "GET":
            return self._json(200, app.status())
        if seg == ["tts"] and m == "POST":
            body = self._json_body()
            if not isinstance(body, dict):
                raise HttpError(400, "צריך אובייקט JSON")
            data, meta, cached = app.tts(body)
            hdr = {"X-Elapsed-Ms": str(int(meta.get("elapsed_ms") or 0)), "X-Cached": "1" if cached else "0",
                   "X-Cold": "1" if (meta.get("cold") and not cached) else "0",
                   "X-Engine": meta.get("engine", ""), "X-Voice": quote(meta.get("voice") or "")}
            if meta.get("g2p"):
                hdr["X-G2P"] = quote(meta["g2p"])
            if meta.get("phonemes"):
                hdr["X-Phonemes"] = quote(meta["phonemes"])
            if meta.get("marked"):
                hdr["X-Text-Used"] = quote(meta["marked"])
            return self._send(200, data, "audio/wav", hdr)
        if seg == ["stt"] and m == "POST":
            body = self._read_body(MAX_AUDIO)
            return self._json(200, app.stt(q, body, self.headers.get("Content-Type")))
        if seg == ["warm"] and m == "POST":
            self._read_body(MAX_JSON)
            return self._json(200, app.warm(q))
        if seg == ["ratings"]:
            if m == "GET":
                return self._json(200, app.store.ratings())
            if m == "PUT":
                return self._json(200, app.put_ratings(self._json_body()))
        if seg and seg[0] == "recordings":
            if len(seg) == 1:
                if m == "GET":
                    return self._json(200, app.store.list())
                if m == "POST":
                    body = self._read_body(MAX_AUDIO)
                    return self._json(200, app.add_recording(q, body, self.headers.get("Content-Type")))
            elif len(seg) == 2 and seg[1].endswith(".wav") and m in ("GET", "HEAD"):
                rid = seg[1][:-4]
                if not ID_RX.match(rid) or app.store.get(rid) is None:
                    raise HttpError(404, "הקלטה לא נמצאה")
                p = app.store.wav_path(rid)
                if not os.path.exists(p):
                    raise HttpError(404, "קובץ ההקלטה חסר")
                with open(p, "rb") as f:
                    return self._send(200, f.read(), "audio/wav")
            elif len(seg) == 2 and ID_RX.match(seg[1]):
                if m == "PATCH":
                    return self._json(200, app.patch_recording(seg[1], self._json_body()))
                if m == "DELETE":
                    self._read_body(MAX_JSON)
                    if not app.store.delete(seg[1]):
                        raise HttpError(404, "הקלטה לא נמצאה")
                    return self._json(200, {"ok": True, "id": seg[1]})
                if m == "GET":
                    rec = app.store.snapshot(seg[1])
                    if rec is None:
                        raise HttpError(404, "הקלטה לא נמצאה")
                    return self._json(200, rec)
            elif len(seg) == 3 and ID_RX.match(seg[1]) and seg[2] == "run" and m == "POST":
                self._read_body(MAX_JSON)
                return self._json(200, app.run_recording(seg[1], q))
        if m in ("POST", "PUT", "PATCH", "DELETE"):
            self._read_body(MAX_AUDIO)
        raise HttpError(404, f"אין כזה API: {m} {path}")

    # ----- static files
    BLOCKED = ("lab/data", "lab/config.json")

    def _static(self, path):
        rel = posixpath.normpath(unquote(path)).lstrip("/")
        if rel in (".", ""):
            rel = ""
        segs = [s for s in rel.split("/") if s]
        if any(s.startswith(".") or s == ".." for s in segs) or "\0" in rel:
            raise HttpError(404, "לא נמצא")
        low = rel.casefold()                          # the Mac file system ignores case
        if any(low == b or low.startswith(b + "/") for b in self.BLOCKED):
            raise HttpError(404, "לא נמצא")
        full = os.path.realpath(os.path.join(ROOT, *segs))
        if not (full == ROOT or full.startswith(ROOT + os.sep)):
            raise HttpError(404, "לא נמצא")
        if self._is_private(full):
            raise HttpError(404, "לא נמצא")
        if os.path.isdir(full):
            if not path.endswith("/"):
                self._send(301, b"", "text/plain; charset=utf-8", {"Location": quote(path + "/", safe="/%")})
                return
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            raise HttpError(404, "לא נמצא")
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        with open(full, "rb") as f:
            self._send(200, f.read(), ctype)

    def _is_private(self, full):
        """True when `full` is, or is inside, the data dir or the config (by file identity)."""
        ids = self.app.private_ids()
        if not ids:
            return False
        p = full
        while len(p) >= len(ROOT):
            try:
                st = os.stat(p)
                if (st.st_dev, st.st_ino) in ids:
                    return True
            except OSError:
                pass
            parent = os.path.dirname(p)
            if parent == p:
                break
            p = parent
        return False


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    ap = argparse.ArgumentParser(description="Speech lab server (127.0.0.1 only)")
    ap.add_argument("--config", default=os.path.join(LAB_DIR, "config.json"))
    ap.add_argument("--port", type=int)
    ap.add_argument("--data-dir", help="override data_dir (recordings, ratings, cache, logs)")
    args = ap.parse_args()

    cfg = load_config(args.config)
    host = cfg.get("host", "127.0.0.1")
    if host not in ("127.0.0.1", "localhost", "::1"):
        sys.exit(f"refusing to bind {host!r}: the lab serves a child's recordings and binds 127.0.0.1 only")
    port = args.port or int(cfg.get("port", 8766))
    data_dir = resolve(args.data_dir or cfg.get("data_dir", "data"))
    os.makedirs(data_dir, exist_ok=True)

    app = App(cfg, data_dir, port, config_path=os.path.abspath(args.config))
    Handler.app = app
    Server.address_family = __import__("socket").AF_INET6 if host == "::1" else __import__("socket").AF_INET
    try:
        httpd = Server(("127.0.0.1" if host == "localhost" else host, port), Handler)
    except OSError as e:
        sys.exit(f"cannot listen on {host}:{port} ({e.strerror}). Is the lab server already running? "
                 f"(lsof -nP -iTCP:{port} -sTCP:LISTEN)")

    def stop(*_):
        threading.Thread(target=httpd.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    log(f"speech lab on http://127.0.0.1:{port}/lab/   data: {data_dir}")
    for e in app.reg.tts + app.reg.stt:
        ok, note = e.available()
        log(f"  {e.kind} {e.id:13s} {'ok ' if ok else 'OFF'}  {note[:110]}")
    try:
        httpd.serve_forever(poll_interval=0.5)
    finally:
        log("stopping workers ...")
        app.reg.stop()
        httpd.server_close()
        log("bye")


if __name__ == "__main__":
    main()
