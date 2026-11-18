"""
NovaPOS — Database Configuration v2.1
=======================================
Tuzatilgan:
  ✅ SQLite + PostgreSQL universal
  ✅ WAL mode (SQLite parallel read)
  ✅ Connection pool (PostgreSQL)
  ✅ Auto migration — yangi ustunlar (returned_quantity, supply_type)
  ✅ Toshkent timezone (UTC+5) — barcha now() larda
  ✅ check_db_health — health endpoint uchun
"""

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import NullPool, QueuePool
from contextlib import contextmanager
from typing import Generator
from datetime import timedelta
import os
import logging

from app.timezone_utils import now_tashkent

logging.basicConfig(
    level  = logging.INFO,
    format = "%(asctime)s — %(name)s — %(levelname)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./novapos.db")
SQL_ECHO     = os.getenv("SQL_ECHO",    "false").lower() == "true"
ENVIRONMENT  = os.getenv("ENVIRONMENT", "development")
IS_SQLITE    = "sqlite" in DATABASE_URL.lower()

# ─── Engine ───────────────────────────────────────────────────
if IS_SQLITE:
    engine = create_engine(
        DATABASE_URL,
        echo         = SQL_ECHO,
        connect_args = {"check_same_thread": False},
        poolclass    = NullPool,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        echo          = SQL_ECHO,
        poolclass     = QueuePool,
        pool_size     = 10,
        max_overflow  = 20,
        pool_timeout  = 30,
        pool_recycle  = 3600,
        pool_pre_ping = True,
    )

SessionLocal = sessionmaker(
    autocommit       = False,
    autoflush        = False,
    bind             = engine,
    expire_on_commit = False,
)


