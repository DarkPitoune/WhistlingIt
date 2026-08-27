"""Storage + table writes with the service key.

The service key bypasses RLS, which is the whole reason the tables can have zero
policies. It exists only in this process's environment — never in the client.
"""

from functools import lru_cache
from pathlib import Path

from supabase import Client, create_client

from .config import BUCKET, Settings


@lru_cache(maxsize=1)
def _settings() -> Settings:
    return Settings.from_env()


@lru_cache(maxsize=1)
def client() -> Client:
    s = _settings()
    return create_client(s.supabase_url, s.supabase_service_key)


def upload_audio(local: Path, dest_path: str) -> None:
    """Upload the transcoded m4a. Raises if the path is already taken — dest
    paths are uuid-derived, so a collision means something is wrong."""
    client().storage.from_(BUCKET).upload(
        path=dest_path,
        file=local.read_bytes(),
        file_options={"content-type": "audio/mp4", "upsert": "false"},
    )


def remove_audio(dest_path: str) -> None:
    """Best-effort cleanup when the row insert fails after the upload landed."""
    try:
        client().storage.from_(BUCKET).remove([dest_path])
    except Exception:
        pass


def insert_song(row: dict) -> dict:
    result = client().table("songs").insert(row).execute()
    if not result.data:
        raise RuntimeError("insert into songs returned no row")
    return result.data[0]
