from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import settings
from .security import verify_token

bearer_scheme = HTTPBearer(auto_error=False)


def require_auth(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Não autorizado (token ausente).",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = verify_token(creds.credentials, secret=settings.AUTH_JWT_SECRET)

    # Isso integra com seu RequestContextMiddleware (log user) via request.state.user
    request.state.user = payload.get("sub", "-")

    return payload
