import json
import re
import uuid
from pathlib import Path


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


def safe_filename(name: str) -> str:
    name = re.sub(r"[^\w.\- ]+", "_", name).strip()
    return name or "file"


def extract_json_block(text: str) -> dict | list | None:
    """Extract first JSON object/array from a string. Tolerant to ```json fences and prose."""
    if not text:
        return None
    fence = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", text, re.DOTALL)
    candidate = fence.group(1) if fence else None
    if candidate is None:
        match = re.search(r"(\{.*\}|\[.*\])", text, re.DOTALL)
        candidate = match.group(1) if match else None
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        # Try a forgiving cleanup of trailing commas
        cleaned = re.sub(r",\s*([}\]])", r"\1", candidate)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            return None


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
