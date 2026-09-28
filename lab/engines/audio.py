"""Audio helpers for the lab server (stdlib + the ffmpeg binary)."""
import array
import math
import os
import subprocess
import sys
import wave

EXT_BY_MIME = {
    "audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".m4a",
    "video/mp4": ".mp4", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/mpeg": ".mp3",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav", "audio/aiff": ".aiff",
}


class AudioError(Exception):
    pass


def to_wav16k(ffmpeg, src_path, out_path, timeout=60):
    """Any audio/video file -> 16 kHz mono 16-bit PCM WAV (what every Whisper wants)."""
    cmd = [ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", src_path,
           "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-map_metadata", "-1",
           "-fflags", "+bitexact", "-flags:a", "+bitexact", "-f", "wav", out_path]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise AudioError("ffmpeg timeout")
    except OSError as e:
        raise AudioError(f"ffmpeg not runnable: {e}")
    if r.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) <= 44:
        err = r.stderr.decode("utf-8", "replace").replace(src_path, "<input>").replace(out_path, "<output>")
        raise AudioError("ffmpeg could not decode the audio: " + " | ".join(err.strip().splitlines()[-2:]))


def read_pcm16(path):
    with wave.open(path, "rb") as w:
        if w.getsampwidth() != 2:
            raise AudioError("expected 16-bit PCM")
        sr, ch, n = w.getframerate(), w.getnchannels(), w.getnframes()
        raw = w.readframes(n)
    a = array.array("h")
    a.frombytes(raw)
    if sys.byteorder == "big":
        a.byteswap()
    if ch > 1:
        a = array.array("h", a[::ch])
    return a, sr


def write_pcm16(path, samples, sr):
    out = array.array("h", samples)
    if sys.byteorder == "big":
        out.byteswap()
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(out.tobytes())


def duration_ms(path):
    try:
        with wave.open(path, "rb") as w:
            return int(w.getnframes() * 1000 / max(1, w.getframerate()))
    except (wave.Error, OSError, EOFError):
        return None


def _db(x):
    return 20 * math.log10(x / 32768.0) if x > 0 else -120.0


def trim_silence(path, out_path, floor_db=-50.0, rel_db=35.0, pad_ms=250, frame_ms=20):
    """Cut leading/trailing silence (Whisper hallucinates 'תודה רבה' on silence).

    A 20 ms frame counts as sound when its RMS is within `rel_db` of the loudest
    frame and above `floor_db` dBFS. Keeps `pad_ms` around the sound. Writes
    `out_path` only when something was cut. Returns a dict; silent=True means
    the whole clip is below the floor (nothing worth transcribing)."""
    samples, sr = read_pcm16(path)
    n = len(samples)
    total_ms = int(n * 1000 / sr) if sr else 0
    info = {"duration_ms": total_ms, "trimmed": False, "silent": False, "path": path}
    if n == 0:
        info["silent"] = True
        return info
    if n > sr * 30:                       # long uploads: not a single word, leave them alone
        return info
    flen = max(1, int(sr * frame_ms / 1000))
    rms = []
    for i in range(0, n, flen):
        fr = samples[i:i + flen]
        rms.append(math.sqrt(sum(v * v for v in fr) / len(fr)))
    loud = max(rms)
    info["peak_dbfs"] = round(_db(max(abs(min(samples)), abs(max(samples)))), 1)
    if _db(loud) < floor_db:
        info["silent"] = True
        return info
    thr = max(floor_db, _db(loud) - rel_db)
    on = [i for i, r in enumerate(rms) if _db(r) >= thr]
    pad = int(sr * pad_ms / 1000)
    start = max(0, on[0] * flen - pad)
    end = min(n, (on[-1] + 1) * flen + pad)
    if start > sr * 0.1 or n - end > sr * 0.1:
        write_pcm16(out_path, samples[start:end], sr)
        info.update(trimmed=True, path=out_path, start_ms=int(start * 1000 / sr), end_ms=int(end * 1000 / sr))
    return info


def silence_wav(path, ms=500, sr=16000):
    write_pcm16(path, [0] * int(sr * ms / 1000), sr)
