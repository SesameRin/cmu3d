// Info panel: side sheet on desktop, bottom sheet on phones. Bilingual name, category chip, quick-facts grid,
// description, departments, "did you know" facts and a drawn mini site plan (no photos needed).
// Data: CAMPUS_INFO entry via the catalogue, falling back to CAMPUS_DATA fields.
import { h, escapeHtml, fmtDist, isTouchUI } from './dom.js';
import { icon } from './icons.js';
import { flyToRecord, walkToRecord } from './navutil.js';
import { pointInRing } from '../core/heightfield.js';

// Artworks: their "architect" is an artist (Scotty, Walking to the Sky, Kraus Campo, Dippy, the sculptures…).
const ART_KEYS = new Set(['scotty', 'walkingToTheSky', 'krausCampo', 'dippy', 'fence']);
const ROLE_PREFIX = /^(艺术家|雕塑家|设计师|景观|画家)/;     // the value already names the role
// Curated render styles that are only rendering hints, never facts worth showing.
const HINT_STYLES = new Set(['industrial', 'parking']);

const STYLE_ZH = {
  'beaux-arts': '布扎（学院派）', 'collegiate-brick': '校园砖砌', 'modern-brick': '现代砖砌', 'modern-glass': '现代玻璃',
  'curtain-wall': '玻璃幕墙', brutalist: '粗野主义', 'limestone-classical': '古典石灰岩', 'gothic-stone': '哥特复兴',
  'residential-brick': '砖砌住宅', house: '独立住宅', parking: '停车建筑', industrial: '工业建筑', 'terracotta-modern': '现代陶板',
};

