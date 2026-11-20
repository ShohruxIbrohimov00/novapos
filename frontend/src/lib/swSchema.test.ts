// Service Worker (webapp/sw.js) va React (lib/db.ts) bitta IndexedDB bazadan foydalanadi.
// Sxema yoki versiya farq qilsa — oflayn sotuvlar yo'qolishi mumkin. Shu test buni ushlaydi.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sw = read('../../../webapp/sw.js');
const db = read('./db.ts');

function schemaBlock(src: string, start: RegExp): string {
  const i = src.search(start);
  const open = src.indexOf('= {', i) + 2;            // turi (Record<...>) emas, qiymat
  const body = src.slice(open, src.indexOf('};', open));
  return body.replace(/\s+/g, '').replace(/,}/g, '}');
}

describe('SW ↔ React IndexedDB', () => {
  it('versiya bir xil', () => {
    const swVer = sw.match(/DB_VERSION\s*=\s*(\d+)/)?.[1];
    const dbVer = db.match(/DB_VERSION\s*=\s*(\d+)/)?.[1];
    expect(swVer).toBeTruthy();
    expect(swVer).toBe(dbVer);
  });
  it('jadvallar va indekslar bir xil', () => {
    expect(schemaBlock(sw, /const NOVA_DB_SCHEMA\s*=/)).toBe(schemaBlock(db, /const SCHEMA:/));
  });
  it('baza nomi bir xil', () => {
    const name = (s: string) => s.match(/DB_NAME\s*=\s*['"]([^'"]+)/)?.[1];
    expect(name(sw)).toBe(name(db));
  });
});

describe('SW: yangilanish', () => {
  it("version.json SW keshidan o'tmaydi", () => {
    expect(sw).toMatch(/url\.pathname === APP_VERSION_URL\) return;/);
    expect(sw).toContain("'/static/app/version.json'");
  });
  it('UPDATE_APP xabarini qabul qiladi', () => expect(sw).toContain("type === 'UPDATE_APP'"));
});
