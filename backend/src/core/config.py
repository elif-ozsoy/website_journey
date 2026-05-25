import os


class Settings:
    ux_tracker_url: str = os.getenv("UX_TRACKER_URL", "http://localhost:3000")
    cors_origins: str = os.getenv(
        "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    )
    
    database_url: str = (
      os.getenv("DATABASE_URL") or ""
    )

    if not database_url:
        raise ValueError("DATABASE_URL environment variable is required")

    proxy_base_url: str = os.getenv("PROXY_BASE_URL", "http://localhost:8080")
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    nvidia_api_key: str = os.getenv("NVIDIA_API_KEY", "")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
