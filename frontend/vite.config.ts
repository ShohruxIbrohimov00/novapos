import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const BASE = '/static/app/';

/**
 * Versiya fayli: build'dagi barcha JS/CSS fayllar ro'yxati va ulardan hisoblangan versiya.
 * - index.html ga <meta name="app-version"> qo'shiladi (ilova o'z versiyasini biladi)
 * - version.json yoziladi: ilova serverdagi versiyani shu fayldan tekshiradi,
 *   Service Worker esa ro'yxatdagi hamma fayllarni oflayn uchun oldindan keshlaydi.
 * Fayl nomlarida kontent hash bor — o'zgarish bo'lmasa versiya ham o'zgarmaydi.
 */
function appVersion(): Plugin {
  let version = '';
  let assets: string[] = [];
  let outDir = '';
  return {
    name: 'nova-app-version',
    apply: 'build',
    configResolved(c) { outDir = c.build.outDir; },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        assets = Object.keys(ctx.bundle ?? {})
          .filter((f) => /\.(js|css)$/.test(f))
          .sort()
          .map((f) => BASE + f);
        version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
        return [{ tag: 'meta', attrs: { name: 'app-version', content: version }, injectTo: 'head' }];
      },
    },
    writeBundle() {
      writeFileSync(join(outDir, 'version.json'), JSON.stringify({ version, assets }, null, 1) + '\n');
    },
  };
}

// Build natijasi FastAPI'ning statik papkasiga yoziladi va repoga qo'shiladi —
// serverda Node.js shart emas. Ilova /app/... manzilida, fayllar /static/app/ dan.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? BASE : '/',
  plugins: [react(), appVersion()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: '../webapp/static/app',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
  },
  server: {
    port: 5173,
    // Ishlab chiqishda API va eski statik fayllar FastAPI (8000) dan olinadi
    proxy: {
      '/api': 'http://localhost:8000',
      '/static': 'http://localhost:8000',
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
}));
