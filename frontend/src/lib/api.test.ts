import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return vi.fn().mockImplementation(async () => new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...headers },
  }));
}

let hrefSpy: ReturnType<typeof vi.fn>;
let replaceSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('access_token', 'tok123');
  localStorage.setItem('user_info', '{"role":"admin"}');
  hrefSpy = vi.fn();
  replaceSpy = vi.fn();
  vi.stubGlobal('location', {
    pathname: '/app/pos', replace: replaceSpy,
    set href(v: string) { hrefSpy(v); }, get href() { return 'http://x/app/pos'; },
  });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => vi.unstubAllGlobals());

describe('api', () => {
  it("token qo'shadi, /api prefiksi, JSON body", async () => {
    const f = respond(200, { ok: 1 });
    vi.stubGlobal('fetch', f);
    expect(await api('/products/', 'POST', { a: 1 })).toEqual({ ok: 1 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('/api/products/');
    expect(init.headers.Authorization).toBe('Bearer tok123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"a":1}');
  });

  it("FormData uchun Content-Type qo'yilmaydi", async () => {
    const f = respond(200, {});
    vi.stubGlobal('fetch', f);
    await api('/api/x', 'POST', new FormData());
    expect(f.mock.calls[0][1].headers['Content-Type']).toBeUndefined();
  });

  it("internetsiz o'zgartirish so'rovi darhol rad etiladi", async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(api('/api/x', 'POST', {})).rejects.toMatchObject({ offline: true });
    expect(f).not.toHaveBeenCalled();
  });

  it('tarmoq xatosi → offline ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const e = await api('/api/x').catch((x: unknown) => x) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.offline).toBe(true);
  });

  it('Service Worker oflayn javobi → offline', async () => {
    vi.stubGlobal('fetch', respond(503, { detail: 'x' }, { 'X-SW-Offline': '1' }));
    await expect(api('/api/x')).rejects.toMatchObject({ offline: true });
  });

  it('401 → sessiya tozalanadi va kirishga yo\'naltiriladi', async () => {
    vi.stubGlobal('fetch', respond(401, { detail: 'x' }));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(replaceSpy).toHaveBeenCalledWith('/app/login');
  });

  it("401 kirish so'rovida — yo'naltirilmaydi (noto'g'ri parol)", async () => {
    vi.stubGlobal('fetch', respond(401, { detail: "Login yoki parol noto'g'ri" }));
    await expect(api('/api/auth/login', 'POST', {})).rejects.toThrow("Login yoki parol noto'g'ri");
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(localStorage.getItem('access_token')).toBe('tok123');
  });

  it("402 → obuna sahifasiga", async () => {
    vi.stubGlobal('fetch', respond(402, { detail: { code: 'SUBSCRIPTION_EXPIRED' } }));
    await expect(api('/api/x')).rejects.toMatchObject({ status: 402 });
    expect(hrefSpy).toHaveBeenCalledWith('/app/settings#obuna');
  });

  it.each([
    [{ detail: 'Oddiy matn' }, 'Oddiy matn'],
    [{ detail: [{ msg: 'a' }, { msg: 'b' }] }, 'a, b'],
    [{ detail: { message: 'Obyekt' } }, 'Obyekt'],
    [null, 'Xatolik yuz berdi'],
  ])('xato matni: %j', async (body, msg) => {
    vi.stubGlobal('fetch', respond(400, body));
    await expect(api('/api/x')).rejects.toThrow(msg);
  });
});
