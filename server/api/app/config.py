"""Settings, all from the environment. No file, no defaults for the secrets."""

import os
from dataclasses import dataclass, field

# Uploads above this are rejected before the body is read.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024      # 10 MiB, mirrors the bucket's limit

# The pipeline's own q_max_duration_s. Checked here too so a long file is
# rejected after the cheap transcode instead of after the expensive analysis.
MAX_DURATION_S = 40.0

BUCKET = "songs"

# Validated at the API, not by a check constraint: adding a category should be a
# code change, not a migration. Mirrors the chips in the booth design.
CATEGORIES = ("Film", "TV Series", "Video Games", "Jingle", "Music")


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is not set")
    return value


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    allowed_origins: tuple[str, ...] = field(default=())

    @classmethod
    def from_env(cls) -> "Settings":
        origins = os.environ.get("ALLOWED_ORIGINS", "")
        return cls(
            supabase_url=_required("SUPABASE_URL").rstrip("/"),
            # Service key, never the anon key, and never anywhere but here.
            supabase_service_key=_required("SUPABASE_SERVICE_KEY"),
            allowed_origins=tuple(
                o.strip() for o in origins.split(",") if o.strip()
            ),
        )
