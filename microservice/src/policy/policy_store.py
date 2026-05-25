"""
Persistence layer for computed behavioral policies.

The `policies` table is created automatically on first use.
All functions accept an asyncpg connection (or compatible async DB connection).
"""
from __future__ import annotations

import json
from typing import Any

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS policies (
    id          SERIAL PRIMARY KEY,
    site_id     TEXT NOT NULL,
    path        TEXT NOT NULL,
    policy_data JSONB NOT NULL,
    n_sessions  INT,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(site_id, path)
);
"""


async def _ensure_table(db_conn: Any) -> None:
    await db_conn.execute(_CREATE_TABLE)


async def save_policy(
    site_id: str,
    path: str,
    policy_data: dict,
    db_conn: Any,
) -> None:
    """Upsert a per-page policy record."""
    await _ensure_table(db_conn)
    n_sessions = policy_data.get("n_sessions")
    await db_conn.execute(
        """
        INSERT INTO policies (site_id, path, policy_data, n_sessions)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (site_id, path)
        DO UPDATE SET
            policy_data = EXCLUDED.policy_data,
            n_sessions  = EXCLUDED.n_sessions,
            computed_at = NOW()
        """,
        site_id,
        path,
        json.dumps(policy_data),
        n_sessions,
    )


async def load_policy(
    site_id: str,
    path: str,
    db_conn: Any,
) -> dict | None:
    """Load a single page policy. Returns None if not found."""
    await _ensure_table(db_conn)
    row = await db_conn.fetchrow(
        "SELECT policy_data FROM policies WHERE site_id = $1 AND path = $2",
        site_id,
        path,
    )
    if row is None:
        return None
    data = row["policy_data"]
    return data if isinstance(data, dict) else json.loads(data)


async def load_all_policies(site_id: str, db_conn: Any) -> dict:
    """Load all page policies for a site, keyed by path."""
    await _ensure_table(db_conn)
    rows = await db_conn.fetch(
        "SELECT path, policy_data FROM policies WHERE site_id = $1",
        site_id,
    )
    result: dict[str, dict] = {}
    for row in rows:
        data = row["policy_data"]
        result[row["path"]] = data if isinstance(data, dict) else json.loads(data)
    return result


async def invalidate_policy(site_id: str, db_conn: Any) -> None:
    """Delete all cached policies for a site (call when new sessions arrive)."""
    await _ensure_table(db_conn)
    await db_conn.execute("DELETE FROM policies WHERE site_id = $1", site_id)
