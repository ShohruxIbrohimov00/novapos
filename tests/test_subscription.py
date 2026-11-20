"""Obuna: muddati tugaganda bloklash, to'lov cheki, superadmin tasdig'i."""
import io

import pytest

from app.api import subscriptions as subs_api

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture
def tarif(superadmin):
    import uuid
    r = superadmin.post("/api/superadmin/tarifs", {"name": f"1 oy {uuid.uuid4().hex[:6]}", "months": 1, "price": 99000})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture(autouse=True)
def _tmp_uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(subs_api, "UPLOAD_DIR", str(tmp_path))


def _upload(api, tarif_id, content=PNG, ctype="image/png"):
    return api.c.post("/api/subscriptions/upload-proof", headers=api.h, data={"tarif_id": str(tarif_id)},
                      files={"file": ("chek.png", io.BytesIO(content), ctype)})


def test_trial_store_works(owner):
    assert owner.get("/api/products/").status_code == 200


def test_expired_store_gets_402(owner, expire_store):
    expire_store(owner.store_id)
    r = owner.get("/api/products/")
    assert r.status_code == 402
    assert r.json()["detail"]["code"] == "SUBSCRIPTION_EXPIRED"


def test_expired_store_can_still_pay(owner, expire_store, tarif):
    expire_store(owner.store_id)
    assert owner.get("/api/subscriptions/status").status_code == 200
    assert owner.get("/api/subscriptions/tarifs").status_code == 200
    assert owner.get("/api/stores/me").status_code == 200
    assert _upload(owner, tarif["id"]).status_code == 200


def test_upload_rejects_non_image(owner, tarif):
    assert _upload(owner, tarif["id"], content=b"<?php echo 1; ?>", ctype="image/png").status_code == 400


def test_upload_rejects_wrong_content_type(owner, tarif):
    assert _upload(owner, tarif["id"], ctype="application/pdf").status_code == 400


def test_upload_unknown_tarif(owner):
    assert _upload(owner, 99999999).status_code == 404


def test_full_payment_flow(owner, superadmin, expire_store, tarif):
    expire_store(owner.store_id)
    assert _upload(owner, tarif["id"]).status_code == 200
    r = owner.get("/api/products/")
    assert r.status_code == 402
    assert r.json()["detail"]["code"] == "SUBSCRIPTION_EXPIRED_PENDING"

    reqs = superadmin.get("/api/superadmin/requests").json()
    mine = [q for q in reqs if q["store_id"] == owner.store_id]
    assert mine, reqs
    assert superadmin.post(f"/api/superadmin/approve/{mine[0]['id']}").status_code == 200
    assert owner.get("/api/products/").status_code == 200
    assert owner.get("/api/subscriptions/status").json()["payment_status"] == "active"


def test_approve_twice_rejected(owner, superadmin, tarif):
    _upload(owner, tarif["id"])
    rid = [q for q in superadmin.get("/api/superadmin/requests").json() if q["store_id"] == owner.store_id][0]["id"]
    assert superadmin.post(f"/api/superadmin/approve/{rid}").status_code == 200
    assert superadmin.post(f"/api/superadmin/approve/{rid}").status_code == 400


def test_reject_keeps_store_expired(owner, superadmin, expire_store, tarif):
    expire_store(owner.store_id)
    _upload(owner, tarif["id"])
    rid = [q for q in superadmin.get("/api/superadmin/requests").json() if q["store_id"] == owner.store_id][0]["id"]
    assert superadmin.post(f"/api/superadmin/reject/{rid}").status_code == 200
    assert owner.get("/api/products/").status_code == 402
    assert owner.get("/api/subscriptions/status").json()["payment_status"] == "expired"


def test_blocked_store_403(owner, superadmin):
    superadmin.patch(f"/api/superadmin/stores/{owner.store_id}/toggle")
    assert owner.get("/api/products/").status_code == 403


def test_my_requests(owner, tarif):
    _upload(owner, tarif["id"])
    assert len(owner.get("/api/subscriptions/my-requests").json()) == 1
