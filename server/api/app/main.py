"""whistling-api — the booth's only endpoint, plus a health check.

The game never talks to this service. Players go Pages -> Supabase RPC, so this
container can be asleep, cold or broken all day and the daily still works. That
is the single most important property of the design: do not let a later refactor
route player traffic through here.
"""

import logging
import tempfile
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import ingest
from .config import CATEGORIES, MAX_UPLOAD_BYTES, Settings

log = logging.getLogger("whistling-api")

settings = Settings.from_env()

app = FastAPI(title="whistling-api", version="0.1.0", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins) or ["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def malformed_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    """A missing or malformed field is a 400, not FastAPI's default 422.

    422 has one meaning in this API — the quality gate rejected the whistle, with
    machine-readable `reasons` the booth renders as plain language. Letting
    validation errors share the status would make the client guess which kind of
    422 it received."""
    fields = ", ".join(
        ".".join(str(p) for p in e["loc"][1:]) or "body" for e in exc.errors()
    )
    return JSONResponse(
        {"error": "bad_request", "detail": f"missing or invalid: {fields}"},
        status_code=400,
    )


@app.middleware("http")
async def cap_body_size(request: Request, call_next):
    """Reject an oversized upload on its Content-Length, before the body is
    parsed. Browsers always send it for multipart; the chunked copy in the
    handler is the backstop for a client that lies or omits it."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        return JSONResponse(
            {"error": "too_large", "max_bytes": MAX_UPLOAD_BYTES},
            status_code=413,
        )
    return await call_next(request)


@app.get("/healthz")
def healthz() -> dict:
    """Render's health check, and what the booth hits to warm the instance
    before the user starts recording."""
    return {"ok": True, "categories": list(CATEGORIES)}


def _spool(upload: UploadFile, dest: Path) -> int:
    """Copy to disk with a hard byte cap. Returns the size written."""
    written = 0
    with dest.open("wb") as out:
        while chunk := upload.file.read(1 << 20):
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                raise ValueError("too_large")
            out.write(chunk)
    return written


@app.post("/uploads", status_code=201)
async def create_upload(
    audio: Annotated[UploadFile, File()],
    title: Annotated[str, Form()],
    # Repeat the field to send several: accepted_answers=a&accepted_answers=b.
    accepted_answers: Annotated[list[str], Form()] = [],
    category: Annotated[str | None, Form()] = None,
    from_label: Annotated[str | None, Form()] = None,
    # Optional: an unsigned whistle is credited to nobody rather than refused.
    signature: Annotated[str | None, Form()] = None,
    # Which booth, and so which of the two games the song joins. Optional only
    # for the booth bundle that predates the split — see ingest.lang_of.
    lang: Annotated[str | None, Form()] = None,
):
    with tempfile.TemporaryDirectory() as tmp:
        original = Path(tmp) / "upload.bin"
        try:
            size = _spool(audio, original)
        except ValueError:
            return JSONResponse(
                {"error": "too_large", "max_bytes": MAX_UPLOAD_BYTES},
                status_code=413,
            )
        finally:
            await audio.close()

        if size == 0:
            return JSONResponse({"error": "empty_upload"}, status_code=400)

        sub = ingest.Submission(
            title=title,
            accepted_answers=accepted_answers,
            category=category,
            from_label=from_label,
            signature=signature,
            lang=lang,
        )

        try:
            return ingest.ingest(original, sub)

        except ingest.BadRequest as exc:
            return JSONResponse(
                {"error": "bad_request", "detail": str(exc)}, status_code=400
            )

        except ingest.BadAudio as exc:
            # ffmpeg's stderr goes to the log, not over the wire: it carries
            # server temp paths and means nothing to a whistler.
            log.warning("undecodable upload: %s", exc)
            return JSONResponse(
                {"error": "bad_audio", "detail": "could not decode the recording"},
                status_code=400,
            )

        except ingest.Rejected as exc:
            # A soft reject the booth explains in plain language. Logged with the
            # metrics because these are the calibration dataset for the still-
            # placeholder q_* thresholds.
            log.info("gate rejected: %s %s", exc.reasons, exc.metrics)
            return JSONResponse(
                {"error": "rejected", "reasons": exc.reasons, "metrics": exc.metrics},
                status_code=422,
            )
