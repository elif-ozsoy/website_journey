from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class Site(Base):
    __tablename__ = "sites"
    __table_args__ = (
        UniqueConstraint("target_url", "label", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    slug: Mapped[str] = mapped_column(String(8), unique=True, nullable=False, index=True)
    target_url: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    # nullable so existing sites created without auth are still valid
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Last non-empty human policy computed for this site, stored as JSON.
    # Used as fallback when the current version has no human tracking events.
    policy_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