export function createInfoPanel(ctx, { root, catalog, onClose, toast, copyLink }) {
  const closeBtn = h('button.icon-btn.info-close', { type: 'button', 'aria-label': '关闭 (Esc)', title: '关闭 (Esc)', html: icon('close') });
  const grab = h('button.info-grab', { type: 'button', 'aria-label': '展开 / 收起' }, h('i'));
  const chips = h('div.info-chips');
  const title = h('h2.info-title', { id: 'info-title', 'aria-live': 'polite' });
  const en = h('div.info-en');
  const aka = h('div.info-aka');
  const plan = h('canvas.info-plan', { 'aria-hidden': 'true' });
  const planWrap = h('div.info-hero', null, [plan, h('span.info-hero-n', null, 'N')]);
  const body = h('div.info-body');
  const flyBtn = h('button.btn.btn-primary', { type: 'button' }, [h('span', { html: icon('target') }), h('span', null, '飞过去')]);
  const walkBtn = h('button.btn.btn-ghost', { type: 'button' }, [h('span', { html: icon('walk') }), h('span', null, '步行到这里')]);
  const linkBtn = h('button.icon-btn', { type: 'button', title: '复制此视角链接', 'aria-label': '复制此视角链接', html: icon('link') });

  // A non-modal side panel: a labelled region whose title is announced (aria-live) when it opens or changes.
  const el = h('aside.info.hud-hideable', { role: 'region', 'aria-labelledby': 'info-title', 'aria-hidden': 'true', tabindex: '-1' }, [
    grab,
    h('header.info-head', null, [h('div.info-toprow', null, [chips, closeBtn]), title, en, aka]),
    h('div.info-scroll', null, [planWrap, body]),
    h('footer.info-actions', null, [flyBtn, walkBtn, linkBtn]),
  ]);
  root.appendChild(el);

  let current = null;
  let open = false;
  let collapsed = false;

  // collapsed form (touch walk / fly): name + "介绍" reopens the panel, × closes it
  const chipName = h('span.ichip-name');
  const chipOpen = h('button.ichip-open', { type: 'button', 'aria-label': '展开介绍' }, [h('span.ichip-ico', { html: icon('info') }), chipName, h('span.ichip-more', null, '介绍')]);
  const chipClose = h('button.icon-btn.sm.ichip-close', { type: 'button', 'aria-label': '关闭介绍', html: icon('close') });
  const chip = h('div.info-chip.glass', { 'aria-hidden': 'true' }, [chipOpen, chipClose]);
  root.appendChild(chip);
  chipOpen.addEventListener('click', () => { if (current) show(current); });
  chipClose.addEventListener('click', () => hide());

  closeBtn.addEventListener('click', () => hide());
  grab.addEventListener('click', () => { el.classList.toggle('expanded'); root.classList.toggle('info-expanded', el.classList.contains('expanded')); });
  flyBtn.addEventListener('click', () => { if (current) flyToRecord(ctx, current); });
  walkBtn.addEventListener('click', () => {
    if (!current) return;
    if (!walkToRecord(ctx, current)) toast?.('步行模式暂不可用');
    else if (isTouchUI(ctx)) collapse();
    else if (innerWidth < 720) hide();
  });
  linkBtn.addEventListener('click', () => copyLink?.());

  function fact(label, value) {
    if (value === null || value === undefined || value === '') return null;
    return h('div.fact', null, [h('dt', null, label), h('dd', null, String(value))]);
  }

  function render(rec) {
    const inf = catalog.infoFor(rec) || null;
    const b = rec.building || null;
    const nameZh = inf?.nameZh || rec.nameZh || '';
    const nameEn = inf?.nameEn || rec.nameEn || '';

    chips.innerHTML = '';
    chips.append(h('span.chip.chip-cat', { html: `${icon(rec.cat?.icon || 'pin')}<span>${escapeHtml(rec.cat?.zh || '地点')}</span>` }));
    const cmu = rec.kind === 'landmark' ? !!rec.campus : !!(rec.campus || b?.campus);
    if (cmu) chips.append(h('span.chip.chip-cmu', null, 'CMU'));
    else if (rec.kind === 'landmark') {
      // neighbours of the campus: say whose they are instead of a misleading CMU chip
      const txt = `${nameEn} ${inf?.function || ''} ${[].concat(inf?.aka || []).join(' ')} ${(inf?.tags || []).join(' ')}`;
      chips.append(h('span.chip.chip-near', null, /\bPitt\b|University of Pittsburgh|匹兹堡大学/.test(txt) ? '匹兹堡大学' : '奥克兰 · Oakland'));
    }
    if (rec.kind === 'landmark') chips.append(h('span.chip.chip-star', { html: `${icon('star')}<span>必看</span>` }));

    title.textContent = nameZh || nameEn || (rec.cat?.zh ? `未命名${rec.cat.zh}` : '未命名地点');
    en.textContent = nameZh ? nameEn : (rec.cat?.en || '');
    en.hidden = !en.textContent;
    const akaList = [].concat(inf?.aka || []).filter(Boolean);
    aka.textContent = akaList.length ? `又称 ${akaList.join(' / ')}` : '';
    aka.hidden = !akaList.length;

    body.innerHTML = '';
    // ---- quick facts
    const lmKey = rec.landmarkKey || rec.infoLandmarkKey || '';
    const isArt = ART_KEYS.has(lmKey) || rec.cat?.zh === '公共艺术' || rec.cat?.zh === '纪念物' || !!rec.poi?.artworkType
      || (inf?.tags || []).some((t) => /^(雕塑|公共艺术|sculpture|artwork)$/i.test(t));
    const venue = lmKey === 'stadium' || ['stadium', 'pitch', 'track'].includes(rec.type);
    const floors = inf?.floors ?? b?.levels ?? null;
    let heightTxt = null;
    if (b && b.heightSource && b.heightSource !== 'default' && b.height) heightTxt = `约 ${Math.round(b.height)} 米`;
    else if (rec.height && b?.heightSource !== 'default') heightTxt = `约 ${Math.round(rec.height)} 米`;
    const floorsTxt = venue || isArt ? null : floors ? `${floors} 层${heightTxt ? ` · ${heightTxt}` : ''}` : heightTxt;
    // curated render styles are shown only for plain buildings nobody has described yet
    const style = inf?.style || (!inf && rec.kind === 'building' && b?.style && !HINT_STYLES.has(b.style) ? STYLE_ZH[b.style] || null : null);
    const maker = inf?.architect || null;
    const makerLabel = !maker ? '' : ROLE_PREFIX.test(maker) ? '创作' : isArt ? '艺术家' : rec.kind === 'area' ? '设计' : '建筑师';
    const grid = h('dl.facts-grid', null, [
      fact('建成', inf?.built),
      maker ? fact(makerLabel, maker) : null,
      fact('风格', style),
      rec.kind === 'area' ? fact('面积', rec.areaM2 ? `约 ${fmtArea(rec.areaM2)}` : null) : fact('楼层 / 高度', floorsTxt),
      fact('用途', inf?.function),
      rec.poi?.artist && !maker ? fact('艺术家', rec.poi.artist) : null,
      rec.poi?.cuisine ? fact('菜系', rec.poi.cuisine.replace(/;/g, ' · ')) : null,
    ].filter(Boolean));
    if (grid.children.length) body.append(grid);

    // ---- description
    if (inf?.description) body.append(h('p.info-desc', null, inf.description));
    else body.append(h('p.info-desc.muted', null, fallbackText(rec, b)));

    // ---- departments
    if (inf?.departments?.length) {
      body.append(h('section.info-sec', null, [
        h('h3', null, '院系与机构'),
        h('div.tags', null, inf.departments.map((d) => h('span.tag', null, d))),
      ]));
    }
    // ---- facts
    if (inf?.facts?.length) {
      body.append(h('section.info-sec', null, [
        h('h3', null, '你知道吗'),
        h('ul.info-facts', null, inf.facts.map((f) => h('li', null, f))),
      ]));
    }
    // ---- meta
    const meta = [];
    if (rec.near) meta.push(`位于 ${rec.near.nameZh || rec.near.nameEn}`);
    if (b?.address) meta.push(b.address);
    const cam = ctx.camera?.position;
    if (cam && rec.position) meta.push(`距镜头 ${fmtDist(Math.hypot(cam.x - rec.position[0], cam.z - rec.position[2]))}`);
    if (rec.osmId) meta.push(`OSM ${rec.osmId}`);
    if (!inf) meta.push('数据来源：OpenStreetMap');
    if (meta.length) body.append(h('div.info-meta', null, meta.join(' · ')));

    walkBtn.hidden = !ctx.nav?.walkTo;
    flyBtn.hidden = !(ctx.nav?.flyTo || ctx.nav?.setView);
    drawPlan(plan, rec, ctx.data);
  }

  function fallbackText(rec, b) {
    const raw = rec.nameZh || rec.nameEn || '这里';
    // "Wesley W. Posvar Hall 是…": a space between a Latin-script name and the Chinese sentence
    const name = /[A-Za-z0-9.)’']$/.test(raw) ? `${raw} ` : raw;
    const cat = rec.cat?.zh || '建筑';
    if (rec.kind === 'building' || b) {
      const lv = b?.levels ? `，地上约 ${b.levels} 层` : '';
      const pitt = /\bPitt\b|University of Pittsburgh/i.test(`${rec.nameEn || ''} ${b?.name || ''}`);
      const where = b?.campus || rec.campus ? '位于卡内基梅隆大学校园内的' : pitt ? '匹兹堡大学的' : `位于${areaName(rec.position)}的`;
      return `${name}是${where}一座${cat}${lv}。暂时还没有更详细的介绍——外形与高度来自 OpenStreetMap 社区绘制的数据。`;
    }
    if (rec.kind === 'area') return `${name}是${rec.campus ? '校园中' : '附近'}的一处${cat}。在俯瞰模式下可以看清它的全貌，或者切换到步行模式身临其境地走一走。`;
    if (rec.kind === 'poi') return `${name}是一处${cat}${rec.campus ? '，就在校园里' : ''}。暂时还没有更详细的介绍。`;
    return `${name} · 暂无详细介绍。`;
  }

  // Which part of town a non-CMU building is in (Fifth Avenue is the Shadyside / Squirrel Hill line;
  // Pitt and the museums lie west of Craig Street; the park is the OSM polygon).
  let geo = null;
  function areaName(pos) {
    if (!pos) return '卡内基梅隆大学校园周边';
    const [x, , z] = pos;
    if (!geo) {
      const data = ctx.data || {};
      const park = (data.areas || []).find((a) => a.name === 'Schenley Park' && a.polygon?.length > 2)?.polygon || null;
      const fifth = (data.roads || []).filter((r) => r.name === 'Fifth Avenue').flatMap((r) => r.points).sort((a, c) => a[0] - c[0]);
      geo = { park, fifth };
    }
    if (geo.park && pointInRing(x, z, geo.park)) return '申利公园（Schenley Park）';
    if (x < -450) return '奥克兰（Oakland）、匹兹堡大学一带';
    let fz = null;
    const f = geo.fifth;
    if (f.length > 1 && x >= f[0][0] && x <= f[f.length - 1][0]) {
      let i = 1;
      while (i < f.length - 1 && f[i][0] < x) i++;
      const a = f[i - 1], c = f[i], t = c[0] > a[0] ? (x - a[0]) / (c[0] - a[0]) : 0;
      fz = a[1] + (c[1] - a[1]) * t;
    }
    if (fz !== null && x > 60 && Math.abs(z - fz) < 80) return '第五大道（Fifth Avenue）沿线';   // either side: say the street
    if (fz !== null && z < fz && x > 150) return '沙迪赛德（Shadyside）一带';
    if (x > 60 && (fz === null || z > fz)) return '松鼠山（Squirrel Hill）一带';
    return '卡内基梅隆大学校园周边';
  }

  function show(rec) {
    if (!rec) return hide();
    setChip(false);
    current = rec;
    render(rec);
    el.querySelector('.info-scroll').scrollTop = 0;
    if (!open) {
      open = true;
      el.classList.add('open');
      el.setAttribute('aria-hidden', 'false');
      root.classList.add('info-open');
    } else {
      el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    }
  }
  function close() {
    open = false;
    el.classList.remove('open', 'expanded');
    el.setAttribute('aria-hidden', 'true');
    root.classList.remove('info-open', 'info-expanded');
  }
  function hide(silent = false) {
    const had = open || collapsed;
    setChip(false);
    if (!had) return;
    current = null;
    close();
    if (!silent) onClose?.();
  }
  // Touch walk / fly: the joystick takes the left of the screen and a drag elsewhere looks around, so the panel
  // folds into a small chip (top left) that reopens it; the selection stays.
  function collapse() {
    if (!open || !current) return false;
    close();
    chipName.textContent = title.textContent;
    setChip(true);
    return true;
  }
  function setChip(on) {
    collapsed = on;
    chip.classList.toggle('show', on);
    chip.setAttribute('aria-hidden', String(!on));
  }

  return {
    el, show, hide, collapse,
    get isOpen() { return open; },
    get collapsed() { return collapsed; },
    get current() { return current; },
  };
}

