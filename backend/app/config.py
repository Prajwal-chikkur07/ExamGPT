from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # Embedding (384-dim). bge-small is one of the strongest 384-dim models per MTEB.
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    # Cross-encoder reranker — small + fast (~90 MB).
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    database_url: str = ""
    upload_dir: str = "./data/uploads"

    chunk_size: int = 1000
    chunk_overlap: int = 150

    # Retrieval pipeline — tuned for low latency. Bump these up if you trade speed for recall.
    retrieve_top_k: int = 12      # candidates from each retriever (vector / BM25)
    rerank_top_k: int = 4         # final chunks sent to the LLM
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
