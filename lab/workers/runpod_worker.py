"""ivrit.ai Whisper on the RunPod serverless endpoint (the one lecture-transcriber uses).

Runs in /Users/ilaish/.venvs/lecture-transcriber (it already has ivrit + requests).
RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID are read at startup from the lecture-transcriber
.env and stay in this process: they are never printed, logged, returned or written
anywhere, and every error text is scrubbed of them. The endpoint's settings are
never touched: this only submits transcription jobs.

Modes:
  ivrit   : ivrit.load_model(engine="runpod", ...).transcribe(path=...)   (default; /run + /status + /stream)
  runsync : one POST to /runsync with the same payload (about 0.2-0.3 s faster when warm)

Both report RunPod's own delayTime (queue + worker boot) and executionTime when available,
which separates a cold start from compute.

Args: --env PATH --model ID [--language he] [--mode ivrit|runsync] [--timeout 300]
"""
import argparse
import base64
import logging
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from protocol import serve  # noqa: E402

SECRETS = []


def redact(text):
    for s in SECRETS:
        if s:
            text = text.replace(s, "***")
    return text


def load_env(path):
    vals = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


class BillingCapture(logging.Handler):
    """ivrit logs 'RunPod[job] billing: queue=..ms execution=..ms' at DEBUG; keep only the numbers."""
    RX = re.compile(r"billing: queue=(\d+)ms execution=(\d+)ms")

    def __init__(self):
        super().__init__(logging.DEBUG)
        self.last = None

    def emit(self, record):
        try:
            m = self.RX.search(record.getMessage())
        except Exception:  # noqa: BLE001
            return
        if m:
            self.last = (int(m.group(1)), int(m.group(2)))


def setup():
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--language", default="he")
    ap.add_argument("--mode", default="ivrit", choices=["ivrit", "runsync"])
    ap.add_argument("--timeout", type=float, default=300.0)
    args = ap.parse_args()

    env = load_env(args.env)
    api_key = env.get("RUNPOD_API_KEY", "")
    endpoint = env.get("RUNPOD_ENDPOINT_ID", "")
    SECRETS.extend([api_key, endpoint])
    if not api_key or not endpoint:
        raise RuntimeError("RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID missing in the .env file")

    import requests
    # ivrit issues every requests call without timeout= (a dropped connection would hang forever,
    # see lecture-transcriber/transcribe.py). Inject a default, as transcribe.py does.
    connect_t, read_t = 30, max(60, int(args.timeout))
    orig = requests.Session.request

    def request_with_timeout(self, method, url, **kw):
        if kw.get("timeout") is None:
            kw["timeout"] = (connect_t, read_t)
        return orig(self, method, url, **kw)

    requests.Session.request = request_with_timeout

    import ivrit
    billing = BillingCapture()
    ivlog = logging.getLogger("ivrit.audio")
    ivlog.setLevel(logging.DEBUG)
    ivlog.propagate = False                  # nothing from ivrit reaches a log file
    ivlog.handlers = [billing]
    for name in ("urllib3", "requests"):
        logging.getLogger(name).setLevel(logging.WARNING)

    model = ivrit.load_model(engine="runpod", model=args.model, api_key=api_key, endpoint_id=endpoint)
    return {"model": model, "requests": requests, "billing": billing, "api_key": api_key,
            "endpoint": endpoint, "args": args,
            "info": {"mode": args.mode, "model": args.model, "ivrit": getattr(ivrit, "__version__", "?")}}


def _segments_text(obj, acc):
    if isinstance(obj, dict):
        if obj.get("type") == "segments":
            for s in obj.get("data") or []:
                acc.append(s.get("text", "") if isinstance(s, dict) else "")
            return
        for v in obj.values():
            if isinstance(v, (dict, list)):
                _segments_text(v, acc)
    elif isinstance(obj, list):
        for v in obj:
            _segments_text(v, acc)


def run_ivrit(state, path, language):
    state["billing"].last = None
    r = state["model"].transcribe(path=path, language=language, diarize=False,
                                  output_options={"word_timestamps": False, "extra_data": False},
                                  stream=False)
    text = (r.get("text", "") if isinstance(r, dict) else "") or ""
    if not text and isinstance(r, dict):
        text = "".join(s.get("text", "") for s in r.get("segments", []) if isinstance(s, dict))
    out = {"text": text.strip()}
    if state["billing"].last:
        out["delay_ms"], out["exec_ms"] = state["billing"].last
    return out


def run_runsync(state, path, language):
    rq, a = state["requests"], state["args"]
    base = f"https://api.runpod.ai/v2/{state['endpoint']}"
    hdr = {"Authorization": f"Bearer {state['api_key']}", "Content-Type": "application/json"}
    with open(path, "rb") as f:
        blob = base64.b64encode(f.read()).decode()
    payload = {"input": {"type": "blob", "model": a.model, "engine": "faster-whisper", "streaming": False,
                         "transcribe_args": {"language": language, "diarize": False, "diarization_args": None,
                                             "output_options": {"word_timestamps": False, "extra_data": False},
                                             "verbose": False, "blob": blob}}}
    t0 = time.monotonic()
    d = rq.post(f"{base}/runsync", headers=hdr, json=payload, timeout=(30, a.timeout)).json()
    # /runsync returns early (IN_QUEUE / IN_PROGRESS) if the job is not done in time: poll it
    while d.get("status") in ("IN_QUEUE", "IN_PROGRESS") and time.monotonic() - t0 < a.timeout:
        time.sleep(0.5)
        d = rq.get(f"{base}/status/{d['id']}", headers=hdr, timeout=(30, 60)).json()
    if d.get("status") != "COMPLETED":
        if d.get("id") and d.get("status") in ("IN_QUEUE", "IN_PROGRESS"):
            try:
                rq.post(f"{base}/cancel/{d['id']}", headers=hdr, timeout=(10, 20))
            except Exception:  # noqa: BLE001
                pass
        raise RuntimeError(f"RunPod job {d.get('status')}: {str(d.get('error') or '')[:300]}")
    acc = []
    _segments_text(d.get("output"), acc)
    out = {"text": "".join(acc).strip()}
    if d.get("delayTime") is not None:
        out["delay_ms"] = int(d["delayTime"])
    if d.get("executionTime") is not None:
        out["exec_ms"] = int(d["executionTime"])
    return out


def op_transcribe(state, req):
    language = req.get("language") or state["args"].language
    mode = req.get("mode") or state["args"].mode
    t0 = time.monotonic()
    out = (run_runsync if mode == "runsync" else run_ivrit)(state, req["path"], language)
    out["wall_ms"] = int((time.monotonic() - t0) * 1000)
    out["mode"] = mode
    out["alternatives"] = [out["text"]] if out["text"] else []
    return out


if __name__ == "__main__":
    serve("runpod", setup, {"transcribe": op_transcribe}, redact=redact)
