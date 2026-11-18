"""
NovaPOS — AI Scan Router (ai_scan.py)
=======================================
POST /api/ai/scan          — rasm → Gemini → mahsulotlar ro'yxati
POST /api/ai/scan-excel    — .xlsx → mahsulotlar ro'yxati
POST /api/ai/confirm       — tasdiqlangan mahsulotlarni bazaga qo'shish
GET  /api/ai/scan/history  — scan tarixi
"""

import os
import base64
import json
import logging
import httpx

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timezone
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from app import models, crud, schemas
from app.database import get_db
from app.dependencies import get_current_employee
from app.websocket_manager import ws_manager

logger = logging.getLogger(__name__)
router = APIRouter(tags=["AI Scan"])

# ─── Config ───────────────────────────────────────────────────
GEMINI_MODEL = "gemini-2.5-flash"

def _get_gemini_url() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY sozlanmagan. .env faylga GEMINI_API_KEY=AIza... qo'shing."
        )
    return (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={key}"
    )

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME    = {"image/jpeg", "image/png", "image/webp"}

def _build_prompt(categories: list[str]) -> str:
    """
    Kategoriyalar ro'yxati bilan dinamik prompt yaratadi.
    Gemini mavjud kategoriyalardan birini tanlaydi yoki yangi taklif qiladi.
    """
    cats_str = ", ".join(f'"{c}"' for c in categories) if categories else '"Boshqa"'

    return f"""Siz omborxona uchun mahsulot ma'lumotlarini tanib oluvchi AIsiz.
Quyidagi rasm/faylda mahsulotlar jadvali bor.

Har bir mahsulot qatori uchun JSON arrayni qaytaring:
[
  {{
    "name":          "Mahsulot nomi (to'liq, o'zbekcha yoki ruscha)",
    "barcode":       "shtrix-kod yoki null",
    "quantity":      0,
    "unit_type":     "dona yoki kg yoki litr yoki metr yoki blok",
    "price_in":      0,
    "price_out":     0,
    "category_name": "Kategoriya nomi",
    "confidence":    0.95
  }}
]

BIRLIK QOIDALARI (unit_type):
- Sanab sotiluvchi narsalar (non, shisha, quti, dona): "dona"
- Og'irlik bilan sotiluvchi (go'sht, sabzavot, don): "kg"
- Hajm bilan sotiluvchi (sut, yog', ichimlik): "litr"
- Uzunlik bilan sotiluvchi (mato, ip, sim): "metr"
- To'liq quti/paket sotiluvchi: "blok"
- Shubha bo'lsa — "dona"

KATEGORIYA QOIDALARI (category_name):
Mavjud kategoriyalar: {cats_str}
- Agar mahsulot yuqoridagi kategoriyalardan biriga mos kelsa — o'sha nomni yoz (aynan shu ko'rinishda)
- Agar hech biriga to'g'ri kelmasa — eng mos yangi nom yoz (o'zbekcha, qisqa)
- Masalan: "Oziq-ovqat", "Ichimliklar", "Kimyo", "Sut mahsulotlari" va hokazo

UMUMIY QOIDALAR:
- Faqat JSON array qaytaring, boshqa hech narsa yozmang
- Narxlar faqat son (vergulsiz): 12000 (to'g'ri), "12,000" (noto'g'ri)
- Miqdor ham faqat son: 15.5 (to'g'ri)
- Bo'sh yoki o'qib bo'lmaydigan qatorlarni o'tkazib yuboring
- confidence: 0.0 dan 1.0 gacha
- Ko'rinmasa yoki bo'sh bo'lsa — null yozing
"""


# ═══════════════════════════════════════════════════════════════
# SCHEMAS
# ═══════════════════════════════════════════════════════════════

class AIScannedProduct(BaseModel):
    name:          str
    barcode:       Optional[str]   = None
    quantity:      float           = 0
    unit_type:     str             = "dona"
    price_in:      Optional[float] = None
    price_out:     Optional[float] = None
    category_name: Optional[str]   = None   # ← AI tanlaydi
    confidence:    float           = 1.0


