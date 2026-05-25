import json
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    site_id: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    timestamp: Mapped[float] = mapped_column(Float, nullable=False)
    path: Mapped[str | None] = mapped_column(String)
    data: Mapped[str | None] = mapped_column(Text)  # JSON
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    @staticmethod
    def from_dict(d: dict) -> "Event":
        return Event(
            session_id=d["session_id"],
            site_id=d["site_id"],
            type=d["type"],
            timestamp=d["timestamp"],
            path=d.get("path"),
            data=json.dumps(d["data"]) if d.get("data") else None,
        )
