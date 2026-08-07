# backend/services/access_log.py
# Registro de acessos (logins) em SQLite: quem entrou, quando, de qual IP
# e de onde (geolocalização aproximada do IP via ip-api.com, com cache).

from __future__ import annotations

import ipaddress
import logging
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from backend.config import settings

logger = logging.getLogger("irricontrol")

_DB_PATH: Path = settings.ARQUIVOS_DIR_PATH / "access_log.db"

# Rate limit de login: acima disso, o IP fica bloqueado ate a janela passar.
LOGIN_MAX_FAILED_ATTEMPTS = 5
LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15

# Serviço gratuito de geolocalização por IP, servido via HTTPS (ip-api.com
# só oferece HTTPS no plano pago — ipwho.is é gratuito, sem chave, e
# criptografado). Não suporta lang=pt-BR como o antigo; país/cidade voltam
# no idioma padrão da API (geralmente inglês) em vez de português.
_GEO_API_URL = "https://ipwho.is/{ip}?fields=success,message,country,region,city,connection.isp"
_GEO_TIMEOUT = 5.0


def _connect() -> sqlite3.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_DB_PATH)
    # WAL permite leitores e escritores concorrentes sem se bloquearem
    # mutuamente, e busy_timeout faz uma escrita concorrente ESPERAR até
    # 5s por um lock livre em vez de falhar na hora com "database is
    # locked" — reduz bem a chance de cair nos except abaixo sob uso
    # simultâneo (mesmo já sendo fail-safe hoje).
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS access_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            ip TEXT NOT NULL,
            user_agent TEXT,
            username TEXT,
            success INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ip_locations (
            ip TEXT PRIMARY KEY,
            location TEXT,
            isp TEXT,
            updated_ts TEXT
        )
        """
    )
    return conn


def _is_private_ip(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_private or ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return True  # valor não-IP (ex.: "unknown") — não tentar geolocalizar


def is_rate_limited(ip: str) -> bool:
    """
    True se esse IP passou do limite de tentativas de login falhas na janela
    de tempo definida em LOGIN_RATE_LIMIT_WINDOW_MINUTES. Falha aberta (False)
    se o SQLite estiver indisponivel - nao pode travar todo mundo por causa
    de um erro de leitura do log.
    """
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=LOGIN_RATE_LIMIT_WINDOW_MINUTES)).isoformat()
        with _connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) c FROM access_log WHERE ip = ? AND success = 0 AND ts > ?",
                (ip, cutoff),
            ).fetchone()
            return row[0] >= LOGIN_MAX_FAILED_ATTEMPTS
    except Exception as e:
        logger.warning("Falha ao checar rate limit de login: %s", e)
        return False


def record_login(ip: str, user_agent: str, username: str, success: bool) -> None:
    """Grava uma tentativa de login. Nunca propaga erro (não pode travar o login)."""
    try:
        ts = datetime.now(timezone.utc).isoformat()
        with _connect() as conn:
            conn.execute(
                "INSERT INTO access_log (ts, ip, user_agent, username, success) VALUES (?, ?, ?, ?, ?)",
                (ts, ip, (user_agent or "")[:300], (username or "")[:100], 1 if success else 0),
            )
    except Exception as e:
        logger.warning("Falha ao registrar acesso no access_log: %s", e)


async def ensure_ip_location(ip: str) -> None:
    """
    Resolve e cacheia a localização aproximada de um IP (cidade/estado/país).
    Fire-and-forget: erros são apenas logados.
    """
    try:
        if _is_private_ip(ip):
            with _connect() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO ip_locations (ip, location, isp, updated_ts) VALUES (?, ?, ?, ?)",
                    (ip, "Rede local", "-", datetime.now(timezone.utc).isoformat()),
                )
            return

        with _connect() as conn:
            row = conn.execute("SELECT 1 FROM ip_locations WHERE ip = ?", (ip,)).fetchone()
        if row:
            return  # já cacheado

        async with httpx.AsyncClient(timeout=_GEO_TIMEOUT) as client:
            resp = await client.get(_GEO_API_URL.format(ip=ip))
            data: Dict[str, Any] = resp.json()

        if not data.get("success"):
            return

        parts = [p for p in (data.get("city"), data.get("region"), data.get("country")) if p]
        location = ", ".join(parts) or "Desconhecido"
        isp = (data.get("connection") or {}).get("isp") or "-"
        with _connect() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO ip_locations (ip, location, isp, updated_ts) VALUES (?, ?, ?, ?)",
                (ip, location, isp, datetime.now(timezone.utc).isoformat()),
            )
    except Exception as e:
        logger.warning("Falha ao geolocalizar IP %s: %s", ip, e)


def get_stats(recent_limit: int = 50) -> Dict[str, Any]:
    """Retorna o resumo de acessos: totais, por dia, por IP e os últimos logins."""
    with _connect() as conn:
        conn.row_factory = sqlite3.Row

        total_ok = conn.execute("SELECT COUNT(*) c FROM access_log WHERE success = 1").fetchone()["c"]
        total_fail = conn.execute("SELECT COUNT(*) c FROM access_log WHERE success = 0").fetchone()["c"]
        unique_ips = conn.execute("SELECT COUNT(DISTINCT ip) c FROM access_log WHERE success = 1").fetchone()["c"]

        per_day = [
            {"dia": r["dia"], "acessos": r["c"]}
            for r in conn.execute(
                """
                SELECT substr(ts, 1, 10) AS dia, COUNT(*) AS c
                FROM access_log WHERE success = 1
                GROUP BY dia ORDER BY dia DESC LIMIT 30
                """
            )
        ]

        por_ip = [
            {
                "ip": r["ip"],
                "acessos": r["c"],
                "ultimo": r["ultimo"],
                "local": r["location"] or "Desconhecido",
                "provedor": r["isp"] or "-",
            }
            for r in conn.execute(
                """
                SELECT a.ip, COUNT(*) AS c, MAX(a.ts) AS ultimo, l.location, l.isp
                FROM access_log a LEFT JOIN ip_locations l ON l.ip = a.ip
                WHERE a.success = 1
                GROUP BY a.ip ORDER BY c DESC LIMIT 20
                """
            )
        ]

        recentes = [
            {
                "ts": r["ts"],
                "ip": r["ip"],
                "local": r["location"] or "Desconhecido",
                "sucesso": bool(r["success"]),
                "user_agent": r["user_agent"] or "-",
            }
            for r in conn.execute(
                """
                SELECT a.ts, a.ip, a.success, a.user_agent, l.location
                FROM access_log a LEFT JOIN ip_locations l ON l.ip = a.ip
                ORDER BY a.id DESC LIMIT ?
                """,
                (recent_limit,),
            )
        ]

    return {
        "total_acessos": total_ok,
        "tentativas_falhas": total_fail,
        "ips_unicos": unique_ips,
        "por_dia": per_day,
        "por_ip": por_ip,
        "recentes": recentes,
    }
