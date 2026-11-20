import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, currentVersion, fetchServerVersion, useAppUpdate } from './appUpdate';

function setMeta(v: string | null) {
  document.querySelector('meta[name="app-version"]')?.remove();
  if (v) {
    const m = document.createElement('meta');
    m.name = 'app-version'; m.content = v;
    document.head.appendChild(m);
  }
}

function serverVersion(v: string | null, ok = true) {
  const f = vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify(v ? { version: v, assets: [] } : {}), { status: ok ? 200 : 404 }));
  vi.stubGlobal('fetch', f);
  return f;
}

// happy-dom'da navigator.serviceWorker yo'q — testda o'zimiz qo'yamiz
function setSW(value: unknown) {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
}

beforeEach(() => {
  setSW(undefined);
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  setMeta('aaa111');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); setMeta(null); });

describe('currentVersion / fetchServerVersion', () => {
  it("meta tegdan o'qiydi", () => expect(currentVersion()).toBe('aaa111'));
  it("ishlab chiqish rejimida (meta yo'q) — null", () => { setMeta(null); expect(currentVersion()).toBeNull(); });
  it('keshsiz so\'raydi', async () => {
    const f = serverVersion('bbb222');
    expect(await fetchServerVersion()).toBe('bbb222');
    expect(f.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });
  it('xato/tarmoq yo\'q — null', async () => {
    serverVersion(null, false);
    expect(await fetchServerVersion()).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    expect(await fetchServerVersion()).toBeNull();
  });
});

describe('useAppUpdate', () => {
  async function flush(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

  it('versiya bir xil — banner yo\'q', async () => {
    serverVersion('aaa111');
    const { result } = renderHook(() => useAppUpdate());
    await flush(6_000);
    expect(result.current.visible).toBe(false);
  });

  it('yangi versiya — banner chiqadi; "Keyinroq" yashiradi', async () => {
    serverVersion('bbb222');
    const { result } = renderHook(() => useAppUpdate());
    expect(result.current.visible).toBe(false);          // darhol emas (ochilish tezligi)
    await flush(6_000);
    expect(result.current.visible).toBe(true);
    act(() => result.current.dismiss());
    expect(result.current.visible).toBe(false);
  });

  it('"Keyinroq"dan keyin keyingi tekshiruvda yana eslatadi', async () => {
    serverVersion('bbb222');
    const { result } = renderHook(() => useAppUpdate());
    await flush(6_000);
    act(() => result.current.dismiss());
    await flush(30 * 60_000);
    expect(result.current.visible).toBe(true);
  });

  it("tez-tez tekshirmaydi (oynaga qaytish)", async () => {
    const f = serverVersion('aaa111');
    renderHook(() => useAppUpdate());
    await flush(6_000);
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush(10);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('internet tiklanganda tekshiradi', async () => {
    const f = serverVersion('aaa111');
    renderHook(() => useAppUpdate());
    await flush(6_000);
    await flush(61_000);
    window.dispatchEvent(new Event('online'));
    await flush(10);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('ishlab chiqish rejimida tekshirmaydi', async () => {
    setMeta(null);
    const f = serverVersion('bbb222');
    renderHook(() => useAppUpdate());
    await flush(6_000);
    expect(f).not.toHaveBeenCalled();
  });

  it('oflayn — tekshirmaydi', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const f = serverVersion('bbb222');
    renderHook(() => useAppUpdate());
    await flush(6_000);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('applyUpdate', () => {
  it('SW yangi fayllarni keshlagach qayta yuklaydi', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    const postMessage = vi.fn((_msg: unknown, ports: MessagePort[]) => ports[0].postMessage({ type: 'APP_UPDATED', ok: true }));
    setSW({ controller: { postMessage } });
    vi.useRealTimers();
    await applyUpdate();
    expect(postMessage.mock.calls[0][0]).toEqual({ type: 'UPDATE_APP' });
    expect(reload).toHaveBeenCalled();
  });

  it('SW javob bermasa ham 10 soniyadan keyin qayta yuklaydi', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    setSW({ controller: { postMessage: vi.fn() } });
    const p = applyUpdate();
    await vi.advanceTimersByTimeAsync(10_000);
    await p;
    expect(reload).toHaveBeenCalled();
  });

  it("SW yo'q — darhol qayta yuklaydi", async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    setSW(undefined);
    await applyUpdate();
    expect(reload).toHaveBeenCalled();
  });
});
