"""Mijozlar va nasiya qarzi."""


def test_create_and_get(owner):
    c = owner.customer(full_name="Ali Valiyev")
    got = owner.get(f"/api/customers/{c['id']}").json()
    assert got["full_name"] == "Ali Valiyev"
    assert got["current_debt"] == 0


def test_list(owner):
    c = owner.customer()
    rows = owner.get("/api/customers/").json()
    assert any(x["id"] == c["id"] for x in rows)


def test_search_by_name_and_phone(owner):
    c = owner.customer(full_name="Zarina Qidiruv", phone="+998901112233")
    assert any(x["id"] == c["id"] for x in owner.get("/api/customers/search", params={"q": "Zarina"}).json())
    assert any(x["id"] == c["id"] for x in owner.get("/api/customers/search", params={"q": "1112233"}).json())


def test_search_requires_query(owner):
    assert owner.get("/api/customers/search", params={"q": ""}).status_code == 422


def test_update(owner):
    c = owner.customer()
    r = owner.patch(f"/api/customers/{c['id']}", {"full_name": "Yangi Ism", "address": "Chilonzor"})
    assert r.status_code == 200
    assert owner.get(f"/api/customers/{c['id']}").json()["address"] == "Chilonzor"


def _debt(owner, c, amount):
    p = owner.product(price_out=amount, price_in=1)
    owner.sell([(p, 1)], payment_method="nasiya", paid=0, customer_id=c["id"])


def test_debt_payment(owner):
    c = owner.customer()
    _debt(owner, c, 50000)
    r = owner.post("/api/customers/payment", {"customer_id": c["id"], "amount": 20000})
    assert r.status_code == 200, r.text
    got = owner.get(f"/api/customers/{c['id']}").json()
    assert got["current_debt"] == 30000
    assert got["total_debt_paid"] == 20000


def test_debt_overpayment_rejected(owner):
    c = owner.customer()
    _debt(owner, c, 10000)
    r = owner.post("/api/customers/payment", {"customer_id": c["id"], "amount": 20000})
    assert r.status_code == 400
    assert owner.get(f"/api/customers/{c['id']}").json()["current_debt"] == 10000


def test_debt_payment_zero_rejected(owner):
    c = owner.customer()
    assert owner.post("/api/customers/payment", {"customer_id": c["id"], "amount": 0}).status_code == 422


def test_debtors_list(owner):
    c = owner.customer()
    clean = owner.customer()
    _debt(owner, c, 7000)
    ids = [x["id"] for x in owner.get("/api/customers/debtors").json()]
    assert c["id"] in ids and clean["id"] not in ids


def test_history(owner):
    c = owner.customer()
    _debt(owner, c, 9000)
    owner.post("/api/customers/payment", {"customer_id": c["id"], "amount": 4000})
    r = owner.get(f"/api/customers/{c['id']}/history")
    assert r.status_code == 200


def test_delete_customer_without_debt(owner):
    c = owner.customer()
    assert owner.delete(f"/api/customers/{c['id']}").status_code == 200


def test_cannot_delete_customer_with_debt(owner):
    c = owner.customer()
    _debt(owner, c, 5000)
    r = owner.delete(f"/api/customers/{c['id']}")
    assert r.status_code == 400
    assert "qarz" in r.json()["detail"]


def test_cashier_cannot_delete_customer(owner, cashier):
    c = owner.customer()
    assert cashier.delete(f"/api/customers/{c['id']}").status_code == 403


def test_cashier_can_create_customer_and_take_payment(owner, cashier):
    c = cashier.customer()
    _debt(owner, c, 3000)
    assert cashier.post("/api/customers/payment", {"customer_id": c["id"], "amount": 3000}).status_code == 200


def test_unknown_customer_404(owner):
    assert owner.get("/api/customers/99999999").status_code == 404
