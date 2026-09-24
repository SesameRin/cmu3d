// Unified catalogue of everything the UI can show, search for and fly to:
// named buildings, hand-modelled landmarks, named areas (lawns, parks, stadium…) and POIs (art, cafés…).
// Merges CAMPUS_DATA (geometry, OSM names) with CAMPUS_INFO (bilingual descriptions) and ctx.landmarks.
import * as THREE from 'three';
import { pointInRing } from '../core/heightfield.js';

// ---------------------------------------------------------------- categories
const CAT = (zh, en, icon) => ({ zh, en, icon });
const BUILDING_CATS = {
  university: CAT('教学科研楼', 'Academic building', 'building'),
  college: CAT('教学科研楼', 'Academic building', 'building'),
  school: CAT('学校', 'School', 'building'),
  dormitory: CAT('学生宿舍', 'Residence hall', 'home'),
  apartments: CAT('公寓', 'Apartments', 'home'),
  residential: CAT('住宅', 'Residential', 'home'),
  house: CAT('住宅', 'House', 'home'),
  parking: CAT('停车楼', 'Parking garage', 'parking'),
  church: CAT('宗教建筑', 'Place of worship', 'church'),
  cathedral: CAT('宗教建筑', 'Cathedral', 'church'),
  chapel: CAT('宗教建筑', 'Chapel', 'church'),
  synagogue: CAT('宗教建筑', 'Synagogue', 'church'),
  religious: CAT('宗教建筑', 'Place of worship', 'church'),
  library: CAT('图书馆', 'Library', 'book'),
  glasshouse: CAT('温室', 'Conservatory', 'leaf'),
  greenhouse: CAT('温室', 'Conservatory', 'leaf'),
  retail: CAT('商铺', 'Retail', 'building'),
  commercial: CAT('商业与办公', 'Commercial', 'building'),
  office: CAT('办公楼', 'Office', 'building'),
  civic: CAT('公共建筑', 'Civic', 'building'),
  public: CAT('公共建筑', 'Public building', 'building'),
};
const AREA_CATS = {
  grass: CAT('草坪', 'Lawn', 'leaf'),
  park: CAT('公园', 'Park', 'tree'),
  garden: CAT('花园', 'Garden', 'flower'),
  wood: CAT('树林', 'Woods', 'tree'),
  scrub: CAT('灌木地', 'Scrub', 'tree'),
  stadium: CAT('体育场', 'Stadium', 'stadium'),
  pitch: CAT('运动场', 'Sports field', 'stadium'),
  track: CAT('跑道', 'Running track', 'stadium'),
  golf: CAT('高尔夫球场', 'Golf course', 'leaf'),
  water: CAT('水景', 'Water', 'drop'),
  plaza: CAT('广场', 'Plaza', 'pin'),
  pavement: CAT('广场', 'Plaza', 'pin'),
  parking: CAT('停车场', 'Parking lot', 'parking'),
  bridgeArea: CAT('桥梁', 'Bridge', 'landmark'),
  playground: CAT('游乐场', 'Playground', 'leaf'),
  flowerbed: CAT('花坛', 'Flower bed', 'flower'),
  construction: CAT('施工区', 'Construction', 'warn'),
};
const POI_CATS = {
  artwork: CAT('公共艺术', 'Artwork', 'palette'),
  memorial: CAT('纪念物', 'Memorial', 'memorial'),
  cafe: CAT('咖啡馆', 'Café', 'cup'),
  restaurant: CAT('餐厅', 'Restaurant', 'fork'),
  fast_food: CAT('快餐', 'Fast food', 'fork'),
  bar: CAT('酒吧', 'Bar', 'cup'),
  library: CAT('图书馆', 'Library', 'book'),
  museum: CAT('博物馆', 'Museum', 'landmark'),
  fountain: CAT('喷泉', 'Fountain', 'drop'),
  place_of_worship: CAT('宗教场所', 'Place of worship', 'church'),
  bank: CAT('银行', 'Bank', 'bank'),
  police: CAT('校警', 'Police', 'shield'),
  bicycle_rental: CAT('共享单车', 'Bike share', 'bike'),
  information: CAT('问讯处', 'Information', 'info'),
  school: CAT('学校', 'School', 'building'),
  social_centre: CAT('活动中心', 'Community centre', 'home'),
  hotel: CAT('酒店', 'Hotel', 'home'),
  shelter: CAT('凉亭', 'Shelter', 'home'),
};
export const LANDMARK_CAT = CAT('地标', 'Landmark', 'landmark');
const BUILDING_DEFAULT = CAT('建筑', 'Building', 'building');

export function categoryFor(kind, type) {
  if (kind === 'landmark') return LANDMARK_CAT;
  if (kind === 'building') return BUILDING_CATS[type] || BUILDING_DEFAULT;
  if (kind === 'area') return AREA_CATS[type] || CAT('区域', 'Area', 'pin');
  if (kind === 'poi') return POI_CATS[type] || CAT('地点', 'Place', 'pin');
  return CAT('地点', 'Place', 'pin');
}

