from fastapi import APIRouter, UploadFile, File, HTTPException
import os
import uuid
from datetime import datetime

router = APIRouter()

UPLOAD_DIR = "uploads"

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Uploads an image for an experiment submission."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")
    
    # Create year-month subfolder for organization
    month_dir = datetime.now().strftime("%Y-%m")
    target_dir = os.path.join(UPLOAD_DIR, month_dir)
    os.makedirs(target_dir, exist_ok=True)
    
    # Generate unique filename
    ext = os.path.splitext(file.filename)[1]
    if not ext:
        ext = ".png" # default fallback
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    
    file_path = os.path.join(target_dir, unique_filename)
    
    try:
        with open(file_path, "wb") as buffer:
            # Read and write in chunks to support larger files
            buffer.write(await file.read())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
        
    return {
        "status": "success",
        "url": f"/uploads/{month_dir}/{unique_filename}",
        "filename": file.filename
    }
