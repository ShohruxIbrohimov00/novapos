import { describe, expect, it } from 'vitest';
import { isActive, navLinks } from './nav';

const labels = (role: Parameters<typeof navLinks>[0]) => navLinks(role).map((l) => l.label);

describe('navLinks', () => {
  it('admin — hisobot bor', () => {
    expect(labels('admin')).toEqual(['Kassa', 'Tarix', 'Ombor', 'Mijozlar', 'Hisobot', 'Sozlama']);
  });
  it('kassir — hisobot yo\'q', () => {
    expect(labels('sotuvchi')).not.toContain('Hisobot');
    expect(labels('sotuvchi')).toContain('Kassa');
  });
  it('superadmin — faqat panel', () => {
    expect(labels('super_admin')).toEqual(['Panel', "Do'konlar", "To'lovlar"]);
  });
  it('hamma havola React ichida', () => {
    for (const r of ['admin', 'sotuvchi', 'super_admin'] as const) expect(navLinks(r).every((l) => l.spa)).toBe(true);
  });
});

describe('isActive', () => {
  const [kassa, , ombor] = navLinks('admin');
  const [panel, stores] = navLinks('super_admin');
  it('boshi bilan mos', () => {
    expect(isActive(ombor, '/app/products/12')).toBe(true);
    expect(isActive(ombor, '/app/products/ai')).toBe(true);
    expect(isActive(kassa, '/app/products')).toBe(false);
  });
  it('$ — aniq moslik', () => {
    expect(isActive(panel, '/app/superadmin')).toBe(true);
    expect(isActive(panel, '/app/superadmin/stores')).toBe(false);
    expect(isActive(stores, '/app/superadmin/stores')).toBe(true);
  });
});
