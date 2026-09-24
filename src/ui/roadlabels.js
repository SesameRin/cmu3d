// Road names — one data model shared by three consumers:
//   • createRoadLabels(ctx, …)  map-style road name labels in the 3D view (DOM, rotated along the road on screen)
//   • drawMinimapRoadNames(…)   names drawn along the roads on the minimap (glyph by glyph, following curves)
//   • roadModel(data)           used by world/streetsigns.js for the Pittsburgh street-name blades at intersections
// OSM ways are merged by name into long polylines ("chains"); anchors every STEP metres along the chains carry the
// local direction and how far the road stays straight around them, so a label is only ever placed on a stretch
// that is long enough (on screen) to hold it. Chinese names for the roads around campus are curated below.
import { h, clamp } from './dom.js';
import { pointInRing } from '../core/heightfield.js';

// ---------------------------------------------------------------- names
/** Curated Chinese names (Simplified) for the roads and trails in the data. Others show their English name only. */
export const ROAD_ZH = {
  'Forbes Avenue': '福布斯大道', 'Fifth Avenue': '第五大道', 'Morewood Avenue': '莫尔伍德大道', 'Morewood Place': '莫尔伍德坊',
  'South Craig Street': '南克雷格街', 'North Craig Street': '北克雷格街', 'Margaret Morrison Street': '玛格丽特·莫里森街',
  'Frew Street': '弗鲁街', 'Frew Street Extension': '弗鲁街支路', 'Tech Street': '科技街', 'Schenley Drive': '申利大道',
  'Schenley Drive Extension': '申利大道支路', 'Schenley Road': '申利路', 'Boundary Street': '边界街', 'Hamerschlag Drive': '哈默施拉格路',
  'Beeler Street': '比勒街', 'North Bellefield Avenue': '北贝尔菲尔德大道', 'South Bellefield Avenue': '南贝尔菲尔德大道',
  'North Neville Street': '北内维尔街', 'South Neville Street': '南内维尔街', 'Panther Hollow Road': '黑豹谷路',
  'Northumberland Street': '诺森伯兰街', 'Wilmot Road': '威尔莫特路', 'Overlook Drive': '观景路', 'Bigelow Boulevard': '比奇洛大道',
  'East Circuit Road': '东环路', 'West Circuit Road': '西环路', 'Fair Oaks Street': '费尔奥克斯街', 'Aylesboro Avenue': '艾尔斯伯勒大道',
  'Semple Street': '森普尔街', 'Bayard Street': '贝亚德街', 'Atwood Street': '阿特伍德街', 'Bates Street': '贝茨街',
  'Ellsworth Avenue': '埃尔斯沃思大道', 'Oakland Avenue': '奥克兰大道', 'Ward Street': '沃德街', 'Parkview Avenue': '帕克维尤大道',
  'South Bouquet Street': '南布凯街', 'North Bouquet Street': '北布凯街', 'Wilkins Avenue': '威尔金斯大道', 'Dawson Street': '道森街',
  'Parkman Avenue': '帕克曼大道', 'Bennington Avenue': '本宁顿大道', 'South Aiken Avenue': '南艾肯大道', 'Squirrel Hill Avenue': '松鼠山大道',
  'Saint James Street': '圣詹姆斯街', 'Darlington Road': '达林顿路', 'North Dithridge Street': '北迪斯里奇街',
  'South Dithridge Street': '南迪斯里奇街', 'Devonshire Street': '德文郡街', 'Boulevard of the Allies': '盟军大道',
  'Centre Avenue': '森特大道', "O'Hara Street": '奥哈拉街', 'McKee Place': '麦基坊', 'Roberto & Vera Clemente Drive': '克莱门特大道',
  'Filmore Street': '菲尔莫尔街', 'University Place': '大学坊', 'Skibo Drive': '斯基博路', 'Techview Terrace': '科技景台',
  'Joncaire Street': '容凯尔街', 'Henry Street': '亨利街', 'Winthrop Street': '温斯罗普街', 'Zulema Street': '祖利马街',
  'Devon Road': '德文路', 'Warwick Terrace': '沃里克台', 'Penton Road': '彭顿路', 'Holyrood Road': '霍利鲁德路',
  'Parish Lane': '帕里什巷', 'Dorset Street': '多塞特街', 'Carriage Road': '马车路', 'Gladstone Street': '格莱斯顿街',
  'Gladstone Road': '格莱斯顿路', 'Lytton Avenue': '利顿大道', 'Tennyson Avenue': '丁尼生大道', 'Westminster Place': '威斯敏斯特坊',
  'Amberson Avenue': '安伯森大道', 'Juliet Street': '朱丽叶街', 'Meyran Avenue': '梅兰大道', 'Beelermont Place': '比勒蒙特坊',
  'Junction Hollow Trail': '交汇谷步道', 'Steve Faloon Trail': '史蒂夫·法伦步道', 'Westinghouse Trail': '西屋步道',
  'Lower Panther Hollow Trail': '下黑豹谷步道', 'Upper Panther Hollow Trail': '上黑豹谷步道',
  // north-east extension: Shadyside, East Liberty, Bloomfield / Friendship, Squirrel Hill (沙迪 as in 沙迪赛德 Shadyside,
  // 海兰 as in 海兰公寓; Penn Avenue is named for the Penn family, hence 宾大道 rather than 宾夕法尼亚大道)
  'Shady Avenue': '沙迪大道', 'Walnut Street': '胡桃街', 'Penn Avenue': '宾大道', 'South Highland Avenue': '南海兰大道',
  'North Highland Avenue': '北海兰大道', 'South Negley Avenue': '南内格利大道', 'Baum Boulevard': '鲍姆大道',
  'Liberty Avenue': '利伯蒂大道', 'Friendship Avenue': '友谊大道', 'Broad Street': '布罗德街', 'Station Street': '车站街',
  'North Euclid Avenue': '北欧几里得大道', 'South Euclid Avenue': '南欧几里得大道', 'South Whitfield Street': '南惠特菲尔德街',
  'North Whitfield Street': '北惠特菲尔德街', 'South Saint Clair Street': '南圣克莱尔街', 'South Beatty Street': '南比蒂街',
  'Sheridan Avenue': '谢里丹大道', 'Larimer Avenue': '拉里默大道', 'Kirkwood Street': '柯克伍德街', 'Spirit Street': '斯皮里特街',
  'Kentucky Avenue': '肯塔基大道', 'Howe Street': '豪街', 'Maryland Avenue': '马里兰大道', 'College Street': '学院街',
  'Emerson Street': '爱默生街', 'Alder Street': '奥尔德街', 'Elmer Street': '埃尔默街', 'Ivy Street': '艾维街',
  'Summerlea Street': '萨默利街', 'Denniston Street': '丹尼斯顿街', 'Aurelia Street': '奥雷利亚街', 'Marchand Street': '马钱德街',
  'Woodland Road': '伍德兰路', 'North Woodland Road': '北伍德兰路',
  'Chapel Hill Road': '教堂山路', 'Murray Hill Avenue': '默里山大道', 'Murray Hill Place': '默里山坊', 'Mellon Park Road': '梅隆公园路',
  'Beechwood Boulevard': '比奇伍德大道', 'Hastings Street': '黑斯廷斯街', 'Gettysburg Street': '葛底斯堡街',
  'Murray Avenue': '默里大道', 'Beacon Street': '比肯街', 'Bartlett Street': '巴特利特街', 'Wightman Street': '怀特曼街',
  'Solway Street': '索尔韦街', 'Woodmont Street': '伍德蒙特街', 'Marlborough Avenue': '马尔伯勒大道', 'Murdoch Road': '默多克路',
  'Murdoch Street': '默多克街', 'Plainfield Street': '普莱恩菲尔德街', 'Inverness Street': '因弗内斯街', 'Maynard Street': '梅纳德街',
  'Bellerock Street': '贝尔罗克街', 'Dunmoyle Street': '邓莫伊尔街',
  'South Graham Street': '南格雷厄姆街', 'South Millvale Avenue': '南米尔维尔大道', 'Melwood Avenue': '梅尔伍德大道',
  'Bloomfield Bridge': '布卢姆菲尔德桥', 'Stratford Avenue': '斯特拉特福大道', 'South Atlantic Avenue': '南大西洋大道',
  'South Pacific Avenue': '南太平洋大道', 'South Evaline Street': '南伊夫林街', 'South Fairmount Street': '南费尔蒙特街',
  'South Winebiddle Street': '南怀恩比德尔街', 'South Mathilda Street': '南玛蒂尔达街', 'Roup Avenue': '鲁普大道',
  'Cypress Street': '赛普拉斯街', 'Gross Street': '格罗斯街', 'Harriet Street': '哈丽雅特街', 'Pearl Street': '珀尔街',
  'Lorigan Street': '洛里根街', 'Cedarville Street': '锡达维尔街', 'Edmond Street': '埃德蒙街', 'Taylor Street': '泰勒街',
  'Juniper Street': '朱尼珀街', 'Minerva Street': '米内尔瓦街', 'Ella Street': '埃拉街', 'Sciota Street': '赛奥塔街',
  'Yew Street': '尤街', 'Amber Street': '安伯街', 'Coral Street': '科勒尔街', 'Eva Street': '伊娃街', 'Pierce Street': '皮尔斯街',
  'Holden Street': '霍尔登街', 'Elwood Street': '埃尔伍德街', 'Filbert Street': '菲尔伯特街', 'Bellefonte Street': '贝尔丰特街',
  'Copeland Street': '科普兰街', 'Claybourne Street': '克莱伯恩街', 'Lehigh Avenue': '利哈伊大道', 'Spahr Street': '斯帕尔街',
  'Lamont Place': '拉蒙特坊', 'Pembroke Place': '彭布罗克坊', 'Enright Court': '恩赖特苑', 'Wallingford Street': '沃灵福德街',
  'Andover Terrace': '安多弗台', 'Iowa Street': '艾奥瓦街', 'Dakota Street': '达科他街', 'Schenley Farms Terrace': '申利农庄台',
  'Bryn Mawr Road': '布林莫尔路', 'Webster Avenue': '韦伯斯特大道', 'Neville Street': '内维尔街', 'Blessing Street': '布莱辛街',
  'Gold Way': '戈尔德巷', 'Enfield Street': '恩菲尔德街', 'Denniston Place': '丹尼斯顿坊',
};
/** Campus streets a visitor orients by: promoted one class. */
const KEY_ROADS = new Set([
  'Morewood Avenue', 'South Craig Street', 'North Craig Street', 'Margaret Morrison Street', 'Frew Street', 'Tech Street',
  'Schenley Drive', 'Boundary Street', 'Hamerschlag Drive', 'Beeler Street', 'North Bellefield Avenue', 'South Bellefield Avenue',
  'North Neville Street', 'South Neville Street', 'Panther Hollow Road',
]);
const TOP_ROADS = new Set(['Forbes Avenue', 'Fifth Avenue']);
const TRAILS = new Set(['Junction Hollow Trail', 'Steve Faloon Trail', 'Westinghouse Trail', 'Lower Panther Hollow Trail', 'Upper Panther Hollow Trail']);
const CLASS_RANK = { motorway: 6, trunk: 6, primary: 6, secondary: 5, tertiary: 4, unclassified: 3, residential: 3, living_street: 3, service: 2 };
const SKIP_NAMES = /drive-through|window|^panther hollow$/i;

