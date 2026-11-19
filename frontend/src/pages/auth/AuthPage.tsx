import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { cleanNumInput } from '@/lib/format';
import { useTheme } from '@/lib/theme';
import { Button, Field, IconButton, Tabs } from '@/components/ui';
import './auth.css';

interface TokenResp { access_token: string; user_info: { username: string; role: string } & Record<string, unknown> }

function saveAndGo(r: TokenResp) {
  try {
    localStorage.setItem('access_token', r.access_token);
    localStorage.setItem('user_info', JSON.stringify(r.user_info));
    localStorage.setItem('saved_username', r.user_info.username);
  } catch { /* xotira yopiq */ }
  location.replace(r.user_info.role === 'super_admin' ? '/app/superadmin' : '/app/pos');
}

const savedUser = () => { try { return localStorage.getItem('saved_username') || ''; } catch { return ''; } };

function tokenValid(): string | null {
  try {
    const t = localStorage.getItem('access_token');
    if (!t) return null;
    const pl = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (Date.now() >= pl.exp * 1000 - 30000) return null;
    return JSON.parse(localStorage.getItem('user_info') || '{}').role ?? 'admin';
  } catch { return null; }
}

export function AuthPage() {
  const loc = useLocation();
  const register = loc.pathname.startsWith('/register');
  const [theme, toggleTheme] = useTheme();

  // Allaqachon kirgan bo'lsa — to'g'ri kassaga
  useEffect(() => {
    const role = tokenValid();
    if (role) location.replace(role === 'super_admin' ? '/app/superadmin' : '/app/pos');
  }, []);

  return (
    <div className="au-page">
      <IconButton icon={theme === 'dark' ? 'fa-sun' : 'fa-moon'} label={theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'} className="au-theme" onClick={toggleTheme} />
      <div className="au-side" aria-hidden="true">
        <div className="au-brand"><span className="brand-mark"><i className="fa-solid fa-bolt" /></span> NovaPOS</div>
        <h2>Do'koningiz kassasi — telefon, planshet yoki kompyuterda</h2>
        <ul>
          <li><i className="fa-solid fa-barcode" /> Shtrix-kod skaner, tarozi tovarlari, nasiya</li>
          <li><i className="fa-solid fa-wifi" /> Internet uzilsa ham sotuv davom etadi</li>
          <li><i className="fa-solid fa-chart-line" /> Foyda, qarzlar va ombor bir joyda</li>
        </ul>
      </div>
      <main className="au-main">
        <div className="au-card">
          <div className="au-brand au-brand--card"><span className="brand-mark"><i className="fa-solid fa-bolt" aria-hidden="true" /></span> NovaPOS</div>
          <nav className="au-tabs" aria-label="Kirish yoki ro'yxatdan o'tish">
            <Link to="/login" replace className="au-tab" aria-current={!register ? 'page' : undefined}>Kirish</Link>
            <Link to="/register" replace className="au-tab" aria-current={register ? 'page' : undefined}>Do'kon ochish</Link>
          </nav>
          {register ? <RegisterForm /> : <LoginForm />}
        </div>
        <p className="au-foot">30 kun bepul · Hech narsa o'rnatish shart emas</p>
      </main>
    </div>
  );
}

function LoginForm() {
  const [mode, setMode] = useState<'pwd' | 'pin'>(() => (savedUser() ? 'pin' : 'pwd'));
  const [user, setUser] = useState(savedUser);
  const [pwd, setPwd] = useState('');
  const [show, setShow] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (mode === 'pin' && user) pinRef.current?.focus(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const u = user.trim().toLowerCase();
    if (!u) { setErr('Loginni yozing'); return; }
    if (mode === 'pwd' && !pwd) { setErr('Parolni yozing'); return; }
    if (mode === 'pin' && pin.length < 4) { setErr('PIN kamida 4 ta raqam'); return; }
    setBusy(true); setErr(null);
    try {
      const r = mode === 'pwd'
        ? await api<TokenResp>('/api/auth/login', 'POST', { username: u, password: pwd })
        : await api<TokenResp>('/api/auth/login-pin', 'POST', { username: u, pin_code: pin });
      saveAndGo(r);
    } catch (e) {
      setErr(e instanceof ApiError ? (e.status === 429 ? "Urinishlar ko'p. Bir daqiqadan keyin qayta urining." : e.message) : 'Kirib bo\'lmadi');
      if (mode === 'pin') { setPin(''); setShake(true); setTimeout(() => setShake(false), 450); pinRef.current?.focus(); }
      setBusy(false);
    }
  };

  const key = (k: string) => {
    setErr(null);
    if (k === 'del') setPin((p) => p.slice(0, -1));
    else if (k === 'clr') setPin('');
    else setPin((p) => (p.length < 8 ? p + k : p));
  };

  return (
    <form className="au-form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate>
      <Tabs label="Kirish usuli" value={mode} onChange={(m) => { setMode(m); setErr(null); }}
            items={[{ value: 'pin', label: 'PIN kod' }, { value: 'pwd', label: 'Parol' }]} />
      <Field label="Login" icon="fa-user" autoComplete="username" autoCapitalize="none" spellCheck={false} value={user}
             onChange={(e) => { setUser(e.target.value.replace(/\s/g, '')); setErr(null); }} autoFocus={!user} />
      {mode === 'pwd' ? (
        <div className="au-pwd">
          <Field label="Parol" icon="fa-lock" type={show ? 'text' : 'password'} autoComplete="current-password" value={pwd}
                 onChange={(e) => { setPwd(e.target.value); setErr(null); }} autoFocus={!!user} />
          <IconButton icon={show ? 'fa-eye-slash' : 'fa-eye'} label={show ? 'Parolni yashirish' : "Parolni ko'rsatish"} className="au-eye" onClick={() => setShow((v) => !v)} />
        </div>
      ) : (
        <div className="au-pin">
          <label htmlFor="au-pin" className="ui-field__label">PIN kod</label>
          <div className={`au-dots${shake ? ' is-shake' : ''}`} aria-hidden="true">
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => <span key={i} className={i < pin.length ? 'on' : ''} />)}
          </div>
          <input id="au-pin" ref={pinRef} className="sr-only" inputMode="numeric" autoComplete="off" value={pin}
                 onChange={(e) => { setPin(cleanNumInput(e.target.value, false).slice(0, 8)); setErr(null); }} />
          <div className="au-pad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clr', '0', 'del'].map((k) => (
              <button key={k} type="button" className={`au-key${k.length > 1 ? ' au-key--fn' : ''}`} onClick={() => key(k)}
                      aria-label={k === 'del' ? "O'chirish" : k === 'clr' ? 'Tozalash' : k}>
                {k === 'del' ? <i className="fa-solid fa-delete-left" aria-hidden="true" /> : k === 'clr' ? 'C' : k}
              </button>
            ))}
          </div>
        </div>
      )}
      {err && <div className="au-err" role="alert">{err}</div>}
      <Button type="submit" size="lg" block loading={busy} icon="fa-right-to-bracket">Kirish</Button>
      {mode === 'pin' && <p className="au-hint">Kassir PIN kodi bilan tez kiradi. PIN'ni do'kon egasi Sozlamalarda beradi.</p>}
    </form>
  );
}

