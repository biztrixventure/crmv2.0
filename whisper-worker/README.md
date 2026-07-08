# whisper-worker

On-demand call-transcription worker for the QA department. Isolated Coolify
service; the CRM calls it internally. Loads `faster-whisper` once, transcribes
one recording at a time, never stores audio.

## Coolify setup (Phase 2)

1. **New Resource → Application → same GitHub repo** (`biztrixventure/crmv2.0`).
2. **Build Pack: Dockerfile**, **Base Directory: `/whisper-worker`**.
3. **No public domain** — this is internal only. Note its internal hostname
   (Coolify gives each service a name on the private `coolify` network, e.g.
   `http://<service-name>:8000`).
4. **Environment variables:**
   - `WHISPER_TOKEN` = a long random string (the CRM must send the same one)
   - `WHISPER_MODEL` = `small` (default; `base` = faster/less accurate, `medium` = slower/more accurate)
   - `WHISPER_CPU_THREADS` = `2` (never set above `cores - 2`)
   - `WHISPER_COMPUTE` = `int8`
5. Deploy. First build downloads the model (~1–2 min). Check `GET /health` → `{ ok, ready: true }`.

## Then wire the CRM (Phase 4)

On the **CRM** service set:
- `WHISPER_WORKER_URL` = `http://<service-name>:8000`
- `WHISPER_TOKEN` = the same token as above

## Env reference

| var | default | meaning |
|-----|---------|---------|
| `WHISPER_MODEL` | `small` | model size (tiny/base/small/medium) |
| `WHISPER_COMPUTE` | `int8` | CPU compute type |
| `WHISPER_CPU_THREADS` | `2` | decode threads (keep the CRM breathing) |
| `WHISPER_TOKEN` | — | shared bearer secret (required in prod) |
| `WHISPER_MAX_MB` | `80` | reject uploads larger than this |
| `PORT` | `8000` | injected by Coolify |
