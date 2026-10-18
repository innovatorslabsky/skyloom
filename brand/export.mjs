// Renders brand/svg/* to PNG (and the social share image). Needs: npm i playwright-core, a Chromium (set CHROMIUM=/path), ImageMagick `convert` for favicon.ico.
//   node brand/export.mjs
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const svg = (f) => readFileSync(join(here, 'svg', f)).toString('base64');
const out = join(here, 'png');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
async function png(file, size, name, bg = 'transparent') {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<body style="margin:0;background:${bg}"><img style="width:${size}px;height:${size}px;display:block" src="data:image/svg+xml;base64,${svg(file)}"></body>`);
  await p.screenshot({ path: join(out, name), omitBackground: bg === 'transparent' });
  await p.close();
}
for (const s of [1024, 512, 256, 128]) await png('skyloom-icon.svg', s, `skyloom-icon-${s}.png`);
await png('skyloom-icon-square.svg', 180, 'apple-touch-icon.png', '#6a58f0');
for (const s of [16, 32, 48]) await png('skyloom-favicon.svg', s, `favicon-${s}.png`);
execFileSync('convert', [join(out, 'favicon-16.png'), join(out, 'favicon-32.png'), join(out, 'favicon-48.png'), join(out, 'favicon.ico')]);

// 1200x630 share image (dark, logo + one line of text)
const p = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(`<body style="margin:0;width:1200px;height:630px;background:radial-gradient(900px 500px at 80% 0%,#6a58f055,transparent),radial-gradient(700px 400px at 0% 100%,#8be9ff22,transparent),#060914;display:flex;flex-direction:column;justify-content:center;padding:0 90px;box-sizing:border-box;font-family:Inter,'Be Vietnam Pro',sans-serif;color:#fff">
<img style="width:620px" src="data:image/svg+xml;base64,${svg('skyloom-logo-dark.svg')}">
<div style="margin-top:36px;font-size:44px;font-weight:700;letter-spacing:-.02em;line-height:1.2;max-width:900px">Tạo video AI hàng loạt,<br><span style="color:#8be9ff">giữ trần ngân sách.</span></div>
<div style="margin-top:20px;font-size:26px;color:#c5c9e0">Báo giá trước · Nhiều nhà cung cấp · Dùng khoá API của bạn</div></body>`);
await p.screenshot({ path: join(out, 'og-image.png') });
await browser.close();
console.log('done');
