from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base


class Journey(Base):
    """One agent run for a specific task on a specific site, keyed by (site_id, task_title, user_id).

    On re-run the row is replaced (upsert in the service layer), so each
    user always has at most one journey per task per project.
    """

    __tablename__ = "journeys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    site_id: Mapped[str] = mapped_column(
        String(16), ForeignKey("sites.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # task_id may be NULL when the caller only provides a free-form task title
    task_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # user_id NULL = anonymous run
    user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    task_title: Mapped[str] = mapped_column(Text, nullable=False)
    total_steps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    steps: Mapped[str] = mapped_column(Text, nullable=False)  # JSON array
    policy_trace: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array
    llm_analysis: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)  # JSON string
    source: Mapped[str] = mapped_column(String(32), nullable=False, default='agent')  # 'agent' | 'policy_bot'
    is_agent: Mapped[bool | None] = mapped_column(nullable=True, default=None)
    embedding: Mapped[str | None] = mapped_column(Text, nullable=True, default=None)  # JSON float array
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
