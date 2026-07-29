# backend/routers/validators.py
# Validações compartilhadas entre routers (entrada controlada pelo cliente).

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

# Jobs são sempre UUIDs gerados pelo servidor (uuid.uuid4()).
_JOB_ID_REGEX = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def ensure_valid_job_id(job_id: str) -> str:
    """
    Garante que o job_id tem formato de UUID antes de usá-lo em caminhos
    de disco. Bloqueia path traversal (ex.: job_id contendo '..').
    """
    if not job_id or not _JOB_ID_REGEX.match(job_id):
        raise HTTPException(status_code=400, detail="job_id inválido.")
    return job_id


def safe_filename(name: Optional[str]) -> Optional[str]:
    """
    Reduz um caminho/URL vindo do cliente a apenas o nome do arquivo.
    Remove querystring e qualquer componente de diretório (anti path traversal).
    """
    if not name:
        return None
    return Path(str(name).split("?", 1)[0]).name or None
