import { describe, expect, it, vi } from 'vitest';

describe('isChunkLoadError', async () => {
  const { isChunkLoadError } = await import('./errorReport');
  it.each([
    'Failed to fetch dynamically imported module: /static/app/assets/Pos-abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Unable to preload CSS for /static/app/assets/x.css',
  ])('chunk: %s', (m) => expect(isChunkLoadError(new TypeError(m))).toBe(true));
  it.each(['Cannot read properties of undefined', 'x is not a function'])('oddiy: %s', (m) =>
    expect(isChunkLoadError(new Error(m))).toBe(false));
});

describe('reportError', () => {
  it("serverga yuboradi, uzun matnni qisqartiradi, sessiyada ko'pi bilan 5 marta", async () => {
    vi.resetModules();
    const { reportError } = await import('./errorReport');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const f = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', f);
    const err = new Error('x'.repeat(1000));
    for (let i = 0; i < 8; i++) reportError(err, 'at Komponent');
    expect(f).toHaveBeenCalledTimes(5);
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(f.mock.calls[0][0]).toBe('/api/client-errors');
    expect(body.message.length).toBeLessThanOrEqual(500);
    expect(body.stack).toContain('at Komponent');
    expect(body.version).toBe('dev');
    vi.unstubAllGlobals();
  });

  it('internet yo\'q — yubormaydi', async () => {
    vi.resetModules();
    const { reportError } = await import('./errorReport');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    reportError(new Error('x'));
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
