import { build } from 'esbuild';

// The web server is one CommonJS file; skyloom-core and the shared app code are bundled in. Run it with: node dist/server/main.cjs
await build({ bundle: true, platform: 'node', format: 'cjs', target: 'node22', entryPoints: ['server/main.ts'], outfile: 'dist/server/main.cjs', logLevel: 'info' });
