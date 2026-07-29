# backend/services/i18n_service.py
# Translation service: loads JSON locale files and provides per-language translators.

import json
import logging
from pathlib import Path
from typing import Dict, Callable, Any, Optional, List, Mapping, Tuple
import threading
import time

from backend.config import settings

logger = logging.getLogger("irricontrol")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _normalize_lang(code: str) -> str:
    """Normalises a basic BCP-47 language code (e.g. pt-BR → pt-br)."""
    return (code or "").strip().replace("_", "-").lower()


def _lang_variants(code: str) -> List[str]:
    """
    Generates the fallback variant chain for a language code.
        'pt-br' -> ['pt-br', 'pt']
        'en'    -> ['en']
    """
    code = _normalize_lang(code)
    if not code:
        return []
    parts = code.split("-")
    variants = ["-".join(parts[:i]) for i in range(len(parts), 0, -1)]
    return variants


class _SafeDict(dict):
    """A dict subclass that does not raise KeyError on missing keys; returns '{key}' instead."""

    def __missing__(self, key):
        return "{" + key + "}"


def _deep_get(d: Mapping[str, Any], keys: List[str]) -> Optional[Any]:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, Mapping):
            return None
        cur = cur.get(k)
        if cur is None:
            return None
    return cur


# ---------------------------------------------------------------------------
# Translation service
# ---------------------------------------------------------------------------

