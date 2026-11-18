"""
NovaPOS — Main Application v2.2
=================================
  ✅ Timezone — Toshkent (UTC+5) barcha joyda
  ✅ WebSocket — JWT token validatsiya (store_id verify)
  ✅ WebSocket — asyncio.wait_for timeout xavfsiz
  ✅ WebSocket — WSEvent konstantlari ishlatiladi
  ✅ CORS — environment ga qarab
  ✅ Global exception handler
  ✅ Structured logging
  ✅ AI (Gemini) router
  ✅ /health — ws_manager.get_all_stats()
  ✅ Superadmin — backend yonganda avtomatik yaratiladi (.env dan)
"""

import os
import secrets
import logging
import asyncio
from contextlib import asynccontextmanager

# ✅ .env ENG BIRINCHI yuklanadi — app.database / app.dependencies import paytida
# DATABASE_URL va SECRET_KEY ni o'qiydi. Avval load_dotenv() keyinroq chaqirilgani
# uchun .env dagi qiymatlar e'tiborsiz qolardi.
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.exceptions import RequestValidationError

from app.database import init_db, check_db_health, SessionLocal
from app.websocket_manager import ws_manager, WSEvent
from app.dependencies import decode_ws_token
from app.rate_limiter import limiter, rate_limit_handler
from app.timezone_utils import now_tashkent
from slowapi.errors import RateLimitExceeded

from app.api import (
    auth, products, sales, reports,
    customers, suppliers, subscriptions,
    superadmin, employees, stores,
)
from app.api import ai_scan
from app import models, crud

# ─── Logging ──────────────────────────────────────────────────
logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt = "%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Environment ──────────────────────────────────────────────
ENVIRONMENT   = os.getenv("ENVIRONMENT", "development")
ALLOWED_HOSTS = os.getenv("ALLOWED_ORIGINS", "*").split(",")
IS_PRODUCTION = ENVIRONMENT == "production"

# ─── Paths ────────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEBAPP_DIR = os.path.join(BASE_DIR, "webapp")
STATIC_DIR = os.path.join(WEBAPP_DIR, "static")

os.makedirs(os.path.join(STATIC_DIR, "uploads", "proofs"),   exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "uploads", "ai_scans"), exist_ok=True)

# ─── Timezone: OS darajasida ham set qilamiz (Linux) ─────────
if os.name != "nt":
    os.environ["TZ"] = "Asia/Tashkent"
    try:
        import time
        time.tzset()
        logger.info("✅ OS timezone: Asia/Tashkent")
    except Exception:
        pass


# ============================================
# SUPERADMIN AUTO-CREATE
# ============================================

def create_initial_superadmin() -> None:
    """
    Superadminni yaratishda crud.hash_password dan foydalanamiz.
    Bu SHA256 + BCYPT zanjirini to'g'ri ishlatilishini ta'minlaydi.
    """
    username = os.getenv("SUPERADMIN_USERNAME", "").strip().lower() # Har doim kichik harf
    password = os.getenv("SUPERADMIN_PASSWORD", "").strip()
    fullname = os.getenv("SUPERADMIN_FULLNAME", "Super Admin").strip()

    if not username or not password:
        logger.warning("⚠️ SUPERADMIN_USERNAME yoki SUPERADMIN_PASSWORD .env da topilmadi")
        return

    db = SessionLocal()
    try:
        # Avval mavjudligini tekshiramiz
        exists = db.query(models.Employee).filter(models.Employee.username == username).first()
        
        if exists:
            # Agar parol o'zgargan bo'lsa, uni yangilab qo'yish mantiqi (ixtiyoriy)
            # Hozircha shunchaki borligini aytamiz
            logger.debug(f"✅ Superadmin '{username}' allaqachon mavjud")
            return

        # DIQQAT: crud.hash_password ishlatamiz!
        # Bu SHA256(password) -> bcrypt(hash) zanjirini yaratadi
        new_admin = models.Employee(
            full_name       = fullname,
            username        = username,
            hashed_password = crud.hash_password(password), # ✅ TO'G'RI HASH
            pin_code        = crud.hash_pin(secrets.token_hex(16)),  # PIN bilan kirish yopiq
            role            = models.EmployeeRole.super_admin,
            is_active       = True,
            store_id        = None,
        )
        db.add(new_admin)
        db.commit()
        logger.info(f"✨ Superadmin yaratildi: '{username}'")

    except Exception as e:
        db.rollback()
        logger.error(f"❌ Superadmin yaratishda xato: {e}")
    finally:
        db.close()