const ABBR = [
  [/\bAvenue\b/g, 'Ave'], [/\bStreet\b/g, 'St'], [/\bDrive\b/g, 'Dr'], [/\bRoad\b/g, 'Rd'], [/\bBoulevard\b/g, 'Blvd'],
  [/\bPlace\b/g, 'Pl'], [/\bTerrace\b/g, 'Ter'], [/\bLane\b/g, 'Ln'], [/\bCourt\b/g, 'Ct'], [/\bSquare\b/g, 'Sq'],
  [/\bExtension\b/g, 'Ext'], [/^North\b/, 'N'], [/^South\b/, 'S'], [/^East\b/, 'E'], [/^West\b/, 'W'], [/^Saint\b/, 'St'],
];
/** "South Craig Street" → "S Craig St" (street-sign / map style). */
export function abbrevRoad(name) {
  let s = String(name || '');
  for (const [re, r] of ABBR) s = s.replace(re, r);
  return s;
}

// ---------------------------------------------------------------- model
const STEP = 20;            // m between label anchors along a chain
const MAX_HALF = 120;       // m: longest straight half-stretch recorded per anchor
const models = new WeakMap();

/**
 * Road model (cached per data object):
 *   roads: [{ name, zh, en, rank, pri, trail, chains:[{ pts:[[x,z]…], cum:[m…], skip:[bool per edge], bridge:[bool per edge],
 *            bbox }], width }]
 *   anchors: [{ id, road, x, z, dx, dz, half, bonus }]   (3D labels; y is filled in lazily by the label renderer)
 *   nodes: [{ x, z, roads:[{ road, dx, dz, width, bridge }] }]   named-road intersections (street signs)
 */
export function roadModel(data) {
  if (!data) return { roads: [], anchors: [], nodes: [] };
  let m = models.get(data);
  if (!m) { m = buildModel(data); models.set(data, m); }
  return m;
}

