from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class TrackerSession(Base):
    __tablename__ = "tracker_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    site_id: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    user_agent: Mapped[str | None] = mapped_column(String)
    viewport_w: Mapped[int | None] = mapped_column(Integer)
    viewport_h: Mapped[int | None] = mapped_column(Integer)
    referrer: Mapped[str | None] = mapped_column(String)
    device_type: Mapped[str | None] = mapped_column(String)
