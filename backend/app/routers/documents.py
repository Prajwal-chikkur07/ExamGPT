from fastapi import APIRouter, File, HTTPException, UploadFile

from app.core import store
from app.models.schemas import DocumentMeta, UploadResponse
from app.services.document_service import DocumentError, ingest_file, remove_document

router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload(files: list[UploadFile] = File(...)):
    docs: list[DocumentMeta] = []
    total_chunks = 0
    errors: list[str] = []
    for f in files:
        try:
            content = await f.read()
            doc = ingest_file(f.filename or "upload", content)
            docs.append(DocumentMeta(**{k: doc[k] for k in DocumentMeta.model_fields.keys()}))
            total_chunks += doc["chunks"]
        except DocumentError as exc:
            errors.append(f"{f.filename}: {exc}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{f.filename}: {exc}")
    if not docs and errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    return UploadResponse(documents=docs, indexed_chunks=total_chunks)


@router.get("", response_model=list[DocumentMeta])
def list_documents():
    docs = store.list_documents()
    return [DocumentMeta(**{k: d[k] for k in DocumentMeta.model_fields.keys()}) for d in docs]


@router.delete("/{document_id}")
def delete_document(document_id: str):
    ok = remove_document(document_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"ok": True}
