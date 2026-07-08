# Whisper transcription worker (faster-whisper, CPU/int8).
# Built as its own Coolify service — isolated from the CRM, resource-capped.
FROM python:3.11-slim

WORKDIR /app

# faster-whisper decodes audio via bundled PyAV/ffmpeg — no system ffmpeg needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Pre-download the model into the image so the FIRST request is instant and the
# container never fetches from HuggingFace at runtime. Change model via build arg.
ARG WHISPER_MODEL=small
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')"

# Coolify injects PORT; default 8000 for local runs.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
