from datetime import datetime

from sqlalchemy import DateTime, Integer, LargeBinary, String, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class Screenshot(Base):
    __tablename__ = "screenshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    site_id: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    path: Mapped[str | None] = mapped_column(String)
    trigger: Mapped[str] = mapped_column(String(32), nullable=False)
    action_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    file_path: Mapped[str | None] = mapped_column(String)
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
