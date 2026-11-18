/**
 * NovaPOS — Auth Module v4.0
 * ===========================
 * Backend /api/auth/* bilan to'liq mos:
 *   ✅ POST /api/auth/register-store
 *   ✅ POST /api/auth/login
 *   ✅ POST /api/auth/login-pin
 *   ✅ GET  /api/auth/me
 *   ✅ POST /api/auth/change-password
 *   ✅ POST /api/auth/change-pin
 *   ✅ PATCH /api/auth/me  (profil tahrirlash)
 *   ✅ SW va IDB ga token sinxronizatsiyasi
 *   ✅ SuperAdmin "do'konga kirish" sessiyasi
 *   ✅ Sahifa himoyasi (checkAuth)
 */

// ── Token saqlash ─────────────────────────────────────────────
function _saveToken(token, username, userInfo) {
  localStorage.setItem('access_token', token);

  if (username)  localStorage.setItem('saved_username', username);
  if (userInfo)  localStorage.setItem('user_info', JSON.stringify(userInfo));

  // IDB ga ham (SW offline sync uchun)
  if (window.NovaPOS_DB) {
    NovaPOS_DB.auth.saveToken(token).catch(() => {});
  }

  // store_id ni alohida saqlash (SyncManager WS uchun)
  if (userInfo?.store_id) {
    localStorage.setItem('store_id', String(userInfo.store_id));
  }
}

// ── Rolga qarab yo'naltirish ──────────────────────────────────
function _redirectByRole(role) {
  const r = role?.value || role || '';
  if (r === 'super_admin') {
    window.location.href = '/superadmin';
  } else {
    window.location.href = '/pos';
  }
}

// ── Joriy foydalanuvchi ma'lumotlari ─────────────────────────
function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user_info') || 'null');
  } catch { return null; }
}

function getUserRole() {
  const u = getCurrentUser();
  return u?.role?.value || u?.role || null;
}

function getStoreId() {
  const u = getCurrentUser();
  return u?.store_id || parseInt(localStorage.getItem('store_id') || '0') || null;
}

// ── Token tekshirish (JWT exp) ────────────────────────────────
function isAuthenticated() {
  const token = localStorage.getItem('access_token');
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // 30 soniya buffer (tez tugashi muammosi)
    return Date.now() < (payload.exp * 1000 - 30_000);
  } catch { return false; }
}

// ============================================================
// 1. DO'KON RO'YXATDAN O'TKAZISH
// ============================================================
async function registerStore(storeName, fullName, username, password, pinCode) {
  try {
    const data = await apiRequest('/auth/register-store', 'POST', {
      store_name: storeName.trim(),
      full_name:  fullName.trim(),
      username:   username.toLowerCase().trim(),
      password:   password,
      pin_code:   pinCode,
    });

    if (data?.access_token) {
      _saveToken(data.access_token, username.toLowerCase().trim(), data.user_info);
      showToast("Muvaffaqiyatli ro'yxatdan o'tdingiz! 🎉", 'success');
      setTimeout(() => window.location.href = '/pos', 1200);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Auth] registerStore:', e);
    return false;
  }
}

// ============================================================
// 2. USERNAME + PAROL BILAN KIRISH
// ============================================================
async function loginWithPassword(username, password) {
  try {
    const data = await apiRequest('/auth/login', 'POST', {
      username: username.toLowerCase().trim(),
      password: password,
    });

    if (data?.access_token) {
      _saveToken(data.access_token, username.toLowerCase().trim(), data.user_info);
      const role = data.user_info?.role?.value || data.user_info?.role || '';

      // Agar superadmin do'kon sessiyasi bo'lsa — asosiy token saqlab qo'yamiz
      if (role === 'super_admin') {
        localStorage.removeItem('super_token');
      }

      _redirectByRole(role);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Auth] loginWithPassword:', e);
    return false;
  }
}

// ============================================================
// 3. PIN-KOD BILAN TEZKOR KIRISH
// ============================================================
async function loginWithPin(pinCode) {
  const savedUsername = localStorage.getItem('saved_username');
  if (!savedUsername) {
    window.location.href = '/register';
    return false;
  }

  try {
    const data = await apiRequest('/auth/login-pin', 'POST', {
      username: savedUsername,
      pin_code: pinCode,
    });

    if (data?.access_token) {
      _saveToken(data.access_token, null, data.user_info);
      const role = data.user_info?.role?.value || data.user_info?.role || '';
      _redirectByRole(role);
      return true;
    }
    return false;
  } catch (e) {
    console.error('[Auth] loginWithPin:', e);
    return false;
  }
}

