"""Ta'minotchilar va ularga qarz."""


def _sup(owner, **kw):
    r = owner.post("/api/suppliers/", {"name": "Ulgurji baza", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_list_get(owner):
    s = _sup(owner, phone="+998901234567")
    assert any(x["id"] == s["id"] for x in owner.get("/api/suppliers/").json())
    assert owner.get(f"/api/suppliers/{s['id']}").json()["phone"] == "+998901234567"


def test_update(owner):
    s = _sup(owner)
    assert owner.patch(f"/api/suppliers/{s['id']}", {"name": "Yangi baza"}).status_code == 200
    assert owner.get(f"/api/suppliers/{s['id']}").json()["name"] == "Yangi baza"


def test_receive_goods_on_credit_and_pay(owner):
    s = _sup(owner)
    r = owner.post("/api/suppliers/receive-goods", {"supplier_id": s["id"], "amount": 100000})
    assert r.status_code == 200, r.text
    assert owner.get(f"/api/suppliers/{s['id']}").json()["current_debt"] == 100000
    r = owner.post("/api/suppliers/payment", {"supplier_id": s["id"], "amount": 40000})
    assert r.status_code == 200, r.text
    got = owner.get(f"/api/suppliers/{s['id']}").json()
    assert got["current_debt"] == 60000
    assert got["total_paid"] == 40000


def test_overpay_supplier_rejected(owner):
    s = _sup(owner)
    owner.post("/api/suppliers/receive-goods", {"supplier_id": s["id"], "amount": 1000})
    assert owner.post("/api/suppliers/payment", {"supplier_id": s["id"], "amount": 5000}).status_code == 400


def test_history(owner):
    s = _sup(owner)
    owner.post("/api/suppliers/receive-goods", {"supplier_id": s["id"], "amount": 1000})
    assert owner.get(f"/api/suppliers/{s['id']}/history").status_code == 200


def test_delete(owner):
    s = _sup(owner)
    assert owner.delete(f"/api/suppliers/{s['id']}").status_code == 200


def test_unknown_404(owner):
    assert owner.get("/api/suppliers/99999999").status_code == 404
