// 앱 아이콘 PNG 생성: node scripts/make-icons.mjs  (필요: playwright — npm i --no-save playwright)
// 임시(placeholder) 디자인: 초록 그라데이션 + 흰 동전(₩) + 흐름 화살표. 최종 아이콘이 정해지면 SVG 만 바꿔 다시 실행한다.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');

const defs = `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0F766E"/><stop offset="1" stop-color="#22C55E"/></linearGradient></defs>`;
const bg = '<rect width="1024" height="1024" fill="url(#bg)"/>';
// 동전: 원 + ₩ (W 와 가로선 두 줄)
const coin = (fill = '#fff', ink = '#0F766E') => `<g>
  <circle cx="512" cy="512" r="290" fill="${fill}"/>
  <path d="M340 400L420 640L512 440L604 640L684 400" fill="none" stroke="${ink}" stroke-width="42" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M320 482H704M320 556H704" stroke="${ink}" stroke-width="30" stroke-linecap="round"/></g>`;
const svg = (size, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}${inner}</svg>`;

const files = {
  'icon.png': { size: 1024, svg: svg(1024, bg + coin()), opaque: true },
  'android-icon-background.png': { size: 1024, svg: svg(1024, bg), opaque: true },
  'android-icon-foreground.png': { size: 1024, svg: svg(1024, `<g transform="translate(512 512) scale(.8) translate(-512 -512)">${coin()}</g>`) },
  'android-icon-monochrome.png': { size: 1024, svg: svg(1024, `<g transform="translate(512 512) scale(.8) translate(-512 -512)">${coin('#000', '#fff')}</g>`) },
  'splash-icon.png': { size: 512, svg: svg(512, coin()) },
  'favicon.png': { size: 48, svg: svg(48, bg + coin()), opaque: true },
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, f] of Object.entries(files)) {
  await page.setViewportSize({ width: f.size, height: f.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${f.svg}</body></html>`);
  fs.writeFileSync(path.join(OUT, name), await page.screenshot({ omitBackground: !f.opaque, clip: { x: 0, y: 0, width: f.size, height: f.size } }));
  console.log('wrote', name);
}
await browser.close();
