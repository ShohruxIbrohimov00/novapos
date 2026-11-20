"""Superadmin: do'konlar, tariflar, uzaytirish, support rejimi."""
import uuid

import pytest


def test_stats(superadmin):
    r = superadmin.get("/api/superadmin/stats")
    assert r.status_code == 200


def test_stores_list_contains_new_store(superadmin, owner):
    rows = superadmin.get("/api/superadmin/stores").json()
    assert any(s["id"] == owner.store_id for s in rows)


def test_store_detail_and_employees(superadmin, owner):
    assert superadmin.get(f"/api/superadmin/stores/{owner.store_id}").status_code == 200
    emps = superadmin.get(f"/api/superadmin/stores/{owner.store_id}/employees").json()
    assert any(e["username"] == owner.info["username"] for e in emps)


def test_extend_store(superadmin, owner, expire_store):
    expire_store(owner.store_id)
    r = superadmin.post(f"/api/superadmin/stores/{owner.store_id}/extend", {"months": 2})
    assert r.status_code == 200
    assert owner.get("/api/products/").status_code == 200


def test_extend_requires_positive_months(superadmin, owner):
    assert superadmin.post(f"/api/superadmin/stores/{owner.store_id}/extend", {"months": 0}).status_code == 400


def test_toggle_store(superadmin, owner):
    assert superadmin.patch(f"/api/superadmin/stores/{owner.store_id}/toggle").status_code == 200
    assert owner.get("/api/products/").status_code == 403
    superadmin.patch(f"/api/superadmin/stores/{owner.store_id}/toggle")
    assert owner.get("/api/products/").status_code == 200


def test_login_as_store(superadmin, owner):
    r = superadmin.post(f"/api/superadmin/login-as-store/{owner.store_id}")
    assert r.status_code == 200
    d = r.json()
    assert d["user_info"]["store_id"] == owner.store_id
    assert d["user_info"]["impersonated"] is True
    h = {"Authorization": f"Bearer {d['access_token']}"}
    assert owner.c.get("/api/products/", headers=h).status_code == 200


def test_delete_empty_store(superadmin, client):
    from conftest import register
    s = register(client)
    assert superadmin.delete(f"/api/superadmin/stores/{s.store_id}").status_code == 200
    assert superadmin.get(f"/api/superadmin/stores/{s.store_id}").status_code == 404


def test_tarif_crud(superadmin):
    name = f"Tarif {uuid.uuid4().hex[:6]}"
    t = superadmin.post("/api/superadmin/tarifs", {"name": name, "months": 3, "price": 250000}).json()
    assert any(x["id"] == t["id"] for x in superadmin.get("/api/superadmin/tarifs").json())
    r = superadmin.patch(f"/api/superadmin/tarifs/{t['id']}", {"price": 240000})
    assert r.json()["price"] == 240000
    assert superadmin.delete(f"/api/superadmin/tarifs/{t['id']}").status_code == 200


@pytest.mark.parametrize("data", [
    {"name": "", "months": 1, "price": 1},
    {"name": "X", "months": 0, "price": 1},
    {"name": "X", "months": 1, "price": -5},
    {"name": "X", "months": "abc", "price": 1},
])
def test_tarif_validation(superadmin, data):
    assert superadmin.post("/api/superadmin/tarifs", data).status_code == 400


def test_tarif_duplicate_name(superadmin):
    name = f"Dup {uuid.uuid4().hex[:6]}"
    superadmin.post("/api/superadmin/tarifs", {"name": name, "months": 1, "price": 1})
    assert superadmin.post("/api/superadmin/tarifs", {"name": name, "months": 1, "price": 1}).status_code == 400


def test_payment_settings(superadmin, owner):
    r = superadmin.patch("/api/superadmin/settings/payment", {"card_number": "8600 1234 5678 9012", "card_holder": "Test"})
    assert r.status_code == 200, r.text
    assert "8600" in str(owner.get("/api/subscriptions/payment-settings").json())


def test_run_expiry_check(superadmin, owner, db):
    from datetime import timedelta
    from app import models
    from app.timezone_utils import now_tashkent
    s = db.get(models.Store, owner.store_id)
    s.subscription_expires_at = now_tashkent().replace(tzinfo=None) - timedelta(days=3)
    db.commit()
    assert superadmin.post("/api/superadmin/run-expiry-check").status_code == 200
    db.expire_all()
    assert db.get(models.Store, owner.store_id).payment_status == "expired"


def test_cashier_cannot_use_superadmin(cashier):
    assert cashier.get("/api/superadmin/stats").status_code == 403
    assert cashier.post("/api/superadmin/tarifs", {"name": "x", "months": 1, "price": 1}).status_code == 403


def test_delete_store_with_data(superadmin, client):
    """Savdosi, mijozi, ta'minotchisi bor do'konni o'chirish xatosiz bo'lishi kerak."""
    from conftest import register
    s = register(client)
    neighbour = register(client)
    np_ = neighbour.product()
    p = s.product()
    c = s.customer()
    s.sell([(p, 1)], payment_method="nasiya", paid=0, customer_id=c["id"])
    s.post("/api/reports/expenses", {"amount": 1000, "category": "x"})
    sup = s.post("/api/suppliers/", {"name": "T"}).json()
    s.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 1, "supply_price": 1,
                                             "is_paid": False, "supplier_id": sup["id"]})
    r = superadmin.delete(f"/api/superadmin/stores/{s.store_id}")
    assert r.status_code == 200, r.text
    assert superadmin.get(f"/api/superadmin/stores/{s.store_id}").status_code == 404
    assert neighbour.get(f"/api/products/{np_['id']}").status_code == 200   # qo'shni do'konga tegilmadi
