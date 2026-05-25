import models.event  # noqa: F401
import models.journey  # noqa: F401
import models.rating  # noqa: F401
import models.screenshot  # noqa: F401
import models.session  # noqa: F401
import models.site  # noqa: F401
import models.site_analysis  # noqa: F401
import models.task  # noqa: F401
import models.user  # noqa: F401
import models.user_token  # noqa: F401
from sqlalchemy import inspect, text
from db.base import Base
from db.session import engine


def init_db() -> None:
    Base.metadata.create_all(engine)

    inspector = inspect(engine)
    journey_columns = {column["name"] for column in inspector.get_columns("journeys")}
    if "policy_trace" not in journey_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journeys ADD COLUMN policy_trace TEXT"))
    if "llm_analysis" not in journey_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journeys ADD COLUMN llm_analysis TEXT"))
    if "source" not in journey_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journeys ADD COLUMN source VARCHAR(32) NOT NULL DEFAULT 'agent'"))
    if "is_agent" not in journey_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journeys ADD COLUMN is_agent BOOLEAN"))
    if "embedding" not in journey_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journeys ADD COLUMN embedding TEXT"))

    if "solution_eval" not in journey_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE journeys ADD COLUMN solution_eval TEXT"))

    screenshot_columns = {column["name"] for column in inspector.get_columns("screenshots")}
    if "action_id" not in screenshot_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE screenshots ADD COLUMN action_id VARCHAR(64)"))

    task_columns = {col["name"] for col in inspector.get_columns("tasks")}
    if "focus_areas" not in task_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN focus_areas TEXT"))
    if "expected_solution" not in task_columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN expected_solution TEXT"))
