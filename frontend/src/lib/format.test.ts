import { describe, expect, it } from 'vitest';
import { cleanNumInput, dateTime, localDate, money, parseNum, qty } from './format';

describe('money', () => {
  it.each([
    [0, "0 so'm"], [12500, "12 500 so'm"], [1234567, "1 234 567 so'm"], [999.6, "1 000 so'm"],
    [-5000, "-5 000 so'm"], [null, "0 so'm"], [undefined, "0 so'm"],
  ])('%s → %s', (v, out) => {
    expect(money(v as number).replace(/ /g, ' ')).toBe(out);
  });
  it("birliksiz", () => expect(money(1500, false).replace(/ /g, ' ')).toBe('1 500'));
});

describe('qty', () => {
  it.each([[2, '2'], [1.5, '1.5'], [0.333333, '0.333'], [1.0005, '1.001'], [null, '0']])('%s → %s', (v, out) => {
    expect(qty(v as number)).toBe(out);
  });
});

describe('dateTime', () => {
  it('mahalliy vaqt formati', () => {
    const d = new Date(2026, 10, 18, 14, 5);
    expect(dateTime(d.toISOString())).toBe('18.11.2026 14:05');
  });
  it.each([null, undefined, '', 'xato'])('bo\'sh/xato: %s', (v) => expect(dateTime(v as string)).toBe('—'));
});

describe('localDate', () => {
  it('YYYY-MM-DD, nol bilan', () => expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05'));
  it('tun yarmida UTC ga siljimaydi', () => expect(localDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31'));
});

describe('parseNum', () => {
  it.each([
    ['12 500', 12500], ['1,5', 1.5], ['0.25', 0.25], ['  7 ', 7], ['12 000', 12000], ['5.', 5], ['-3', -3],
    [42, 42],
  ])('%s → %s', (v, out) => expect(parseNum(v)).toBe(out));
  it.each(['', 'abc', '1.2.3', '1e5', null, undefined])('NaN: %s', (v) => expect(parseNum(v as string)).toBeNaN());
});

describe('cleanNumInput', () => {
  it.each([
    ['12a3', true, '123'], ['1,5', true, '1.5'], ['1.2.3', true, '1.23'], ['1.5', false, '15'], ['-7', true, '7'],
  ])('%s (%s) → %s', (v, dec, out) => expect(cleanNumInput(v as string, dec as boolean)).toBe(out));
});
