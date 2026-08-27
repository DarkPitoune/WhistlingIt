# Render's native Python runtime has no ffmpeg, so Docker is not optional here.
FROM python:3.12-slim

# ffmpeg for decode/transcode, and nothing else. `git` used to be installed for
# the SHA-pinned pipeline dependency; the pipeline now lives in ./whistle, so
# there is nothing left to clone.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# hatchling builds both packages from source, so both have to be in place before
# pip runs. Runtime footprint is numpy + scipy — no torch, no numba, no weights.
COPY pyproject.toml ./
COPY app ./app
COPY whistle ./whistle
RUN pip install --no-cache-dir .

ENV PYTHONUNBUFFERED=1 PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