function wayRank(r) {
  const t = String(r.type || '').replace(/_link$/, '');
  const base = CLASS_RANK[t];
  if (!base) return 0;
  return /_link$/.test(r.type) ? Math.max(2, base - 1) : base;
}

function buildModel(data) {
  const b = data.meta?.bounds || { minX: -800, maxX: 900, minZ: -830, maxZ: 610 };
  const inB = (x, z, m = 0) => x > b.minX + m && x < b.maxX - m && z > b.minZ + m && z < b.maxZ - m;
  const groups = new Map();
  const addWay = (w, rank, trail) => {
    const pts = w.points;
    if (!w.name || !pts || pts.length < 2 || SKIP_NAMES.test(w.name)) return;
    let g = groups.get(w.name);
    if (!g) groups.set(w.name, (g = { name: w.name, rank: 0, trail, ways: [] }));
    g.rank = Math.max(g.rank, rank);
    g.ways.push(w);
  };
  for (const r of data.roads || []) {
    if (r.type === 'construction') continue;
    const rank = wayRank(r);
    if (rank >= 2) addWay(r, rank, false);
  }
  for (const p of data.paths || []) if (TRAILS.has(p.name) && !p.tunnel) addWay(p, 2, true);

  const roads = [];
  for (const g of groups.values()) {
    if (g.rank < 3 && !g.trail && !KEY_ROADS.has(g.name) && !ROAD_ZH[g.name]) continue;   // anonymous service lanes
    let pri = g.rank + (KEY_ROADS.has(g.name) ? 1 : 0);
    if (TOP_ROADS.has(g.name)) pri = 7;
    if (g.trail) pri = 2;
    const road = {
      name: g.name, zh: ROAD_ZH[g.name] || '', en: abbrevRoad(g.name), rank: g.rank, pri: Math.min(7, pri), trail: g.trail,
      width: Math.max(...g.ways.map((w) => w.width || 6)), chains: [], ways: g.ways, idx: roads.length,
    };
    road.chains = chainWays(g.ways);
    roads.push(road);
  }

  // anchors along every chain
  const anchors = [];
  const P = [0, 0];
  for (const road of roads) {
    for (const c of road.chains) {
      const total = c.cum[c.cum.length - 1];
      if (total < 30) continue;
      for (let s = STEP / 2; s < total - 6; s += STEP) {
        const e = edgeAt(c, s);
        if (c.skip[e]) continue;
        at(c, s, P);
        const x = P[0], z = P[1];
        if (!inB(x, z, 12)) continue;
        at(c, Math.max(0, s - 12), P); const ax = P[0], az = P[1];
        at(c, Math.min(total, s + 12), P); const bx = P[0], bz = P[1];
        let dx = bx - ax, dz = bz - az;
        const l = Math.hypot(dx, dz);
        if (l < 1) continue;
        dx /= l; dz /= l;
        const fwd = straightExtent(c, s, 1, x, z, dx, dz, total);
        const back = straightExtent(c, s, -1, x, z, dx, dz, total);
        const half = Math.min(fwd, back);
        if (half < 10) continue;
        let bonus = 0;
        // Forbes Avenue at the head of the Cut (Forbes × Morewood) is the visitor's main street: prefer it
        if (road.name === 'Forbes Avenue' && Math.hypot(x - 0, z + 180) < 110) bonus = 4;
        anchors.push({ id: anchors.length, road, chain: c, s, x, z, dx, dz, half, bonus, y: NaN, occ: -1, occT: -1e9, ocx: NaN, ocy: NaN, ocz: NaN });
      }
    }
  }

  // named-road intersections: a vertex shared by ways of two different names
  const vmap = new Map();
  for (const road of roads) {
    if (road.trail || road.rank < 3) continue;
    for (const w of road.ways) {
      if (w.tunnel) continue;
      const pts = w.points;
      for (let i = 0; i < pts.length; i++) {
        const k = `${Math.round(pts[i][0] * 2)},${Math.round(pts[i][1] * 2)}`;
        let n = vmap.get(k);
        if (!n) vmap.set(k, (n = { x: pts[i][0], z: pts[i][1], by: new Map() }));
        let e = n.by.get(road);
        if (!e) n.by.set(road, (e = { road, dirs: [], width: 0, bridge: false }));
        e.width = Math.max(e.width, w.width || 6);
        if (w.bridge) e.bridge = true;
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= pts.length) continue;
          const vx = pts[j][0] - pts[i][0], vz = pts[j][1] - pts[i][1], l = Math.hypot(vx, vz);
          if (l > 0.3) e.dirs.push([vx / l, vz / l]);
        }
      }
    }
  }
  const nodes = [];
  for (const n of vmap.values()) {
    if (n.by.size < 2 || !inB(n.x, n.z, 15)) continue;
    const list = [];
    for (const e of n.by.values()) {
      if (!e.dirs.length) continue;
      // road direction through the node: the two most opposite incident edges, else the single one
      let dx = e.dirs[0][0], dz = e.dirs[0][1];
      let best = 2;
      for (let i = 0; i < e.dirs.length; i++) for (let j = i + 1; j < e.dirs.length; j++) {
        const d = e.dirs[i][0] * e.dirs[j][0] + e.dirs[i][1] * e.dirs[j][1];
        if (d < best) { best = d; dx = e.dirs[i][0] - e.dirs[j][0]; dz = e.dirs[i][1] - e.dirs[j][1]; }
      }
      const l = Math.hypot(dx, dz) || 1;
      list.push({ road: e.road, dx: dx / l, dz: dz / l, width: e.width, bridge: e.bridge, through: e.dirs.length > 1 });
    }
    if (list.length >= 2) nodes.push({ x: n.x, z: n.z, roads: list });
  }
  return { roads, anchors, nodes, bounds: b };
}

