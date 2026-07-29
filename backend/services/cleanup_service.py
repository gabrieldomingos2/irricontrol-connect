# backend/services/cleanup_service.py
# Periodically removes old per-job directories (backend/arquivos/<job_id> and
# backend/static/imagens/<job_id>) so disk usage doesn't grow forever.

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import time
from pathlib import Path

from fastapi.concurrency import run_in_threadpool

from backend.config import settings

logger = logging.getLogger("irricontrol")

# Job directories are named after a UUID4. Anything else under
# ARQUIVOS_DIR_PATH / IMAGENS_DIR_PATH (e.g. "cache", "reports") is
# structural and must never be auto-deleted.
_JOB_DIR_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _newest_mtime(path: Path) -> float:
    """Returns the most recent modification time among a directory's files."""
    newest = path.stat().st_mtime
    for sub in path.rglob("*"):
        try:
            newest = max(newest, sub.stat().st_mtime)
        except OSError:
            continue
    return newest


def _cleanup_job_dirs_sync(base_dir: Path, max_age_seconds: float) -> int:
    if not base_dir.is_dir():
        return 0

    now = time.time()
    removed = 0
    for entry in base_dir.iterdir():
        if not entry.is_dir() or not _JOB_DIR_PATTERN.match(entry.name):
            continue
        try:
            if now - _newest_mtime(entry) > max_age_seconds:
                shutil.rmtree(entry, ignore_errors=True)
                removed += 1
        except OSError as e:
            logger.warning("  -> Failed to inspect/remove job dir %s: %s", entry, e)
    return removed


async def cleanup_old_jobs() -> None:
    """Removes job directories older than settings.JOB_RETENTION_DAYS."""
    max_age_seconds = settings.JOB_RETENTION_DAYS * 24 * 3600
    total_removed = await run_in_threadpool(
        lambda: sum(
            _cleanup_job_dirs_sync(base_dir, max_age_seconds)
            for base_dir in (settings.ARQUIVOS_DIR_PATH, settings.IMAGENS_DIR_PATH)
        )
    )
    if total_removed:
        logger.info(
            "Job cleanup: removed %d job dir(s) older than %d day(s).",
            total_removed,
            settings.JOB_RETENTION_DAYS,
        )


async def run_periodic_cleanup() -> None:
    """Background loop: cleans up old jobs on startup, then on a fixed interval."""
    interval_seconds = settings.JOB_CLEANUP_INTERVAL_HOURS * 3600
    while True:
        try:
            await cleanup_old_jobs()
        except Exception as e:
            logger.error("Job cleanup run failed: %s", e, exc_info=True)
        await asyncio.sleep(interval_seconds)