# ─── SQLite pragma ────────────────────────────────────────────
@event.listens_for(engine, "connect")
def _configure_connection(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    try:
        if IS_SQLITE:
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.execute("PRAGMA cache_size=10000")
            cur.execute("PRAGMA temp_store=MEMORY")
        else:
            # PostgreSQL — server timezone ni o'rnatish
            cur.execute("SET timezone = 'Asia/Tashkent'")
    except Exception as e:
        logger.warning(f"Connection config: {e}")
    finally:
        cur.close()


# ─── Dependency ───────────────────────────────────────────────
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    except Exception as e:
        logger.error(f"DB session error: {e}")
        db.rollback()
        raise
    finally:
        db.close()


@contextmanager
def get_db_context():
    """Background task va script uchun context manager"""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ============================================================
# AUTO MIGRATION — SQLite uchun
# ============================================================

def _auto_migrate_sqlite():
    if not IS_SQLITE:
        return

    import sqlite3

    db_file = DATABASE_URL.replace("sqlite:///", "").replace("sqlite://", "")
    if db_file.startswith("./"):
        db_file = db_file[2:]
    if not os.path.exists(db_file):
        return

    logger.info("SQLite migration tekshirilmoqda...")

    # (jadval, ustun, tip, default)
    NEEDED_COLUMNS = [
        # stores
        ("stores",    "phone",                   "VARCHAR(20)",  "NULL"),
        ("stores",    "address",                 "VARCHAR(255)", "NULL"),
        ("stores",    "payment_status",          "VARCHAR(20)",  "'active'"),
        ("stores",    "updated_at",              "DATETIME",     "NULL"),
        # employees
        ("employees", "last_seen_at",            "DATETIME",     "NULL"),
        ("employees", "device_id",               "VARCHAR(255)", "NULL"),
        # products
        ("products",  "short_code",              "VARCHAR(20)",  "NULL"),
        ("products",  "sku",                     "VARCHAR(50)",  "NULL"),
        ("products",  "min_stock_limit",         "FLOAT",        "2.0"),
        ("products",  "max_stock_limit",         "FLOAT",        "NULL"),
        ("products",  "unit_type",               "VARCHAR(20)",  "'dona'"),
        ("products",  "description",             "TEXT",         "NULL"),
        ("products",  "image_url",               "VARCHAR(500)", "NULL"),
        ("products",  "is_deleted",              "BOOLEAN",      "0"),
        ("products",  "updated_at",              "DATETIME",     "NULL"),
        # sales
        ("sales",     "total_cost",              "FLOAT",        "0.0"),
        ("sales",     "total_profit",            "FLOAT",        "0.0"),
        ("sales",     "change_amount",           "FLOAT",        "0.0"),
        ("sales",     "receipt_number",          "VARCHAR(50)",  "NULL"),
        ("sales",     "is_cancelled",            "BOOLEAN",      "0"),
        ("sales",     "cancelled_by",            "INTEGER",      "NULL"),
        ("sales",     "notes",                   "TEXT",         "NULL"),
        # sale_items — ✅ YANGI: returned_quantity
        ("sale_items","product_name",            "VARCHAR(255)", "''"),
        ("sale_items","barcode",                 "VARCHAR(100)", "NULL"),
        ("sale_items","cost_price",              "FLOAT",        "0.0"),
        ("sale_items","discount_percent",        "FLOAT",        "0.0"),
        ("sale_items","discount_amount",         "FLOAT",        "0.0"),
        ("sale_items","subtotal",                "FLOAT",        "0.0"),
        ("sale_items","final_amount",            "FLOAT",        "0.0"),
        ("sale_items","item_profit",             "FLOAT",        "0.0"),
        ("sale_items","returned_quantity",       "FLOAT",        "0.0"),   # ← YANGI
        # customers
        ("customers", "total_debt_given",        "FLOAT",        "0.0"),
        ("customers", "total_debt_paid",         "FLOAT",        "0.0"),
        ("customers", "notes",                   "TEXT",         "NULL"),
        ("customers", "last_purchase_date",      "DATETIME",     "NULL"),
        ("customers", "address",                 "VARCHAR(255)", "NULL"),
        # suppliers
        ("suppliers", "total_supplied",          "FLOAT",        "0.0"),
        ("suppliers", "total_paid",              "FLOAT",        "0.0"),
        ("suppliers", "notes",                   "TEXT",         "NULL"),
        ("suppliers", "address",                 "VARCHAR(255)", "NULL"),
        # supply_batches — ✅ YANGI: supply_type, notes
        ("supply_batches", "store_id",           "INTEGER",      "NULL"),
        ("supply_batches", "price_out",          "FLOAT",        "NULL"),
        ("supply_batches", "supply_type",        "VARCHAR(20)",  "'restock'"),  # ← YANGI
        ("supply_batches", "notes",              "TEXT",         "NULL"),       # ← YANGI
        # stock_adjustments
        ("stock_adjustments", "store_id",        "INTEGER",      "NULL"),
        ("stock_adjustments", "notes",           "TEXT",         "NULL"),
        # sale_returns
        ("sale_returns", "product_name",         "VARCHAR(255)", "''"),
        ("sale_returns", "employee_name",        "VARCHAR(255)", "NULL"),
        # expenses
        ("expenses",  "created_by",              "INTEGER",      "NULL"),
        # subscription_requests
        ("subscription_requests", "tarif_id",    "INTEGER",      "NULL"),
        ("subscription_requests", "reviewed_at", "DATETIME",     "NULL"),
        ("subscription_requests", "admin_note",  "TEXT",         "NULL"),
    ]

    NEW_TABLES = {
        "categories": """
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                name VARCHAR(100) NOT NULL,
                description TEXT,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
        "supply_batches": """
            CREATE TABLE IF NOT EXISTS supply_batches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER,
                product_id INTEGER NOT NULL,
                supplier_id INTEGER,
                supply_type VARCHAR(20) DEFAULT 'restock',
                quantity_received FLOAT NOT NULL DEFAULT 0.0,
                supply_price FLOAT NOT NULL DEFAULT 0.0,
                price_out FLOAT,
                total_cost FLOAT NOT NULL DEFAULT 0.0,
                is_paid BOOLEAN DEFAULT 1,
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER
            )""",
        "debt_payments": """
            CREATE TABLE IF NOT EXISTS debt_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id INTEGER NOT NULL,
                sale_id INTEGER,
                amount FLOAT NOT NULL,
                payment_method VARCHAR(20) NOT NULL DEFAULT 'naqd',
                payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                received_by INTEGER,
                comment VARCHAR(255)
            )""",
        "supplier_payments": """
            CREATE TABLE IF NOT EXISTS supplier_payments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                supplier_id INTEGER NOT NULL,
                amount FLOAT NOT NULL,
                payment_method VARCHAR(20) NOT NULL DEFAULT 'naqd',
                payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                paid_by INTEGER,
                comment VARCHAR(255)
            )""",
        "sale_returns": """
            CREATE TABLE IF NOT EXISTS sale_returns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sale_id INTEGER NOT NULL,
                product_id INTEGER,
                product_name VARCHAR(255) DEFAULT '',
                quantity FLOAT NOT NULL,
                refund_amount FLOAT NOT NULL DEFAULT 0.0,
                reason VARCHAR(255),
                employee_id INTEGER,
                employee_name VARCHAR(255),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
        "stock_adjustments": """
            CREATE TABLE IF NOT EXISTS stock_adjustments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER,
                product_id INTEGER NOT NULL,
                old_quantity FLOAT NOT NULL,
                new_quantity FLOAT NOT NULL,
                difference FLOAT NOT NULL,
                reason VARCHAR(255),
                notes TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER
            )""",
        "expenses": """
            CREATE TABLE IF NOT EXISTS expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                amount FLOAT NOT NULL,
                category VARCHAR(100) NOT NULL,
                notes TEXT,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
        "tarifs": """
            CREATE TABLE IF NOT EXISTS tarifs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL,
                months INTEGER NOT NULL DEFAULT 1,
                price FLOAT NOT NULL DEFAULT 0.0,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
        "subscription_requests": """
            CREATE TABLE IF NOT EXISTS subscription_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                employee_id INTEGER NOT NULL,
                tarif_id INTEGER,
                amount FLOAT NOT NULL DEFAULT 0.0,
                plan_months INTEGER DEFAULT 1,
                proof_image_url VARCHAR(500) DEFAULT '',
                status VARCHAR(20) DEFAULT 'pending',
                admin_note TEXT,
                reviewed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
        "ai_product_scans": """
            CREATE TABLE IF NOT EXISTS ai_product_scans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                store_id INTEGER NOT NULL,
                employee_id INTEGER,
                image_url VARCHAR(500),
                raw_response TEXT,
                products_found INTEGER DEFAULT 0,
                products_added INTEGER DEFAULT 0,
                status VARCHAR(20) DEFAULT 'pending',
                error_message TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
        "system_settings": """
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_number VARCHAR(50) DEFAULT '8600 0000 0000 0000',
                card_owner VARCHAR(100) DEFAULT 'NOVAPOS ADMIN',
                support_phone VARCHAR(20) DEFAULT '+998597551023',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )""",
    }

    conn = sqlite3.connect(db_file)
    conn.execute("PRAGMA foreign_keys=OFF")
    cur = conn.cursor()

    # Mavjud jadvallar
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    existing_tables = {r[0] for r in cur.fetchall()}

    # 1. Yangi jadvallar
    for tname, sql in NEW_TABLES.items():
        if tname not in existing_tables:
            cur.execute(sql)
            logger.info(f"  ✚ jadval yaratildi: {tname}")

    # 2. Yangi ustunlar
    for table, col, typ, default in NEEDED_COLUMNS:
        if table not in existing_tables:
            continue
        cur.execute(f"PRAGMA table_info({table})")
        cols = {r[1] for r in cur.fetchall()}
        if col not in cols:
            sql = f"ALTER TABLE {table} ADD COLUMN {col} {typ}"
            if default != "NULL":
                sql += f" DEFAULT {default}"
            try:
                cur.execute(sql)
                logger.info(f"  ✚ ustun qo'shildi: {table}.{col}")
            except Exception as e:
                logger.warning(f"  ⚠ {table}.{col}: {e}")

    # 3. NULL larni to'ldirish
    _safe_updates = [
        "UPDATE stores    SET payment_status='active' WHERE payment_status IS NULL",
        "UPDATE products  SET is_deleted=0            WHERE is_deleted IS NULL",
        "UPDATE products  SET min_stock_limit=2.0     WHERE min_stock_limit IS NULL",
        "UPDATE products  SET unit_type='dona'        WHERE unit_type IS NULL",
        "UPDATE sales     SET is_cancelled=0          WHERE is_cancelled IS NULL",
        "UPDATE sales     SET total_cost=0.0          WHERE total_cost IS NULL",
        "UPDATE sales     SET total_profit=0.0        WHERE total_profit IS NULL",
        "UPDATE sales     SET change_amount=0.0       WHERE change_amount IS NULL",
        "UPDATE customers SET total_debt_given=0.0    WHERE total_debt_given IS NULL",
        "UPDATE customers SET total_debt_paid=0.0     WHERE total_debt_paid IS NULL",
        "UPDATE suppliers SET total_supplied=0.0      WHERE total_supplied IS NULL",
        "UPDATE suppliers SET total_paid=0.0          WHERE total_paid IS NULL",
        # ✅ Eski sale_items uchun returned_quantity = 0
        "UPDATE sale_items SET returned_quantity=0.0  WHERE returned_quantity IS NULL",
        # ✅ Eski supply_batches uchun supply_type = restock
        "UPDATE supply_batches SET supply_type='restock' WHERE supply_type IS NULL",
    ]
    for sql in _safe_updates:
        try:
            cur.execute(sql)
        except Exception:
            pass

    # 4. receipt_number ni to'ldirish
    try:
        cur.execute("SELECT id FROM sales WHERE receipt_number IS NULL LIMIT 5000")
        for (sid,) in cur.fetchall():
            cur.execute(
                "UPDATE sales SET receipt_number=? WHERE id=?",
                (f"CH-{sid:08d}", sid),
            )
    except Exception:
        pass

    conn.commit()
    conn.execute("PRAGMA foreign_keys=ON")
    conn.close()
    logger.info("✅ Migration tugadi")


# ============================================================
# INIT DB
# ============================================================

def init_db():
    try:
        _auto_migrate_sqlite()

        from app.models import Base
        logger.info("Jadvallar yaratilmoqda...")
        Base.metadata.create_all(bind=engine)
        logger.info("✅ Baza tayyor!")

    except Exception as e:
        logger.error(f"❌ init_db xato: {e}")
        raise


def check_db_health() -> dict:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {
            "status": "healthy",
            "type":   "sqlite" if IS_SQLITE else "postgresql",
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}