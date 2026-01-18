from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings
from backend.routers import kmz, simulation, report
from backend.logging_config import setup_logging
from backend.middlewares import RequestContextMiddleware


# ---------------------------------------------------------------------------
# Funções auxiliares de bootstrap (LÓGICA DE AÇÃO)
# ---------------------------------------------------------------------------
def _init_directories(logger: logging.Logger) -> None:
    """Garante que os diretórios necessários para a aplicação existam."""
    try:
        # A lógica que estava em 'settings.initialize_directories' agora vive aqui.
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
    # Ações na inicialização (antes de aceitar requisições)
    setup_logging()
    logger = logging.getLogger("irricontrol")
    _init_directories(logger)
    _log_startup_info(logger)
    
    yield # A aplicação executa aqui

    # Ações na finalização
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
# Middlewares (configurados no escopo do módulo, como esperado pelo FastAPI)
# ---------------------------------------------------------------------------
app.add_middleware(RequestContextMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(kmz.router,        prefix=settings.API_V1_STR, tags=["KMZ Operations"])
app.include_router(simulation.router, prefix=settings.API_V1_STR, tags=["Simulation"])
app.include_router(report.router,     prefix=settings.API_V1_STR, tags=["Report Operations"])

# ---------------------------------------------------------------------------
# Logger global
# ---------------------------------------------------------------------------
logger = logging.getLogger("irricontrol")

# ---------------------------------------------------------------------------
# Endpoints básicos
# ---------------------------------------------------------------------------
@app.get("/", tags=["Root"])
async def read_root() -> dict[str, str]:
    """Endpoint raiz: retorna mensagem de boas-vindas."""
    logger.info("event=endpoint_access endpoint=/")
    return {"message": f"Bem-vindo à {settings.APP_NAME}!"}


@app.get(f"{settings.API_V1_STR}/health", tags=["Health"])
@app.api_route(
    f"{settings.API_V1_STR}/health",
    methods=["GET", "HEAD"],
    tags=["Health"]
)
async def health():
    return {"status": "ok"}


@app.get(f"{settings.API_V1_STR}/version", tags=["Health"])
async def version_info() -> dict[str, str]:
    """Retorna nome e versão da aplicação (útil para automations)."""
    return {"name": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get(f"{settings.API_V1_STR}/templates", tags=["Simulation"])
async def list_templates() -> dict[str, list[str] | str]:
    """Lista IDs de templates disponíveis (sem expor segredos)."""
    ids = settings.listar_templates_ids()
    logger.info("event=endpoint_access endpoint=/templates templates=%s", ids)
    return {"templates": ids, "disabled": settings.TEMPLATES_DESABILITADOS, "default": settings.DEFAULT_TEMPLATE_ID.value}
