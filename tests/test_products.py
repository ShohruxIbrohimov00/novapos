"""Ombor: mahsulot, kategoriya, shtrix-kod/PLU, kirim, inventarizatsiya, ruxsatlar."""
import pytest

from conftest import _uid


def _list(api, **params):
    r = api.get("/api/products/", params=params)
    assert r.status_code == 200
    return r.json()


def test_create_product(owner):
    p = owner.product(name="Non", price_in=3000, price_out=4000, quantity=20)
    assert p["name"] == "Non"
    assert p["quantity"] == 20
    assert p["store_id"] == owner.store_id


def test_create_product_trims_and_requires_name(owner):
    r = owner.post("/api/products/", {"name": "   ", "price_in": 1, "price_out": 2})
    assert r.status_code == 400


@pytest.mark.parametrize("field", ["price_in", "price_out", "quantity"])
def test_create_product_negative_rejected(owner, field):
    data = {"name": "X", "price_in": 1, "price_out": 2, field: -1}
    assert owner.post("/api/products/", data).status_code == 422


def test_duplicate_barcode_rejected(owner):
    bc = f"478{_uid()[:9]}"
    owner.product(barcode=bc)
    r = owner.post("/api/products/", {"name": "Y", "price_in": 1, "price_out": 2, "barcode": bc})
    assert r.status_code == 400
    assert "band" in r.json()["detail"]


def test_same_barcode_allowed_in_different_stores(owner, other_owner):
    bc = f"478{_uid()[:9]}"
    owner.product(barcode=bc)
    other_owner.product(barcode=bc)


def test_duplicate_plu_rejected(owner):
    owner.product(short_code="77")
    r = owner.post("/api/products/", {"name": "Y", "price_in": 1, "price_out": 2, "short_code": "77"})
    assert r.status_code == 400


def test_scan_by_barcode_and_plu(owner):
    bc = f"478{_uid()[:9]}"
    p = owner.product(barcode=bc, short_code="12")
    assert owner.get(f"/api/products/scan/{bc}").json()["id"] == p["id"]
    assert owner.get("/api/products/scan/12").json()["id"] == p["id"]


def test_scan_unknown_404(owner):
    assert owner.get("/api/products/scan/0000000").status_code == 404


def test_scan_deleted_product_404(owner):
    bc = f"478{_uid()[:9]}"
    p = owner.product(barcode=bc)
    owner.delete(f"/api/products/{p['id']}")
    assert owner.get(f"/api/products/scan/{bc}").status_code == 404


def test_list_and_search(owner):
    owner.product(name="Olma qizil")
    owner.product(name="Banan")
    names = [p["name"] for p in _list(owner, search="olma")]
    assert names == ["Olma qizil"]


def test_list_low_mode(owner):
    low = owner.product(quantity=1, min_stock_limit=5)
    owner.product(quantity=50, min_stock_limit=5)
    ids = [p["id"] for p in _list(owner, mode="low")]
    assert ids == [low["id"]]


def test_low_stock_endpoint(owner):
    low = owner.product(quantity=0, min_stock_limit=2)
    ids = [p["id"] for p in owner.get("/api/products/low-stock/list").json()]
    assert low["id"] in ids


def test_update_product(owner):
    p = owner.product()
    r = owner.put(f"/api/products/{p['id']}", {"name": "Yangi nom", "price_out": 2000})
    assert r.status_code == 200, r.text
    got = owner.get(f"/api/products/{p['id']}").json()
    assert got["name"] == "Yangi nom" and got["price_out"] == 2000


def test_update_barcode_conflict(owner):
    bc = f"478{_uid()[:9]}"
    owner.product(barcode=bc)
    p = owner.product()
    assert owner.put(f"/api/products/{p['id']}", {"barcode": bc}).status_code == 400


def test_soft_delete_hides_from_list(owner):
    p = owner.product()
    assert owner.delete(f"/api/products/{p['id']}").status_code == 200
    assert all(x["id"] != p["id"] for x in _list(owner))


def test_deleted_product_sales_history_intact(owner):
    p = owner.product()
    sale = owner.sell([(p, 1)])
    owner.delete(f"/api/products/{p['id']}")
    d = owner.get(f"/api/sales/{sale['id']}").json()
    assert d["items"][0]["product_name"] == p["name"]


# ─── Kategoriyalar ────────────────────────────────────────────

def test_category_crud(owner):
    r = owner.post("/api/products/categories", {"name": "Ichimliklar"})
    assert r.status_code == 200, r.text
    cat = r.json()
    assert any(c["id"] == cat["id"] for c in owner.get("/api/products/categories").json())
    assert owner.delete(f"/api/products/categories/{cat['id']}").status_code == 204


def test_category_duplicate_rejected(owner):
    owner.post("/api/products/categories", {"name": "Sut"})
    assert owner.post("/api/products/categories", {"name": "Sut"}).status_code == 400


