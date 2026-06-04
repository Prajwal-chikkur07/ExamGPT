from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    database_url: str = ""
    upload_dir: str = "./data/uploads"

    chunk_size: int = 1000
    chunk_overlap: int = 150

    # Retrieval pipeline — tuned for low latency. Bump these up if you trade speed for recall.
    retrieve_top_k: int = 12      # candidates from each retriever (vector / BM25)
    rerank_top_k: int = 8         # final chunks sent to the LLM (broader coverage for multi-topic asks)
    rrf_k: int = 60               # constant for Reciprocal Rank Fusion
    history_window: int = 10      # conversation messages fed to the LLM

    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_dirs(self) -> None:
        Path(self.upload_dir).mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s
