"""JSON-lines worker loop shared by every lab worker (stdlib only, Python 3.9+).

A worker is a long-lived subprocess that loads one heavy model once and then
answers requests on stdin/stdout, one JSON object per line:

    request : {"id": 7, "op": "synth", ...params}
    reply   : {"id": 7, "ok": true, ...result}   or   {"id": 7, "ok": false, "error": "..."}
    events  : {"event": "ready", "load_ms": 1234, ...}   (once, after setup)
              {"event": "fatal", "error": "..."}         (setup failed; the worker exits)

Only this module writes to the real stdout. Everything else a library prints
(Python or C level) is redirected to stderr, which the server sends to a log
file, so a chatty library can never corrupt the protocol.
"""
import json
import os
import sys
import time
import traceback

_proto = None


def _open_protocol_channel():
    global _proto
    fd = os.dup(1)                      # keep the real stdout for the protocol
    os.dup2(2, 1)                       # fd 1 -> stderr (C libraries, print())
    sys.stdout = sys.stderr
    _proto = os.fdopen(fd, "w", encoding="utf-8", buffering=1)


def send(obj):
    _proto.write(json.dumps(obj, ensure_ascii=False) + "\n")
    _proto.flush()


def log(*parts):
    print(time.strftime("%H:%M:%S"), *parts, file=sys.stderr, flush=True)


def serve(name, setup, handlers, redact=None):
    """setup() -> state (loads the model). handlers: {op: fn(state, request) -> dict}.

    redact(str) -> str scrubs secrets from any error text before it leaves the worker.
    """
    _open_protocol_channel()
    scrub = redact or (lambda s: s)
    t0 = time.monotonic()
    try:
        state = setup()
    except BaseException as e:  # noqa: BLE001 - report every setup failure
        msg = scrub(f"{type(e).__name__}: {e}")
        log(name, "setup failed:", msg)
        log(scrub(traceback.format_exc()))
        send({"event": "fatal", "error": msg})
        sys.exit(1)
    load_ms = int((time.monotonic() - t0) * 1000)
    info = state.get("info", {}) if isinstance(state, dict) else {}
    log(name, f"ready in {load_ms} ms")
    send({"event": "ready", "load_ms": load_ms, **info})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        rid = None
        try:
            req = json.loads(line)
            rid = req.get("id")
            op = req.get("op")
            if op == "ping":
                send({"id": rid, "ok": True, "pong": True})
                continue
            if op == "shutdown":
                send({"id": rid, "ok": True})
                break
            fn = handlers.get(op)
            if fn is None:
                raise ValueError(f"unknown op {op!r}")
            t = time.monotonic()
            result = fn(state, req) or {}
            result.setdefault("worker_ms", int((time.monotonic() - t) * 1000))
            send({"id": rid, "ok": True, **result})
        except Exception as e:  # noqa: BLE001 - one bad request must not kill the worker
            msg = scrub(f"{type(e).__name__}: {e}")
            log(name, "request failed:", msg)
            log(scrub(traceback.format_exc()))
            send({"id": rid, "ok": False, "error": msg})
    log(name, "bye")