/** Joins the ways of one name end to end (continuing straight-ish) into as few polylines as possible. */
function chainWays(ways) {
  const segs = ways.filter((w) => !w.tunnel || ways.length === 1).map((w) => ({ pts: w.points, tunnel: !!w.tunnel, bridge: !!w.bridge, used: false }));
  const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;
  const ends = new Map();
  const put = (k, v) => { let a = ends.get(k); if (!a) ends.set(k, (a = [])); a.push(v); };
  for (const s of segs) { put(key(s.pts[0]), { s, start: true }); put(key(s.pts[s.pts.length - 1]), { s, start: false }); }
  const chains = [];
  const dirOf = (a, b) => { const x = b[0] - a[0], z = b[1] - a[1], l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
  function extend(pts, flags) {
    for (;;) {
      const last = pts[pts.length - 1], prev = pts[pts.length - 2];
      const d0 = dirOf(prev, last);
      let best = null, bestDot = 0.35;
      for (const c of ends.get(key(last)) || []) {
        if (c.s.used) continue;
        const p = c.s.pts;
        const next = c.start ? p[1] : p[p.length - 2];
        const d1 = dirOf(last, next);
        const dot = d0[0] * d1[0] + d0[1] * d1[1];
        if (dot > bestDot) { bestDot = dot; best = c; }
      }
      if (!best) return;
      best.s.used = true;
      const p = best.start ? best.s.pts : best.s.pts.slice().reverse();
      for (let i = 1; i < p.length; i++) { pts.push(p[i]); flags.push(best.s); }
    }
  }
  for (const s of segs) {
    if (s.used) continue;
    s.used = true;
    const pts = s.pts.slice();
    const flags = new Array(pts.length - 1).fill(s);
    extend(pts, flags);
    // and backwards from the start
    pts.reverse(); flags.reverse();
    extend(pts, flags);
    const cum = [0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      x0 = Math.min(x0, pts[i][0]); x1 = Math.max(x1, pts[i][0]); z0 = Math.min(z0, pts[i][1]); z1 = Math.max(z1, pts[i][1]);
    }
    chains.push({ pts, cum, skip: flags.map((f) => f.tunnel), bridge: flags.map((f) => f.bridge), segOf: flags, bbox: [x0, z0, x1, z1] });
  }
  return chains;
}

function edgeAt(c, s) {
  const cum = c.cum;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  return lo;
}
/** Position at arc length s along a chain → out[0..1]. */
function at(c, s, out) {
  const i = edgeAt(c, clamp(s, 0, c.cum[c.cum.length - 1]));
  const a = c.pts[i], b = c.pts[Math.min(i + 1, c.pts.length - 1)];
  const L = c.cum[Math.min(i + 1, c.cum.length - 1)] - c.cum[i];
  const t = L > 1e-6 ? clamp((s - c.cum[i]) / L, 0, 1) : 0;
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  return out;
}
const tmpP = [0, 0];
function straightExtent(c, s, sign, x, z, dx, dz, total) {
  let ext = 0;
  for (let t = 6; t <= MAX_HALF; t += 6) {
    const q = s + sign * t;
    if (q < 0 || q > total) break;
    if (c.skip[edgeAt(c, q)]) break;
    at(c, q, tmpP);
    const lat = Math.abs((tmpP[0] - x) * -dz + (tmpP[1] - z) * dx);
    if (lat > 3 + t * 0.1) break;           // about 6 degrees of bend: a straight label still sits on the road
    ext = t;
  }
  return ext;
}

/** Road surface height along a chain (bridge decks interpolate between their abutments). */
function anchorY(ctx, a) {
  const c = a.chain;
  const e = edgeAt(c, a.s);
  const hAt = ctx.heightAt || (() => 0);
  if (!c.bridge[e]) return hAt(a.x, a.z);
  // walk to the ends of the bridge run
  let i0 = e, i1 = e;
  while (i0 > 0 && c.bridge[i0 - 1]) i0--;
  while (i1 < c.bridge.length - 1 && c.bridge[i1 + 1]) i1++;
  const p0 = c.pts[i0], p1 = c.pts[i1 + 1];
  const s0 = c.cum[i0], s1 = c.cum[i1 + 1];
  const t = s1 > s0 ? (a.s - s0) / (s1 - s0) : 0;
  return hAt(p0[0], p0[1]) * (1 - t) + hAt(p1[0], p1[1]) * t;
}

// ---------------------------------------------------------------- 3D labels
const SANS = "'Noto Sans SC', system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif";
// classes: r1 major (Forbes, Fifth, primary) · r2 secondary / key campus streets · r3 minor · rt trails. Keep the
// font sizes / paddings in step with css/styles.css (§road labels): widths are measured from them without layout.
const CLS = {
  r1: { zh: `700 13px ${SANS}`, en: `600 11px ${SANS}`, pad: 22, gap: 6, h: 22 },
  r2: { zh: `600 12px ${SANS}`, en: `500 10.5px ${SANS}`, pad: 20, gap: 5, h: 20 },
  r3: { zh: `600 11px ${SANS}`, en: `500 10px ${SANS}`, pad: 16, gap: 4, h: 18 },
  rt: { zh: `600 11px ${SANS}`, en: `500 10px ${SANS}`, pad: 16, gap: 4, h: 18 },
};
const clsOf = (road) => (road.trail ? 'rt' : road.pri >= 6 ? 'r1' : road.pri >= 4 ? 'r2' : 'r3');
const MAXD = { 7: 1700, 6: 1300, 5: 1000, 4: 720, 3: 460, 2: 340 };
const WALK_MAXD = 420;
const SPACING = 260;          // m between two labels of the same road
const SPACING_PX = 240;       // px between two labels of the same road
const RESELECT = 0.15;        // s between placement passes (positions still track the camera every frame)
const OCC_TTL = 0.7, OCC_GRID = 24;

let mctx = null, mfont = '';
function textW(font, s) {
  if (!s) return 0;
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  if (!mctx) return s.length * 11;
  if (font !== mfont) { mctx.font = font; mfont = font; }
  return mctx.measureText(s).width;
}

/**
 * Road name labels in the 3D view: rotated along the road on screen (never upside down; an upright tag when a road
 * runs away from an eye-level viewer), a few per long road, nearest / most important first, faded by distance and
 * hidden behind buildings and hills. Rendered in their own layer below the other labels and laid out inside the
 * main label renderer's declutter pass (labels.setRoadHook) so they never overlap building / landmark labels or
 * HUD panels; a compact Chinese-only form fits tight gaps. Toggled together with the main labels (ui.js).
 * API: { layer, update(dt), setEnabled(on), setMinPriority(p), stats(), visible(), explain(roadName), model }.
 */
export function createRoadLabels(ctx, { root, labels, before = null }) {
  const model = roadModel(ctx.data);
  const layer = h('div.rlbl-layer', { 'aria-hidden': 'true' });
  if (before && before.parentNode === root) root.insertBefore(layer, before);
  else root.appendChild(layer);

  // per-road text + measured box
  const meta = new Map();
  function measureRoad(road) {
    const c = CLS[clsOf(road)];
    const zw = road.zh ? textW(c.zh, road.zh) : 0;
    const ew = textW(road.zh ? c.en : c.zh, road.en);
    const w = Math.ceil(zw + ew + (road.zh ? c.gap : 0) + c.pad);
    // compact variant (Chinese name only) for tight spots between other labels
    return { cls: clsOf(road), w, wc: road.zh ? Math.ceil(zw + c.pad) : w, h: c.h };
  }
  const metaOf = (road) => { let m = meta.get(road); if (!m) meta.set(road, (m = measureRoad(road))); return m; };
  const remeasure = () => { meta.clear(); for (const st of states.values()) { st.m = metaOf(st.a.road); st.w = st.compact ? st.m.wc : st.m.w; } };
  document.fonts?.ready?.then(remeasure).catch(() => {});
  try { document.fonts?.addEventListener?.('loadingdone', remeasure); } catch { /* old browsers */ }

  const states = new Map();      // anchor id → { a, el, m, alpha, target, ang, sx, sy, … }
  const pool = [];
  let enabled = true;
  let minPriority = -Infinity;
  let sinceSel = 1e9;
  const lastSig = new Float64Array(10);
  let clock = 0;
  const statsOut = { anchors: model.anchors.length, candidates: 0, shown: 0, selMs: 0 };

  function elFor(road) {
    const m = metaOf(road);
    let el = pool.pop();
    if (!el) { el = h('div.rlbl'); layer.appendChild(el); }
    el.className = `rlbl ${m.cls}`;          // (+ .cmp when shown in its compact form)
    el.innerHTML = '';
    const inner = h('div.rlbl-in', null, road.zh ? [h('b', null, road.zh), h('small', null, road.en)] : [h('b', null, road.en)]);
    el.appendChild(inner);
    el.title = road.zh ? `${road.zh} · ${road.name}` : road.name;
    el.style.display = 'none';
    el.style.opacity = '0';
    return el;
  }

  // -------------------------------------------------------------- projection
  let E = null, W = 0, H = 0;
  const out = { x: 0, y: 0, w: 0 };
  function project(x, y, z) {
    const e = E;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    out.w = w;
    if (w <= 1e-3) return false;
    out.x = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * W;
    out.y = (-(e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5 + 0.5) * H;
    return true;
  }
  const vp = { elements: new Float32Array(16) };
  function updateVP(cam) {
    cam.updateMatrixWorld();
    const a = cam.projectionMatrix.elements, b = cam.matrixWorldInverse.elements, o = vp.elements;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    E = o;
  }

  /** Screen placement of an anchor: centre, angle (never upside down), px per metre along the road. */
  const pl = { sx: 0, sy: 0, ang: 0, ppm: 0, w: 0, flat: false };
  function place(a, prevAng, cull = 0) {
    if (Number.isNaN(a.y)) a.y = anchorY(ctx, a) + 0.8;
    if (!project(a.x, a.y, a.z)) return false;
    const sx = out.x, sy = out.y, w0 = out.w;
    if (cull && (sx < -cull || sx > W + cull || sy < -cull || sy > H + cull)) return false;
    const e = Math.min(a.half, 14);
    if (!project(a.x + a.dx * e, a.y, a.z + a.dz * e)) return false;
    const x1 = out.x, y1 = out.y;
    if (!project(a.x - a.dx * e, a.y, a.z - a.dz * e)) return false;
    const x0 = out.x, y0 = out.y;
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 1) return false;
    let ang = Math.atan2(y1 - y0, x1 - x0);
    // keep the text upright; near vertical keep the previous orientation (no flip-flopping)
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang <= -Math.PI / 2) ang += Math.PI;
    if (prevAng !== null && Math.abs(ang - prevAng) > Math.PI / 2) {
      const alt = ang > 0 ? ang - Math.PI : ang + Math.PI;
      if (Math.abs(alt) < 1.85) ang = alt;
    }
    // at eye level a road running away from the viewer projects nearly vertical: a sideways name standing in the
    // road reads badly, so it becomes an upright tag on the road instead (with hysteresis)
    pl.flat = false;
    if (frame.eye && Math.abs(ang) > (prevAng === 0 ? 0.8 : 0.95)) { ang = 0; pl.flat = true; }
    pl.sx = sx; pl.sy = sy; pl.ang = ang; pl.ppm = L / (2 * e); pl.w = w0;
    return true;
  }

  // -------------------------------------------------------------- line of sight (buildings + terrain)
  let occCells = null, occCount = -1;
  const ckey = (i, j) => (i + 2048) * 4096 + (j + 2048);
  function occluders() {
    const shapes = ctx.colliders?.shapes;
    if (!shapes) return null;
    if (occCells && occCount === shapes.length) return occCells;
    occCount = shapes.length;
    occCells = new Map();
    for (const s of shapes) {
      if (!s || !Number.isFinite(s.yMax)) continue;
      if (s.kind === 'circle' ? s.r < 1.5 : Math.hypot(s.x1 - s.x0, s.z1 - s.z0) < 4) continue;
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const g = ctx.heightAt?.(cx, cz) ?? s.yMax;
      if (s.yMax - Math.max(Number.isFinite(s.yMin) ? s.yMin : g, g) < 4) continue;
      for (let i = Math.floor(s.x0 / OCC_GRID); i <= Math.floor(s.x1 / OCC_GRID); i++) {
        for (let j = Math.floor(s.z0 / OCC_GRID); j <= Math.floor(s.z1 / OCC_GRID); j++) {
          const k = ckey(i, j);
          let arr = occCells.get(k);
          if (!arr) occCells.set(k, (arr = []));
          arr.push(s);
        }
      }
    }
    return occCells;
  }
  function occluded(a, cam) {
    const cells = occluders();
    const hAt = ctx.heightAt;
    const o = cam.position;
    const dx = a.x - o.x, dy = a.y + 1 - o.y, dz = a.z - o.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 10) return false;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    for (let t = 3; t < len - 7; t += clamp(t * 0.02, 2, 8)) {
      const x = o.x + ux * t, y = o.y + uy * t, z = o.z + uz * t;
      if (hAt && y < hAt(x, z) - 0.8) return true;
      const list = cells && cells.get(ckey(Math.floor(x / OCC_GRID), Math.floor(z / OCC_GRID)));
      if (!list) continue;
      for (const s of list) {
        if (y > s.yMax || (Number.isFinite(s.yMin) && y < s.yMin)) continue;
        if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
        if (s.kind === 'circle' ? (x - s.x) ** 2 + (z - s.z) ** 2 <= s.r * s.r : pointInRing(x, z, s.ring)) return true;
      }
    }
    return false;
  }

  // -------------------------------------------------------------- occupancy (shared with labels.js)
  // labels.js calls layout(G, 'mid') part-way through its declutter pass (after landmarks, campus buildings and big
  // areas, before minor buildings / POIs) and layout(G, 'end') after it: major roads (pri >= MAJOR) are placed in the
  // mid phase, minor roads in the end phase. Without labels.js the renderer uses its own (empty) grid.
  let own = new Uint8Array(1), ownW = 0, ownH = 0;
  function ownGrid() {
    const cell = 12, gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
    if (gw !== ownW || gh !== ownH) { ownW = gw; ownH = gh; own = new Uint8Array(gw * gh); } else own.fill(0);
    return { grid: own, w: gw, h: gh, cell };
  }
  /** Visits the grid cells covered by a rotated rectangle; returns false as soon as fn returns false. */
  function cells(G, cx, cy, w, hh, ang, fn) {
    const c = Math.cos(ang), s = Math.sin(ang), CELL = G.cell;
    const hw = w / 2 + 2, hh2 = hh / 2 + 1;
    const ex = Math.abs(c) * hw + Math.abs(s) * hh2, ey = Math.abs(s) * hw + Math.abs(c) * hh2;
    const gx0 = Math.max(0, Math.floor((cx - ex) / CELL)), gx1 = Math.min(G.w - 1, Math.floor((cx + ex) / CELL));
    const gy0 = Math.max(0, Math.floor((cy - ey) / CELL)), gy1 = Math.min(G.h - 1, Math.floor((cy + ey) / CELL));
    const tol = CELL * 0.45;
    for (let gy = gy0; gy <= gy1; gy++) {
      const py = (gy + 0.5) * CELL - cy;
      for (let gx = gx0; gx <= gx1; gx++) {
        const px = (gx + 0.5) * CELL - cx;
        const u = px * c + py * s, v = -px * s + py * c;
        if (Math.abs(u) > hw + tol || Math.abs(v) > hh2 + tol) continue;
        if (fn(gy * G.w + gx) === false) return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------- per frame
  const MAJOR = 5;
  const isMajor = (road) => road.pri >= MAJOR;
  const majorAnchors = model.anchors.filter((a) => isMajor(a.road)), minorAnchors = model.anchors.filter((a) => !isMajor(a.road));
  const cands = [];
  const placed = [];
  /** Screen placement + score of one anchor, or the reason it can't be shown right now. */
  function consider(a, cam, walk) {
    const pri = a.road.pri;
    if (pri < minPriority) return 'priority';
    let maxD = MAXD[pri] || 400;
    if (walk) maxD = Math.min(maxD, WALK_MAXD);
    const ddx = a.x - cam.position.x, ddz = a.z - cam.position.z;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 > maxD * maxD) return 'far';
    const st = states.get(a.id);
    if (!place(a, st && st.target > 0 ? st.ang : null, 60)) return 'behind';
    const m = metaOf(a.road);
    const c = Math.abs(Math.cos(pl.ang)), s = Math.abs(Math.sin(pl.ang));
    const ex = c * m.wc / 2 + s * m.h / 2, ey = s * m.wc / 2 + c * m.h / 2;
    if (pl.sx - ex < 6 || pl.sx + ex > W - 6 || pl.sy - ey < 6 || pl.sy + ey > H - 6) return 'offscreen';
    // the straight stretch must hold the text on screen (half the label + margin, in metres along the road)
    if (!pl.flat && (m.wc / 2 + 8) / pl.ppm > a.half) return 'short';
    const exf = c * m.w / 2 + s * m.h / 2, eyf = s * m.w / 2 + c * m.h / 2;
    a.full = (pl.flat || (m.w / 2 + 8) / pl.ppm <= a.half) && pl.sx - exf >= 6 && pl.sx + exf <= W - 6 && pl.sy - eyf >= 6 && pl.sy + eyf <= H - 6;
    const dy = a.y - cam.position.y;
    const dist = Math.sqrt(d2 + dy * dy);
    if (dist > maxD) return 'far';
    let fade = 1 - clamp((dist - maxD * 0.7) / (maxD * 0.3), 0, 1);
    if (walk) fade *= clamp((dist - 7) / 10, 0, 1);
    if (fade < 0.05) return 'faded';
    const shown = st && st.target > 0;
    a.sx = pl.sx; a.sy = pl.sy; a.ang = pl.ang; a.dist = dist; a.fade = fade;
    a.score = pri * 3 - dist / 110 + (shown ? 5 : 0) + a.bonus + Math.min(a.half, 80) / 40;
    return null;
  }

  // Frame state: the first layout() call of a frame prepares the projection and decides whether this is a
  // placement frame (every RESELECT s while the view changes); on the other frames labels only follow the camera.
  const frame = { began: false, due: false, walk: false, eye: false, majorN: 0 };
  function begin() {
    const cam = ctx.camera;
    frame.began = true;
    W = innerWidth; H = innerHeight;
    updateVP(cam);
    frame.walk = ctx.nav?.mode === 'walk';
    frame.eye = frame.walk || ctx.nav?.mode === 'fly' || cam.position.y - (ctx.heightAt?.(cam.position.x, cam.position.z) ?? -1e9) < 40;
    const p = cam.position;
    // placement pass when the view changed (position > 5 cm, orientation > ~0.1°) or every 0.6 s regardless
    const L = lastSig;
    const moved = Math.abs(p.x - L[0]) + Math.abs(p.y - L[1]) + Math.abs(p.z - L[2]) > 0.05 ||
      Math.abs(E[0] - L[3]) + Math.abs(E[1] - L[4]) + Math.abs(E[2] - L[5]) + Math.abs(E[8] - L[6]) > 0.002 ||
      W !== L[7] || H !== L[8] || minPriority !== L[9];
    frame.due = (sinceSel > RESELECT && moved) || sinceSel > 0.6;
    if (frame.due) { sinceSel = 0; L[0] = p.x; L[1] = p.y; L[2] = p.z; L[3] = E[0]; L[4] = E[1]; L[5] = E[2]; L[6] = E[8]; L[7] = W; L[8] = H; L[9] = minPriority; }
  }

  function select(G, major) {
    const cam = ctx.camera;
    const t0 = performance.now();
    const limit = (W < 720 ? 6 : 12) - (major ? 0 : frame.majorN);
    cands.length = 0;
    if (limit > 0) {
      const list = major ? majorAnchors : minorAnchors;
      for (let i = 0; i < list.length; i++) if (consider(list[i], cam, frame.walk) === null) cands.push(list[i]);
    }
    cands.sort((p, q) => q.score - p.score);
    if (major) placed.length = 0;
    const start = placed.length;
    let occBudget = major ? 10 : 6;
    for (const a of cands) {
      a.why = 'limit';
      if (placed.length - start >= limit) break;
      a.why = 'spacing';
      let clash = false;
      for (const p of placed) {
        if (p.road !== a.road) continue;
        if (Math.hypot(p.x - a.x, p.z - a.z) < SPACING || Math.hypot(p.sx - a.sx, p.sy - a.sy) < SPACING_PX) { clash = true; break; }
      }
      if (clash) continue;
      const m = metaOf(a.road);
      a.why = 'grid';
      const free = (i) => G.grid[i] === 0;
      a.compact = !(a.full && cells(G, a.sx, a.sy, m.w, m.h, a.ang, free));
      if (a.compact && (m.wc === m.w || !cells(G, a.sx, a.sy, m.wc, m.h, a.ang, free))) continue;
      const w = a.compact ? m.wc : m.w;
      a.why = 'occluded';
      // line of sight against buildings and hills (cached, a few fresh tests per pass; a result stays valid while
      // the camera has not moved — the world is static)
      const cp = cam.position;
      // never-tested anchors (occ -1) must be tested; NaN positions would otherwise make "moved" always false
      if (a.occ === -1 || (clock - a.occT > OCC_TTL && Math.abs(cp.x - a.ocx) + Math.abs(cp.y - a.ocy) + Math.abs(cp.z - a.ocz) > 0.3)) {
        if (occBudget <= 0) continue;
        occBudget--;
        a.occ = occluded(a, cam) ? 1 : 0;
        a.occT = clock;
        a.ocx = cp.x; a.ocy = cp.y; a.ocz = cp.z;
      }
      if (a.occ === 1) continue;
      // reserve it right away so the next road names of this pass fit around it
      cells(G, a.sx, a.sy, w, m.h, a.ang, (i) => { if (G.grid[i] === 0) G.grid[i] = 1; });
      placed.push(a);
    }
    if (major) frame.majorN = placed.length;
    for (const st of states.values()) if (isMajor(st.a.road) === major) st.target = 0;
    for (let i = start; i < placed.length; i++) {
      const a = placed[i];
      let st = states.get(a.id);
      if (!st) {
        st = { a, el: elFor(a.road), m: metaOf(a.road), alpha: 0, target: 0, ang: a.ang, x: -1e4, y: -1e4, r: 99, o: -1, shown: false, ok: false, px: 0, py: 0, pa: 0, fresh: true, compact: false, w: 0 };
        states.set(a.id, st);
      }
      if (st.compact !== a.compact) { st.compact = a.compact; st.el.classList.toggle('cmp', a.compact); }
      st.w = a.compact ? st.m.wc : st.m.w;
      st.target = a.fade;
      st.fresh = true;
    }
    statsOut.selMs = (major ? 0 : statsOut.selMs) + performance.now() - t0;
    statsOut.candidates = (major ? 0 : statsOut.candidates) + cands.length;
  }

  /** Places (on placement frames) and reserves the road labels of one phase in the declutter grid G. */
  function layout(G, phase) {
    if (!enabled || !ctx.camera) return;
    if (!frame.began) begin();
    const major = phase !== 'end';
    if (frame.due) select(G, major);
    for (const st of states.values()) {
      if (isMajor(st.a.road) !== major) continue;
      st.ok = false;
      if (st.target <= 0 && st.alpha <= 0) continue;
      if (!place(st.a, st.ang)) continue;
      st.ok = true; st.px = pl.sx; st.py = pl.sy; st.pa = pl.ang;
      // placed this frame: already reserved by select()
      if (st.fresh) { st.fresh = false; continue; }
      if (st.target > 0) cells(G, pl.sx, pl.sy, st.w, st.m.h, pl.ang, (i) => { if (G.grid[i] === 0) G.grid[i] = 1; });
    }
  }

  function hideAll() {
    for (const [id, st] of states) { st.el.style.display = 'none'; pool.push(st.el); states.delete(id); }
    statsOut.shown = 0;
  }

  /** Per frame, after labels.update(): smooth fades, follow the camera. */
  function update(dt) {
    const cam = ctx.camera;
    if (!cam) return;
    if (!enabled) { if (states.size) hideAll(); frame.began = false; return; }
    clock += dt || 0;
    sinceSel += dt || 0;
    // (labels.js skipped an idle frame — nothing moved: the last layout stands, only fades continue below)
    if (!frame.began && !labels?.idle) {
      // labels.js didn't run its declutter pass this frame (no labels): lay out on an own grid
      const G = ownGrid();
      layout(G, 'mid');
      layout(G, 'end');
    }
    frame.began = false;
    const k = 1 - Math.exp(-(dt || 0.016) * 9);
    let shown = 0;
    for (const [id, st] of states) {
      const target = st.ok ? st.target : 0;
      st.alpha += (target - st.alpha) * k;
      if (target === 0 && st.alpha < 0.03) {
        if (st.shown) st.el.style.display = 'none';
        pool.push(st.el);
        states.delete(id);
        continue;
      }
      if (!st.ok) continue;
      if (!st.shown) { st.el.style.display = 'block'; st.shown = true; }
      st.ang = st.pa;
      const x = Math.round(st.px * 2) / 2, y = Math.round(st.py * 2) / 2, r = Math.round(st.pa * 572.96) / 10;
      if (x !== st.x || y !== st.y || r !== st.r) {
        st.el.style.transform = `translate3d(${x}px,${y}px,0) rotate(${r}deg)`;
        st.x = x; st.y = y; st.r = r;
      }
      const o = Math.round(st.alpha * 40) / 40;
      if (o !== st.o) { st.el.style.opacity = o; st.o = o; }
      shown++;
    }
    statsOut.shown = shown;
  }

  // called from inside labels.update(): a failure here must never take the other labels down with it
  let hookErrors = 0;
  labels?.setRoadHook?.((G, phase) => {
    try { layout(G, phase); } catch (e) { if (hookErrors++ % 600 === 0) console.error('[ui] road labels layout failed', e); }
  });
  // warm the lazy bits (anchor heights, the occluder grid) in idle time rather than in the first placement pass
  const ric = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 500));
  ric(() => {
    for (const a of model.anchors) if (Number.isNaN(a.y)) a.y = anchorY(ctx, a) + 0.8;
    ric(() => occluders());
  });

  return {
    layer,
    update,
    /** Loading time: anchor heights, text sizes and the line-of-sight grid, instead of during the first passes. */
    prepare() {
      for (const a of model.anchors) if (Number.isNaN(a.y)) a.y = anchorY(ctx, a) + 0.8;
      for (const road of model.roads) metaOf(road);
      occluders();
    },
    get enabled() { return enabled; },
    setEnabled(on) { enabled = !!on; layer.classList.toggle('off', !enabled); if (!enabled) hideAll(); },
    setMinPriority(p) { minPriority = Number.isFinite(p) ? p : -Infinity; },
    stats: () => ({ ...statsOut, active: states.size }),
    // debugging: why each anchor of a road is / isn't shown (see the review notes in the report)
    explain(name) {
      const cam = ctx.camera;
      if (!cam || !E) return [];
      const walk = ctx.nav?.mode === 'walk';
      return model.anchors.filter((a) => a.road.name === name).map((a) => {
        const why = consider(a, cam, walk);
        const st = states.get(a.id);
        return { x: Math.round(a.x), z: Math.round(a.z), half: a.half, why: why || (st?.target > 0 ? 'SHOWN' : a.why || '?'), sx: Math.round(a.sx || 0), sy: Math.round(a.sy || 0), score: +(a.score || 0).toFixed(1) };
      });
    },
    visible: () => [...states.values()].filter((st) => st.target > 0).map((st) => ({ name: st.a.road.name, x: Math.round(st.a.x), z: Math.round(st.a.z), sx: Math.round(st.x), sy: Math.round(st.y), deg: st.r })),
    model,
  };
}