class AIConfirmItem(BaseModel):
    name:                str
    barcode:             Optional[str]   = None
    quantity:            float           = 0
    unit_type:           str             = "dona"
    price_in:            Optional[float] = None
    price_out:           Optional[float] = None
    category_name:       Optional[str]   = None   # ← AI tanlagan yoki foydalanuvchi o'zgartirgan
    existing_product_id: Optional[int]   = None


class AIConfirmRequest(BaseModel):
    products: List[AIConfirmItem]
    scan_id:  Optional[int] = None


class AIScanResponse(BaseModel):
    products:      List[AIScannedProduct]
    total_found:   int
    scan_id:       Optional[int] = None
    error_message: Optional[str] = None


# ═══════════════════════════════════════════════════════════════
# GEMINI HELPER
# ═══════════════════════════════════════════════════════════════

async def _call_gemini(image_b64: str, mime_type: str, categories: list = None) -> List[dict]:
    gemini_url = _get_gemini_url()
    prompt     = _build_prompt(categories or [])

    payload = {
        "contents": [{
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": mime_type, "data": image_b64}},
            ]
        }],
        "generationConfig": {
            "temperature":    0.1,
            "maxOutputTokens": 8192,
        },
    }

    logger.info(f"[Gemini] So'rov yuborilmoqda... model={GEMINI_MODEL}, mime={mime_type}, b64_len={len(image_b64)}")

    try:
        async with httpx.AsyncClient(timeout=90.0) as client:  # 60→90s: katta rasm uchun
            resp = await client.post(gemini_url, json=payload)
    except httpx.TimeoutException:
        logger.error("[Gemini] Timeout")
        raise HTTPException(504, "Gemini API vaqt limitini oshdi. Qayta urinib ko'ring.")
    except httpx.ConnectError as e:
        logger.error(f"[Gemini] Ulanish xatosi: {e}")
        raise HTTPException(502, "Gemini API ga ulanib bo'lmadi. Internet aloqasini tekshiring.")

    logger.info(f"[Gemini] Javob: status={resp.status_code}")

    if resp.status_code == 404:
        logger.error(f"[Gemini] 404 — Model topilmadi: {GEMINI_MODEL}")
        raise HTTPException(502, f"Gemini model '{GEMINI_MODEL}' topilmadi.")

    if resp.status_code == 400:
        try:
            msg = resp.json().get("error", {}).get("message", resp.text[:200])
        except Exception:
            msg = resp.text[:200]
        logger.error(f"[Gemini] 400: {msg}")
        raise HTTPException(400, f"Gemini so'rov xatosi: {msg}")

    if resp.status_code == 403:
        logger.error("[Gemini] 403 — API kalit xato")
        raise HTTPException(503, "Gemini API kalit noto'g'ri yoki ruxsat yo'q. GEMINI_API_KEY ni tekshiring.")

    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After", "60")
        logger.error(f"[Gemini] 429 — Rate limit. Retry-After: {retry_after}s")
        raise HTTPException(429, f"Gemini API limiti to'ldi. {retry_after} soniyadan keyin qayta urinib ko'ring.")

    if resp.status_code != 200:
        logger.error(f"[Gemini] {resp.status_code}: {resp.text[:400]}")
        raise HTTPException(502, f"Gemini API xatosi: {resp.status_code}")

    try:
        data = resp.json()
    except Exception:
        logger.error(f"[Gemini] JSON parse xato, raw: {resp.text[:300]}")
        raise HTTPException(502, "Gemini javobi JSON formatida emas")

    candidates = data.get("candidates", [])
    if not candidates:
        feedback = data.get("promptFeedback", {})
        block    = feedback.get("blockReason", "")
        logger.error(f"[Gemini] candidates bo'sh. blockReason={block}, data={data}")
        hint = " Sabab: " + block if block else " Rasm sifatini qayta urinib koring."
        raise HTTPException(502, "Gemini rasm tahlil qilmadi." + hint)

    # BUG FIX: finishReason tekshirish — MAX_TOKENS bo'lsa natija to'liq emas
    finish_reason = candidates[0].get("finishReason", "")
    if finish_reason == "MAX_TOKENS":
        logger.warning("[Gemini] finishReason=MAX_TOKENS — javob kesilgan bo'lishi mumkin")
        # davom etamiz, lekin log ga yozamiz

    try:
        text = candidates[0]["content"]["parts"][0]["text"].strip()
    except (KeyError, IndexError) as e:
        logger.error(f"[Gemini] Javob strukturasi noto'g'ri: {e}\n{data}")
        raise HTTPException(502, "Gemini javobi kutilmagan formatda")

    logger.info(f"[Gemini] Raw text (200 chars): {text[:200]}")

    # JSON tozalash — ``` wrapping olib tashlash
    if "```" in text:
        for part in text.split("```"):
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            if part.startswith("[") or part.startswith("{"):
                text = part
                break

    text = text.strip()

    # Array emas bo'lsa
    if not text.startswith("["):
        if text.startswith("{"):
            text = f"[{text}]"
        else:
            logger.warning(f"[Gemini] JSON array topilmadi: {text[:100]}")
            return []

    try:
        result = json.loads(text)
        if not isinstance(result, list):
            result = [result]
        logger.info(f"[Gemini] ✅ {len(result)} mahsulot topildi")
        return result
    except json.JSONDecodeError as e:
        logger.error(f"[Gemini] JSON parse xato: {e}\nText: {text[:500]}")
        raise HTTPException(502, "AI javobi to'g'ri formatda emas. Qayta urinib ko'ring.")