def test_category_empty_name_rejected(owner):
    assert owner.post("/api/products/categories", {"name": "  "}).status_code == 400


def test_filter_by_category(owner):
    cat = owner.post("/api/products/categories", {"name": "Shirinlik"}).json()
    a = owner.product(category_id=cat["id"])
    owner.product()
    ids = [p["id"] for p in _list(owner, category="Shirinlik")]
    assert ids == [a["id"]]
    assert a["id"] not in [p["id"] for p in _list(owner, category="Kategoriyasiz")]


def test_cannot_use_foreign_category(owner, other_owner):
    cat = other_owner.post("/api/products/categories", {"name": "Begona"}).json()
    r = owner.post("/api/products/", {"name": "X", "price_in": 1, "price_out": 2, "category_id": cat["id"]})
    assert r.status_code == 404


# ─── Kirim (supply) ───────────────────────────────────────────

def test_supply_increases_stock(owner):
    p = owner.product(quantity=5)
    r = owner.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 10, "supply_price": 900})
    assert r.status_code == 200, r.text
    assert r.json()["new_quantity"] == 15


def test_supply_on_credit_requires_supplier(owner):
    p = owner.product()
    r = owner.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 1,
                                                     "supply_price": 900, "is_paid": False})
    assert r.status_code == 400


def test_supply_on_credit_adds_supplier_debt(owner):
    p = owner.product()
    sup = owner.post("/api/suppliers/", {"name": "Ulgurji"}).json()
    owner.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 10,
                                                 "supply_price": 1000, "is_paid": False, "supplier_id": sup["id"]})
    assert owner.get(f"/api/suppliers/{sup['id']}").json()["current_debt"] == 10000


def test_supply_zero_quantity_rejected(owner):
    p = owner.product()
    r = owner.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 0, "supply_price": 1})
    assert r.status_code == 422


def test_supply_history(owner):
    p = owner.product()
    owner.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 3, "supply_price": 900})
    r = owner.get("/api/products/supply-history", params={"product_id": p["id"]})
    assert r.status_code == 200


def test_supply_history_bad_date(owner):
    assert owner.get("/api/products/supply-history", params={"start_date": "20-01-2025"}).status_code == 400


def test_cashier_can_receive_goods(owner, cashier):
    p = owner.product(quantity=1)
    r = cashier.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 4, "supply_price": 900})
    assert r.status_code == 200
    assert r.json()["new_quantity"] == 5


def test_cashier_cannot_change_price_on_supply(owner, cashier):
    p = owner.product(price_out=1500)
    r = cashier.post("/api/products/supply_batches", {"product_id": p["id"], "quantity_received": 1,
                                                       "supply_price": 900, "price_out": 9999})
    assert r.status_code == 403


# ─── Inventarizatsiya ─────────────────────────────────────────

def test_adjust_stock(owner):
    p = owner.product(quantity=10)
    r = owner.post(f"/api/products/{p['id']}/adjust-stock", params={"new_quantity": 7, "reason": "inventarizatsiya"})
    assert r.status_code == 200, r.text
    assert r.json()["difference"] == -3
    assert owner.get(f"/api/products/{p['id']}").json()["quantity"] == 7


def test_adjust_stock_negative_rejected(owner):
    p = owner.product()
    assert owner.post(f"/api/products/{p['id']}/adjust-stock", params={"new_quantity": -1}).status_code == 422


def test_bulk_update_limits(owner):
    p = owner.product(unit_type="kg", min_stock_limit=1)
    r = owner.post("/api/products/bulk-update-limits", params={"unit": "kg", "new_limit": 3})
    assert r.status_code == 200, r.text
    assert owner.get(f"/api/products/{p['id']}").json()["min_stock_limit"] == 3


# ─── Kassir ruxsatlari ────────────────────────────────────────

def test_cashier_cannot_delete_product(owner, cashier):
    p = owner.product()
    assert cashier.delete(f"/api/products/{p['id']}").status_code == 403


def test_cashier_cannot_adjust_stock(owner, cashier):
    p = owner.product()
    assert cashier.post(f"/api/products/{p['id']}/adjust-stock", params={"new_quantity": 0}).status_code == 403


def test_cashier_cannot_change_price(owner, cashier):
    p = owner.product()
    assert cashier.put(f"/api/products/{p['id']}", {"price_out": 1}).status_code == 403


def test_cashier_cannot_change_quantity(owner, cashier):
    p = owner.product()
    assert cashier.put(f"/api/products/{p['id']}", {"quantity": 1000}).status_code == 403


def test_cashier_cannot_delete_category(owner, cashier):
    cat = owner.post("/api/products/categories", {"name": "Kassirga emas"}).json()
    assert cashier.delete(f"/api/products/categories/{cat['id']}").status_code == 403


def test_cashier_cannot_bulk_update_limits(cashier):
    assert cashier.post("/api/products/bulk-update-limits", params={"unit": "kg", "new_limit": 3}).status_code == 403