// ============================================================
// 4. JORIY FOYDALANUVCHI MA'LUMOTLARINI YANGILASH
// ============================================================
async function refreshUserInfo() {
  try {
    const data = await apiRequest('/auth/me', 'GET', null, true);
    if (data) {
      localStorage.setItem('user_info', JSON.stringify(data));
      return data;
    }
  } catch {}
  return getCurrentUser();
}

// ============================================================
// 5. PAROL ALMASHTIRISH
// ============================================================
async function changePassword(oldPassword, newPassword) {
  try {
    await apiRequest('/auth/change-password', 'POST', {
      old_password: oldPassword,
      new_password: newPassword,
    });
    showToast('Parol muvaffaqiyatli almashtirildi ✓', 'success');
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 6. PIN ALMASHTIRISH
// ============================================================
async function changePin(currentPin, newPin) {
  try {
    await apiRequest('/auth/change-pin', 'POST', {
      current_pin: currentPin,
      new_pin:     newPin,
    });
    showToast('PIN muvaffaqiyatli almashtirildi ✓', 'success');
    return true;
  } catch (e) {
    return false;
  }
}

// ============================================================
// 7. TIZIMDAN CHIQISH
// ============================================================
function logout() {
  // SuperAdmin do'kon sessiyasi bo'lsa — asosiy tokenga qayt
  const superToken = localStorage.getItem('super_token');
  if (superToken) {
    localStorage.setItem('access_token', superToken);
    localStorage.removeItem('super_token');
    window.location.href = '/superadmin/stores';
    return;
  }

  // IDB tokenni o'chirish
  if (window.NovaPOS_DB) {
    NovaPOS_DB.auth.clearToken().catch(() => {});
  }

  // SyncManager WebSocket ni yopish
  if (window.SyncManager) {
    SyncManager.disconnectWS();
  }

  // Maxfiy ma'lumotlarni o'chirish (savat, token, user)
  ['access_token', 'user_info', 'cart', 'store_id'].forEach(k =>
    localStorage.removeItem(k)
  );

  window.location.href = '/login';
}

// ============================================================
// 8. TO'LIQ CHIQISH (qurilmani "unutish")
// ============================================================
function forgetAccount() {
  if (!confirm("Qurilmani unutmoqchimisiz? Barcha ma'lumotlar o'chiriladi.")) return;

  if (window.NovaPOS_DB) {
    NovaPOS_DB.auth.clearToken().catch(() => {});
  }
  if (window.SyncManager) {
    SyncManager.disconnectWS();
  }

  // localStorage ni to'liq tozalash (saved_username ham)
  localStorage.clear();
  window.location.href = '/register';
}

// ============================================================
// 9. SAHIFA HIMOYASI
// ============================================================
function checkAuth() {
  const path        = window.location.pathname;
  const publicPaths = ['/login', '/register'];

  // Public sahifalarda: agar login qilgan bo'lsa → yo'naltirish
  if (publicPaths.includes(path)) {
    if (isAuthenticated()) {
      _redirectByRole(getUserRole());
    }
    return;
  }

  // Himoyalangan sahifalarda: token yo'q → login
  if (!isAuthenticated()) {
    localStorage.removeItem('access_token');
    window.location.href = '/login';
    return;
  }

  // SuperAdmin sahifalari — faqat super_admin roli uchun
  if (path.startsWith('/superadmin') && getUserRole() !== 'super_admin') {
    window.location.href = '/pos';
    return;
  }

  // Obuna holati tekshirish (paywall)
  const userInfo = getCurrentUser();
  if (userInfo && getUserRole() !== 'super_admin') {
    const store = userInfo.store;
    if (store && (store.payment_status === 'pending' || store.payment_status === 'expired')) {
      const pw = document.getElementById('paywall-screen');
      if (pw) pw.classList.remove('hidden');
    }
  }
}

// ============================================================
// 10. SUPERADMIN — DO'KON NOMIDAN KIRISH
// ============================================================
async function loginAsStore(storeId) {
  try {
    const data = await apiRequest(`/superadmin/login-as-store/${storeId}`, 'POST');
    if (data?.access_token) {
      // Asosiy super_admin tokenni saqlash
      const currentToken = localStorage.getItem('access_token');
      localStorage.setItem('super_token', currentToken);

      _saveToken(data.access_token, null, data.user_info);
      showToast("Do'kon sifatida kirmoqda...", 'info');
      setTimeout(() => window.location.href = '/pos', 800);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

// ── Avtomatik sahifa himoyasi ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});