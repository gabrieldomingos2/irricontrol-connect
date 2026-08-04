from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from pydantic import BaseModel

from backend.config import settings
from backend.services import access_log
from .deps import require_auth
from .security import create_access_token

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest, request: Request, background_tasks: BackgroundTasks) -> LoginResponse:
    ip = _client_ip(request)
    user_agent = request.headers.get("user-agent", "")

    if access_log.is_rate_limited(ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas de login. Tente novamente em alguns minutos.",
            headers={"Retry-After": str(access_log.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60)},
        )

    success = payload.username == settings.AUTH_ADMIN_USER and payload.password == settings.AUTH_ADMIN_PASSWORD

    access_log.record_login(ip=ip, user_agent=user_agent, username=payload.username, success=success)
    background_tasks.add_task(access_log.ensure_ip_location, ip)

    if not success:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuário ou senha inválidos.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(
        subject=payload.username,
        secret=settings.AUTH_JWT_SECRET,
        expires_minutes=settings.AUTH_JWT_EXPIRES_MIN,
    )
    return LoginResponse(access_token=token)


@router.get("/access-stats")
async def access_stats(_payload: dict = Depends(require_auth)) -> Dict[str, Any]:
    """Resumo dos acessos registrados (requer token válido)."""
    return access_log.get_stats()
