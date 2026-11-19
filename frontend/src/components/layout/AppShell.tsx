import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getUser } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { useConfirm, useToast } from '@/components/ui';
import { logout as doLogout } from '@/lib/session';
import { isActive, navLinks, type NavLink } from './nav';
import './shell.css';

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', sotuvchi: 'Kassir', cashier: 'Kassir', super_admin: 'SuperAdmin' };

function NavItem({ link, path }: { link: NavLink; path: string }) {
  const active = isActive(link, path);
  const inner = (
    <>
      <i className={`fa-solid ${link.icon}`} aria-hidden="true" />
      <span className="nav-item__label">{link.label}</span>
    </>
  );
  const props = { className: `nav-item${active ? ' is-active' : ''}`, 'aria-current': active ? ('page' as const) : undefined, title: link.label };
  // React ichidagi sahifa — <Link>; eski sahifa — oddiy havola (to'liq yuklanadi)
  return link.spa
    ? <Link to={link.to.replace(/^\/app/, '') || '/'} {...props}>{inner}</Link>
    : <a href={link.to} {...props}>{inner}</a>;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

/**
 * Telefon (<768): pastki menyu.  Planshet (768+): ixcham yon menyu.
 * Kompyuter (1440+): keng yon menyu — do'kon nomi, foydalanuvchi, tema, chiqish.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const user = getUser();
  const loc = useLocation();
  const path = '/app' + (loc.pathname === '/' ? '' : loc.pathname);
  const links = navLinks(user?.role);
  const [theme, toggleTheme] = useTheme();
  const online = useOnline();
  const confirm = useConfirm();

  const toast = useToast();
  const logout = async () => {
    const ok = await confirm({ title: 'Tizimdan chiqish', message: 'Kassadan chiqmoqchimisiz?', confirmText: 'Chiqish', danger: true });
    if (!ok) return;
    const r = await doLogout();
    if (!r.ok) toast.show(`${r.pending} ta oflayn sotuv hali serverga yuborilmagan. Internetga ulanib, yuborilishini kuting.`, 'error');
  };

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Asosiy menyu">
        <div className="sidebar__brand">
          <div className="brand-mark"><i className="fa-solid fa-bolt" aria-hidden="true" /></div>
          <div className="sidebar__brandtext">
            <b>{user?.store_name || 'NovaPOS'}</b>
            <small>NovaPOS</small>
          </div>
        </div>
        <div className="sidebar__links">
          {links.map((l) => <NavItem key={l.to} link={l} path={path} />)}
        </div>
        <div className="sidebar__foot">
          <div className="sidebar__user">
            <div className="sidebar__ava" aria-hidden="true">{(user?.full_name || '?').trim().charAt(0).toUpperCase()}</div>
            <div className="sidebar__usertext">
              <b>{user?.full_name}</b>
              <small>{user ? ROLE_LABEL[user.role] ?? '' : ''}</small>
            </div>
          </div>
          <span className={`net-dot${online ? ' is-on' : ''}`} title={online ? 'Internet bor' : "Internet yo'q"} />
          <button type="button" className="sidebar__btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'}>
            <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true" />
            <span className="sidebar__btnlabel">{theme === 'dark' ? 'Kunduzgi rejim' : 'Tungi rejim'}</span>
          </button>
          <button type="button" className="sidebar__btn sidebar__btn--danger" onClick={logout} aria-label="Chiqish">
            <i className="fa-solid fa-right-from-bracket" aria-hidden="true" />
            <span className="sidebar__btnlabel">Chiqish</span>
          </button>
        </div>
      </nav>

      <div className="shell__main">
        {!online && <div className="offline-bar" role="status"><i className="fa-solid fa-wifi" aria-hidden="true" /> Internet yo'q — ma'lumotlar keshdan</div>}
        {children}
      </div>

      <nav className="bottomnav" aria-label="Asosiy menyu">
        {links.map((l) => <NavItem key={l.to} link={l} path={path} />)}
      </nav>
    </div>
  );
}