// ---------------------------------------------------------------- minimap
const MM_FONT = `600 10px ${SANS}`;
const glyphCache = new Map();
function glyphs(g, text) {
  let e = glyphCache.get(text);
  if (!e) {
    g.font = MM_FONT;
    const ws = [...text].map((ch) => g.measureText(ch).width);
    e = { chars: [...text], ws, total: ws.reduce((s, v) => s + v, 0) };
    glyphCache.set(text, e);
  }
  return e;
}
const mmTmp = [0, 0];
/**
 * Draws road names along the roads of the (north-up) minimap. g has the CSS-pixel transform set; the view maps world
 * (x, z) to X = cw/2 + (x − cx)/mpp, Y = ch/2 + (z − cz)/mpp. Positions are on a fixed world grid along each chain
 * (per zoom level) so names don't swim while the map pans. The minimap renders a whole-map (or a larger-than-view)
 * image once per zoom level and pans over it, so it asks for names more often along a road (`repeat`, px) to have
 * each road named inside a small view.
 */
export function drawMinimapRoadNames(g, data, { cx, cz, mpp, cw, ch, dpr = 1, repeat = 280 }) {
  const model = roadModel(data);
  if (!model.roads.length) return 0;
  const minPri = mpp <= 1.3 ? 2 : mpp <= 2.3 ? 3 : mpp <= 3.5 ? 4 : mpp <= 5.6 ? 5 : 6;
  const x0 = cx - (cw / 2) * mpp, x1 = cx + (cw / 2) * mpp, z0 = cz - (ch / 2) * mpp, z1 = cz + (ch / 2) * mpp;
  const X = (x) => cw / 2 + (x - cx) / mpp, Y = (z) => ch / 2 + (z - cz) / mpp;
  const boxes = [];
  const roads = model.roads.filter((r) => r.pri >= minPri && !(r.trail && mpp > 2.3)).sort((a, b) => b.pri - a.pri);
  g.save();
  g.font = MM_FONT;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  let count = 0;
  const pos = [];
  // lays the glyphs out along the chain around arc length s; false if off screen, too curvy or colliding
  function layout(c, gl, s, Lw) {
    const sa = s - Lw / 2, sb = s + Lw / 2;
    at(c, sa, mmTmp); const ax = X(mmTmp[0]), ay = Y(mmTmp[1]);
    at(c, sb, mmTmp); const bx = X(mmTmp[0]), by = Y(mmTmp[1]);
    if (Math.min(ax, bx) < 8 || Math.max(ax, bx) > cw - 8 || Math.min(ay, by) < 8 || Math.max(ay, by) > ch - 8) return false;
    if (Math.hypot(bx - ax, by - ay) < gl.total * 0.85) return false;       // bends too much for the text
    if (c.skip[edgeAt(c, s)]) return false;
    const rev = bx < ax;                                                    // keep the text left → right
    pos.length = 0;
    let u = 0;
    for (let i = 0; i < gl.chars.length; i++) {
      const w = gl.ws[i];
      const q = rev ? sb - (u + w / 2 + 2) * mpp : sa + (u + w / 2 + 2) * mpp;
      at(c, q - 1.5 * mpp, mmTmp); const px0 = X(mmTmp[0]), py0 = Y(mmTmp[1]);
      at(c, q + 1.5 * mpp, mmTmp); const px1 = X(mmTmp[0]), py1 = Y(mmTmp[1]);
      at(c, q, mmTmp);
      let ang = Math.atan2(py1 - py0, px1 - px0);
      if (rev) ang += Math.PI;
      const px = X(mmTmp[0]), py = Y(mmTmp[1]);
      if (px < 6 || px > cw - 6 || py < 6 || py > ch - 6) return false;
      if (i) {
        let d = Math.abs(ang - pos[i - 1][2]);
        if (d > Math.PI) d = 2 * Math.PI - d;
        if (d > 0.6) return false;
      }
      pos.push([px, py, ang]);
      u += w;
    }
    for (const [px, py] of pos) for (const bb of boxes) if ((bb[0] - px) ** 2 + (bb[1] - py) ** 2 < 90) return false;
    return true;
  }
  for (const road of roads) {
    const text = road.zh || road.en;
    const gl = glyphs(g, text);
    const Lw = (gl.total + 4) * mpp;                         // metres of road the text needs
    const spacing = Math.max(Lw * 3, repeat * mpp);     // (repeat: px between two names of a road)
    const placedHere = [];
    for (const c of road.chains) {
      const [bx0, bz0, bx1, bz1] = c.bbox;
      if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) continue;
      const total = c.cum[c.cum.length - 1];
      if (total < Lw + 10) continue;
      // slots on a fixed world grid along the chain (names stay put while the map pans), a few nudges per slot
      for (let s0 = Lw / 2 + 8; s0 + Lw / 2 < total; s0 += spacing) {
        let ok = false;
        for (const f of [0, 0.22, -0.22, 0.44]) {
          const s = s0 + f * spacing;
          if (s - Lw / 2 < 0 || s + Lw / 2 > total) continue;
          at(c, s, mmTmp);
          const mx = X(mmTmp[0]), my = Y(mmTmp[1]);
          if (mx < 0 || mx > cw || my < 0 || my > ch) continue;
          if (placedHere.some((p) => Math.hypot(p[0] - mx, p[1] - my) < 220)) continue;   // other chains / carriageways
          if (!layout(c, gl, s, Lw)) continue;
          placedHere.push([mx, my]);
          ok = true;
          break;
        }
        if (!ok) continue;
        for (const [px, py] of pos) boxes.push([px, py]);
        g.fillStyle = road.trail ? '#bfe0b0' : road.pri >= 6 ? '#ffe3a3' : '#eef0f2';
        for (let i = 0; i < pos.length; i++) {
          const [px, py, ang] = pos[i];
          g.setTransform(dpr, 0, 0, dpr, 0, 0);
          g.translate(px, py);
          g.rotate(ang);
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(18,20,24,0.92)';
          g.strokeText(gl.chars[i], 0, 0.5);
          g.fillText(gl.chars[i], 0, 0.5);
        }
        count++;
      }
    }
  }
  g.restore();
  return count;
}
