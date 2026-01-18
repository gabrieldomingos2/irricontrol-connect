from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.auth.deps import require_auth
from backend.auth.router import router as auth_router
from backend.config import settings
from backend.logging_config import setup_logging
from backend.middlewares import RequestContextMiddleware
from backend.routers import kmz, report, simulation


# ---------------------------------------------------------------------------
# Funções auxiliares de bootstrap (LÓGICA DE AÇÃO)
# ---------------------------------------------------------------------------
def _init_directories(logger: logging.Logger) -> None:
    """Garante que os diretórios necessários para a aplicação existam."""
    try:
        logger.info("Verificando/Criando diretório de imagens em: %s", settings.IMAGENS_DIR_PATH)
        settings.IMAGENS_DIR_PATH.mkdir(parents=True, exist_ok=True)

        logger.info("Verificando/Criando diretório de arquivos em: %s", settings.ARQUIVOS_DIR_PATH)
        settings.ARQUIVOS_DIR_PATH.mkdir(parents=True, exist_ok=True)

        logger.info("Verificando/Criando diretório de cache de simulações em: %s", settings.SIMULATIONS_CACHE_PATH)
        settings.SIMULATIONS_CACHE_PATH.mkdir(parents=True, exist_ok=True)

        logger.info("Verificando/Criando diretório de cache de elevação em: %s", settings.ELEVATION_CACHE_PATH)
        settings.ELEVATION_CACHE_PATH.mkdir(parents=True, exist_ok=True)

    except Exception as e:
        logger.exception("Falha ao inicializar diretórios: %s", e)


def _log_startup_info(logger: logging.Logger) -> None:
    """Loga informações iniciais da aplicação sem vazar segredos."""
    logger.info("Startup - ALLOWED_ORIGINS: %s", settings.ALLOWED_ORIGINS)
    logger.info("Startup - LOG_LEVEL: %s", settings.LOG_LEVEL)
    logger.info(
        "Aplicação iniciando... name=%s version=%s api_base=%s",
        settings.APP_NAME,
        settings.APP_VERSION,
        settings.API_V1_STR,
    )


# ---------------------------------------------------------------------------
# Lifespan: Ações a serem executadas durante a inicialização e finalização
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    logger = logging.getLogger("irricontrol")
    _init_directories(logger)
    _log_startup_info(logger)

    yield

    logger.info("Aplicação finalizando (lifespan shutdown).")


# ---------------------------------------------------------------------------
# Instância FastAPI
# ---------------------------------------------------------------------------
app = FastAPI(
    title=settings.APP_NAME,
    description="API para processar KMZ e simular cobertura de sinal.",
    version=settings.APP_VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Middlewares
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(RequestContextMiddleware)

# ---------------------------------------------------------------------------
# Arquivos estáticos
# ---------------------------------------------------------------------------
app.mount(
    "/static",
    StaticFiles(directory=settings.STATIC_DIR_PATH),
    name="static",
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

# Auth (rota aberta)
app.include_router(auth_router, prefix=settings.API_V1_STR, tags=["Auth"])

# Rotas protegidas
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

# ---------------------------------------------------------------------------
# Logger global
# ---------------------------------------------------------------------------
logger = logging.getLogger("irricontrol")

# ---------------------------------------------------------------------------
# Endpoints básicos (abertos)
# ---------------------------------------------------------------------------
@app.get("/", tags=["Root"])
async def read_root() -> dict[str, str]:
    logger.info("event=endpoint_access endpoint=/")
    return {"message": f"Bem-vindo à {settings.APP_NAME}!"}


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
