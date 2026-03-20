const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true,
  platform: 'node',
  outdir: 'dist-electron',
  external: ['electron'], // Don't bundle Electron itself
  sourcemap: true,        // Enable source maps for debugging
  target: 'node20',       // Optional: explicitly target recent Node version
  format: 'cjs',          // CommonJS output (Electron prefers this)
  logLevel: 'info'        // Log output during build
}).catch((err) => {
  console.error('❌ Electron build failed:', err);
  process.exit(1);
});
