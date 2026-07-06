from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from core.config import settings


class SchoolPasswordError(Exception):
    pass


def _fernet_key() -> bytes:
    raw = settings.SCHOOL_PASSWORD_SECRET_KEY or settings.SECRET_KEY
    if raw.startswith("fernet:"):
        return raw.removeprefix("fernet:").encode("utf-8")
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def encrypt_school_password(password: str) -> str:
    if not password:
        raise SchoolPasswordError("school password is required")
    return Fernet(_fernet_key()).encrypt(password.encode("utf-8")).decode("utf-8")


def decrypt_school_password(encrypted_password: str | None) -> str:
    if not encrypted_password:
        raise SchoolPasswordError("school password is missing")
    try:
        return Fernet(_fernet_key()).decrypt(encrypted_password.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise SchoolPasswordError("school password cannot be decrypted") from exc
