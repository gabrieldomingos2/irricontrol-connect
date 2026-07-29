# backend/main.py
# FastAPI application factory: configures middleware, static files, and routers.

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from backend.auth.deps import require_auth
from backend.auth.router import router as auth_router
from backend.config import settings
from backend.logging_config import setup_logging
from backend.middlewares import RequestContextMiddleware
from backend.routers import kmz, report, simulation, tiles
from backend.services.cleanup_service import run_periodic_cleanup


# ---------------------------------------------------------------------------
# Bootstrap helpers
# ---------------------------------------------------------------------------
def _init_directories(logger: logging.Logger) -> None:
    """Creates required application directories if they do not already exist."""
    try:
        logger.info("Ensuring directory: %s", settings.IMAGENS_DIR_PATH)
        settings.IMAGENS_DIR_PATH.mkdir(parents=True, exist_ok=True)

        logger.info("Ensuring directory: %s", settings.ARQUIVOS_DIR_PATH)
        settings.ARQUIVOS_DIR_PATH.mkdir(parents=True, exist_ok=True)

        logger.info("Ensuring directory: %s", settings.SIMULATIONS_CACHE_PATH)
        settings.SIMULATIONS_CACHE_PATH.mkdir(parents=True, exist_ok=True)

        logger.info("Ensuring directory: %s", settings.ELEVATION_CACHE_PATH)
        settings.ELEVATION_CACHE_PATH.mkdir(parents=True, exist_ok=True)

    except Exception as e:
        logger.exception("Failed to initialise directories: %s", e)


def _log_startup_info(logger: logging.Logger) -> None:
    """Logs initial application info without leaking secrets."""
    logger.info("Startup - ALLOWED_ORIGINS: %s", settings.ALLOWED_ORIGINS)
    logger.info("Startup - LOG_LEVEL: %s", settings.LOG_LEVEL)
    logger.info(
        "Starting application: name=%s version=%s api_base=%s",
        settings.APP_NAME,
        settings.APP_VERSION,
        settings.API_V1_STR,
    )


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger = logging.getLogger("irricontrol")
    _init_directories(logger)
    _log_startup_info(logger)

    cleanup_task = asyncio.create_task(run_periodic_cleanup())

    yield

    cleanup_task.cancel()
    logger.info("Application shutting down (lifespan shutdown).")


# ---------------------------------------------------------------------------
# Static files with long-lived caching
# ---------------------------------------------------------------------------
class CachedStaticFiles(StaticFiles):
    """Serves static files with an aggressive Cache-Control header.

    Images under /static are generated per job_id and never mutated in
    place after creation, so it's safe to let browsers cache them
    indefinitely instead of re-validating on every navigation.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# ---------------------------------------------------------------------------
# FastAPI instance
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.APP_NAME,
    description="API for KMZ processing and signal coverage simulation.",
    version=settings.APP_VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ---------------------------------------------------------------------------
# Static files
# ---------------------------------------------------------------------------
app.mount(
    "/static",
    CachedStaticFiles(directory=settings.STATIC_DIR_PATH),
    name="static",
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

# Auth (open route)
app.include_router(auth_router, prefix=settings.API_V1_STR, tags=["Auth"])

# Protected routes
app.include_router(
    kmz.router,
    prefix=settings.API_V1_STR,
    tags=["KMZ Operations"],
    dependencies=[Depends(require_auth)],
)
app.include_router(
    simulation.router,
    prefix=settings.API_V1_STR,
    tags=["Simulation & Analysis"],
    dependencies=[Depends(require_auth)],
)
app.include_router(
    report.router,
    prefix=settings.API_V1_STR,
    tags=["Report Operations"],
    dependencies=[Depends(require_auth)],
)

# Open route: tile <img> requests from the browser cannot carry the auth
# header, and the proxied content is just public satellite imagery.
app.include_router(tiles.router, prefix=settings.API_V1_STR, tags=["Tile Proxy"])

# ---------------------------------------------------------------------------
# Global logger
# ---------------------------------------------------------------------------
logger = logging.getLogger("irricontrol")

# ---------------------------------------------------------------------------
# Open endpoints
# ---------------------------------------------------------------------------
@app.get("/", tags=["Root"])
async def read_root() -> dict[str, str]:
    logger.info("event=endpoint_access endpoint=/")
    return {"message": f"Welcome to {settings.APP_NAME}!"}


@app.api_route(
    f"{settings.API_V1_STR}/health",
    methods=["GET", "HEAD"],
    tags=["Health"],
)
async def health() -> dict[str, str]:
    logger.info("event=endpoint_access endpoint=/health status=ok")
    return {"status": "ok"}


@app.get(f"{settings.API_V1_STR}/version", tags=["Health"])
async def version_info() -> dict[str, str]:
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION}
