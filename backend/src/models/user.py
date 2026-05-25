import base64
import hashlib
import hmac
import os
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(254), unique=True, nullable=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def set_password(self, password: str) -> None:
        salt = os.urandom(16)
        key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
        self.password_hash = base64.b64encode(salt + key).decode()

    def verify_password(self, password: str) -> bool:
        try:
            data = base64.b64decode(self.password_hash.encode())
            salt, stored_key = data[:16], data[16:]
            new_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100_000)
            return hmac.compare_digest(stored_key, new_key)
        except Exception:
            return False
