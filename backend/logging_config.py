# backend/logging_config.py
# Structured logging setup with per-request context (job_id, user) via ContextVar.

from __future__ import annotations

import logging
import logging.config
from logging import Filter
from contextvars import ContextVar
from typing import Optional, Any
from uuid import uuid4
from pathlib import Path
from contextlib import contextmanager


# ---------------------------------------------------------------------------
# Settings integration (optional — safe fallback if not available)
# ---------------------------------------------------------------------------
try:
    from backend.config import settings  # type: ignore

    LOG_LEVEL_STR: str = getattr(settings, "LOG_LEVEL", "INFO")
    LOG_LEVEL_INT: int = getattr(settings, "LOG_LEVEL_INT", logging.INFO)
    LOG_TO_FILE: bool = bool(getattr(settings, "LOG_TO_FILE", True))
    LOG_FILE: str | Path = getattr(settings, "LOG_FILE", "logs/irricontrol_app.log")
    LOG_DIR: str | Path = getattr(settings, "LOG_DIR", "")
    LOG_MAX_BYTES: int = int(getattr(settings, "LOG_MAX_BYTES", 10 * 1024 * 1024))  # 10 MB
    LOG_BACKUP_COUNT: int = int(getattr(settings, "LOG_BACKUP_COUNT", 5))
    LOG_CAPTURE_THIRD_PARTY: bool = bool(getattr(settings, "LOG_CAPTURE_THIRD_PARTY", True))
except (ImportError, AttributeError):
    # Stable fallbacks used when settings are absent or incomplete.
    LOG_LEVEL_STR = "INFO"
    LOG_LEVEL_INT = logging.INFO
    LOG_TO_FILE = True
    LOG_FILE = "logs/irricontrol_app.log"
    LOG_DIR = ""
    LOG_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
    LOG_BACKUP_COUNT = 5
    LOG_CAPTURE_THIRD_PARTY = True


# ---------------------------------------------------------------------------
# Per-request context (ContextVar) + helpers
# ---------------------------------------------------------------------------
job_id_ctx: ContextVar[str] = ContextVar("job_id", default="global")
user_ctx: ContextVar[str] = ContextVar("user", default="-")


def set_job_id(job_id: Optional[str] = None) -> str:
    """Sets the job_id in the current context and returns the value used."""
    jid = job_id or str(uuid4())
    job_id_ctx.set(jid)
    return jid


def clear_job_id() -> None:
    """Resets the job_id in the current context (best practice at task teardown)."""
    job_id_ctx.set("global")


def set_user(user: Optional[str] = None) -> None:
    user_ctx.set(user or "-")


def clear_user() -> None:
    user_ctx.set("-")


@contextmanager
def job_context(job_id: Optional[str] = None, user: Optional[str] = None):
    """Context manager that runs a block with temporary job_id / user values."""
    old_jid = job_id_ctx.get()
    old_user = user_ctx.get()
    try:
        set_job_id(job_id)
        if user is not None:
            set_user(user)
        yield
    finally:
        job_id_ctx.set(old_jid)
        user_ctx.set(old_user)