# ═══════════════════════════════════════════════════════════════
# RASM YUKLASH → GEMINI
# ═══════════════════════════════════════════════════════════════

@router.post("/scan", response_model=AIScanResponse)
async def scan_image(
    file:     UploadFile      = File(...),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Rasm yuklash → Gemini Vision tahlili → mahsulotlar ro'yxati"""
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(400, "Faqat JPG, PNG, WebP rasmlari qabul qilinadi")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Fayl hajmi 10 MB dan oshmasin")

    # Mavjud kategoriyalarni DB dan olib Gemini ga beramiz
    try:
        cats = crud.get_store_categories(db, employee.store_id)
        cat_names = [c.name for c in cats]
    except Exception:
        cat_names = []

    image_b64    = base64.b64encode(content).decode()
    raw_products = await _call_gemini(image_b64, file.content_type, cat_names)

    # AIProductScan log
    scan_record = None
    try:
        scan_record = models.AIProductScan(
            store_id       = employee.store_id,
            employee_id    = employee.id,
            products_found = len(raw_products),
            status         = "pending",
            created_at     = datetime.now(timezone.utc),
        )
        db.add(scan_record)
        db.commit()
        db.refresh(scan_record)
    except Exception as e:
        logger.warning(f"AIProductScan log xato (kritik emas): {e}")

    products = []
    for p in raw_products:
        if not p.get("name"):
            continue
        try:
            unit = (p.get("unit_type") or "dona").lower().strip()
            if unit not in {"dona","kg","litr","metr","blok"}:
                unit = "dona"
            products.append(AIScannedProduct(
                name          = str(p.get("name", "")).strip(),
                barcode       = p.get("barcode")       or None,
                quantity      = float(p.get("quantity") or 0),
                unit_type     = unit,
                price_in      = float(p["price_in"])   if p.get("price_in")   not in (None, "", 0) else None,
                price_out     = float(p["price_out"])  if p.get("price_out")  not in (None, "", 0) else None,
                category_name = str(p["category_name"]).strip() if p.get("category_name") else None,
                confidence    = float(p.get("confidence") or 1.0),
            ))
        except (ValueError, TypeError) as e:
            logger.warning(f"Mahsulot parse xato ({p.get('name')}): {e} — o'tkazildi")

    return AIScanResponse(
        products    = products,
        total_found = len(products),
        scan_id     = scan_record.id if scan_record else None,
    )

@router.get("/scan/{scan_id}")
async def get_scan_detail(
    scan_id: int,
    db: Session = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee)
):
    # Bu endpoint scan_id orqali skanerlangan mahsulotlarni 
    # bazadan (yoki keshdan) qaytarishi kerak. 
    # Hozircha sizda skanerlangan mahsulotlar DBda alohida saqlanmayapti, 
    # faqat umumiy log saqlanyapti.
    scan = db.query(models.AIProductScan).filter(
        models.AIProductScan.id == scan_id,
        models.AIProductScan.store_id == employee.store_id
    ).first()
    
    if not scan:
        raise HTTPException(status_code=404, detail="Scan natijasi topilmadi")
    
    return scan
    
    
