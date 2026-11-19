import type { Role } from '@/lib/auth';

export interface NavLink {
  /** Manzil. `spa: true` — React ilovasi ichida (sahifa qayta yuklanmaydi) */
  to: string;
  icon: string;
  label: string;
  spa?: boolean;
  /** Faol deb hisoblanadigan manzil boshlari */
  match: string[];
}

// Ko'chirilgan sahifalar `spa: true`. Qolganlari hozircha eski sahifaga oddiy havola.
export function navLinks(role: Role | undefined): NavLink[] {
  if (role === 'super_admin') {
    return [
      { to: '/superadmin', icon: 'fa-chart-pie', label: 'Panel', match: ['/superadmin$'] },
      { to: '/superadmin/stores', icon: 'fa-shop', label: "Do'konlar", match: ['/superadmin/stores'] },
      { to: '/superadmin/requests', icon: 'fa-hand-holding-dollar', label: "To'lovlar", match: ['/superadmin/requests'] },
    ];
  }
  const links: NavLink[] = [
    { to: '/app/pos', icon: 'fa-cash-register', label: 'Kassa', spa: true, match: ['/app/pos', '/pos'] },
    { to: '/sales/history', icon: 'fa-receipt', label: 'Tarix', match: ['/sales'] },
    { to: '/products', icon: 'fa-boxes-stacked', label: 'Ombor', match: ['/products', '/ai-scan'] },
    { to: '/app/customers', icon: 'fa-users', label: 'Mijozlar', spa: true, match: ['/app/customers', '/customers'] },
  ];
  if (role === 'admin') links.push({ to: '/reports', icon: 'fa-chart-column', label: 'Hisobot', match: ['/reports'] });
  links.push({ to: '/settings', icon: 'fa-gear', label: 'Sozlama', match: ['/settings'] });
  return links;
}

export function isActive(link: NavLink, path: string): boolean {
  return link.match.some((m) => (m.endsWith('$') ? path === m.slice(0, -1) : path.startsWith(m)));
}