# ============================================
# LIFESPAN
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"🚀 NovaPOS v2.2 ishga tushmoqda... [{ENVIRONMENT}]")
    logger.info(f"🕐 Server vaqti: {now_tashkent().strftime('%Y-%m-%d %H:%M:%S')} (Toshkent UTC+5)")
    try:
        init_db()
        logger.info("✅ Database tayyor")

        # Superadminni tekshirish va kerak bo'lsa yaratish
        create_initial_superadmin()

    except Exception as e:
        logger.error(f"❌ Ishga tushishda xato: {e}")
        raise
    yield
    logger.info("🛑 NovaPOS to'xtatilmoqda...")


# ============================================
# FASTAPI APP
# ============================================

app = FastAPI(
    title       = "NovaPOS Smart POS",
    description = "PWA Point of Sale — Real-time WebSocket + AI Scan",
    version     = "2.2.0",
    lifespan    = lifespan,
    docs_url    = None if IS_PRODUCTION else "/docs",
    redoc_url   = None if IS_PRODUCTION else "/redoc",
)

# ─── Rate Limiter ─────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

# ─── CORS ─────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"] if not IS_PRODUCTION else ALLOWED_HOSTS,
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)


# ─── Global Exception Handlers ────────────────────────────────
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = []
    for err in exc.errors():
        field = " → ".join(str(x) for x in err["loc"])
        errors.append(f"{field}: {err['msg']}")
    return JSONResponse(
        status_code=422,
        content={"detail": "; ".join(errors)},
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled error on {request.url}: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Server xatosi yuz berdi"},
    )


# ─── Static & Templates ───────────────────────────────────────
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

templates = Jinja2Templates(directory=os.path.join(WEBAPP_DIR, "templates"))


# ─── PWA Files ────────────────────────────────────────────────
@app.get("/sw.js")
async def service_worker():
    path = os.path.join(WEBAPP_DIR, "sw.js")
    if os.path.exists(path):
        return FileResponse(path, media_type="application/javascript",
                            headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, "sw.js topilmadi")

@app.get("/manifest.json")
async def manifest():
    path = os.path.join(STATIC_DIR, "manifest.json")
    if os.path.exists(path):
        return FileResponse(path, media_type="application/manifest+json")
    raise HTTPException(404, "manifest.json topilmadi")


# ============================================
# ⚡ WEBSOCKET — REAL-TIME
# ============================================

WS_TIMEOUT = 60   # sekund

@app.websocket("/ws/{store_id}")
async def websocket_endpoint(websocket: WebSocket, store_id: int):
    """
    Real-time kanal — har bir do'kon uchun.

    Ulanish:
        const ws = new WebSocket(`wss://domain/ws/${storeId}?token=${jwt_token}`)

    Client → Server:
        "ping"   → server "pong" javob beradi
    """
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Token kerak")
        return

    try:
        payload = decode_ws_token(token, store_id)
    except Exception as e:
        logger.warning(f"[WS] Store {store_id} — token xato: {e}")
        await websocket.close(code=4003, reason="Token noto'g'ri")
        return

    employee_id   = payload["employee_id"]
    employee_name = payload["full_name"]
    role          = payload["role"]

    conn = await ws_manager.connect(
        websocket     = websocket,
        store_id      = store_id,
        employee_id   = employee_id,
        employee_name = employee_name,
        role          = role,
    )

    await ws_manager.broadcast_except(
        store_id     = store_id,
        event        = WSEvent.EMPLOYEE_ACTIVITY,
        data         = {
            "employee_id":   employee_id,
            "employee_name": employee_name,
            "role":          role,
            "action":        "login",
            "timestamp":     conn.connected_at.isoformat(),
            "online_count":  ws_manager.get_connections_count(store_id),
        },
        exclude_conn = conn,
    )

    await ws_manager.send_personal(conn, WSEvent.CONNECTED, {
        "store_id":      store_id,
        "employee_id":   employee_id,
        "employee_name": employee_name,
        "role":          role,
        "online_count":  ws_manager.get_connections_count(store_id),
        "server_time":   now_tashkent().isoformat(),
    })

    try:
        while True:
            try:
                msg = await asyncio.wait_for(
                    websocket.receive_text(),
                    timeout=WS_TIMEOUT,
                )
                if msg == "ping":
                    await websocket.send_text("pong")
            except asyncio.TimeoutError:
                logger.info(f"[WS] Store {store_id} — {employee_name} timeout, yopildi")
                break
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.warning(f"[WS] Store {store_id} — {employee_name} kutilmagan xato: {e}")
    finally:
        await ws_manager.disconnect(conn, store_id)
        await ws_manager.broadcast(
            store_id = store_id,
            event    = WSEvent.EMPLOYEE_ACTIVITY,
            data     = {
                "employee_id":   employee_id,
                "employee_name": employee_name,
                "role":          role,
                "action":        "logout",
                "timestamp":     now_tashkent().isoformat(),
                "online_count":  ws_manager.get_connections_count(store_id),
            },
        )


