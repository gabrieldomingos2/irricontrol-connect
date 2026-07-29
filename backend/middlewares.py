from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from starlette.types import Scope, Receive, Send

from backend.logging_config import set_job_id, clear_job_id, set_user, clear_user

logger = logging.getLogger("irricontrol")


class RequestContextMiddleware:
    """
    Middleware ASGI:
    - Extrai/gera X-Request-ID por request.
    - Injeta em contextvars (job_id, user) para logs correlacionados.
    - Adiciona X-Request-ID na resposta.
    - (Opcional) seta 'user' se scope['state'].user foi populado por autenticação.
    - Funciona apenas para requests HTTP (ignora websockets e lifespan).
    """

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            # Não é HTTP (ex.: websocket/lifespan) → segue reto
            await self.app(scope, receive, send)
            return

        # Extrai headers da conexão
        try:
            headers = {
                k.decode("latin-1").lower(): v.decode("latin-1")
                for k, v in scope.get("headers", [])
            }
        except Exception:
            headers = {}

        req_id: str = headers.get("x-request-id") or str(uuid4())
        set_job_id(req_id)

        # Extrai user se existir (depende de autenticação própria do app)
        user_identifier = getattr(scope.get("state"), "user", None)
        if user_identifier:
            set_user(str(user_identifier))

        method: str = scope.get("method", "-")
        path: str = scope.get("path", "-")
        status_code: int | None = None

        logger.info("-> %s %s (req_id=%s user=%s)", method, path, req_id, user_identifier or "-")

        async def send_wrapper(message: dict[str, Any]):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", None)
                # Garante X-Request-ID na resposta (sem sobrescrever)
                hdrs = list(message.get("headers") or [])
                hdrs.append((b"x-request-id", req_id.encode("latin-1")))
                message["headers"] = hdrs
            return await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
            logger.info(
                "%s %s -> %s (req_id=%s user=%s)",
                method,
                path,
                status_code if status_code is not None else "-",
                req_id,
                user_identifier or "-",
            )
        except Exception as exc:
            logger.exception(
                "Unhandled exception on %s %s: %s (req_id=%s user=%s)",
                method,
                path,
                exc,
                req_id,
                user_identifier or "-",
            )
            raise
        finally:
            # Garante que contexto não vaza para outros requests
            clear_user()
            clear_job_id()