function RegisterForm() {
  const [f, setF] = useState({ store: '', name: '', phone: '', user: '', pwd: '', pin: '', pin2: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setF({ ...f, [k]: v }); setErrs({}); };

  const submit = async () => {
    const e: Record<string, string> = {};
    if (f.store.trim().length < 2) e.store = "Do'kon nomini yozing";
    if (f.name.trim().length < 2) e.name = 'Ismingizni yozing';
    if (!/^[a-z0-9_.]{3,30}$/.test(f.user)) e.user = '3–30 ta lotin harf, raqam, _ yoki .';
    if (f.pwd.length < 4) e.pwd = 'Kamida 4 belgi';
    if (!/^\d{4,8}$/.test(f.pin)) e.pin = '4–8 ta raqam';
    else if (f.pin !== f.pin2) e.pin2 = 'PIN mos kelmadi';
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const r = await api<TokenResp>('/api/auth/register-store', 'POST', {
        store_name: f.store.trim(), full_name: f.name.trim(), phone: f.phone.trim() || null,
        username: f.user, password: f.pwd, pin_code: f.pin,
      });
      saveAndGo(r);
    } catch (x) {
      const m = x instanceof ApiError ? (x.status === 429 ? "Urinishlar ko'p. Bir daqiqadan keyin qayta urining." : x.message) : 'Saqlanmadi';
      setErrs(/login/i.test(m) ? { user: m } : { form: m });
      setBusy(false);
    }
  };

  return (
    <form className="au-form" onSubmit={(e) => { e.preventDefault(); submit(); }} noValidate autoComplete="off">
      <fieldset className="au-fs">
        <legend>Do'kon</legend>
        <Field label="Do'kon nomi" required placeholder="Masalan: Baraka Market" value={f.store} error={errs.store} maxLength={100} onChange={(e) => set('store', e.target.value)} autoFocus />
        <div className="pf-grid2">
          <Field label="Ismingiz" required value={f.name} error={errs.name} maxLength={80} autoComplete="name" onChange={(e) => set('name', e.target.value)} />
          <Field label="Telefon" type="tel" inputMode="tel" placeholder="+998" value={f.phone} maxLength={20} autoComplete="tel" onChange={(e) => set('phone', e.target.value)} />
        </div>
      </fieldset>
      <fieldset className="au-fs">
        <legend>Kirish ma'lumotlari</legend>
        <div className="pf-grid2">
          <Field label="Login" required placeholder="masalan: baraka" autoCapitalize="none" spellCheck={false} autoComplete="username" value={f.user} error={errs.user}
                 onChange={(e) => set('user', e.target.value.toLowerCase().replace(/\s/g, ''))} />
          <Field label="Parol" required type="password" autoComplete="new-password" placeholder="kamida 4 belgi" value={f.pwd} error={errs.pwd} onChange={(e) => set('pwd', e.target.value)} />
          <Field label="PIN (kassaga tez kirish)" required type="password" inputMode="numeric" placeholder="4 ta raqam" value={f.pin} error={errs.pin}
                 onChange={(e) => set('pin', cleanNumInput(e.target.value, false).slice(0, 8))} />
          <Field label="PIN takror" required type="password" inputMode="numeric" value={f.pin2} error={errs.pin2}
                 onChange={(e) => set('pin2', cleanNumInput(e.target.value, false).slice(0, 8))} />
        </div>
      </fieldset>
      {errs.form && <div className="au-err" role="alert">{errs.form}</div>}
      <Button type="submit" size="lg" block loading={busy} icon="fa-store">Do'konni ochish</Button>
    </form>
  );
}