class TranslationService:
    def __init__(self, locales_dir: Path, default_lang: str = "pt-br", fallback_to_en: bool = True):
        self.locales_dir = locales_dir
        self.default_lang = _normalize_lang(
            getattr(settings, "DEFAULT_LANG", default_lang)
        )
        self.fallback_to_en = fallback_to_en

        self.translations: Dict[str, Dict[str, Any]] = {}
        self._files_mtime: Dict[str, float] = {}
        self._lock = threading.RLock()
        # Simple (lang, key) → resolved text cache.
        self._cache: Dict[Tuple[str, str], str] = {}

        self._load_all_translations()

    # ---------------------------------------------------------------------------
    # Loading / reloading
    # ---------------------------------------------------------------------------

    def _load_file(self, file_path: Path) -> Optional[Dict[str, Any]]:
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                raise ValueError("Translation file is not a root JSON object.")
            return data
        except (json.JSONDecodeError, OSError, ValueError) as e:
            logger.error("Failed to load translation file %s: %s", file_path, e)
            return None

    def _load_all_translations(self) -> None:
        """Loads / reloads all .json files from the locales directory."""
        with self._lock:
            if not self.locales_dir.is_dir():
                logger.error("Locales directory not found: %s", self.locales_dir)
                return

            # Invalidate the cache on every full reload.
            self._cache.clear()

            count = 0
            for file_path in sorted(self.locales_dir.glob("*.json")):
                lang_code = _normalize_lang(file_path.stem)
                data = self._load_file(file_path)
                if data is None:
                    continue
                self.translations[lang_code] = data
                try:
                    self._files_mtime[str(file_path)] = file_path.stat().st_mtime
                except OSError:
                    pass
                count += 1
                logger.info("Translation loaded: '%s' (%s)", lang_code, file_path.name)

            if count == 0:
                logger.warning("No translations found in %s", self.locales_dir)

    def reload_if_changed(self) -> None:
        """Reloads only changed files (useful in development)."""
        with self._lock:
            changed = False
            for file_path in sorted(self.locales_dir.glob("*.json")):
                key = str(file_path)
                try:
                    mtime = file_path.stat().st_mtime
                except OSError:
                    continue

                prev = self._files_mtime.get(key)
                if prev is None or mtime > prev:
                    data = self._load_file(file_path)
                    if data is not None:
                        lang_code = _normalize_lang(file_path.stem)
                        self.translations[lang_code] = data
                        self._files_mtime[key] = mtime
                        changed = True
                        logger.info("Translation reloaded: '%s' (%s)", lang_code, file_path.name)

            if changed:
                # Any change invalidates the whole cache (simple and safe).
                self._cache.clear()

    # ---------------------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------------------

    def set_default_lang(self, code: str) -> None:
        with self._lock:
            self.default_lang = _normalize_lang(code)
            # Default changed — cache may become inconsistent.
            self._cache.clear()

    def available_languages(self) -> List[str]:
        with self._lock:
            return sorted(self.translations.keys())

    def _resolve_fallback_chain(self, lang: str) -> List[str]:
        """
        Builds the fallback chain:
            [lang_variants..., default_lang, 'en' if available and allowed]
        No duplicates; only loaded languages are included.
        """
        with self._lock:
            chain: List[str] = []
            for candidate in _lang_variants(lang):
                if candidate in self.translations and candidate not in chain:
                    chain.append(candidate)

            if self.default_lang and self.default_lang not in chain and self.default_lang in self.translations:
                chain.append(self.default_lang)

            if self.fallback_to_en and "en" in self.translations and "en" not in chain:
                chain.append("en")

            return chain

    def _get_any(self, lang: str, key: str) -> Optional[Any]:
        """
        Looks up a value (any type) following the fallback chain.
        Returns None if not found anywhere.
        """
        keys = key.split(".")
        for candidate in self._resolve_fallback_chain(lang):
            val = _deep_get(self.translations.get(candidate, {}), keys)
            if val is not None:
                if candidate != _normalize_lang(lang):
                    logger.debug(
                        "Key '%s' not found in '%s'; using fallback '%s'.",
                        key, lang, candidate,
                    )
                return val
        return None

    def _get_text(self, lang: str, key: str) -> Optional[str]:
        cache_key = (_normalize_lang(lang), key)
        with self._lock:
            if cache_key in self._cache:
                return self._cache[cache_key]

        val = self._get_any(lang, key)
        if val is None:
            return None

        if isinstance(val, str):
            text = val
        else:
            # Non-string value — return compact JSON (useful for lists/objects).
            try:
                text = json.dumps(val, ensure_ascii=False, separators=(",", ":"))
            except Exception:
                text = str(val)

        with self._lock:
            self._cache[cache_key] = text
        return text

    def get_translator(self, lang_code: str) -> Callable[[str], str]:
        """
        Returns a translator function `t(key, default=None, **kwargs)` that:
        - resolves the key following the fallback chain,
        - formats with kwargs (missing placeholders remain as {name}),
        - returns `default` if provided; otherwise falls back to the key itself.
        """
        lang_code = _normalize_lang(lang_code)

        def translator(key: str, default: Optional[str] = None, **kwargs: Any) -> str:
            text = self._get_text(lang_code, key)
            if text is None:
                if default is not None:
                    text = default
                else:
                    logger.error(
                        "Translation key '%s' not found (lang='%s', chain=%s).",
                        key, lang_code, self._resolve_fallback_chain(lang_code),
                    )
                    text = key  # Last resort: return the key itself.

            if kwargs:
                try:
                    return text.format_map(_SafeDict(kwargs))
                except Exception as e:
                    logger.error(
                        "Error formatting key '%s' (lang='%s'): %s | text='%s' | kwargs=%s",
                        key, lang_code, e, text, kwargs,
                    )
                    return text
            return text

        return translator


# ---------------------------------------------------------------------------
# Singleton instance
# ---------------------------------------------------------------------------

# Default path: backend/services/../locales
_locales_root = Path(__file__).resolve().parent.parent / "locales"

# Allow override via settings (optional).
_locales_dir = Path(getattr(settings, "LOCALES_DIR", _locales_root))

i18n_service = TranslationService(
    locales_dir=_locales_dir,
    default_lang=getattr(settings, "DEFAULT_LANG", "pt-br"),
    fallback_to_en=True,
)
