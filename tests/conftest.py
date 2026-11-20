"""
NovaPOS backend testlari — umumiy sozlamalar.

Har test sessiyasi vaqtinchalik SQLite bazada ishlaydi (haqiqiy bazaga tegmaydi).
Har test o'z do'konini ro'yxatdan o'tkazadi — testlar bir-biriga ta'sir qilmaydi.

Ishga tushirish (repo ildizidan):
    pip install -r requirements.txt -r requirements-dev.txt
    pytest
"""
import os
import tempfile
import uuid

import pytest

# ⚠️ app import qilinishidan OLDIN — app.database / app.dependencies import paytida o'qiydi
_TMP = tempfile.mkdtemp(prefix="novapos-test-")
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["SECRET_KEY"] = "test-secret-key-0123456789abcdef0123456789abcdef"
os.environ["SUPERADMIN_USERNAME"] = "superadmin"
os.environ["SUPERADMIN_PASSWORD"] = "Super12345"
os.environ.pop("GEMINI_API_KEY", None)

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app import crud, models  # noqa: E402

# Testlarda bcrypt sekin bo'lmasin (haqiqiy serverda o'zgarmaydi)
crud.pwd_context.update(bcrypt__rounds=4)


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:   # lifespan: init_db + superadmin
        yield c


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.close()


def _uid() -> str:
    return uuid.uuid4().hex[:10]


class Api:
    """Token bilan so'rov yuboruvchi kichik yordamchi."""

    def __init__(self, client: TestClient, token: str, info: dict):
        self.c = client
        self.token = token
        self.info = info
        self.h = {"Authorization": f"Bearer {token}"}

    @property
    def store_id(self) -> int:
        return self.info["store_id"]

    def get(self, url, **kw):
        return self.c.get(url, headers=self.h, **kw)

    def post(self, url, json=None, **kw):
        return self.c.post(url, headers=self.h, json=json, **kw)

    def put(self, url, json=None, **kw):
        return self.c.put(url, headers=self.h, json=json, **kw)

    def patch(self, url, json=None, **kw):
        return self.c.patch(url, headers=self.h, json=json, **kw)

    def delete(self, url, **kw):
        return self.c.delete(url, headers=self.h, **kw)

    # ── Tez-tez kerak bo'ladigan amallar ──
    def product(self, **kw) -> dict:
        data = {"name": f"Tovar {_uid()}", "price_in": 1000, "price_out": 1500, "quantity": 10, **kw}
        r = self.post("/api/products/", data)
        assert r.status_code in (200, 201), r.text
        return r.json()

    def customer(self, **kw) -> dict:
        data = {"full_name": f"Mijoz {_uid()}", "phone": f"+99890{uuid.uuid4().int % 10**7:07d}", **kw}
        r = self.post("/api/customers/", data)
        assert r.status_code == 201, r.text
        return r.json()

    def sell(self, items, payment_method="naqd", paid=None, expect=200, **kw):
        """items: [(product, qty)] yoki [(product, qty, {qo'shimcha})]"""
        lines = []
        total = 0.0
        for it in items:
            p, q = it[0], it[1]
            extra = it[2] if len(it) > 2 else {}
            lines.append({"product_id": p["id"], "quantity": q, **extra})
            total += q * extra.get("price_out", p["price_out"])
        body = {
            "store_id": self.store_id, "items": lines, "payment_method": payment_method,
            "paid_amount": total if paid is None else paid, **kw,
        }
        r = self.post("/api/sales/checkout", body)
        assert r.status_code == expect, r.text
        return r.json()

    def employee(self, role="sotuvchi", **kw) -> "Api":
        """Shu do'konga xodim qo'shib, uning nomidan kirilgan Api qaytaradi."""
        username = f"emp{_uid()}"
        data = {"full_name": "Kassir Test", "username": username, "password": "pass1234",
                "pin_code": "1234", "role": role, **kw}
        r = self.post("/api/employees/", data)
        assert r.status_code == 201, r.text
        return login(self.c, username, "pass1234")


def login(client: TestClient, username: str, password: str) -> Api:
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    d = r.json()
    return Api(client, d["access_token"], d["user_info"])


def register(client: TestClient, **kw) -> Api:
    username = kw.pop("username", f"owner{_uid()}")
    data = {"store_name": f"Do'kon {_uid()}", "full_name": "Egasi Test", "username": username,
            "password": "pass1234", "pin_code": "1234", **kw}
    r = client.post("/api/auth/register-store", json=data)
    assert r.status_code == 200, r.text
    d = r.json()
    return Api(client, d["access_token"], d["user_info"])


@pytest.fixture
def owner(client) -> Api:
    """Yangi do'kon egasi (admin), 30 kunlik sinov davri."""
    return register(client)


@pytest.fixture
def other_owner(client) -> Api:
    """Boshqa do'kon — ma'lumotlar ajratilganini tekshirish uchun."""
    return register(client)


@pytest.fixture
def cashier(owner) -> Api:
    return owner.employee("sotuvchi")


@pytest.fixture
def superadmin(client) -> Api:
    return login(client, "superadmin", "Super12345")


@pytest.fixture
def expire_store(db):
    """Do'kon obunasini o'tib ketgan qilib qo'yish."""
    from datetime import timedelta
    from app.timezone_utils import now_tashkent

    def _expire(store_id: int, status: str = "expired"):
        s = db.get(models.Store, store_id)
        s.subscription_expires_at = now_tashkent().replace(tzinfo=None) - timedelta(days=1)
        s.payment_status = status
        db.commit()
    return _expire
