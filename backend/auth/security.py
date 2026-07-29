from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from fastapi import HTTPException, status


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))


def create_access_token(subject: str, secret: str, expires_minutes: int = 60) -> str:
    """
    Token assinado (JWT-like HS256) com expiração.
    payload: { sub, iat, exp }
    """
    now = int(time.time())
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + int(expires_minutes) * 60,
    }
    header = {"alg": "HS256", "typ": "JWT"}

    header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    sig_b64 = _b64url_encode(sig)

    return f"{header_b64}.{payload_b64}.{sig_b64}"


def verify_token(token: str, secret: str) -> dict[str, Any]:
    """
    Valida assinatura e expiração. Retorna payload.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Formato inválido")

        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")

        expected_sig = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
        expected_sig_b64 = _b64url_encode(expected_sig)

        if not hmac.compare_digest(expected_sig_b64, sig_b64):
            raise ValueError("Assinatura inválida")

        payload_raw = _b64url_decode(payload_b64)
        payload = json.loads(payload_raw.decode("utf-8"))

        exp = int(payload.get("exp", 0))
        if exp <= int(time.time()):
            raise ValueError("Token expirado")

        return payload

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Não autorizado (token inválido ou expirado).",
            headers={"WWW-Authenticate": "Bearer"},
        )
