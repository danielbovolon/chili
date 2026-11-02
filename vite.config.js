import { defineConfig } from 'vite';
// base './' → Build läuft auf jedem Pfad (GitHub Pages, eigener Server, Unterordner)
export default defineConfig({ base: './', build: { target: 'es2022', assetsInlineLimit: 0 } });