# ============================================
# API ROUTERS
# ============================================

app.include_router(auth.router)
app.include_router(products.router,      prefix="/api/products",      tags=["Products"])
app.include_router(sales.router,         prefix="/api/sales",         tags=["Sales"])
app.include_router(customers.router,     prefix="/api/customers",     tags=["Customers"])
app.include_router(reports.router,       prefix="/api/reports",       tags=["Reports"])
app.include_router(suppliers.router,     prefix="/api/suppliers",     tags=["Suppliers"])
app.include_router(subscriptions.router, prefix="/api/subscriptions", tags=["Subscriptions"])
app.include_router(superadmin.router,    prefix="/api/superadmin",    tags=["Superadmin"])
app.include_router(employees.router,     prefix="/api/employees",     tags=["Employees"])
app.include_router(stores.router,        prefix="/api/stores",        tags=["Stores"])
app.include_router(ai_scan.router,       prefix="/api/ai",            tags=["AI Scan"])


# ============================================
# FRONTEND PAGES
# ============================================

def _page(template: str):
    async def _handler(request: Request):
        return templates.TemplateResponse(template, {"request": request})
    return _handler

app.get("/",                        response_class=HTMLResponse)(_page("index.html"))
app.get("/login",                   response_class=HTMLResponse)(_page("login.html"))
app.get("/register",                response_class=HTMLResponse)(_page("register.html"))
app.get("/pos",                     response_class=HTMLResponse)(_page("pos.html"))
app.get("/sales/history",           response_class=HTMLResponse)(_page("sales_history.html"))
app.get("/sales",                   response_class=HTMLResponse)(_page("sales_history.html"))  # menyu shu manzilga olib boradi
app.get("/products",                response_class=HTMLResponse)(_page("inventory.html"))
app.get("/products/add",            response_class=HTMLResponse)(_page("add_product.html"))
app.get("/products/supply-history", response_class=HTMLResponse)(_page("supply_history.html"))
app.get("/reports",                 response_class=HTMLResponse)(_page("reports.html"))
app.get("/settings",                response_class=HTMLResponse)(_page("settings.html"))
app.get("/customers",               response_class=HTMLResponse)(_page("customers.html"))

@app.get("/ai-scan", response_class=HTMLResponse)
async def page_ai_scan(request: Request):
    return templates.TemplateResponse("ai_scan.html", {"request": request})

app.get("/ai-scan/confirm", response_class=HTMLResponse)(_page("ai_scan_confirm.html"))

@app.get("/products/edit/{product_id}", response_class=HTMLResponse)
async def page_edit_product(request: Request, product_id: int):
    return templates.TemplateResponse("add_product.html", {"request": request, "product_id": product_id})

app.get("/superadmin",          response_class=HTMLResponse)(_page("superadmin_dashboard.html"))
app.get("/superadmin/requests", response_class=HTMLResponse)(_page("superadmin_requests.html"))
app.get("/superadmin/stores",   response_class=HTMLResponse)(_page("superadmin_stores.html"))


# ============================================
# HEALTH CHECK
# ============================================

@app.get("/health")
async def health_check():
    return {
        "status":      "healthy",
        "system":      "NovaPOS",
        "version":     "2.2.0",
        "environment": ENVIRONMENT,
        "server_time": now_tashkent().isoformat(),
        "timezone":    "Asia/Tashkent (UTC+5)",
        "database":    check_db_health(),
        "websocket": {
            "total_connections": ws_manager.total_connections,
            "rooms":             ws_manager.get_all_stats(),
        },
    }

@app.get("/api/health")
async def api_health():
    return {
        "status":      "ok",
        "message":     "NovaPOS ishlamoqda",
        "server_time": now_tashkent().isoformat(),
    }


# ============================================
# RUN (dev)
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host      = "0.0.0.0",
        port      = 8000,
        reload    = True,
        log_level = "info",
    )