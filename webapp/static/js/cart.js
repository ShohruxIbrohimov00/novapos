/**
 * NovaPOS — Shopping Cart v5.0
 * ==============================
 * ✅ unit_type: dona/blok → oddiy miqdor (+1/-1)
 * ✅ unit_type: kg/metr/litr → WEIGHT MODE
 *      - Miqdor kiritilsa → narx avtomatik (price_out × qty)
 *      - Narx kiritilsa   → miqdor avtomatik (total / price_out)
 *      - Ikkalasi numpad orqali boshqariladi
 * ✅ Backend SaleCreate schema bilan to'liq mos
 * ✅ Offline checkout qo'llab-quvvatlaydi
 */

// O'lchov birliklarini aniqlash
if (typeof window._WUNITS === 'undefined') window._WUNITS = ['kg', 'metr', 'litr'];
const WEIGHT_UNITS = window._WUNITS;

function isWeightUnit(unit_type) {
  return WEIGHT_UNITS.includes(unit_type);
}

class ShoppingCart {

  constructor() {
    try {
      const saved = localStorage.getItem('cart');
      this.items  = saved ? JSON.parse(saved) : [];
    } catch {
      this.items = [];
    }
  }

  // ── Mahsulot qo'shish ────────────────────────────────────
  // Weight unit bo'lsa qty=0 bilan qo'shiladi (numpad kutiladi)
  add(product, qty = null) {
    const price     = parseFloat(product.price_out || product.price || 0);
    const unit      = product.unit_type || 'dona';
    const isWeight  = isWeightUnit(unit);

    // Weight unit uchun default qty=0 (foydalanuvchi kiritishi kerak)
    const defaultQty = isWeight ? 0 : 1;
    const addQty     = qty !== null ? qty : defaultQty;

    const existing = this.items.find(i => i.id === product.id);

    if (existing) {
      if (!isWeight) {
        // Dona/blok: oddiy qo'shish
        existing.quantity = parseFloat((existing.quantity + addQty).toFixed(3));
      }
      // Weight: takror qo'shilganda miqdorni saqlab qo'yamiz (numpad bilan o'zgartiriladi)
    } else {
      this.items.push({
        id:               product.id,
        name:             product.name,
        price_out:        price,
        quantity:         addQty,
        unit_type:        unit,
        is_weight:        isWeight,
        total_price:      isWeight ? 0 : price * addQty, // weight uchun qty kiritilgach hisoblanadi
        discount_percent: 0,
        barcode:          product.barcode || null,
        short_code:       product.short_code || null,
        in_stock:         parseFloat(product.quantity || 0),
      });
    }
    this.save();
    return this.getItem(product.id);
  }

  // ── Bitta mahsulotni olish ───────────────────────────────
  getItem(id) {
    return this.items.find(i => i.id === id) || null;
  }

