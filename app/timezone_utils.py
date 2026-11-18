"""
NovaPOS — Timezone Utils
=========================
Barcha datetime operatsiyalar FAQAT shu moduldan o'tadi.
Toshkent vaqti (UTC+5) — hamma joyda bir xil.

Muammo:
  - datetime.utcnow()  → UTC vaqt (Toshkentdan 5 soat orqada)
  - func.now()         → SQLite: UTC, PostgreSQL: server vaqti
  - datetime.now()     → server local vaqt (unpredictable)

Yechim:
  - now_tashkent()     → har doim UTC+5
  - to_tashkent(dt)    → har qanday naive/aware → UTC+5 display uchun
"""

from datetime import datetime, timezone, timedelta

# ─── Toshkent timezone ───────────────────────────────────────
TZ_TASHKENT = timezone(timedelta(hours=5), name="Asia/Tashkent")


def now_tashkent() -> datetime:
    """
    Hozirgi vaqt — Toshkent (UTC+5), naive datetime (DB uchun).
    SQLite/PostgreSQL ikkalasi ham naive datetime saqlaydi.
    
    Foydalanish:
        created_at = now_tashkent()
    """
    return datetime.now(TZ_TASHKENT).replace(tzinfo=None)


def now_tashkent_aware() -> datetime:
    """
    Toshkent vaqti, timezone-aware (API response uchun).
    """
    return datetime.now(TZ_TASHKENT)


def to_tashkent(dt: datetime | None) -> datetime | None:
    """
    Har qanday datetime → Toshkent vaqtiga o'girish.
    
    - None → None
    - naive datetime → UTC deb qabul qilib UTC+5 ga o'girish
    - aware datetime → UTC+5 ga convert
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        # DB dan kelgan naive datetime = UTC saqlangan deb faraz qilamiz
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(TZ_TASHKENT)


def start_of_day(dt: datetime | None = None) -> datetime:
    """
    Berilgan kun (yoki bugun) ning 00:00:00 — Toshkent.
    DB query uchun naive format.
    """
    base = dt or now_tashkent()
    return base.replace(hour=0, minute=0, second=0, microsecond=0)


def end_of_day(dt: datetime | None = None) -> datetime:
    """
    Berilgan kun (yoki bugun) ning 23:59:59 — Toshkent.
    DB query uchun naive format.
    """
    base = dt or now_tashkent()
    return base.replace(hour=23, minute=59, second=59, microsecond=999999)


def parse_date_param(date_str: str | None, fallback: datetime) -> datetime:
    """
    Query param sifatida kelgan sana string → datetime.
    Format: YYYY-MM-DD yoki YYYY-MM-DDTHH:MM:SS
    """
    if not date_str:
        return fallback
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    return fallback