"""Persistent JSON-lines worker subprocesses (server side, stdlib only).

Each heavy engine runs in its own venv as a long-lived process (see workers/protocol.py):
started lazily on first use, the model loaded once, one request at a time,
killed on timeout and restarted on the next call after a crash.
"""
import json
import os
import queue
import subprocess
import threading
import time


class WorkerError(Exception):
    pass


class WorkerProcess:
    def __init__(self, name, python, script, args=(), log_path=None, cwd=None, env=None,
                 start_timeout=180.0, call_timeout=60.0):
        self.name = name
        self.python = python
        self.script = script
        self.args = [str(a) for a in args]
        self.log_path = log_path
        self.cwd = cwd
        self.extra_env = dict(env or {})
        self.start_timeout = start_timeout
        self.call_timeout = call_timeout
        self._lock = threading.Lock()
        self._proc = None
        self._q = None
        self._log = None
        self._next_id = 0
        self._fails = []                    # monotonic times of failed starts
        self.load_ms = None
        self.started_at = None
        self.ready_info = {}
        self.last_error = None
        self.starts = 0

    # ---------- state ----------
    @property
    def running(self):
        return self._proc is not None and self._proc.poll() is None

    def status(self):
        return {"running": self.running, "load_ms": self.load_ms, "starts": self.starts,
                "last_error": self.last_error}

    # ---------- lifecycle ----------
    def _env(self):
        env = dict(os.environ)
        env.update({"PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1",
                    "HF_HUB_DISABLE_TELEMETRY": "1", "HF_HUB_DISABLE_PROGRESS_BARS": "1",
                    "TOKENIZERS_PARALLELISM": "false", "TQDM_DISABLE": "1"})
        env.update(self.extra_env)
        return env

    def _start(self):
        now = time.monotonic()
        self._fails = [t for t in self._fails if now - t < 300]
        if len(self._fails) >= 3 and now - self._fails[-1] < 60:
            raise WorkerError(f"{self.name}: failed to start 3 times; waiting a minute before retrying "
                              f"({self.last_error})")
        if not os.path.exists(self.python):
            raise WorkerError(f"{self.name}: python not found: {self.python}")
        if self._proc is not None or self._log is not None:
            self._kill()                    # a worker that died on its own: reap it, close its log
        if self.log_path:
            os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
            self._log = open(self.log_path, "a", encoding="utf-8")
            self._log.write(f"\n=== {time.strftime('%Y-%m-%d %H:%M:%S')} start {self.name} ===\n")
            self._log.flush()
        t0 = time.monotonic()
        try:
            self._proc = subprocess.Popen(
                [self.python, "-u", self.script, *self.args],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=self._log or subprocess.DEVNULL, cwd=self.cwd, env=self._env(),
                text=True, encoding="utf-8", errors="replace", bufsize=1)
        except OSError as e:
            self._fails.append(time.monotonic())
            self.last_error = f"spawn failed: {e}"
            raise WorkerError(f"{self.name}: {self.last_error}")
        self.starts += 1
        q = queue.Queue()
        self._q = q
        threading.Thread(target=self._reader, args=(self._proc, q), daemon=True,
                         name=f"worker-{self.name}").start()
        try:
            msg = self._get(self.start_timeout, starting=True)
        except WorkerError as e:
            self._kill()
            self._fails.append(time.monotonic())
            self.last_error = str(e)
            raise
        if msg.get("event") != "ready":
            self._kill()
            self._fails.append(time.monotonic())
            self.last_error = msg.get("error") or f"unexpected first message {msg!r}"[:300]
            raise WorkerError(f"{self.name}: {self.last_error}")
        self.load_ms = int((time.monotonic() - t0) * 1000)
        self.started_at = time.time()
        self.ready_info = {k: v for k, v in msg.items() if k != "event"}
        self.last_error = None
        self._fails = []

    @staticmethod
    def _reader(proc, q):
        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    q.put(json.loads(line))
                except ValueError:
                    q.put({"event": "garbage", "line": line[:200]})
        except (OSError, ValueError):
            pass
        q.put(None)

    def _get(self, timeout, starting=False):
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise WorkerError(f"{self.name}: {'start' if starting else 'request'} timed out after {int(timeout)} s")
            try:
                msg = self._q.get(timeout=left)
            except queue.Empty:
                continue
            if msg is None:
                code = None
                try:
                    code = self._proc.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    pass
                hint = f"; see {self.log_path}" if self.log_path else ""
                raise WorkerError(f"{self.name}: worker exited (code {code}){hint}")
            if msg.get("event") == "garbage":
                continue
            return msg

    def _kill(self):
        p = self._proc
        self._proc = None
        if p is not None and p.poll() is None:
            try:
                p.terminate()
                p.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    p.kill()
                except OSError:
                    pass
        if self._log:
            try:
                self._log.close()
            except OSError:
                pass
            self._log = None

    def ensure_started(self):
        """Start the worker if needed. Returns True when this call started it."""
        with self._acquire():
            if self.running:
                return False
            self._start()
            return True

    def stop(self):
        with self._lock:
            if self.running:
                try:
                    self._proc.stdin.write(json.dumps({"id": 0, "op": "shutdown"}) + "\n")
                    self._proc.stdin.flush()
                    self._proc.wait(timeout=3)
                except (OSError, ValueError, subprocess.TimeoutExpired):
                    pass
            self._kill()

    # ---------- requests ----------
    class _Held:
        def __init__(self, lock):
            self.lock = lock

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.lock.release()

    def _acquire(self):
        if not self._lock.acquire(timeout=self.start_timeout + self.call_timeout + 30):
            raise WorkerError(f"{self.name}: busy (another request is still running)")
        return self._Held(self._lock)

    def call(self, op, timeout=None, **params):
        """Send one request; returns the reply dict (+ '_started': bool, '_start_ms')."""
        with self._acquire():
            started, start_ms = False, 0
            if not self.running:
                t0 = time.monotonic()
                self._start()
                started, start_ms = True, int((time.monotonic() - t0) * 1000)
            self._next_id += 1
            rid = self._next_id
            try:
                self._proc.stdin.write(json.dumps({"id": rid, "op": op, **params}, ensure_ascii=False) + "\n")
                self._proc.stdin.flush()
            except (OSError, ValueError) as e:
                self._kill()
                raise WorkerError(f"{self.name}: worker pipe closed ({e})")
            try:
                while True:
                    msg = self._get(timeout or self.call_timeout)
                    if msg.get("id") == rid:
                        break
            except WorkerError:
                self._kill()                 # timed out or died: a fresh process next time
                raise
            if not msg.get("ok"):
                raise WorkerError(msg.get("error") or f"{self.name}: request failed")
            msg["_started"] = started
            msg["_start_ms"] = start_ms
            return msg