function fmtArea(m2) {
  if (m2 > 100000) return `${(m2 / 10000).toFixed(1)} 公顷`;
  return `${Math.round(m2 / 100) * 100} 平方米`;
}

// ---------------------------------------------------------------- mini site plan
function drawPlan(canvas, rec, data) {
  const cssW = canvas.clientWidth || 340, cssH = canvas.clientHeight || 132;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cssW, cssH);
  if (!rec?.position || !data) return;
  const [cx, , cz] = rec.position;
  const r = Math.max(45, Math.min(rec.radius || 30, 320)) * 2.1;
  const s = Math.min(cssW, cssH * 2.2) / (r * 2) * 0.95;
  const X = (x) => cssW / 2 + (x - cx) * s;
  const Z = (z) => cssH / 2 + (z - cz) * s;
  const rw = cssW / s / 2 + 10, rh = cssH / s / 2 + 10;
  const inView = (pts) => pts.some(([x, z]) => Math.abs(x - cx) < rw && Math.abs(z - cz) < rh);
  const poly = (ring) => { g.moveTo(X(ring[0][0]), Z(ring[0][1])); for (let i = 1; i < ring.length; i++) g.lineTo(X(ring[i][0]), Z(ring[i][1])); g.closePath(); };
  const line = (pts) => { g.moveTo(X(pts[0][0]), Z(pts[0][1])); for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Z(pts[i][1])); };

  // greens
  g.beginPath();
  for (const a of data.areas || []) if (['grass', 'park', 'garden', 'wood', 'pitch', 'golf', 'stadium'].includes(a.type) && inView(a.polygon)) poly(a.polygon);
  g.fillStyle = 'rgba(110,160,105,0.16)'; g.fill();
  // roads / paths
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(247,244,238,0.12)';
  for (const rd of data.roads || []) if (!rd.tunnel && inView(rd.points)) { g.lineWidth = Math.max(1, (rd.width || 6) * s); g.beginPath(); line(rd.points); g.stroke(); }
  g.strokeStyle = 'rgba(247,244,238,0.10)'; g.lineWidth = Math.max(0.7, 1.6 * s);
  g.beginPath(); for (const p of data.paths || []) if (!p.indoor && inView(p.points)) line(p.points); g.stroke();
  // neighbours
  const mine = new Set((rec.osmIds || []).concat(rec.osmId ? [rec.osmId] : []));
  g.beginPath();
  for (const b of data.buildings || []) if (!mine.has(b.osmId) && inView(b.footprint)) poly(b.footprint);
  g.fillStyle = 'rgba(247,244,238,0.10)'; g.fill();
  g.strokeStyle = 'rgba(247,244,238,0.22)'; g.lineWidth = 1; g.stroke();
  // subject
  let drew = false;
  g.beginPath();
  for (const b of data.buildings || []) if (mine.has(b.osmId)) { poly(b.footprint); drew = true; }
  if (!drew && rec.area?.polygon) { poly(rec.area.polygon); drew = true; }
  if (drew) {
    g.shadowColor = 'rgba(196,18,48,0.8)'; g.shadowBlur = 14;
    g.fillStyle = rec.area ? 'rgba(120,190,120,0.55)' : 'rgba(196,18,48,0.78)';
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = rec.area ? 'rgba(200,240,200,0.9)' : '#ff9aa6'; g.lineWidth = 1.4; g.stroke();
  } else {
    const x = X(cx), y = Z(cz);
    g.fillStyle = 'rgba(196,18,48,0.25)'; g.beginPath(); g.arc(x, y, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c41230'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
  }
  // scale bar
  const target = pickScale(80 / s);
  const len = target * s;
  const bx = 14, by = cssH - 14;
  g.strokeStyle = 'rgba(247,244,238,0.75)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by); g.lineTo(bx + len, by); g.lineTo(bx + len, by - 4); g.stroke();
  g.fillStyle = 'rgba(247,244,238,0.8)'; g.font = '500 10px "Noto Sans SC", system-ui, sans-serif';
  g.fillText(`${target} m`, bx + len + 6, by);
}
function pickScale(m) {
  const steps = [10, 20, 25, 50, 100, 200, 250, 500];
  let best = steps[0];
  for (const s of steps) if (s <= m) best = s;
  return best;
}