class ContextFilter(Filter):
    """Injects job_id and user into every log record without breaking third-party loggers."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        record.__dict__.setdefault("job_id", job_id_ctx.get())
        record.__dict__.setdefault("user", user_ctx.get())
        return True


# ---------------------------------------------------------------------------
# Path utilities
# ---------------------------------------------------------------------------
def _ensure_parent_dir(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        # Do not crash the application; just log to stderr.
        logging.getLogger("irricontrol").warning(
            "Could not create log directory %s: %s", path.parent, exc
        )


def _resolve_log_file() -> Path:
    """
    Resolves the final log file path taking LOG_DIR and LOG_FILE into account.
    Always returns an absolute path.
    """
    log_file_path = Path(LOG_FILE)
    if str(LOG_DIR).strip():
        base = Path(LOG_DIR)
        if log_file_path.suffix:
            log_file_path = base / log_file_path.name
        else:
            log_file_path = base / "irricontrol_app.log"
    elif log_file_path.is_dir():
        log_file_path = log_file_path / "irricontrol_app.log"
    return log_file_path.resolve()


# ---------------------------------------------------------------------------
# Config builder
# ---------------------------------------------------------------------------
def build_logging_config(
    json_available: bool,
    uvicorn_formatter_available: bool,
    level_int: int | None = None,
) -> dict[str, Any]:
    """Builds the dictConfig-compatible logging configuration dictionary."""
    use_level = int(level_int if level_int is not None else LOG_LEVEL_INT)

    if uvicorn_formatter_available:
        default_fmt: dict[str, Any] = {
            "()": "uvicorn.logging.DefaultFormatter",
            "fmt": "%(levelprefix)s %(asctime)s [%(name)s] [job_id=%(job_id)s user=%(user)s] :: %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        }
    else:
        default_fmt = {
            "format": "%(levelname)s %(asctime)s [%(name)s] [job_id=%(job_id)s user=%(user)s] :: %(message)s",
            "datefmt": "%Y-%m-%d %H:%M:%S",
        }

    if json_available:
        json_fmt: dict[str, Any] = {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": (
                "%(asctime)s %(levelname)s %(name)s %(message)s "
                "%(pathname)s %(lineno)d %(module)s %(funcName)s %(process)d %(threadName)s "
                "%(job_id)s %(user)s"
            ),
        }
    else:
        json_fmt = default_fmt

    handlers: dict[str, Any] = {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "default",
            "filters": ["ctx"],
            "stream": "ext://sys.stderr",
        }
    }

    logger_handlers = ["console"]

    if LOG_TO_FILE:
        log_path = _resolve_log_file()
        _ensure_parent_dir(log_path)
        handlers["rotating_file"] = {
            "class": "logging.handlers.RotatingFileHandler",
            "filename": str(log_path),
            "maxBytes": int(LOG_MAX_BYTES),
            "backupCount": int(LOG_BACKUP_COUNT),
            "encoding": "utf8",
            "formatter": "json" if json_available else "default",
            "filters": ["ctx"],
            "delay": True,
        }
        logger_handlers.append("rotating_file")

    config: dict[str, Any] = {
        "version": 1,
        "disable_existing_loggers": False,
        "filters": {
            "ctx": {"()": ContextFilter},
        },
        "formatters": {
            "default": default_fmt,
            "json": json_fmt,
        },
        "handlers": handlers,
        "loggers": {
            "irricontrol": {
                "handlers": logger_handlers,
                "level": use_level,
                "propagate": False,
            },
            "uvicorn.error": {
                "handlers": logger_handlers,
                "level": use_level,
                "propagate": False,
            },
            "uvicorn.access": {
                "handlers": ["console"],
                "level": logging.WARNING,
                "propagate": False,
            },
        },
    }

    if LOG_CAPTURE_THIRD_PARTY:
        config["root"] = {
            "handlers": logger_handlers,
            "level": max(use_level, logging.WARNING),
        }

    return config


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def setup_logging() -> None:
    """Applies logging configuration with automatic fallbacks for JSON and Uvicorn formatter."""
    try:
        import pythonjsonlogger  # noqa: F401
        json_available = True
    except ImportError:
        json_available = False

    try:
        from uvicorn.logging import DefaultFormatter  # noqa: F401
        uvicorn_formatter_available = True
    except ImportError:
        uvicorn_formatter_available = False

    config = build_logging_config(
        json_available=json_available,
        uvicorn_formatter_available=uvicorn_formatter_available,
        level_int=LOG_LEVEL_INT,
    )
    logging.config.dictConfig(config)

    logger = logging.getLogger("irricontrol")
    with job_context(job_id="setup"):
        logger.info(
            "event=logging_setup status=ok level=%s file=%s json=%s",
            LOG_LEVEL_STR,
            _resolve_log_file() if LOG_TO_FILE else "-",
            json_available,
        )
