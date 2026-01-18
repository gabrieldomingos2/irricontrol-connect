# settings.py

import logging
from pathlib import Path
from typing import Optional

from pydantic import Field, HttpUrl, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from .models import TemplateSettings
from .templates import TemplateID, default_templates, I18N_KEYWORDS

logger = logging.getLogger("irricontrol")


class AppSettings(BaseSettings):
    """Configurações principais da aplicação."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Configurações Gerais ---
    APP_NAME: str = "Irricontrol Signal Simulator API"
    APP_VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    DEFAULT_TEMPLATE_ID: TemplateID = TemplateID.BRAZIL_V6_100DBM
    ENVIRONMENT: str = "development"

    # --- Auth (ambiente de teste) ---
    # ✅ Login fixo (teste)
    AUTH_ADMIN_USER: str = "admin"
    AUTH_ADMIN_PASSWORD: str = "123"

    # ✅ Segredo do token (troque em produção via .env)
    AUTH_JWT_SECRET: str = "dev-secret-change-me"

    # ✅ Expiração (minutos)
    AUTH_JWT_EXPIRES_MIN: int = 720  # 12h

    # --- CORS ---
    ALLOWED_ORIGINS_CSV: str = Field(
        default=(
            "http://localhost,"
            "http://localhost:8080,"
            "http://127.0.0.1,"
            "http://127.0.0.1:8080,"
            "null,"
            "http://localhost:5173,"
        )
    )
    NETLIFY_APP_URL: Optional[str] = "https://irricontrolconnect.netlify.app"
    BACKEND_PUBLIC_URL: Optional[HttpUrl] = None

    @property
    def ALLOWED_ORIGINS(self) -> list[str]:
        origins = [o.strip() for o in self.ALLOWED_ORIGINS_CSV.split(",") if o.strip()]

        if self.ENVIRONMENT == "production":
            prod_origins: list[str] = []
            if self.NETLIFY_APP_URL:
                prod_origins.append(self.NETLIFY_APP_URL.strip().rstrip("/"))
            if self.BACKEND_PUBLIC_URL:
                prod_origins.append(str(self.BACKEND_PUBLIC_URL).strip().rstrip("/"))

            # GUARANTEE: garante o frontend Netlify conhecido sempre permitido
            if "https://irricontrolconnect.netlify.app" not in prod_origins:
                prod_origins.append("https://irricontrolconnect.netlify.app")

            if not prod_origins:
                raise ValueError(
                    "CONFIGURAÇÃO DE SEGURANÇA CRÍTICA AUSENTE: "
                    "Em modo 'production', NETLIFY_APP_URL ou BACKEND_PUBLIC_URL devem ser definidos."
                )
            return sorted(list(set(prod_origins)))

        # development / staging
        dev_origins = list(origins)
        if self.NETLIFY_APP_URL:
            dev_origins.append(self.NETLIFY_APP_URL.strip().rstrip("/"))

        # garante em dev também
        if "https://irricontrolconnect.netlify.app" not in dev_origins:
            dev_origins.append("https://irricontrolconnect.netlify.app")

        if self.BACKEND_PUBLIC_URL:
            dev_origins.append(str(self.BACKEND_PUBLIC_URL).strip().rstrip("/"))

        normalized_dev_origins = {o.lower().rstrip("/") for o in dev_origins if o}
        return sorted(list(normalized_dev_origins))

    # --- Diretórios ---
    BACKEND_DIR: Path = Path(__file__).resolve().parent.parent
    PROJECT_ROOT_DIR: Path = BACKEND_DIR.parent
    STATIC_DIR_NAME: str = "static"
    IMAGENS_DIR_NAME: str = "imagens"
    ARQUIVOS_DIR_NAME: str = "arquivos"
    CACHE_DIR_NAME: str = "cache"
    SIMULATIONS_CACHE_DIR_NAME: str = "simulations"
    ELEVATION_CACHE_DIR_NAME: str = "elevation"

    @property
    def STATIC_DIR_PATH(self) -> Path:
        return self.BACKEND_DIR / self.STATIC_DIR_NAME

    @property
    def IMAGENS_DIR_PATH(self) -> Path:
        return self.STATIC_DIR_PATH / self.IMAGENS_DIR_NAME

    @property
    def ARQUIVOS_DIR_PATH(self) -> Path:
        return self.BACKEND_DIR / self.ARQUIVOS_DIR_NAME

    @property
    def SIMULATIONS_CACHE_PATH(self) -> Path:
        return (
            self.ARQUIVOS_DIR_PATH
            / self.CACHE_DIR_NAME
            / self.SIMULATIONS_CACHE_DIR_NAME
        )

    @property
    def ELEVATION_CACHE_PATH(self) -> Path:
        return (
            self.ARQUIVOS_DIR_PATH
            / self.CACHE_DIR_NAME
            / self.ELEVATION_CACHE_DIR_NAME
        )

    @property
    def ENTITY_KEYWORDS(self) -> dict[str, list[str]]:
        consolidated: dict[str, list[str]] = {}
        for entity, lang_map in I18N_KEYWORDS.items():
            all_keywords = [
                w.strip()
                for words in lang_map.values()
                for w in words
                if w.strip()
            ]
            consolidated[entity] = sorted(set(all_keywords))
        return consolidated

    # --- CloudRF ---
    CLOUDRF_API_KEY: Optional[str] = None
    CLOUDRF_API_URL: HttpUrl = Field(default="https://api.cloudrf.com/area")
    HTTP_TIMEOUT: float = 60.0
    LOG_LEVEL: str = "INFO"

    @property
    def LOG_LEVEL_INT(self) -> int:
        return getattr(logging, str(self.LOG_LEVEL).upper(), logging.INFO)

    # --- Parâmetros de Simulação ---
    SIM_ALPHA_THRESHOLD: int = Field(
        default=50,
        description="Opacidade mínima do pixel para considerar área coberta (0-255)",
    )
    SIM_ELEVATION_STEPS: int = Field(
        default=50,
        description="Número de segmentos no cálculo do perfil de elevação",
    )
    SIM_MAX_LOS_TASKS: int = Field(
        default=64,
        description="Limite de análises de visada (LOS) simultâneas para proteger APIs externas",
    )

    # --- Templates ---
    TEMPLATES_DISPONIVEIS: list[TemplateSettings] = Field(default_factory=default_templates)
    TEMPLATES_DESABILITADOS: list[str] = Field(
        default_factory=lambda: [TemplateID.BRAZIL_V6_90DBM.value],
        description="Templates listados mas temporariamente bloqueados",
    )

    # --- Métodos ---
    def obter_template(self, template_id: str | TemplateID) -> TemplateSettings:
        """Busca um template por ID, retornando o default se não encontrado."""
        id_value = template_id.value if isinstance(template_id, TemplateID) else str(template_id)
        template_obj = next((t for t in self.TEMPLATES_DISPONIVEIS if t.id == id_value), None)

        if not template_obj:
            logger.warning(
                "Template '%s' não encontrado. Usando padrão '%s'.",
                id_value,
                self.DEFAULT_TEMPLATE_ID.value,
            )
            default_t = next(
                (t for t in self.TEMPLATES_DISPONIVEIS if t.id == self.DEFAULT_TEMPLATE_ID.value),
                None,
            )
            if default_t:
                return default_t
            raise KeyError(
                f"Template '{id_value}' não encontrado e default '{self.DEFAULT_TEMPLATE_ID.value}' ausente."
            )

        return template_obj

    def listar_templates_ids(self) -> list[str]:
        """Retorna uma lista com os IDs (strings) de todos os templates disponíveis."""
        return [t.id for t in self.TEMPLATES_DISPONIVEIS]

    def listar_templates_permitidos(self) -> list[str]:
        """Lista de templates habilitados para uso (exclui os bloqueados)."""
        bloqueados = set(self.TEMPLATES_DESABILITADOS)
        return [t.id for t in self.TEMPLATES_DISPONIVEIS if t.id not in bloqueados]

    def listar_templates_com_status(self) -> list[dict[str, str | bool]]:
        """Lista templates indicando se estão desativados."""
        bloqueados = set(self.TEMPLATES_DESABILITADOS)
        return [{"id": t.id, "disabled": t.id in bloqueados} for t in self.TEMPLATES_DISPONIVEIS]

    def template_desabilitado(self, template_id: str | TemplateID) -> bool:
        tid = template_id.value if isinstance(template_id, TemplateID) else str(template_id)
        return tid in set(self.TEMPLATES_DESABILITADOS)

    @model_validator(mode="after")
    def _validate_templates(self):
        ids = [t.id for t in self.TEMPLATES_DISPONIVEIS]
        if len(ids) != len(set(ids)):
            dupes = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"IDs de template duplicados: {dupes}")

        if self.DEFAULT_TEMPLATE_ID.value not in ids:
            raise ValueError(
                f"DEFAULT_TEMPLATE_ID '{self.DEFAULT_TEMPLATE_ID.value}' não está em TEMPLATES_DISPONIVEIS"
            )

        invalid_disabled = sorted({i for i in self.TEMPLATES_DESABILITADOS if i not in ids})
        if invalid_disabled:
            raise ValueError(f"TEMPLATES_DESABILITADOS com IDs desconhecidos: {invalid_disabled}")

        return self


# Instância global
settings = AppSettings()
