// 앱 아이콘 PNG 생성: node scripts/make-icons.mjs  (필요: playwright — npm i --no-save playwright)
// 디자인(A안): 청록 그라데이션 바다 위의 물결 + 금빛 ₩ 동전. SVG 만 바꿔 다시 실행한 뒤 assets/*.png 를 커밋한다.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)('playwright');
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets');

const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0F766E"/><stop offset="1" stop-color="#14B8A6"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset="1" stop-color="#F5B83D"/></linearGradient>
</defs>`;
const bg = '<rect width="1024" height="1024" fill="url(#bg)"/>';
// 겹친 물결 두 줄 (Flow)
const waves = `<path d="M0 610Q150 500 300 610T600 610T900 590T1200 610V1100H0Z" fill="#fff" opacity=".18"/>
  <path d="M0 720Q150 610 300 720T600 720T900 700T1200 720V1100H0Z" fill="#fff" opacity=".18"/>`;
// ₩ 글리프(글꼴 의존 없이 경로로): W 와 가로선 두 줄. 중심 (512,420)
const won = (ink, w = 1) => `<g transform="translate(512 420) scale(${w}) translate(-512 -420)">
  <path d="M412 340L462 500L512 372L562 500L612 340" fill="none" stroke="${ink}" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M396 410H628M396 462H628" stroke="${ink}" stroke-width="22" stroke-linecap="round"/></g>`;
const coin = () => `<circle cx="512" cy="420" r="200" fill="url(#gold)"/><circle cx="512" cy="420" r="152" fill="none" stroke="#C98A12" stroke-width="14"/>${won('#B7770E')}`;
/** 단색 동전: 원판에서 ₩ 와 안쪽 링을 뚫는다 (Android 테마 아이콘·알림 작은 아이콘) */
const monoCoin = (color) => `<mask id="m"><rect width="1024" height="1024" fill="#fff"/><circle cx="512" cy="420" r="152" fill="none" stroke="#000" stroke-width="14"/>${won('#000')}</mask>
  <circle cx="512" cy="420" r="200" fill="${color}" mask="url(#m)"/>`;
const svg = (size, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${defs}${inner}</svg>`;
/** 적응형 아이콘 전경: 안전 영역(가운데 66%)에 맞게 가운데로 모은다 */
const centered = (inner, k = 1.1) => `<g transform="translate(512 512) scale(${k}) translate(-512 -420)">${inner}</g>`;

const files = {
  'icon.png': { size: 1024, svg: svg(1024, bg + waves + coin()), opaque: true },
  'android-icon-background.png': { size: 1024, svg: svg(1024, bg + waves), opaque: true },
  'android-icon-foreground.png': { size: 1024, svg: svg(1024, centered(coin())) },
  'android-icon-monochrome.png': { size: 1024, svg: svg(1024, centered(monoCoin('#000'))) },
  'splash-icon.png': { size: 512, svg: svg(512, centered(coin(), 1.3)) },
  'favicon.png': { size: 48, svg: svg(48, bg + waves + coin()), opaque: true },
  'notification-icon.png': { size: 96, svg: svg(96, centered(monoCoin('#fff'), 1.5)) },
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
