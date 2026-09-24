// Shady Avenue at Walnut Street (Shadyside / East Liberty border): the Kenmawr Apartments and the two Gothic
// churches that face each other across Shady Avenue a block north of it.
//   · Kenmawr Apartments (401 Shady Ave, 1956) — eight-storey cross-plan block of orange-red brick.
//   · Calvary Episcopal Church (315 Shady Ave, Ralph Adams Cram, 1906–07) — pale limestone English Gothic with a
//     crossing tower and a 220-foot spire.
//   · Sacred Heart Church (310 Shady Ave, Carlton Strong / Kaiser, Neal & Reid, 1924–53) — grey rock-faced Gothic
//     with a massive square tower and pale metal roofs.
//   · Hunt Armory (324 Emerson St, W. G. Wilkins Co., 1911–16) — Classical Revival terracotta front range and drill
//     hall, now the Penguins' community ice rink.
// Each building has a cheap distant level built during loading and a detailed level built in idle time after
// the app is ready (or at once when the camera comes close); see lib/kenmawr-kit.js lodBuilding().
import { buildKenmawr, KENMAWR_OSM } from './lib/kenmawr-apts.js';
import { buildCalvary, CALVARY_OSM } from './lib/kenmawr-calvary.js';
import { buildSacredHeart, SACRED_OSM } from './lib/kenmawr-sacred.js';
import { buildArmory, ARMORY_OSM } from './lib/kenmawr-armory.js';

const safe = (name, fn) => async (ctx) => {
  try { return await fn(ctx); } catch (e) { console.error(`[kenmawr] ${name} failed`, e); return null; }
};

const defs = [
  { key: 'kenmawr', name: 'Kenmawr Apartments', nameZh: '肯莫尔公寓', osmIds: [KENMAWR_OSM], builder: buildKenmawr },
  { key: 'calvaryEpiscopal', name: 'Calvary Episcopal Church', nameZh: '加略山圣公会教堂', osmIds: [CALVARY_OSM], builder: buildCalvary },
  { key: 'sacredHeart', name: 'Sacred Heart Church', nameZh: '圣心天主堂', osmIds: [SACRED_OSM], builder: buildSacredHeart },
  { key: 'huntArmory', name: 'Hunt Armory', nameZh: '亨特军械库', osmIds: [ARMORY_OSM], builder: buildArmory },
];
for (const d of defs) {
  const { builder } = d;
  delete d.builder;
  d.build = safe(d.key, (ctx) => builder(ctx, d));
}

export default defs;
