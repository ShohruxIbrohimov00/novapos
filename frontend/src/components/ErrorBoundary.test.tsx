import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow: Error | null = null;
function Bomb() {
  if (shouldThrow) throw shouldThrow;
  return <div>Sahifa ishlayapti</div>;
}

let reload: ReturnType<typeof vi.fn>;
beforeEach(() => {
  shouldThrow = null;
  reload = vi.fn();
  vi.stubGlobal('location', { reload, pathname: '/app/pos', search: '' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});     // React xatoni konsolga yozadi
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('ErrorBoundary', () => {
  it('xato bo\'lmasa — sahifa', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByText('Sahifa ishlayapti')).toBeTruthy();
  });

  it("xato bo'lsa — oq ekran o'rniga xatolik oynasi va serverga hisobot", () => {
    shouldThrow = new TypeError("Cannot read properties of undefined (reading 'name')");
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('Xatolik yuz berdi')).toBeTruthy();
    expect(screen.getByText(/Cannot read properties/)).toBeTruthy();
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(f).toHaveBeenCalledWith('/api/client-errors', expect.objectContaining({ method: 'POST' }));
  });

  it('"Qayta yuklash" sahifani qayta yuklaydi', () => {
    shouldThrow = new Error('x');
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    fireEvent.click(screen.getByText(/Qayta yuklash/));
    expect(reload).toHaveBeenCalled();
  });

  it('"Qayta urinish" — xato tuzalgan bo\'lsa sahifa qaytadi', () => {
    shouldThrow = new Error('vaqtinchalik');
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    shouldThrow = null;
    fireEvent.click(screen.getByText('Qayta urinish'));
    expect(screen.getByText('Sahifa ishlayapti')).toBeTruthy();
  });

  it('boshqa sahifaga o\'tilganda (resetKey) xato tozalanadi', () => {
    shouldThrow = new Error('x');
    const { rerender } = render(<ErrorBoundary resetKey="/pos"><Bomb /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    shouldThrow = null;
    rerender(<ErrorBoundary resetKey="/sales"><Bomb /></ErrorBoundary>);
    expect(screen.getByText('Sahifa ishlayapti')).toBeTruthy();
  });

  it('yangi versiyadan keyin eski sahifa fayli yo\'q — bir marta o\'zi qayta yuklaydi', () => {
    shouldThrow = new TypeError('Failed to fetch dynamically imported module: /static/app/assets/Sales-x.js');
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Ilova yangilandi')).toBeTruthy();
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(f).not.toHaveBeenCalled();                          // bu dastur xatosi emas — hisobot yo'q
  });

  it("qayta yuklash yordam bermasa — cheksiz aylanmaydi", () => {
    sessionStorage.setItem('nova_chunk_reload', String(Date.now()));
    shouldThrow = new TypeError('Failed to fetch dynamically imported module: /x.js');
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(reload).not.toHaveBeenCalled();
  });

  it("oflaynda saqlanmagan sahifa — internet haqida xabar", () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    shouldThrow = new TypeError('Failed to fetch dynamically imported module: /x.js');
    render(<ErrorBoundary><Bomb /></ErrorBoundary>);
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText('Sahifa yuklanmadi')).toBeTruthy();
  });
});
