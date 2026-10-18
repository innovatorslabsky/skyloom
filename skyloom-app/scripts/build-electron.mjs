import { build } from 'esbuild';

// Main and preload are bundled to CommonJS; electron stays external, skyloom-core is bundled in.
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], logLevel: 'info' };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist/electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist/electron/preload.cjs' });
