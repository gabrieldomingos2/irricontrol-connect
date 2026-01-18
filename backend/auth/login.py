# backend/auth/router.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from backend.config import settings
from .security import create_access_token


router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


@router.post("/login", response_model=LoginResponse)
async def login(payload: LoginRequest) -> LoginResponse:
    # credenciais do ambiente (teste)
    if payload.username != settings.AUTH_ADMIN_USER or payload.password != settings.AUTH_ADMIN_PASSWORD:
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