// Non-building landmarks the info agent may describe without a 3D module: approximate positions (see ARCHITECTURE).
const KNOWN_SPOTS = {
  randyPauschBridge: [-100, -25],
  fence: [-37, 83],
  walkingToTheSky: [9, -127],
  scotty: [65, -16],
  krausCampo: [43, 175],
  theCut: [2, -23],
  theMall: [-214, 101],
  cfaLawn: [-32, 129],
};

// Preferred views (the side a building is best seen from — its front): used by 飞过去 / 步行到这里 instead of
// whatever side the camera happens to be on. { stand:[x,z] } a checked eye-level spot · { from:[x,z] } a point on
// that side · { fromArea: name } that area's centre · { heading: compass deg the camera looks along }.
// CAMPUS_INFO entries may carry their own `view`, landmark defs a `view` or `frontHeading` (compass radians).
const VIEW_SEEDS = {
  cfa: { stand: [-30, 125] },                    // the carved lawn front (five niches, CREARE frieze) across the CFA Lawn
  hamerschlag: { fromArea: 'The Mall' },         // the pedimented Mall front with the ceremonial arch
  hunt: { from: [-63, 150] },                    // the entrance front faces the Mall to the north
  mmch: { from: [120, 150] },                    // the rotunda on Margaret Morrison Street
  cathedralOfLearning: { fromArea: 'Cathedral Lawn' },
};

// Extra search words per category (zh <-> en synonyms) so "dorm", "coffee", "football", "宿舍" find the right places.
const CAT_SYNONYMS = {
  学生宿舍: 'dorm dorms dormitory residence 宿舍 住宿',
  教学科研楼: 'academic classroom 教学楼 教室 上课 实验室',
  图书馆: 'library books 图书 书',
  咖啡馆: 'coffee cafe 咖啡 食堂 餐饮',
  餐厅: 'food dining eat 吃饭 餐饮 美食 食堂 canteen',
  快餐: 'food dining eat 吃饭 餐饮 美食 食堂 canteen',
  体育场: 'stadium football soccer sports 橄榄球 足球 运动 体育',
  运动场: 'field sports football soccer 运动 体育 球场',
  跑道: 'track running 田径 跑步',
  停车楼: 'parking garage 停车',
  停车场: 'parking 停车',
  宗教建筑: 'church chapel 教堂',
  博物馆: 'museum 博物馆 展览',
  公共艺术: 'art sculpture 雕塑 艺术',
  纪念物: 'memorial monument 纪念',
  温室: 'garden greenhouse 植物',
};
const SPORT_ZH = { american_football: '橄榄球 football', soccer: '足球 soccer', baseball: '棒球 baseball', tennis: '网球 tennis', basketball: '篮球 basketball', running: '跑步 running', golf: '高尔夫 golf' };
// Search-only aliases by landmark key or OSM id (nicknames, other spellings, what people are likely to type).
const LANDMARK_ALIASES = {
  scotty: '狗 小狗 梗犬 苏格兰梗 dog terrier mascot 吉祥物',
  stadium: 'football soccer 橄榄球 足球 田径 track 体育场 操场 gesling',
  fence: '围栏 栅栏 彩绘 涂鸦 painted fence',
  walkingToTheSky: '雕塑 sculpture borofsky 天空',
  randyPauschBridge: '桥 bridge pausch 兰迪 企鹅 penguin 最后一课 last lecture',
  krausCampo: '花园 garden 艺术花园',
  dippy: '恐龙 dinosaur diplodocus 梁龙',
  cathedralOfLearning: 'pitt 匹大 皮特 匹兹堡大学 cathedral 大教堂',
  heinzChapel: '匹兹堡大学 chapel 教堂 亨氏教堂',
  phipps: 'greenhouse conservatory 温室 植物园',
  hunt: 'library 图书馆',
  gates: 'ghc scs computer science 计算机 盖茨中心 盖茨楼',
  cohon: 'uc university center 大学中心 学生中心 科翁中心 科恩 科恩中心 gym 健身房 健身 pool 游泳池 游泳 bookstore 书店 食堂 dining 最后一课 last lecture',
  tepper: '泰珀大楼 泰珀楼 tepper building tepper quad 商学院 business school',
  hamerschlag: 'hammerschlag hamerschlag hall',
  purnell: '珀内尔中心 purnell center 剧场 theater',
  cfa: 'fine arts art 艺术 沃霍尔 安迪·沃霍尔 warhol andy warhol',
  buggy: 'buggy sweepstakes 赛车 无动力车',
  carnival: 'carnival booth midway 嘉年华 狂欢节',
  kiltieBand: 'band bagpipe 乐队 风笛',
  w1039908831: 'gym 健身房 健身 fitness 体育馆 athletics highmark',     // Highmark Center
  w27551364: '笑脸 smiley emoticon :-) 可乐 coke machine',                 // Wean Hall
  w27574394: 'uc university center 大学中心 学生中心 科翁中心 科恩 gym 健身房 pool 游泳池 bookstore 书店 食堂',   // Cohon UC
  w583510520: '泰珀大楼 泰珀楼 tepper building 商学院',                   // Tepper
  w27551077: 'hammerschlag',                                              // Hamerschlag Hall
  w27574406: '珀内尔中心 purnell center 剧场',                             // Purnell
  w27623372: '盖茨中心 盖茨楼 ghc',                                        // Gates-Hillman
};
// Whole-query aliases: other spellings / nicknames searched as well (the best of both scores wins).
const QUERY_ALIASES = { 匹大: '匹兹堡大学', 皮特: '匹兹堡大学', pitt: '匹兹堡大学', 皮特大学: '匹兹堡大学', 匹兹堡大学: 'pitt', uc: '科翁大学中心' };
// Queries meaning "the whole campus": a pinned result that flies back to the overview.
const CAMPUS_QUERY = /^(cmu|c\s*m\s*u\s*校园|cmu\s*campus|carnegie\s*mellon(\s*university)?(\s*campus)?|卡内基梅隆(大学)?(校园)?|梅隆大学|卡内基\s*梅隆|校园|校园全景|全景|campus)$/i;
export const HOME_RECORD = Object.freeze({
  key: 'home', kind: 'home', action: 'home', nameZh: '卡内基梅隆大学校园 · 全景', nameEn: 'Carnegie Mellon University — campus overview',
  cat: { zh: '全景', en: 'Overview', icon: 'target' },
});
// Chinese spelling variants (卡耐基 is a common spelling of 卡内基).
const zhVariants = (s) => s.replace(/卡耐基/g, '卡内基').replace(/梅伦/g, '梅隆');
const ZH_PUNCT = /[\s\-‐–—·・•.,，。、:：;；'"“”‘’()（）[\]【】]/g;
const isCJK = (s) => /[㐀-鿿]/.test(s);

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[\u2019'`".,()\-\u2013\u2014\u00b7:]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['and', 'the', 'of', 'for', 'at', 'a', 'on', '&']);
const initials = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w)).map((w) => w[0]).join('');