# ═══════════════════════════════════════════════════════════════
# EXCEL YUKLASH
# ═══════════════════════════════════════════════════════════════

@router.post("/scan-excel", response_model=AIScanResponse)
async def scan_excel(
    file:     UploadFile      = File(...),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    """Excel (.xlsx va .xls) ni parse qilib mahsulotlar ro'yxatini qaytaradi"""
    fname = (file.filename or "").lower()
    if not fname.endswith((".xlsx", ".xls")):
        raise HTTPException(400, "Faqat .xlsx yoki .xls fayl qabul qilinadi")

    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Fayl hajmi 10 MB dan oshmasin")

    try:
        from io import BytesIO

        VALID_UNITS = {"dona", "kg", "litr", "metr", "blok"}
        products    = []

        def safe_float(v, default=0.0):
            try:
                if v is None or str(v).strip() in ("", "—", "-", "None", "nan"):
                    return default
                return float(str(v).replace(",","").replace(" ","").replace("\xa0",""))
            except (ValueError, TypeError):
                return default

        def _parse_ws(ws_rows):
            """
            Ikki format qo'llab-quvvatlanadi:
            YANGI 6 ustun: A=№, B=Nom, C=Barcode, D=Miqdor, E=Kelish, F=Sotuv
            ESKI 8 ustun:  A=№, B=Nom, C=Barcode, D=Miqdor, E=Birlik, F=Kelish, G=Sotuv, H=Kategoriya
            """
            result = []
            for row in ws_rows:
                try:
                    name = str(row[1]).strip() if len(row) > 1 and row[1] not in (None, "") else ""
                except: name = ""
                if not name or name.lower() in ("none","nan","mahsulot nomi ★","mahsulot nomi","nomi","mahsulot nomi"):
                    continue

                try:
                    barcode = str(row[2]).strip() if len(row) > 2 and row[2] not in (None, "") else None
                    if barcode and barcode.lower() in ("none","nan","—","-","barcode","plu/barcode"): barcode = None
                except: barcode = None

                # Format aniqlaymiz: E ustunida birlik bor bo'lsa — eski 8 ustun format
                try:
                    e_val = str(row[4]).strip().lower() if len(row) > 4 and row[4] not in (None, "") else ""
                except: e_val = ""

                if e_val in VALID_UNITS:
                    # Eski format: E=Birlik, F=Kelish, G=Sotuv
                    unit      = e_val
                    price_in  = safe_float(row[5] if len(row) > 5 else None) or None
                    price_out = safe_float(row[6] if len(row) > 6 else None) or None
                else:
                    # Yangi format: E=Kelish, F=Sotuv (birlikni AI aniqlaydi)
                    unit      = "dona"   # AI o'zi tanlaydi
                    price_in  = safe_float(row[4] if len(row) > 4 else None) or None
                    price_out = safe_float(row[5] if len(row) > 5 else None) or None

                result.append(AIScannedProduct(
                    name      = name,
                    barcode   = barcode,
                    quantity  = safe_float(row[3] if len(row) > 3 else None),
                    unit_type = unit,
                    price_in  = price_in,
                    price_out = price_out,
                    confidence= 1.0,
                ))
            return result

        if fname.endswith(".xlsx"):
            # openpyxl — .xlsx uchun
            import openpyxl
            wb = openpyxl.load_workbook(BytesIO(content), data_only=True)
            ws = wb.active
            rows = list(ws.iter_rows(min_row=5, values_only=True))
            products = _parse_ws(rows)

        else:
            # .xls uchun — xlrd ishlatamiz
            try:
                import xlrd
                wb_xls = xlrd.open_workbook(file_contents=content)
                ws_xls = wb_xls.sheet_by_index(0)
                rows = []
                for i in range(4, ws_xls.nrows):   # 5-qatordan (0-indexed: 4)
                    rows.append([ws_xls.cell_value(i, j) for j in range(ws_xls.ncols)])
                products = _parse_ws(rows)
            except ImportError:
                # xlrd yo'q bo'lsa — .xls ni rasm sifatida Gemini ga yuborib bo'lmaydi
                # Foydalanuvchiga .xlsx ga o'tkazishni so'raymiz
                raise HTTPException(
                    400,
                    "Eski .xls format uchun 'xlrd' kutubxonasi kerak. "
                    "Iltimos faylni .xlsx formatiga o'tkazing yoki: pip install xlrd"
                )

    except Exception as e:
        logger.error(f"Excel parse xato: {e}")
        raise HTTPException(400, f"Excel faylni o'qib bo'lmadi: {str(e)}")

    # Scan log
    scan_record = None
    try:
        scan_record = models.AIProductScan(
            store_id       = employee.store_id,
            employee_id    = employee.id,
            products_found = len(products),
            status         = "pending",
            created_at     = datetime.now(timezone.utc),
        )
        db.add(scan_record)
        db.commit()
        db.refresh(scan_record)
    except Exception as e:
        logger.warning(f"AIProductScan log xato: {e}")

    return AIScanResponse(
        products    = products,
        total_found = len(products),
        scan_id     = scan_record.id if scan_record else None,
    )


# ═══════════════════════════════════════════════════════════════
# TASDIQLASH — AQLLI QO'SHISH
# ═══════════════════════════════════════════════════════════════

@router.post("/confirm")
async def confirm_scan(
    data:     AIConfirmRequest,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    added_new   = 0
    added_stock = 0
    errors      = 0
    error_list  = []

    # Kategoriya cache — nom → id
    cat_cache: dict[str, int] = {}

    def _get_or_create_category(cat_name: Optional[str]) -> Optional[int]:
        """Kategoriya nomidan ID oladi, yo'q bo'lsa yaratadi"""
        if not cat_name or not cat_name.strip():
            return None
        name = cat_name.strip()
        if name in cat_cache:
            return cat_cache[name]
        # DB dan qidirish
        cat = db.query(models.Category).filter(
            models.Category.store_id  == employee.store_id,
            models.Category.name      == name,
            models.Category.is_active == True,
        ).first()
        if not cat:
            # Yangi kategoriya yaratish
            try:
                cat = models.Category(
                    store_id  = employee.store_id,
                    name      = name,
                    is_active = True,
                )
                db.add(cat)
                db.flush()
            except Exception as e:
                logger.warning(f"Kategoriya yaratishda xato ({name}): {e}")
                return None
        cat_cache[name] = cat.id
        return cat.id

    for item in data.products:
        if not item.name.strip():
            continue

        try:
            # ── PYDANTIC BUG FIX: mutable flag ──────────────
            # item.existing_product_id ni o'zgartirib bo'lmaydi (immutable)
            # Shuning uchun alohida flag ishlatamiz
            use_existing_id = item.existing_product_id
            handled = False  # bu item qayta ishlandi yoki yo'q

            # ── YO'L 1: MAVJUD MAHSULOTGA QO'SHISH ──────────
            if use_existing_id:
                existing = db.query(models.Product).filter(
                    models.Product.id         == use_existing_id,
                    models.Product.store_id   == employee.store_id,
                    models.Product.is_deleted == False,
                ).first()

                if existing:
                    # Miqdor qo'shish — supply_price 0 bo'lmasligi kerak
                    supply_price = item.price_in or existing.price_in or 0
                    if supply_price <= 0:
                        supply_price = existing.price_in or 1  # kamida 1

                    if item.quantity and item.quantity > 0:
                        batch_data = schemas.SupplyBatchCreate(
                            product_id        = existing.id,
                            quantity_received = item.quantity,
                            supply_price      = supply_price,
                            price_out         = item.price_out or existing.price_out or 0,
                            is_paid           = True,
                            supplier_id       = None,
                        )
                        crud.create_supply_batch(db, batch_data, employee.store_id, employee.id)

                    # Narxlar o'zgargan bo'lsa — yangilash
                    changed = False
                    if item.price_out and item.price_out > 0 and item.price_out != existing.price_out:
                        existing.price_out = item.price_out
                        changed = True
                    if item.price_in and item.price_in > 0 and item.price_in != existing.price_in:
                        existing.price_in = item.price_in
                        changed = True
                    if changed:
                        existing.updated_at = datetime.now(timezone.utc)
                        db.commit()

                    db.refresh(existing)
                    added_stock += 1
                    handled = True

                    await ws_manager.broadcast(
                        store_id = employee.store_id,
                        event    = "stock_updated",
                        data     = {"items": [{
                            "product_id": existing.id,
                            "name":       existing.name,
                            "new_qty":    existing.quantity,
                            "barcode":    existing.barcode,
                            "short_code": existing.short_code,
                        }]},
                    )
                else:
                    # ID topilmadi — yangi yaratishga o'tamiz
                    logger.warning(f"existing_product_id={use_existing_id} topilmadi → yangi yaratiladi: {item.name}")

            if handled:
                continue

            # ── YO'L 2: BARCODE ORQALI TEKSHIRISH ───────────
            if item.barcode:
                barcode_exist = db.query(models.Product).filter(
                    models.Product.store_id   == employee.store_id,
                    models.Product.barcode    == item.barcode,
                    models.Product.is_deleted == False,
                ).first()

                if barcode_exist:
                    supply_price = item.price_in or barcode_exist.price_in or 1
                    if item.quantity and item.quantity > 0:
                        batch_data = schemas.SupplyBatchCreate(
                            product_id        = barcode_exist.id,
                            quantity_received = item.quantity,
                            supply_price      = supply_price,
                            price_out         = item.price_out or barcode_exist.price_out or 0,
                            is_paid           = True,
                            supplier_id       = None,
                        )
                        crud.create_supply_batch(db, batch_data, employee.store_id, employee.id)
                    added_stock += 1
                    continue

            # ── YO'L 3: YANGI MAHSULOT YARATISH ─────────────
            # Kategoriya ID olish yoki yaratish
            category_id = _get_or_create_category(item.category_name)

            product_data = schemas.ProductCreate(
                name        = item.name.strip(),
                barcode     = item.barcode   or None,
                short_code  = None,
                unit_type   = item.unit_type or "dona",
                quantity    = item.quantity  or 0,
                price_in    = item.price_in  or 0,
                price_out   = item.price_out or 0,
                category_id = category_id,
                description = None,
            )
            new_product = crud.create_product(db, product_data, employee.store_id)
            added_new  += 1

            await ws_manager.broadcast(
                store_id = employee.store_id,
                event    = "product_added",
                data     = {
                    "product_id":   new_product.id,
                    "name":         new_product.name,
                    "quantity":     new_product.quantity,
                    "price_out":    new_product.price_out,
                    "barcode":      new_product.barcode,
                    "category_id":  new_product.category_id,
                    "added_by":     employee.full_name,
                    "source":       "ai_scan",
                },
            )

        except Exception as e:
            errors += 1
            error_list.append(f"{item.name}: {str(e)}")
            logger.error(f"AI confirm xato [{item.name}]: {e}", exc_info=True)

    # Kategoriya commit (agar yangi yaratilgan bo'lsa)
    try:
        db.commit()
    except Exception:
        pass

    # Scan record yangilash
    if data.scan_id:
        try:
            scan = db.query(models.AIProductScan).filter(
                models.AIProductScan.id == data.scan_id
            ).first()
            if scan:
                scan.products_added = added_new + added_stock
                scan.status         = "success" if not errors else "partial"
                scan.error_message  = "; ".join(error_list[:3]) if error_list else None
                db.commit()
        except Exception as e:
            logger.warning(f"Scan record yangilashda xato: {e}")

    return {
        "status":      "success" if not errors else "partial",
        "added_new":   added_new,
        "added_stock": added_stock,
        "added_count": added_new + added_stock,
        "error_count": errors,
        "errors":      error_list[:5] if error_list else [],
    }


# ═══════════════════════════════════════════════════════════════
# SCAN TARIXI
# ═══════════════════════════════════════════════════════════════

@router.get("/scan/history")
def get_scan_history(
    limit:    int             = 20,
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    try:
        scans = db.query(models.AIProductScan).filter(
            models.AIProductScan.store_id == employee.store_id
        ).order_by(
            models.AIProductScan.created_at.desc()
        ).limit(limit).all()

        return [{
            "id":             s.id,
            "products_found": s.products_found,
            "products_added": s.products_added,
            "status":         s.status,
            "error_message":  s.error_message,
            "created_at":     s.created_at.isoformat() if s.created_at else None,
        } for s in scans]
    except Exception as e:
        logger.warning(f"Scan history xato: {e}")
        return []