from pathlib import Path
from typing import Any
from io import BytesIO

from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse
import os
import uuid
import imghdr
from datetime import datetime
from sqlmodel import Session, select
try:
    from PIL import Image, ImageOps, UnidentifiedImageError
except ImportError:
    Image = None
    ImageOps = None
    UnidentifiedImageError = OSError

try:
    from pillow_heif import register_heif_opener
    register_heif_opener()
except Exception:
    pass

from api.deps import get_current_user
from core.db import get_session
from models.core import AuditLog, Submission, SubmissionDraft, UploadedFile, User

router = APIRouter()

UPLOAD_DIR = "uploads"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {
    "jpeg": "jpg",
    "png": "png",
    "webp": "webp",
    "gif": "gif",
    "bmp": "bmp",
}
IMAGE_FILE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic", ".heif", ".tif", ".tiff", ".mpo", ".avif"}
if Image is not None:
    Image.MAX_IMAGE_PIXELS = 80_000_000

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _normalize_upload_url(raw_path: str) -> str:
    path = str(raw_path or "").strip()
    if path.startswith("http://") or path.startswith("https://"):
        raise HTTPException(status_code=400, detail="Only local uploaded files can be served.")
    if not path.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="Invalid upload path.")
    if ".." in Path(path).parts:
        raise HTTPException(status_code=400, detail="Invalid upload path.")
    return path


def _upload_url_to_file_path(upload_url: str) -> Path:
    relative = upload_url.removeprefix("/uploads/")
    base_dir = Path(UPLOAD_DIR).resolve()
    file_path = (base_dir / relative).resolve()
    if base_dir not in file_path.parents:
        raise HTTPException(status_code=400, detail="Invalid upload path.")
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    return file_path


def _json_contains_upload_url(value: Any, upload_url: str) -> bool:
    if value == upload_url:
        return True
    if isinstance(value, dict):
        return any(_json_contains_upload_url(item, upload_url) for item in value.values())
    if isinstance(value, list):
        return any(_json_contains_upload_url(item, upload_url) for item in value)
    return False


def _user_can_read_upload(session: Session, current_user: User, upload_url: str) -> bool:
    if current_user.role in ["admin", "reviewer"]:
        return True

    upload = session.exec(
        select(UploadedFile).where(UploadedFile.url == upload_url)
    ).first()
    if upload and upload.user_id == current_user.id:
        return True

    submissions = session.exec(
        select(Submission).where(Submission.student_id == current_user.id)
    ).all()
    for submission in submissions:
        if (
            _json_contains_upload_url(submission.image_paths, upload_url)
            or _json_contains_upload_url(submission.image_slots, upload_url)
            or _json_contains_upload_url(submission.recognition_json, upload_url)
            or _json_contains_upload_url(submission.corrected_json, upload_url)
        ):
            return True

    submission_ids = [submission.id for submission in submissions]
    if submission_ids:
        drafts = session.exec(
            select(SubmissionDraft).where(SubmissionDraft.submission_id.in_(submission_ids))
        ).all()
        for draft in drafts:
            if (
                _json_contains_upload_url(draft.image_paths, upload_url)
                or _json_contains_upload_url(draft.image_slots, upload_url)
                or _json_contains_upload_url(draft.draft_json, upload_url)
            ):
                return True
    return False


def _looks_like_image_upload(file: UploadFile) -> bool:
    content_type = (file.content_type or "").lower()
    if content_type.startswith("image/"):
        return True
    suffix = Path(file.filename or "").suffix.lower()
    return suffix in IMAGE_FILE_EXTENSIONS


def _transcode_image_to_jpeg(payload: bytes) -> bytes:
    if Image is None:
        raise HTTPException(
            status_code=415,
            detail="不支持的图片格式，当前服务未安装图片转码组件。",
        )
    try:
        with Image.open(BytesIO(payload)) as image:
            try:
                image.seek(0)
            except EOFError:
                pass
            image = ImageOps.exif_transpose(image)
            if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
                background = Image.new("RGB", image.size, (255, 255, 255))
                alpha = image.convert("RGBA").getchannel("A")
                background.paste(image.convert("RGB"), mask=alpha)
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")

            output = BytesIO()
            image.save(output, format="JPEG", quality=92, optimize=True)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=415,
            detail="不支持的图片格式，自动转码失败。请上传 jpg、png、webp、gif、bmp，或先转成 jpg/png。",
        ) from exc


def _normalize_image_payload(payload: bytes) -> tuple[bytes, str, str, bool]:
    detected_type = imghdr.what(None, payload)
    if detected_type in ALLOWED_IMAGE_TYPES:
        ext = ALLOWED_IMAGE_TYPES[detected_type]
        content_type = "image/jpeg" if ext == "jpg" else f"image/{ext}"
        return payload, ext, content_type, False

    transcoded_payload = _transcode_image_to_jpeg(payload)
    return transcoded_payload, "jpg", "image/jpeg", True

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Uploads an image for an experiment submission."""
    if not _looks_like_image_upload(file):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="图片不能超过 20MB")

    payload, ext, stored_content_type, transcoded = _normalize_image_payload(payload)
    if len(payload) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="图片转码后仍超过 20MB")
    
    # Create year-month subfolder for organization
    month_dir = datetime.now().strftime("%Y-%m")
    target_dir = os.path.join(UPLOAD_DIR, month_dir)
    os.makedirs(target_dir, exist_ok=True)
    
    # Generate unique filename
    unique_filename = f"{uuid.uuid4().hex}.{ext}"
    
    file_path = os.path.join(target_dir, unique_filename)
    upload_url = f"/uploads/{month_dir}/{unique_filename}"
    
    try:
        with open(file_path, "wb") as buffer:
            buffer.write(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

    session.add(UploadedFile(
        id=uuid.uuid4().hex,
        user_id=current_user.id,
        url=upload_url,
        storage_path=file_path,
        original_filename=file.filename,
        content_type=stored_content_type,
        size_bytes=len(payload),
    ))
    session.add(AuditLog(
        user_id=current_user.id,
        action="file_uploaded",
        status="success",
        target_id=None,
        details=f"上传图片 {file.filename}，大小 {len(payload)} bytes{'，已自动转码为 jpg' if transcoded else ''}。",
    ))
    session.commit()

    return {
        "status": "success",
        "url": upload_url,
        "filename": file.filename,
        "transcoded": transcoded,
    }


@router.get("/view")
def view_uploaded_file(
    path: str = Query(...),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    upload_url = _normalize_upload_url(path)
    if not _user_can_read_upload(session, current_user, upload_url):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    file_path = _upload_url_to_file_path(upload_url)
    return FileResponse(file_path)