function ringStats(ring) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, a = 0, cx = 0, cz = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    const f = xj * zi - xi * zj;
    a += f; cx += (xi + xj) * f; cz += (zi + zj) * f;
    if (xi < x0) x0 = xi; if (xi > x1) x1 = xi; if (zi < z0) z0 = zi; if (zi > z1) z1 = zi;
  }
  a *= 0.5;
  let c = Math.abs(a) > 1e-6 ? [cx / (6 * a), cz / (6 * a)] : [(x0 + x1) / 2, (z0 + z1) / 2];
  if (!pointInRing(c[0], c[1], ring)) c = [(x0 + x1) / 2, (z0 + z1) / 2];
  return { x0, x1, z0, z1, area: Math.abs(a), center: c, radius: Math.hypot(x1 - x0, z1 - z0) / 2 };
}

export function createCatalog(ctx) {
  const data = ctx.data || { buildings: [], areas: [], pois: [], paths: [] };
  const H = (x, z) => { try { return ctx.heightAt(x, z); } catch { return 45; } };
  const records = [];
  const byKey = new Map();
  const byOsm = new Map();     // osmId → record (landmarks claim the osmIds they replace)
  const byName = new Map();    // normalised English name → record

  const info = () => ctx.info || window.CAMPUS_INFO || {};

  function add(rec) {
    if (byKey.has(rec.key)) return byKey.get(rec.key);
    rec.cat = rec.cat || categoryFor(rec.kind, rec.type);
    records.push(rec);
    byKey.set(rec.key, rec);
    if (rec.nameEn) { const n = norm(rec.nameEn); if (!byName.has(n)) byName.set(n, rec); }
    return rec;
  }

  // ---------------------------------------------------------------- buildings grouped by osmId
  const groups = new Map();
  for (const b of data.buildings || []) {
    if (!b.footprint || b.footprint.length < 3) continue;
    const id = b.osmId || b.id;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(b);
  }
  function buildingGeom(list) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, gMin = Infinity, top = -Infinity, area = 0;
    for (const b of list) {
      const s = ringStats(b.footprint);
      x0 = Math.min(x0, s.x0); x1 = Math.max(x1, s.x1); z0 = Math.min(z0, s.z0); z1 = Math.max(z1, s.z1);
      gMin = Math.min(gMin, b.ground?.min ?? H(b.centroid[0], b.centroid[1]));
      top = Math.max(top, (b.ground?.min ?? 0) + (b.height || 10));
      area += b.area || s.area;
    }
    const main = list.reduce((a, b) => ((b.area || 0) > (a.area || 0) ? b : a), list[0]);
    let c = main.centroid;
    if (list.length > 1) c = [(x0 + x1) / 2, (z0 + z1) / 2];
    return { center: c, radius: Math.max(12, Math.hypot(x1 - x0, z1 - z0) / 2), ground: gMin, top, area };
  }

  // ---------------------------------------------------------------- landmarks (3D modules)
  // Static pick entries registered by landmark modules carry an accurate focus position + radius.
  const pickByKey = new Map();
  for (const e of ctx.pick?.items?.values?.() || []) {
    if (e && typeof e === 'object' && e.kind === 'landmark' && e.key && !pickByKey.has(e.key)) pickByKey.set(e.key, e);
  }
  const labelFor = (key) => ctx.labels?.items?.get(key) || ctx.labels?.items?.get(`landmark:${key}`) || null;
  const box = new THREE.Box3();
  const tmpV = new THREE.Vector3();
  function addLandmark(lm) {
    const inf = info().landmarks?.[lm.key];
    // Landmarks that replace OSM buildings are described under CAMPUS_INFO.buildings[osmId]: their names win too,
    // so labels, tooltips, search, tour and the info panel all show one name.
    const bInf = (lm.osmIds || []).map((id) => info().buildings?.[id]).find(Boolean) || null;
    let pos = null, radius = 30;
    const label = labelFor(lm.key);
    const pe = pickByKey.get(lm.key);
    if (pe?.position) {
      const p = Array.isArray(pe.position) ? pe.position : [pe.position.x, pe.position.y, pe.position.z];
      if (p.every(Number.isFinite)) { pos = p.slice(); radius = pe.radius || radius; }
    }
    const firstB = (lm.osmIds || []).map((id) => groups.get(id)).find(Boolean);
    if (firstB) {
      const g = buildingGeom(firstB);
      if (!pos) pos = [g.center[0], (g.ground + g.top) / 2, g.center[1]];
      radius = Math.max(pe?.radius || 0, g.radius);
    }
    if (lm.object && !pos) {
      try {
        box.setFromObject(lm.object);
        if (!box.isEmpty() && Number.isFinite(box.min.x)) {
          const size = box.getSize(tmpV);
          if (size.x < 3000 && size.z < 3000) {
            const c = box.getCenter(new THREE.Vector3());
            if (!pos) pos = [c.x, c.y, c.z];
            radius = Math.max(radius, Math.hypot(size.x, size.z) / 2);
          }
        }
      } catch { /* ignore */ }
    }
    if (!pos && label?.position) pos = [label.position.x, label.position.y - 10, label.position.z];
    if (!pos && KNOWN_SPOTS[lm.key]) { const [x, z] = KNOWN_SPOTS[lm.key]; pos = [x, H(x, z) + 5, z]; }
    if (!pos) return null;
    const rec = add({
      key: `lm:${lm.key}`, kind: 'landmark', landmarkKey: lm.key, type: 'landmark',
      nameEn: inf?.nameEn || bInf?.nameEn || lm.name || pe?.name || label?.text || lm.key,
      nameZh: inf?.nameZh || bInf?.nameZh || lm.nameZh || pe?.nameZh || label?.textZh || '',
      infoKey: pe?.infoKey,
      osmIds: lm.osmIds || [], osmId: (lm.osmIds || [])[0] || null,
      position: pos, radius: Math.max(10, Math.min(radius, 260)),
      // CMU or not (the Cathedral of Learning, the Carnegie museums, Phipps… are neighbours, not CMU)
      campus: firstB ? firstB.some((b) => b.campus) : inCampus(pos[0], pos[2]),
      featured: true,
      building: firstB ? firstB[0] : null,
      view: inf?.view || bInf?.view || lm.view || (Number.isFinite(lm.frontHeading) ? { heading: (lm.frontHeading * 180) / Math.PI } : null)
        || VIEW_SEEDS[lm.key] || null,
    });
    for (const id of lm.osmIds || []) byOsm.set(id, rec);
    return rec;
  }
  for (const lm of ctx.landmarks || []) addLandmark(lm);

  // ---------------------------------------------------------------- buildings
  for (const [id, list] of groups) {
    if (byOsm.has(id)) continue;
    const b = list[0];
    const inf = info().buildings?.[id];
    const name = list.find((x) => x.name)?.name || inf?.nameEn || null;
    const nameZh = list.find((x) => x.nameZh)?.nameZh || inf?.nameZh || '';
    if (!name && !nameZh) continue;
    if (list.every((x) => x.hidden) && !inf) continue;
    const g = buildingGeom(list);
    const dorm = b.type === 'dormitory' || (b.campus && ['residential', 'house', 'apartments', 'detached'].includes(b.type))
      || (inf?.tags || []).includes('宿舍') || /宿舍/.test(inf?.function || '');
    const rec = add({
      key: `b:${id}`, kind: 'building', type: b.type, osmId: id, osmIds: [id],
      ...(dorm ? { cat: BUILDING_CATS.dormitory } : {}),
      nameEn: name || inf?.nameEn || '', nameZh, campus: !!b.campus,
      position: [g.center[0], (g.ground + g.top) / 2, g.center[1]], radius: g.radius,
      building: b, parts: list, height: g.top - g.ground,
    });
    byOsm.set(id, rec);
  }

  // ---------------------------------------------------------------- areas
  const lmByName = (n) => {
    const k = norm(n);
    for (const r of records) if (r.kind === 'landmark' && (norm(r.nameEn) === k || (k.length > 5 && norm(r.nameEn).includes(k)))) return r;
    return null;
  };
  for (const a of data.areas || []) {
    if (!a.name || !a.polygon || a.polygon.length < 3) continue;
    const k = `area:${a.name}`;
    if (byKey.has(k)) continue;
    const lm = lmByName(a.name);
    if (lm) { byKey.set(k, lm); continue; }
    const s = ringStats(a.polygon);
    const inf = info().areas?.[a.name];
    add({
      key: k, kind: 'area', type: a.type, nameEn: a.name, nameZh: inf?.nameZh || '',
      position: [s.center[0], H(s.center[0], s.center[1]) + 2, s.center[1]],
      radius: Math.max(15, Math.min(s.radius, 500)), area: a, areaM2: s.area,
      campus: inCampus(s.center[0], s.center[1]),
    });
  }

  // ---------------------------------------------------------------- POIs
  const seen = new Map();
  for (const p of data.pois || []) {
    if (!p.name || !POI_CATS[p.type]) continue;
    const lm = lmByName(p.name);
    if (lm) { byKey.set(`poi:${p.name}`, lm); continue; }
    const n = (seen.get(p.name) || 0) + 1;
    seen.set(p.name, n);
    const inf = info().pois?.[p.name];
    add({
      key: n === 1 ? `poi:${p.name}` : `poi:${p.name}#${n}`, kind: 'poi', type: p.type,
      nameEn: p.name, nameZh: inf?.nameZh || '', poi: p,
      position: [p.x, H(p.x, p.z) + 1.5, p.z], radius: 12,
      campus: inCampus(p.x, p.z),
    });
  }

  // ---------------------------------------------------------------- info-only landmarks (no 3D module)
  for (const [key, inf] of Object.entries(info().landmarks || {})) {
    if (byKey.has(`lm:${key}`)) continue;
    const match = byName.get(norm(inf.nameEn));
    if (match && match.kind !== 'landmark') {
      // An OSM feature with this name already exists — upgrade it to a landmark entry.
      match.infoLandmarkKey = key; match.featured = true;
      if (!match.nameZh && inf.nameZh) match.nameZh = inf.nameZh;
      byKey.set(`lm:${key}`, match);
      continue;
    }
    let pos = null;
    const ip = Array.isArray(inf.position) ? inf.position.map(Number) : null;
    if (ip && ip.length >= 3 && ip.slice(0, 3).every(Number.isFinite)) pos = ip.slice(0, 3);
    else if (ip && ip.length === 2 && ip.every(Number.isFinite)) pos = [ip[0], H(ip[0], ip[1]) + 4, ip[1]];
    const label = ctx.labels?.items?.get(key);
    if (!pos && label?.position) pos = [label.position.x, label.position.y - 6, label.position.z];
    if (!pos && inf.nameEn) {
      const path = (data.paths || []).find((p) => p.name && norm(p.name) === norm(inf.nameEn));
      if (path) { const m = path.points[Math.floor(path.points.length / 2)]; const a = path.points[0], b = path.points[path.points.length - 1]; const x = (a[0] + b[0]) / 2, z = (a[1] + b[1]) / 2; pos = [x, H(m[0], m[1]) + 6, z]; }
    }
    if (!pos && KNOWN_SPOTS[key]) { const [x, z] = KNOWN_SPOTS[key]; pos = [x, H(x, z) + 4, z]; }
    if (!pos) continue;
    // Traditions (Buggy, Carnival, Kiltie Band) are CMU things even where they happen off campus.
    const tradition = (inf.tags || []).some((t) => t === '传统' || t === '学生生活');
    add({ key: `lm:${key}`, kind: 'landmark', landmarkKey: key, type: 'landmark', nameEn: inf.nameEn || key, nameZh: inf.nameZh || '', position: pos, radius: 30, campus: tradition || inCampus(pos[0], pos[2]), featured: true });
  }

  // POIs: remember which building they are in / next to ("La Prima · 韦恩楼") to tell same-named ones apart.
  const bRecs = records.filter((r) => (r.kind === 'building' || r.kind === 'landmark') && r.position);
  for (const r of records) {
    if (r.kind !== 'poi') continue;
    const [x, , z] = r.position;
    let best = null, bd = 45;
    for (const b of bRecs) {
      const d = Math.hypot(b.position[0] - x, b.position[2] - z) - (b.radius || 20) * 0.5;
      const rings = (b.parts || (b.building ? [b.building] : [])).map((q) => q.footprint);
      if (rings.some((ring) => ring && pointInRing(x, z, ring))) { best = b; break; }
      if (d < bd) { bd = d; best = b; }
    }
    if (best) r.near = best;
  }

  // Preferred views given as an area name → that area's centre; buildings described with a `view` get it too.
  for (const r of records) {
    if (!r.view && r.kind === 'building') { const v = infoFor(r)?.view; if (v) r.view = v; }
    if (r.view?.fromArea) {
      const a = byKey.get(`area:${r.view.fromArea}`);
      r.view = a?.position ? { ...r.view, from: [a.position[0], a.position[2]] } : null;
    }
  }

  // Precompute search text
  for (const r of records) indexRecord(r);

  function inCampus(x, z) {
    for (const ring of data.meta?.campusBoundary || []) if (ring.length > 2 && pointInRing(x, z, ring)) return true;
    return false;
  }

  function indexRecord(r) {
    const inf = infoFor(r);
    // CAMPUS_INFO is the single source of display names (the info panel shows it too).
    if (inf?.nameZh) r.nameZh = inf.nameZh;
    if (inf?.nameEn) {
      if (r.nameEn && r.nameEn !== inf.nameEn) r.osmName = r.osmName || r.nameEn;
      r.nameEn = inf.nameEn;
      const n = norm(r.nameEn);
      if (n && !byName.has(n) && byKey.get(r.key) === r) byName.set(n, r);
    }
    const alias = [...new Set([r.landmarkKey, r.infoLandmarkKey, ...(r.osmIds || []), r.osmId].filter(Boolean))]
      .map((k) => LANDMARK_ALIASES[k] || '').join(' ');
    const aka = [].concat(inf?.aka || [], r.osmName || [], alias).join(' ');
    r._en = norm(r.nameEn);
    r._zh = zhVariants((r.nameZh || '').toLowerCase());
    r._zhs = r._zh.replace(ZH_PUNCT, '');                 // for the in-order character match
    r._aka = norm(aka) + ' ' + zhVariants(aka.toLowerCase());
    r._akaWords = new Set(r._aka.split(/[\s,，;；、/]+/).filter(Boolean));
    r._ini = initials(r.nameEn);
    r._words = r._en ? r._en.split(' ').filter(Boolean) : [];
    r._extra = [r.cat.zh, r.cat.en, CAT_SYNONYMS[r.cat.zh] || '', SPORT_ZH[r.area?.sport] || '', r.poi?.cuisine || '',
      ...(inf?.departments || []), ...(inf?.tags || []), inf?.function || ''].join(' ').toLowerCase();
    // the stories (Warhol at CFA, the Last Lecture, the Coke machine…) — searchable at low weight
    r._desc = zhVariants([inf?.description || '', ...(inf?.facts || []), inf?.architect || ''].join(' ').toLowerCase());
    r.hasInfo = !!inf;
    r.homey = !r.campus && r.kind === 'building' && ['apartments', 'residential', 'house', 'detached', 'terrace'].includes(r.type);
  }

  // ---------------------------------------------------------------- info lookup
  function infoFor(r) {
    if (!r) return null;
    const I = info();
    let e = null;
    const merge = (x) => { if (x) e = e ? { ...x, ...e } : { ...x }; };
    if (r.landmarkKey) merge(I.landmarks?.[r.landmarkKey]);
    if (r.infoLandmarkKey) merge(I.landmarks?.[r.infoLandmarkKey]);
    if (r.infoKey) { merge(I.landmarks?.[r.infoKey]); merge(I.buildings?.[r.infoKey]); merge(I.pois?.[r.infoKey]); merge(I.areas?.[r.infoKey]); }
    for (const id of r.osmIds || (r.osmId ? [r.osmId] : [])) merge(I.buildings?.[id]);
    if (r.kind === 'area') merge(I.areas?.[r.nameEn]);
    if (r.kind === 'poi') merge(I.pois?.[r.nameEn]);
    return e;
  }

  // ---------------------------------------------------------------- pick entry → record
  const PREFIX = /^(landmark|lm|building|bld|b|poi|area|label|ui):/i;
  function fromPick(entry) {
    if (!entry) return null;
    if (entry.__rec) return entry.__rec;
    let r = null;
    const k = typeof entry.key === 'string' ? entry.key.replace(PREFIX, '') : entry.key;
    if (entry.kind === 'landmark') r = byKey.get(`lm:${k}`) || (entry.osmId && byOsm.get(entry.osmId));
    else if (entry.kind === 'building') r = byOsm.get(entry.osmId || k) || byKey.get(`b:${entry.osmId || k}`);
    else if (entry.kind === 'area') r = byKey.get(`area:${entry.name || k}`);
    else if (entry.kind === 'poi') r = byKey.get(`poi:${entry.name || k}`);
    if (!r && k) r = byKey.get(k) || byKey.get(`lm:${k}`) || byOsm.get(k);
    if (!r && entry.osmId) r = byOsm.get(entry.osmId);
    if (!r && entry.infoKey) r = byKey.get(`lm:${entry.infoKey}`) || byOsm.get(entry.infoKey);
    if (!r && entry.name) {
      const n = byName.get(norm(entry.name));
      if (n && (entry.kind === n.kind || entry.kind === 'landmark' || !entry.kind)) r = n;
    }
    if (!r && entry.nameZh) r = records.find((x) => x.nameZh && x.nameZh === entry.nameZh) || null;
    if (r) return r;
    // Ad-hoc record (unnamed building, unknown feature)
    const pos = entry.position ? (Array.isArray(entry.position) ? entry.position : [entry.position.x, entry.position.y, entry.position.z]) : null;
    let building = null;
    if (entry.osmId || (entry.kind === 'building' && k)) building = groups.get(entry.osmId || k)?.[0] || null;
    const rec = {
      key: `adhoc:${entry.kind}:${k || entry.osmId || entry.name}`, kind: entry.kind || 'building',
      type: building?.type || entry.type, nameEn: entry.name || building?.name || '', nameZh: entry.nameZh || building?.nameZh || '',
      osmId: entry.osmId || building?.osmId || null, osmIds: entry.osmId ? [entry.osmId] : building ? [building.osmId] : [],
      infoKey: entry.infoKey, campus: building?.campus, building,
      position: pos, radius: entry.radius || 25,
    };
    if (!rec.position && building) {
      const g = buildingGeom(groups.get(building.osmId || building.id));
      rec.position = [g.center[0], (g.ground + g.top) / 2, g.center[1]]; rec.radius = g.radius; rec.height = g.top - g.ground;
    }
    rec.cat = categoryFor(rec.kind, rec.type);
    indexRecord(rec);
    return rec;
  }

  // ---------------------------------------------------------------- search
  // Fuzzy fallback: the query is split into runs that each start a word, in order
  // ("gahi" -> Gates And HIllman; "hunt" no longer matches "Cohon University Center").
  function wordSubseq(q, words, qi = 0, wi = 0) {
    if (qi === q.length) return true;
    for (let w = wi; w < words.length; w++) {
      const word = words[w];
      let k = 0;
      while (k < word.length && qi + k < q.length && word[k] === q[qi + k]) k++;
      for (let len = k; len >= 1; len--) if (wordSubseq(q, words, qi + len, w + 1)) return true;
    }
    return false;
  }
  // Chinese names: the query's characters in order inside one name, with short gaps
  // ("科翁中心" → 科翁大学中心, "盖茨中心" → 盖茨-希尔曼中心). Returns the total gap length, or -1.
  function zhSubseq(q, name) {
    let pos = name.indexOf(q[0]);
    if (pos < 0) return -1;
    let gaps = 0;
    for (let i = 1; i < q.length; i++) {
      const at = name.indexOf(q[i], pos + 1);
      if (at < 0 || at - pos - 1 > 3) return -1;
      gaps += at - pos - 1;
      pos = at;
    }
    return gaps;
  }
  const FUZZY = 16;   // score of a fuzzy-only hit (no bonuses; dropped when there are real hits)
  function score(r, q, qn, qs) {
    let s = 0;
    const zh = r._zh, en = r._en;
    if (zh && q) {
      if (zh === q) s = 100;
      // Chinese names put the head noun last: "大教堂" is the Cathedral of Learning (学习大教堂) before 大教堂公寓
      else if (q.length >= 2 && zh.endsWith(q)) s = 86;
      else if (zh.startsWith(q)) s = 84;
      else if (zh.includes(q)) s = 60;
      else if (qs.length >= 3 && isCJK(qs)) {
        const gaps = zhSubseq(qs, r._zhs);
        if (gaps >= 0) s = Math.max(38, 54 - gaps * 3);
      }
    }
    if (en && qn) {
      if (en === qn) s = Math.max(s, 100);
      else if (en.startsWith(qn)) s = Math.max(s, /^[a-z0-9]/.test(en.charAt(qn.length)) ? 76 : 82);   // "pitt" ≠ Pittsburgh…
      else if ((' ' + en).includes(' ' + qn)) s = Math.max(s, 68);
      else if (en.includes(qn)) s = Math.max(s, 52);
      else if (qn.length >= 2 && !qn.includes(' ') && r._ini.startsWith(qn)) s = Math.max(s, 58);
    }
    if (s < 75 && r._akaWords && (r._akaWords.has(q) || (qn && r._akaWords.has(qn)))) s = Math.max(s, 75);   // a whole alias
    if (s < 40 && r._aka && ((qn && r._aka.includes(qn)) || r._aka.includes(q))) s = Math.max(s, 45);
    if (s < 30 && r._extra.includes(q)) s = Math.max(s, 22);
    if (s < 20 && q.length >= 2 && r._desc && r._desc.includes(q)) s = 18;
    if (!s) {
      if (qn.length >= 3 && r._words.length && wordSubseq(qn.replace(/ /g, ''), r._words)) return FUZZY;
      return 0;
    }
    if (r.kind === 'landmark') s += 9;
    if (r.campus) s += 5;
    if (r.hasInfo) s += 3;
    if (r.kind === 'poi' && !r.campus) s -= 4;
    if (r.homey) s -= 5;                 // apartment blocks rank below landmarks / campus buildings on equal matches
    return s;
  }
  function scoreAll(query) {
    const q = zhVariants(String(query || '').trim().toLowerCase());
    const qn = norm(q);
    const qs = q.replace(ZH_PUNCT, '');
    const alt = QUERY_ALIASES[q] || QUERY_ALIASES[qn] || null;
    const altN = alt ? norm(alt) : '';
    const out = [];
    for (const r of records) {
      let s = score(r, q, qn, qs);
      if (alt) s = Math.max(s, score(r, alt, altN, alt.replace(ZH_PUNCT, '')) - 2);
      if (s > 0) out.push({ r, s });
    }
    return out;
  }
  /** Pinned pseudo results for a query (the whole-campus overview for "CMU", "卡内基梅隆"…). */
  function pinned(query) {
    const q = zhVariants(String(query || '').trim().toLowerCase());
    return q && CAMPUS_QUERY.test(q) ? [HOME_RECORD] : [];
  }
  function search(query, from = null, limit = 30) {
    const q = String(query || '').trim().toLowerCase();
    const out = [];
    if (!q) {
      for (const r of featured()) out.push({ r, s: 1 });
    } else out.push(...scoreAll(query));
    // fuzzy matches only fill in when nothing matched properly
    if (out.some((o) => o.s > FUZZY)) for (let i = out.length - 1; i >= 0; i--) if (out[i].s <= FUZZY) out.splice(i, 1);
    const dist = (r) => (from && r.position ? Math.hypot(r.position[0] - from[0], r.position[2] - from[2]) : 0);
    for (const o of out) o.d = dist(o.r);
    if (q) out.sort((a, b) => b.s - a.s || a.d - b.d);
    return dedupe(out, limit);
  }
  // Drop key aliases of the same record and same-named neighbours (one apartment complex mapped as 3 buildings).
  function dedupe(list, limit = Infinity) {
    const uniq = [];
    const seenR = new Set();
    const byLabel = new Map();
    for (const o of list) {
      const r = o.r || o;
      if (seenR.has(r)) continue;
      seenR.add(r);
      // same Chinese name or same English name, within 150 m → one entry
      const keys = [r.nameZh ? `zh:${r.nameZh}` : '', r.nameEn ? `en:${norm(r.nameEn)}` : ''].filter(Boolean);
      if (keys.length && r.position) {
        const near = (k) => (byLabel.get(k) || []).some((p) => Math.hypot(p[0] - r.position[0], p[2] - r.position[2]) < 150);
        if (keys.some(near)) continue;
        for (const k of keys) { const prev = byLabel.get(k); if (prev) prev.push(r.position); else byLabel.set(k, [r.position]); }
      }
      uniq.push(o);
      if (uniq.length >= limit) break;
    }
    return uniq;
  }
  function featured() {
    const lms = records.filter((r) => r.kind === 'landmark');
    const extra = ['The Cut', 'The Mall', 'Kraus Campo', 'Gesling Stadium', 'Schenley Park']
      .map((n) => byKey.get(`area:${n}`)).filter(Boolean);
    const keyB = ['Gates and Hillman Centers', 'Cohon University Center', 'Hunt Library', 'Wean Hall', 'Tepper School of Business', 'Margaret Morrison Carnegie Hall', 'Baker Hall', 'Doherty Hall']
      .map((n) => byName.get(norm(n))).filter(Boolean);
    return [...new Set([...lms, ...extra, ...keyB])];
  }

  return {
    records, byKey, byOsm,
    get: (k) => byKey.get(k) || null,
    byName: (n) => byName.get(norm(n)) || null,
    fromPick, infoFor, search, pinned, featured, categoryFor, dedupe,
    buildingGroup: (id) => groups.get(id) || null,
    reindex() { for (const r of records) indexRecord(r); },
  };
}
