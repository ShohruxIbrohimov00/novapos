"""
NovaPOS — Subscriptions Router v2.1
======================================
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from datetime import datetime, timezone
import os
import logging
from typing import List

from app import models
from app.database import get_db
from app.dependencies import get_current_employee

logger     = logging.getLogger(__name__)
router     = APIRouter(tags=["Subscriptions"])

UPLOAD_DIR        = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                                 "webapp", "static", "uploads", "proofs")
ALLOWED_TYPES     = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
ALLOWED_EXT       = {"jpg", "jpeg", "png", "webp"}
MAX_SIZE          = 5 * 1024 * 1024   # 5 MB

os.makedirs(UPLOAD_DIR, exist_ok=True)

# ─── 1. TARIFLARNI OLISH (FRONT-END UCHUN) ───
@router.get("/tarifs")
async def get_all_available_tarifs(db: Session = Depends(get_db)):
    """Barcha faol tariflar ro'yxati"""
    try:
        tarifs = db.query(models.Tarif).all()
        return [
            {
                "id": t.id,
                "name": t.name,
                "price": float(t.price),
                "months": t.months,
                "description": getattr(t, 'description', "")
            }
            for t in tarifs
        ]
    except Exception as e:
        logger.error(f"Tariflar xatosi: {e}")
        return []

# ─── 2. TO'LOV SOZLAMALARI (KARTA RAQAMI) ───
@router.get("/payment-settings")
def get_payment_settings(db: Session = Depends(get_db)):
    """Karta ma'lumotlari — PUBLIC"""
    s = db.query(models.SystemSettings).first()
    if not s:
        return {
            "card_number": "8600 0000 0000 0000", 
            "card_owner": "NOVAPOS", 
            "support_phone": "+998901234567"
        }
    return {
        "card_number": s.card_number, 
        "card_owner": s.card_owner, 
        "support_phone": s.support_phone
    }

# ─── 3. TO'LOV CHEKINI YUKLASH ───
@router.post("/upload-proof")
async def upload_proof(
    tarif_id: int         = Form(...),
    file:     UploadFile  = File(...),
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(400, "Faqat rasm formatlari qabul qilinadi")

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(400, "Fayl 5 MB dan katta bo'lmasin")

    tarif = db.query(models.Tarif).filter(models.Tarif.id == tarif_id).first()
    if not tarif:
        raise HTTPException(404, "Tarif topilmadi")

    # Faylni saqlash
    # ✅ Fayl haqiqatan rasm ekanini ichidan tekshiramiz (nom va content-type soxta bo'lishi mumkin)
    if content[:3] == b"\xff\xd8\xff":
        ext = "jpg"
    elif content[:8] == b"\x89PNG\r\n\x1a\n":
        ext = "png"
    elif content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        ext = "webp"
    else:
        raise HTTPException(400, "Faqat JPG, PNG yoki WEBP rasm yuklang")
    fname = f"proof_{employee.store_id}_{int(datetime.now().timestamp())}.{ext}"
    fpath = os.path.join(UPLOAD_DIR, fname)
    
    with open(fpath, "wb") as f:
        f.write(content)

    # So'rov yaratish
    req = models.SubscriptionRequest(
        store_id        = employee.store_id,
        employee_id     = employee.id,
        tarif_id        = tarif.id,
        amount          = tarif.price,
        plan_months     = tarif.months,
        proof_image_url = f"/static/uploads/proofs/{fname}",
        status          = "pending",
    )
    db.add(req)

    if employee.store:
        employee.store.payment_status = "pending"

    db.commit()
    return {"status": "success", "message": "Yuborildi!"}

# ─── 4. OBUNA HOLATI ───
@router.get("/status")
def get_subscription_status(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    store = db.query(models.Store).filter(models.Store.id == employee.store_id).first()
    if not store:
        raise HTTPException(404, "Do'kon topilmadi")

    now = datetime.now()
    days_left = None
    if store.subscription_expires_at:
        days_left = (store.subscription_expires_at - now).days

    return {
        "payment_status": store.payment_status,
        "expires_at": store.subscription_expires_at.isoformat() if store.subscription_expires_at else None,
        "days_left": days_left
    }

# ─── 5. MENING SO'ROVLARIM ───
@router.get("/my-requests")
def get_my_requests(
    db:       Session         = Depends(get_db),
    employee: models.Employee = Depends(get_current_employee),
):
    return db.query(models.SubscriptionRequest).filter(
        models.SubscriptionRequest.store_id == employee.store_id
    ).order_by(models.SubscriptionRequest.created_at.desc()).all()