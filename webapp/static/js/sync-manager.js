/**
 * NovaPOS — Sync Manager v5.0
 * ============================
 * WebSocket real-time + offline sync:
 *   ✅ WebSocket /ws/{store_id}?token=...
 *   ✅ Eventlar: stock_updated, sale_created, product_added/edited
 *   ✅ Auto-reconnect (exponential backoff, max 30s)
 *   ✅ Heartbeat ping/pong (25s interval)
 *   ✅ Offline → Online: queue + sales yuborish
 *   ✅ Background Sync (SW) + manual fallback
 *   ✅ Periodic sync (WS bo'lmasa, 3 daqiqada)
 *   ✅ IDB: products, customers, offline_sales, offline_queue
 */

const SyncManager = (() => {

  // ── Ichki holat ──────────────────────────────────────────
  let _online      = navigator.onLine;
  let _syncing     = false;
  let _ws          = null;
  let _wsReady     = false;
  let _reconnectMs = 1_000;       // boshlang'ich: 1s, max: 30s
  let _reconnectT  = null;
  let _pingT       = null;
  let _periodicT   = null;
  let _debounceT   = null;

  const MAX_RECONNECT  = 30_000;
  const PING_INTERVAL  = 25_000;  // 25s (server 30s timeout)
  const PERIODIC_MS    = 3 * 60_000; // 3 daqiqa
  const ONLINE_DEBOUNCE = 1_500;   // online bo'lgandan keyin kut

  // ── Online/Offline tinglash ───────────────────────────────
  window.addEventListener('online',  () => { _online = true;  _onOnline();  });
  window.addEventListener('offline', () => { _online = false; _onOffline(); });

  // ── SW xabarlari ─────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', ({ data }) => {
      if (data?.type === 'SALE_SYNCED' || data?.type === 'OP_SYNCED')
        _updateBadge();
    });
  }

  // ============================================================
  // WEBSOCKET
  // ============================================================

  function _wsUrl() {
    const token   = localStorage.getItem('access_token');
    const storeId = _storeId();
    if (!token || !storeId) return null;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}/ws/${storeId}?token=${token}`;
  }

  function _storeId() {
    try {
      const token = localStorage.getItem('access_token');
      if (!token) return null;
      const p = JSON.parse(atob(token.split('.')[1]));
      return p.store_id || localStorage.getItem('store_id');
    } catch {
      return localStorage.getItem('store_id');
    }
  }

  function connectWS() {
    if (_ws && (_ws.readyState === WebSocket.OPEN ||
                _ws.readyState === WebSocket.CONNECTING)) return;

    const url = _wsUrl();
    if (!url) { console.warn('[WS] Token/store_id yo\'q'); return; }

    console.log('[WS] Ulanmoqda...', url);
    _ws = new WebSocket(url);

    _ws.onopen = () => {
      console.log('[WS] ✅ Ulandi');
      _wsReady     = true;
      _reconnectMs = 1_000;
      clearTimeout(_reconnectT);
      _startPing();
      syncAll();
      document.dispatchEvent(new Event('novapos:ws-connected'));
    };

    _ws.onmessage = ({ data }) => {
      try {
        if (data === 'pong') return;
        const { event, data: payload } = JSON.parse(data);
        _handleEvent(event, payload);
      } catch (e) {
        console.warn('[WS] Parse xato:', e, data);
      }
    };

    _ws.onerror = () => {};  // onclose chaqiriladi

    _ws.onclose = ({ code }) => {
      _wsReady = false;
      _stopPing();
      console.log(`[WS] Uzildi (${code}). ${_reconnectMs / 1000}s da qayta...`);
      document.dispatchEvent(new Event('novapos:ws-disconnected'));

      if (_online && code !== 1000) { // 1000 = intentional close
        _reconnectT = setTimeout(() => {
          _reconnectMs = Math.min(_reconnectMs * 2, MAX_RECONNECT);
          connectWS();
        }, _reconnectMs);
      }
    };
  }

  function disconnectWS() {
    clearTimeout(_reconnectT);
    _stopPing();
    if (_ws) {
      _ws.onclose = null;  // auto-reconnect off
      _ws.close(1000, 'user_logout');
      _ws = null;
    }
    _wsReady = false;
  }

  function _startPing() {
    _stopPing();
    _pingT = setInterval(() => {
      if (_ws?.readyState === WebSocket.OPEN) _ws.send('ping');
    }, PING_INTERVAL);
  }

  function _stopPing() {
    if (_pingT) { clearInterval(_pingT); _pingT = null; }
  }

  // ── WebSocket eventlarni qayta ishlash ────────────────────
  async function _handleEvent(event, data) {
    switch (event) {

      case 'connected':
        console.log('[WS] Server ack:', data);
        break;

      // Stok yangilandi (sotuv, qaytarish, kirim)
      case 'stock_updated':
        if (data?.items?.length && window.NovaPOS_DB) {
          for (const item of data.items) {
            await NovaPOS_DB.products.updateStock(item.product_id, item.new_qty);
          }
          document.dispatchEvent(new CustomEvent('products:stock-updated', {
            detail: { items: data.items }
          }));
          console.log(`[WS] 📦 Stok yangilandi: ${data.items.length} ta`);
        }
        break;

      // Yangi sotuv (boshqa kassirdan)
      case 'sale_created':
        document.dispatchEvent(new CustomEvent('novapos:sale-created', { detail: data }));
        console.log(`[WS] 🧾 Yangi sotuv: #${data?.receipt_number}`);
        break;

      // Mahsulot qo'shildi yoki tahrirlandi
      case 'product_added':
      case 'product_edited':
        if (data && window.NovaPOS_DB) {
          await NovaPOS_DB.products.updateLocal(data);
          document.dispatchEvent(new CustomEvent('products:updated', { detail: { single: data } }));
        }
        break;

      // Server to'liq sync so'ramoqda
      case 'sync_request':
        await _fullSyncProducts();
        break;

      default:
        console.log('[WS] Noma\'lum event:', event, data);
    }
  }

  // ============================================================
  // ONLINE / OFFLINE
  // ============================================================

  function _onOnline() {
    console.log('[Sync] 🌐 Online');
    clearTimeout(_debounceT);
    _debounceT = setTimeout(async () => {
      connectWS();
      await syncOfflineSales();
      await syncOfflineOps();
    }, ONLINE_DEBOUNCE);
  }

  function _onOffline() {
    console.log('[Sync] 📴 Offline');
  }

  // ============================================================
  // FULL SYNC
  // ============================================================

  async function syncAll() {
    if (_syncing || !_online) return;
    _syncing = true;
    try {
      await syncOfflineSales();
      await syncOfflineOps();
      await _fullSyncProducts();
      await _fullSyncCustomers();
    } catch (e) {
      console.warn('[Sync] syncAll xato:', e);
    } finally {
      _syncing = false;
    }
  }

  async function _fullSyncProducts(force = false) {
    try {
      const token = localStorage.getItem('access_token');
      if (!token || !_online) return;

      if (!force && window.NovaPOS_DB) {
        const lastSync = await NovaPOS_DB.products.getLastSyncTime();
        const count    = await NovaPOS_DB.products.getCount();
        const age      = lastSync ? Date.now() - lastSync.getTime() : Infinity;
        // 5 daqiqadan yangi va bo'sh bo'lmasa — skip
        if (count > 0 && age < 5 * 60_000) {
          console.log('[Sync] Products fresh, skip');
          return;
        }
      }

      const res = await fetch('/api/products/?limit=5000', {  // backend max: le=5000
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return;

      const raw  = await res.json();
      const list = Array.isArray(raw) ? raw : (raw.items || raw.products || []);

      if (list.length > 0 && window.NovaPOS_DB) {
        await NovaPOS_DB.products.saveAll(list);
        console.log(`[Sync] ✅ ${list.length} mahsulot`);
        document.dispatchEvent(new CustomEvent('products:updated', { detail: { list } }));
      }
    } catch (e) { console.warn('[Sync] Products xato:', e); }
  }

  async function _fullSyncCustomers() {
    try {
      const token = localStorage.getItem('access_token');
      if (!token || !_online) return;

      if (window.NovaPOS_DB) {
        const lastSync = await NovaPOS_DB.meta.get('customers_synced_at').catch(() => null);
        if (lastSync && Date.now() - lastSync < 5 * 60_000) {
          console.log('[Sync] Customers fresh, skip');
          return;
        }
      }

      const res = await fetch('/api/customers/', {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` }
      });
      if (!res.ok) return;

      const list = await res.json();
      const arr  = Array.isArray(list) ? list : [];

      if (arr.length > 0 && window.NovaPOS_DB) {
        await NovaPOS_DB.customers.saveAll(arr);
        console.log(`[Sync] ✅ ${arr.length} mijoz`);
      }
    } catch (e) { console.warn('[Sync] Customers xato:', e); }
  }

  // ── Offline sotuvlar yuborish ─────────────────────────────
  async function syncOfflineSales() {
    if (!window.NovaPOS_DB || !_online) return;
    const pending = await NovaPOS_DB.offlineSales.getPending().catch(() => []);
    if (!pending.length) return;

    // Background Sync (SW)
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-offline-sales');
        console.log('[Sync] Sales → SW BackgroundSync');
        return;
      } catch {}
    }

    // Manual fallback
    await _sendSalesManually(pending);
  }

  async function _sendSalesManually(pending) {
    const token = localStorage.getItem('access_token');
    if (!token || !pending?.length) return;
    console.log(`[Sync] 📤 ${pending.length} sotuv yuborilmoqda...`);

    for (const sale of pending) {
      try {
        await NovaPOS_DB.offlineSales.markSyncing(sale.local_id);
        const res = await fetch('/api/sales/checkout', {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify(sale.data),
        });

        if (res.ok) {
          await NovaPOS_DB.offlineSales.markSynced(sale.local_id);
          if (typeof showToast === 'function')
            showToast('Offline sotuv yuborildi ✓', 'success');
        } else {
          const err = await res.json().catch(() => ({}));
          await NovaPOS_DB.offlineSales.markFailed(sale.local_id, err?.detail || res.status);
        }
      } catch (e) {
        await NovaPOS_DB.offlineSales.markFailed(sale.local_id, e.message);
      }
    }
    await _updateBadge();
  }

  // ── Offline queue yuborish ────────────────────────────────
  async function syncOfflineOps() {
    if (!window.NovaPOS_DB || !_online) return;
    const pending = await NovaPOS_DB.offlineOps.getPending().catch(() => []);
    if (!pending.length) return;

    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('sync-offline-ops');
        return;
      } catch {}
    }

    await _sendOpsManually(pending);
  }

  async function _sendOpsManually(pending) {
    const token = localStorage.getItem('access_token');
    if (!token || !pending?.length) return;
    let okCount = 0;

    for (const op of pending) {
      try {
        const cfg = {
          method:  op.method,
          headers: {
            'Authorization': `Bearer ${token}`,
            ...(op.method !== 'DELETE' ? { 'Content-Type': 'application/json' } : {}),
          },
        };
        if (op.method !== 'DELETE' && op.data)
          cfg.body = JSON.stringify(op.data);

        const res = await fetch(op.endpoint, cfg);
        if (res.ok) { await NovaPOS_DB.offlineOps.markSynced(op.id); okCount++; }
        else         await NovaPOS_DB.offlineOps.markFailed(op.id, res.status);
      } catch (e) {
        await NovaPOS_DB.offlineOps.markFailed(op.id, e.message);
      }
    }

    if (okCount > 0 && typeof showToast === 'function')
      showToast(`${okCount} ta operatsiya yuborildi ✓`, 'success');

    await _updateBadge();
  }

  // ── Badge yangilash ───────────────────────────────────────
  async function _updateBadge() {
    if (!window.NovaPOS_DB) return;
    const sales = await NovaPOS_DB.offlineSales.getCount().catch(() => 0);
    const ops   = await NovaPOS_DB.offlineOps.getCount().catch(() => 0);
    const total = sales + ops;

    document.dispatchEvent(new CustomEvent('offline-count-changed', {
      detail: { count: total, sales, ops }
    }));

    if ('setAppBadge' in navigator) {
      total > 0 ? navigator.setAppBadge(total).catch(() => {})
                : navigator.clearAppBadge().catch(() => {});
    }
  }

  // ============================================================
  // AUTO SYNC
  // ============================================================

  function startAutoSync() {
    if (_periodicT) return;

    // 1.5s keyin boshlash (sahifa to'liq yuklansin)
    setTimeout(() => {
      if (_online) connectWS();
      syncAll();
    }, 1_500);

    // Har 3 daqiqada (WS ishlamasa fallback)
    _periodicT = setInterval(() => {
      if (_online && !_wsReady) syncAll();
    }, PERIODIC_MS);
  }

  function stopAutoSync() {
    if (_periodicT) { clearInterval(_periodicT); _periodicT = null; }
    disconnectWS();
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  return {
    get isOnline()  { return _online;  },
    get isSyncing() { return _syncing; },
    get wsReady()   { return _wsReady; },

    connectWS,
    disconnectWS,
    syncAll,
    syncProducts:     _fullSyncProducts,
    syncCustomers:    _fullSyncCustomers,
    syncOfflineSales,
    syncOfflineOps,
    updateOfflineBadge: _updateBadge,
    startAutoSync,
    stopAutoSync,
  };

})();

window.SyncManager = SyncManager;