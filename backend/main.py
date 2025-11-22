import os
import shutil
import base64
import numpy as np
import cv2
from typing import Optional, List
from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from blind_watermark import WaterMark
import blind_watermark
blind_watermark.bw_notes.close()


def resize_watermark_if_needed(wm_path: str, max_capacity_bits: int) -> str:
    """Resize watermark image if it's too large for the source image capacity."""
    img = cv2.imread(wm_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return wm_path

    h, w = img.shape
    current_bits = h * w

    if current_bits <= max_capacity_bits:
        return wm_path

    scale = np.sqrt(max_capacity_bits * 0.9 / current_bits)
    new_w = max(int(w * scale), 1)
    new_h = max(int(h * scale), 1)

    resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

    resized_path = wm_path.rsplit('.', 1)[0] + '_resized.png'
    cv2.imwrite(resized_path, resized)

    return resized_path


def get_image_capacity(img_path: str) -> int:
    """Estimate the watermark capacity of an image in bits."""
    img = cv2.imread(img_path)
    if img is None:
        return 0
    h, w = img.shape[:2]

    return (h // 4) * (w // 4)

load_dotenv()

app = FastAPI(title="StegoPix")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_TOKEN = os.getenv("API_TOKEN")
AUTH_ENABLED = os.getenv("ENABLE_FRONTEND_AUTH", "false").lower() == "true"
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

async def verify_token(authorization: Optional[str] = Header(None)):
    if not API_TOKEN:
        return
    if authorization != f"Bearer {API_TOKEN}":
        raise HTTPException(status_code=401, detail="Invalid Token")

def save_temp_file(file: UploadFile):
    path = os.path.join(UPLOAD_DIR, file.filename)
    with open(path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return path

def clean_temp(paths):
    for p in paths:
        if os.path.exists(p):
            os.remove(p)

def encode_image_base64(path):
    with open(path, "rb") as f:
        return base64.b64encode(f.read()).decode('utf-8')


async def process_batch(files: List[UploadFile], processor):
    """Save uploaded files to disk, run `processor(path, filename)` for each,
    then clean up temporary files and return a list of results.
    `processor` is expected to be an async function.
    """
    saved_paths = []
    results = []
    try:
        for f in files:
            p = save_temp_file(f)
            saved_paths.append(p)

        for p, f in zip(saved_paths, files):
            res = await processor(p, f.filename)
            results.append(res)

        return results
    finally:
        clean_temp(saved_paths)

@app.get("/api/config")
def get_config():
    return {"auth_required": AUTH_ENABLED}

@app.post("/api/embed/image", dependencies=[Depends(verify_token)])
async def embed_image(
    source: List[UploadFile] = File(...),
    watermark: UploadFile = File(...),
    pwd_img: int = Form(1),
    pwd_wm: int = Form(1)
):
    wm_path = save_temp_file(watermark)
    all_resized_wm_paths = []

    async def _process(src_path, filename):
        nonlocal all_resized_wm_paths
        out_path = os.path.join(UPLOAD_DIR, f"out_{filename}")
        resized_wm_paths = []

        try:
            capacity = get_image_capacity(src_path)
            current_wm_path = wm_path
            max_attempts = 10
            scale_factor = 0.85

            for attempt in range(max_attempts):
                try:
                    if attempt == 0:
                        resized_path = resize_watermark_if_needed(current_wm_path, capacity)
                    else:
                        wm_img = cv2.imread(current_wm_path, cv2.IMREAD_GRAYSCALE)
                        if wm_img is None:
                            raise ValueError("Cannot read watermark image")
                        h, w = wm_img.shape
                        new_w = max(int(w * scale_factor), 1)
                        new_h = max(int(h * scale_factor), 1)
                        resized_img = cv2.resize(wm_img, (new_w, new_h), interpolation=cv2.INTER_AREA)
                        resized_path = current_wm_path.rsplit('.', 1)[0] + f'_retry{attempt}_{filename}.png'
                        cv2.imwrite(resized_path, resized_img)

                    if resized_path != wm_path and resized_path not in resized_wm_paths:
                        resized_wm_paths.append(resized_path)
                        all_resized_wm_paths.append(resized_path)

                    current_wm_path = resized_path

                    bwm = WaterMark(password_img=pwd_img, password_wm=pwd_wm, processes=None)
                    bwm.read_img(src_path)
                    bwm.read_wm(current_wm_path)
                    bwm.embed(out_path)

                    wm_img = cv2.imread(current_wm_path, cv2.IMREAD_GRAYSCALE)
                    wm_h, wm_w = wm_img.shape

                    result = {
                        "filename": filename,
                        "image": f"data:image/png;base64,{encode_image_base64(out_path)}",
                        "wm_shape": f"({wm_w}, {wm_h})",
                        "wm_width": wm_w,
                        "wm_height": wm_h,
                        "note": f"Watermark {'auto-resized' if current_wm_path != wm_path else 'kept'} at {wm_w}x{wm_h}."
                    }
                    clean_temp([out_path])
                    return result

                except AssertionError as e:
                    error_msg = str(e)
                    if ("overflow" in error_msg or "The maximum number of embeddings" in error_msg) and attempt < max_attempts - 1:
                        continue
                    if attempt == max_attempts - 1:
                        return {"filename": filename, "error": f"Watermark too large after {max_attempts} attempts. {error_msg}"}
                    return {"filename": filename, "error": str(e)}

        except Exception as e:
            return {"filename": filename, "error": f"Embedding error: {str(e)}"}

    try:
        results = await process_batch(source, _process)
        return results
    finally:
        clean_temp([wm_path] + all_resized_wm_paths)

@app.post("/api/extract/image", dependencies=[Depends(verify_token)])
async def extract_image(
    source: List[UploadFile] = File(...),
    wm_width: int = Form(...),
    wm_height: int = Form(...),
    pwd_img: int = Form(1),
    pwd_wm: int = Form(1)
):
    if wm_width <= 0 or wm_height <= 0:
        raise HTTPException(status_code=400, detail="Width and Height must be greater than 0.")

    async def _process(path, filename):
        out_wm_path = os.path.join(UPLOAD_DIR, f"extracted_wm_{filename}.png")
        try:
            bwm = WaterMark(password_img=pwd_img, password_wm=pwd_wm, processes=None)
            bwm.extract(filename=path, wm_shape=(wm_height, wm_width), out_wm_name=out_wm_path)
            
            if os.path.exists(out_wm_path):
                res = {"filename": filename, "image": f"data:image/png;base64,{encode_image_base64(out_wm_path)}"}
                clean_temp([out_wm_path])
                return res
            else:
                return {"filename": filename, "error": "Extraction yielded no image."}
        except Exception as e:
             return {"filename": filename, "error": f"Failed: {str(e)}"}

    return await process_batch(source, _process)

@app.post("/api/embed/text", dependencies=[Depends(verify_token)])
async def embed_text(
    source: List[UploadFile] = File(...),
    text: str = Form(...),
    pwd_img: int = Form(1),
    pwd_wm: int = Form(1)
):
    async def _process(src_path, filename):
        out_path = os.path.join(UPLOAD_DIR, f"out_{filename}")
        try:
            bwm = WaterMark(password_img=pwd_img, password_wm=pwd_wm, processes=None)
            bwm.read_img(src_path)
            bwm.read_wm(text, mode='str')
            bwm.embed(out_path)

            result = {
                "filename": filename,
                "image": f"data:image/png;base64,{encode_image_base64(out_path)}",
                "wm_length": len(bwm.wm_bit)
            }
            clean_temp([out_path])
            return result
        except AssertionError as e:
            error_msg = str(e)
            if "overflow" in error_msg or "too many" in error_msg:
                return {"filename": filename, "error": f"Text too long for this image. {error_msg}"}
            return {"filename": filename, "error": f"Embedding failed: {error_msg}"}
        except Exception as e:
            return {"filename": filename, "error": f"Embedding error: {str(e)}"}

    return await process_batch(source, _process)

@app.post("/api/extract/text", dependencies=[Depends(verify_token)])
async def extract_text(
    source: List[UploadFile] = File(...),
    wm_length: int = Form(...),
    pwd_img: int = Form(1),
    pwd_wm: int = Form(1)
):
    if wm_length <= 0:
        raise HTTPException(status_code=400, detail="Watermark length must be greater than 0.")

    async def _process(path, filename):
        try:
            bwm = WaterMark(password_img=pwd_img, password_wm=pwd_wm, processes=None)
            text = bwm.extract(path, wm_shape=wm_length, mode='str')
            return {"filename": filename, "content": text}
        except ValueError as e:
            if "zero-size array" in str(e):
                 return {"filename": filename, "error": "Extraction failed: Length is too small or image has no data."}
            raise e
        except Exception as e:
            return {"filename": filename, "error": f"Error: {str(e)}"}

    return await process_batch(source, _process)

@app.post("/api/embed/bytes", dependencies=[Depends(verify_token)])
async def embed_bytes(
    source: List[UploadFile] = File(...),
    binary_file: UploadFile = File(...),
    pwd_img: int = Form(1),
    pwd_wm: int = Form(1)
):
    bin_content = await binary_file.read()
    bits = np.unpackbits(np.frombuffer(bin_content, dtype=np.uint8))
    bits_list = [bool(b) for b in bits]

    async def _process(src_path, filename):
        out_path = os.path.join(UPLOAD_DIR, f"out_{filename}")
        try:
            bwm = WaterMark(password_img=pwd_img, password_wm=pwd_wm, processes=None)
            bwm.read_img(src_path)
            bwm.read_wm(bits_list, mode='bit')
            bwm.embed(out_path)

            result = {
                "filename": filename,
                "image": f"data:image/png;base64,{encode_image_base64(out_path)}",
                "wm_length": len(bits_list)
            }
            clean_temp([out_path])
            return result
        except AssertionError as e:
            error_msg = str(e)
            if "overflow" in error_msg or "too many" in error_msg:
                return {"filename": filename, "error": f"Binary file too large for this image. {error_msg}"}
            return {"filename": filename, "error": f"Embedding failed: {error_msg}"}
        except Exception as e:
            return {"filename": filename, "error": f"Embedding error: {str(e)}"}

    return await process_batch(source, _process)

@app.post("/api/extract/bytes", dependencies=[Depends(verify_token)])
async def extract_bytes(
    source: List[UploadFile] = File(...),
    wm_length: int = Form(...),
    pwd_img: int = Form(1),
    pwd_wm: int = Form(1)
):
    if wm_length <= 0:
        raise HTTPException(status_code=400, detail="Watermark length must be greater than 0.")

    async def _process(path, filename):
        try:
            bwm = WaterMark(password_img=pwd_img, password_wm=pwd_wm, processes=None)
            extracted_bits = bwm.extract(path, wm_shape=wm_length, mode='bit')
            
            bits = np.array([1 if x > 0.5 else 0 for x in extracted_bits], dtype=np.uint8)
            byte_data = np.packbits(bits).tobytes()
            
            return {
                "filename": filename,
                "file_b64": base64.b64encode(byte_data).decode('utf-8')
            }
        except Exception as e:
            print(f"Error extracting bytes: {e}")
            return {"filename": filename, "error": "Extraction failed. Check length/password."}

    return await process_batch(source, _process)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
