// Headless-Chrome screenshot + console capture for visual checks.
//
//   node tools/shot.mjs --html index.html --out .scratch/app.png
//   node tools/shot.mjs --bundle .scratch/me/bundle.js --out .scratch/me/shot.png --cam -200,120,300 --look -150,45,80
//   node tools/shot.mjs --html index.html --views views.json --outdir .scratch/views
//       views.json: [{ "name": "mall", "cam": [x,y,z], "look": [x,y,z], "hours": 14 }, ...]
//   node tools/shot.mjs --app .scratch/me/app.js ...   full app (index.html) but with your own bundle of src/main.js
//   Extra: --width 1600 --height 900 --timeout 90000 --eval "js expression run after ready" --query "q=low"
//
// Pages must set window.__READY = true when the scene is built and may expose
// window.__setView(cam, look) and window.__ctx (the harness and the app do both).
// Console errors/warnings and page errors are printed; exit code 2 if any page error occurred.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) {
    const eq = a.indexOf('=');
    if (eq > 0) { args[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const k = a.slice(2); const v = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true; args[k] = v;
  }
}
const W = +(args.width || 1600), H = +(args.height || 900);
const TIMEOUT = +(args.timeout || 120000);
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => fs.existsSync(p));

let pageUrl;
if (args.app) {
  // Full app page with a custom bundle: copy index.html next to the bundle with absolute asset URLs
  const bundle = path.resolve(args.app);
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  html = html.replace(/(href|src)="((?:css|data|dist)\/[^"]+)"/g, (m, attr, rel) =>
    `${attr}="${rel === 'dist/app.js' ? pathToFileURL(bundle).href : pathToFileURL(path.join(ROOT, rel)).href}"`);
  const htmlPath = bundle.replace(/\.js$/, '') + '.app.html';
  fs.writeFileSync(htmlPath, html);
  pageUrl = pathToFileURL(htmlPath).href;
} else if (args.bundle) {
  const bundle = path.resolve(args.bundle);
  const htmlPath = bundle.replace(/\.js$/, '') + '.html';
  const dataUrl = pathToFileURL(path.join(ROOT, 'data', 'campus.js')).href;
  const infoPath = path.join(ROOT, 'data', 'info.js');
  const infoTag = fs.existsSync(infoPath) ? `<script src="${pathToFileURL(infoPath).href}"></script>` : '';
  const cssPath = path.join(ROOT, 'css', 'styles.css');
  const cssTag = args.css && fs.existsSync(cssPath) ? `<link rel="stylesheet" href="${pathToFileURL(cssPath).href}">` : '';
  fs.writeFileSync(htmlPath, `<!doctype html><html><head><meta charset="utf-8"><title>harness</title>${cssTag}</head><body style="margin:0;background:#000">
<div id="app"></div><script src="${dataUrl}"></script>${infoTag}<script src="${pathToFileURL(bundle).href}"></script></body></html>`);
  pageUrl = pathToFileURL(htmlPath).href;
} else {
  pageUrl = pathToFileURL(path.resolve(args.html || path.join(ROOT, 'index.html'))).href;
}
const query = new URLSearchParams(args.query || '');
if (args.cam && args.look) { query.set('cam', args.cam); query.set('look', args.look); }
if (args.hours) query.set('hours', args.hours);
query.set('shot', '1');
pageUrl += (pageUrl.includes('?') ? '&' : '?') + query.toString();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--allow-file-access-from-files', `--window-size=${W},${H}`, '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
let pageErrors = 0;
const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning' || args.verbose) logs.push(`[console.${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => { pageErrors++; logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 6).join('\n')}`); });
  page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  const t0 = Date.now();
  await page.goto(pageUrl, { waitUntil: 'load', timeout: TIMEOUT });
  try {
    await page.waitForFunction('window.__READY === true', { timeout: TIMEOUT, polling: 250 });
  } catch {
    logs.push(`[shot] window.__READY never became true within ${TIMEOUT} ms`);
  }
  const loadMs = Date.now() - t0;
  if (args.eval) {
    const r = await page.evaluate(args.eval);
    console.log('[eval]', typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  }
  const settle = () => new Promise((r) => setTimeout(r, +(args.settle || 1200)));
  if (args.views) {
    const views = JSON.parse(fs.readFileSync(args.views, 'utf8'));
    const outdir = path.resolve(args.outdir || path.dirname(args.views));
    fs.mkdirSync(outdir, { recursive: true });
    for (const v of views) {
      await page.evaluate((v) => {
        if (v.hours !== undefined && window.__ctx?.env?.setTime) window.__ctx.env.setTime(v.hours);
        if (v.season && window.__ctx?.env?.setSeason) window.__ctx.env.setSeason(v.season);
        if (v.weather && window.__ctx?.env?.setWeather) window.__ctx.env.setWeather(v.weather);
        if (v.eval) (0, eval)(v.eval);
        window.__setView?.(v.cam, v.look);
      }, v);
      await new Promise((r) => setTimeout(r, v.settle ?? +(args.settle || 1200)));
      const out = path.join(outdir, `${v.name}.png`);
      await page.screenshot({ path: out });
      console.log('[shot] wrote', out);
    }
  } else {
    await settle();
    const out = path.resolve(args.out || path.join(ROOT, '.scratch', 'shot.png'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
    console.log('[shot] wrote', out);
  }
  const stats = await page.evaluate(() => {
    const r = window.__ctx?.renderer;
    return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, gl: (() => { const gl = r.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a'; })() } : null;
  });
  console.log(`[shot] ready in ${loadMs} ms`, stats ? JSON.stringify(stats) : '');
} finally {
  for (const l of logs.slice(0, 60)) console.log(l);
  if (logs.length > 60) console.log(`... ${logs.length - 60} more log lines`);
  await browser.close();
}
process.exit(pageErrors ? 2 : 0);