  // ── Miqdor yangilash ─────────────────────────────────────
  updateQuantity(id, newQty) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    const q = parseFloat(newQty);
    if (isNaN(q) || q < 0) return;
    if (q === 0 && !item.is_weight) {
      this.removeItem(id);
      return;
    }
    item.quantity = parseFloat(q.toFixed(3));
    // Weight uchun total_price ni qayta hisoblash
    if (item.is_weight) {
      item.total_price = parseFloat((item.price_out * item.quantity).toFixed(0));
    }
    this.save(true);
  }

  // ── Narx orqali miqdor hisoblash (weight mode) ───────────
  // total_price kiritilsa → qty = total_price / price_out
  updateTotalPrice(id, newTotalPrice) {
    const item = this.items.find(i => i.id === id);
    if (!item || !item.is_weight) return;
    const total = parseFloat(newTotalPrice);
    if (isNaN(total) || total < 0) return;
    item.total_price = total;
    if (item.price_out > 0) {
      item.quantity = parseFloat((total / item.price_out).toFixed(3));
    }
    this.save(true);
  }

  // ── Narx o'zgartirish (manual) ───────────────────────────
  updatePrice(id, newPrice) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    item.price_out = parseFloat(newPrice) || item.price_out;
    if (item.is_weight && item.quantity > 0) {
      item.total_price = parseFloat((item.price_out * item.quantity).toFixed(0));
    }
    this.save(true);
  }

  // ── Chegirma o'rnatish ───────────────────────────────────
  updateDiscount(id, discountPercent) {
    const item = this.items.find(i => i.id === id);
    if (!item) return;
    item.discount_percent = Math.min(100, Math.max(0, parseFloat(discountPercent) || 0));
    this.save(true);
  }

  // ── Mahsulot o'chirish ───────────────────────────────────
  removeItem(id) {
    this.items = this.items.filter(i => i.id !== id);
    this.save();
  }

  // ── Savatni tozalash ─────────────────────────────────────
  clear() {
    this.items = [];
    this.save();
  }

  // ── Bitta item subtotal ───────────────────────────────────
  getItemSubtotal(item) {
    const price    = item.price_out || 0;
    const discount = item.discount_percent || 0;
    const qty      = item.quantity || 0;
    if (item.is_weight) {
      // total_price dan chegirma
      const tp = item.total_price || (price * qty);
      return tp * (1 - discount / 100);
    }
    return price * (1 - discount / 100) * qty;
  }

  // ── Jami hisoblash ───────────────────────────────────────
  getTotal() {
    return this.items.reduce((sum, item) => {
      return sum + this.getItemSubtotal(item);
    }, 0);
  }

  // ── Chegirmali jami ──────────────────────────────────────
  getTotalDiscount() {
    return this.items.reduce((sum, item) => {
      const price    = item.price_out || 0;
      const discount = item.discount_percent || 0;
      const qty      = item.quantity || 0;
      if (item.is_weight) {
        return sum + ((item.total_price || price * qty) * discount / 100);
      }
      return sum + (price * discount / 100) * qty;
    }, 0);
  }

  // ── Mahsulotlar soni ─────────────────────────────────────
  getCount() {
    return this.items.reduce((n, i) => n + (i.quantity || 0), 0);
  }

  getUniqueCount() { return this.items.length; }
  getItems()       { return this.items; }
  isEmpty()        { return this.items.length === 0; }

  // ── Weight item tayyor ekanligini tekshirish ─────────────
  hasUnfinishedWeightItems() {
    return this.items.some(i => i.is_weight && (!i.quantity || i.quantity <= 0));
  }

  getUnfinishedWeightItems() {
    return this.items.filter(i => i.is_weight && (!i.quantity || i.quantity <= 0));
  }

  // ── localStorage ga saqlash ──────────────────────────────
  save(onlyTotals = false) {
    localStorage.setItem('cart', JSON.stringify(this.items));
    document.dispatchEvent(new CustomEvent('cartUpdated', {
      detail: {
        items:       this.items,
        total:       this.getTotal(),
        count:       this.getCount(),
        only_totals: onlyTotals,
      }
    }));
  }

  // ── Backend uchun payload tayyorlash ─────────────────────
  buildSalePayload(paymentMethod, paidAmount, customerId = null, storeId = null) {
    const user = typeof getCurrentUser !== 'undefined' ? getCurrentUser() : (
      JSON.parse(localStorage.getItem('user_info') || '{}')
    );
    const sid = storeId || user?.store_id;

    if (!sid) {
      console.error('[Cart] store_id topilmadi!');
    }

    return {
      store_id:       sid,
      customer_id:    customerId || null,
      payment_method: paymentMethod,
      paid_amount:    parseFloat(paidAmount) || this.getTotal(),
      items: this.items.map(item => ({
        product_id:       item.id,
        quantity:         item.quantity,
        price_out:        item.price_out,
        discount_percent: item.discount_percent || 0,
      })),
    };
  }

  // ── Sotuvni yuborish ─────────────────────────────────────
  async submitSale(paymentMethod, paidAmount, customerId = null, storeId = null) {
    if (this.isEmpty()) {
      if (typeof showToast !== 'undefined') showToast("Savat bo'm-bo'sh!", 'error');
      return null;
    }

    if (this.hasUnfinishedWeightItems()) {
      const names = this.getUnfinishedWeightItems().map(i => i.name).join(', ');
      if (typeof showToast !== 'undefined') showToast(`Miqdor kiritilmagan: ${names}`, 'error');
      return null;
    }

    if (paymentMethod === 'nasiya' && !customerId) {
      if (typeof showToast !== 'undefined') showToast('Nasiya uchun mijozni tanlang!', 'error');
      return null;
    }

    const payload = this.buildSalePayload(paymentMethod, paidAmount, customerId, storeId);

    try {
      const result = await apiRequest('/api/sales/checkout', 'POST', payload);
      if (result) {
        this.clear();
        return result;
      }
      return null;
    } catch (e) {
      if (e.offline) return null;
      console.error('[Cart] submitSale xato:', e);
      return null;
    }
  }

  // ── Chekni matn sifatida tayyorlash ──────────────────────
  buildReceiptText(saleResult) {
    const user  = typeof getCurrentUser !== 'undefined' ? getCurrentUser() : JSON.parse(localStorage.getItem('user_info') || '{}');
    const store = user?.store || {};
    const W     = 32;

    const line  = (l, r, w = W) => {
      const ls = String(l), rs = String(r);
      const sp = Math.max(1, w - ls.length - rs.length);
      return ls + ' '.repeat(sp) + rs;
    };
    const center = (s, w = W) => {
      const sp = Math.max(0, Math.floor((w - s.length) / 2));
      return ' '.repeat(sp) + s;
    };
    const fmt = n => Math.round(n).toLocaleString('uz-UZ');
    const hr  = (c = '-', w = W) => c.repeat(w);

    const now = new Date();
    const dateStr = now.toLocaleDateString('uz-UZ');
    const timeStr = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });

    const payNames = { naqd: 'NAQD PUL', plastik: 'PLASTIK KARTA', nasiya: 'NASIYA (QARZ)' };
    const pm = payNames[saleResult.payment_method] || (saleResult.payment_method || '').toUpperCase();

    let txt = '';
    txt += hr('=') + '\n';
    txt += center((store.name || 'NOVAPOS MARKET').toUpperCase()) + '\n';
    if (store.address) txt += center(store.address) + '\n';
    if (store.phone)   txt += center(store.phone)   + '\n';
    txt += hr('=') + '\n\n';
    txt += line('Chek:', '#' + (saleResult.receipt_number || 'OFFLINE')) + '\n';
    txt += line('Sana:', dateStr) + '\n';
    txt += line('Vaqt:', timeStr) + '\n';
    txt += line('Kassir:', (user?.full_name || 'Admin').split(' ')[0]) + '\n';
    txt += hr() + '\n';
    txt += line('MAHSULOT', 'SUMMA') + '\n';
    txt += hr() + '\n';

    let total = 0;
    this.items.forEach(item => {
      const subtotal = this.getItemSubtotal(item);
      total += subtotal;

      const name = item.name.substring(0, W - 1);
      txt += name + '\n';

      if (item.is_weight) {
        const unitLabel = item.unit_type === 'kg' ? 'kg' : item.unit_type === 'metr' ? 'm' : 'l';
        txt += line(`${item.quantity}${unitLabel} × ${fmt(item.price_out)}`, fmt(subtotal)) + '\n';
      } else {
        const qtyStr = `${item.quantity} × ${fmt(item.price_out)}`;
        txt += line(qtyStr, fmt(subtotal)) + '\n';
      }

      if (item.discount_percent > 0) {
        txt += line(`  Chegirma ${item.discount_percent}%:`, `-${fmt(item.price_out * item.discount_percent / 100 * item.quantity)}`) + '\n';
      }
    });

    txt += hr() + '\n';
    txt += line('JAMI:', fmt(total)) + '\n';
    txt += line("To'lov:", pm) + '\n';

    if (saleResult.payment_method === 'naqd') {
      txt += line('Berildi:', fmt(saleResult.paid_amount || total)) + '\n';
      txt += line('Qaytim:',  fmt(Math.max(0, (saleResult.paid_amount || 0) - total))) + '\n';
    }

    if (saleResult.customer_name) {
      txt += hr() + '\n';
      txt += 'Mijoz: ' + saleResult.customer_name + '\n';
    }

    if (saleResult.offline) {
      txt += hr('~') + '\n';
      txt += center('OFFLINE SOTUV') + '\n';
    }

    txt += '\n' + hr('=') + '\n';
    txt += center('XARIDINGIZ UCHUN RAHMAT!') + '\n';
    txt += center('novapos.uz') + '\n';
    txt += hr('=') + '\n\n\n';

    return txt;
  }
}

// ── Global instance ───────────────────────────────────────────
const cart = new ShoppingCart();