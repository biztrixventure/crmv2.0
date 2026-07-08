"""
Whisper transcription worker — a small, isolated service that transcribes ONE
call recording at a time using faster-whisper (CPU, int8). Runs as its own
Coolify service next to the CRM; the CRM calls it internally over the private
network. It never stores audio — bytes come in, text goes out.

Endpoints
  GET  /health              → { ok, model, ready }
  POST /transcribe          → multipart file "audio"  → { text, language, duration, segments }
                              (Authorization: Bearer <WHISPER_TOKEN>)

Design notes
  * Model is loaded ONCE at startup and kept warm in memory.
  * A single global lock serializes transcriptions so we never spin up parallel
    decodes that would fight the CRM for CPU. cpu_threads is capped low too.
  * Everything is tunable via env (model size, threads, token).
"""
import os
import tempfile
import threading
import logging

from fastapi import FastAPI, UploadFile, File, Header, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s [whisper] %(message)s")
log = logging.getLogger("whisper")

MODEL_SIZE   = os.getenv("WHISPER_MODEL", "small")          # tiny|base|small|medium
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE", "int8")         # int8 = fast + low RAM on CPU
CPU_THREADS  = int(os.getenv("WHISPER_CPU_THREADS", "2"))   # keep <= cores-2 so the CRM breathes
DEVICE       = os.getenv("WHISPER_DEVICE", "cpu")
TOKEN        = os.getenv("WHISPER_TOKEN", "")               # shared secret; CRM sends it
MAX_MB       = int(os.getenv("WHISPER_MAX_MB", "80"))       # reject absurdly large uploads

app = FastAPI(title="whisper-worker")

# One decode at a time — serialize so concurrent requests queue instead of
# saturating every core. faster-whisper itself is not safe for parallel decodes.
_lock = threading.Lock()
_model = None


@app.on_event("startup")
def _load():
    global _model
    log.info(f"loading model={MODEL_SIZE} device={DEVICE} compute={COMPUTE_TYPE} threads={CPU_THREADS}")
    _model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE, cpu_threads=CPU_THREADS)
    log.info("model ready")


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_SIZE, "ready": _model is not None}


def _check_auth(authorization: str | None):
    # Only enforce when a token is configured (it always is in prod).
    if TOKEN:
        expected = f"Bearer {TOKEN}"
        if authorization != expected:
            raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)
    if _model is None:
        raise HTTPException(status_code=503, detail="model not ready")

    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(data) > MAX_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"audio over {MAX_MB} MB")

    # Persist to a temp file (faster-whisper reads a path/stream) then delete.
    suffix = os.path.splitext(audio.filename or "")[1] or ".wav"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()

        with _lock:  # serialize decodes
            segments, info = _model.transcribe(tmp.name, vad_filter=True)
            seg_list = [
                {"start": round(s.start, 2), "end": round(s.end, 2), "text": s.text.strip()}
                for s in segments
            ]
        text = " ".join(s["text"] for s in seg_list).strip()
        return JSONResponse({
            "text": text,
            "language": info.language,
            "duration": round(info.duration, 2),
            "segments": seg_list,
        })
    except Exception as e:  # noqa
        log.exception("transcribe failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
