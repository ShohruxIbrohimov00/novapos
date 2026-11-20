"""Server: sog'liq, sahifalar, eski manzillar, PWA fayllari, brauzer xatolari."""
import pytest


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


def test_security_headers(client):
    h = client.get("/health").headers
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "SAMEORIGIN"


@pytest.mark.parametrize("old,new", [
    ("/login", "/app/login"), ("/register", "/app/register"), ("/pos", "/app/pos"),
    ("/sales", "/app/sales"), ("/sales/history", "/app/sales"), ("/products", "/app/products"),
    ("/products/add", "/app/products/new"), ("/products/edit/5", "/app/products/5"),
    ("/products/supply-history", "/app/products/supply-history"), ("/reports", "/app/reports"),
    ("/settings", "/app/settings"), ("/customers", "/app/customers"), ("/ai-scan", "/app/products/ai"),
    ("/superadmin", "/app/superadmin"), ("/superadmin/stores", "/app/superadmin/stores"),
])
def test_old_urls_redirect(client, old, new):
    r = client.get(old, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == new


@pytest.mark.parametrize("path", ["/app", "/app/", "/app/pos", "/app/products/12", "/app/anything/deep"])
def test_react_app_served(client, path):
    r = client.get(path)
    assert r.status_code == 200
    assert '<div id="root">' in r.text
    assert r.headers["cache-control"] == "no-cache"


def test_app_has_version_meta(client):
    assert 'name="app-version"' in client.get("/app/").text


def test_version_json_matches_index(client):
    import re
    html = client.get("/app/").text
    v = re.search(r'name="app-version" content="([^"]+)"', html).group(1)
    data = client.get("/static/app/version.json").json()
    assert data["version"] == v
    for a in data["assets"]:
        assert client.get(a).status_code == 200, a
        assert a in html or a.endswith(".js") or a.endswith(".css")


def test_service_worker(client):
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    assert r.headers["cache-control"] == "no-cache"


def test_manifest(client):
    assert client.get("/manifest.json").status_code == 200


def test_client_error_report(client, caplog):
    import logging
    with caplog.at_level(logging.WARNING, logger="novapos.client"):
        r = client.post("/api/client-errors", json={"message": "TypeError: boom", "url": "/app/pos", "version": "abc"})
    assert r.status_code == 204
    assert "TypeError: boom" in caplog.text


def test_client_error_report_limits_size(client):
    r = client.post("/api/client-errors", json={"message": "x" * 501})
    assert r.status_code == 422


def test_unknown_api_404(client):
    assert client.get("/api/does-not-exist").status_code == 404
