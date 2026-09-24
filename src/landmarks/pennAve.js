// East Liberty: Penn Avenue landmarks around Penn & Highland.
//   East Liberty Presbyterian Church (the "Cathedral of Hope", Cram & Ferguson 1935) - the skyline anchor;
//   Motor Square Garden (Peabody & Stearns, 1900 - the domed former East Liberty Market);
//   the Highland Building (D. H. Burnham & Co., 1910) and the Wallace Building on South Highland Avenue;
//   Carnegie Library of Pittsburgh - East Liberty (remodelled 2016) and the Target store on Penn Avenue.
// The builders live in ./lib/pennAve-*.js (reference notes on massing, materials and proportions are there).
// The many ordinary shops and restaurants along Penn Avenue are left to the generic storefront system.
import { buildELPC, ELPC_OSM } from './lib/pennAve-church.js';
import { buildMSG, MSG_OSM } from './lib/pennAve-msg.js';
import {
  buildHighland, buildWallace, buildLibrary, buildTarget,
  HIGHLAND_OSM, WALLACE_OSM, LIBRARY_OSM, TARGET_OSM,
} from './lib/pennAve-blocks.js';

export default [
  {
    key: 'eastLibertyPresbyterian',
    name: 'East Liberty Presbyterian Church',
    nameZh: '东自由长老会教堂',
    osmIds: [ELPC_OSM],
    async build(ctx) { return buildELPC(ctx); },
  },
  {
    key: 'motorSquareGarden',
    name: 'Motor Square Garden',
    nameZh: '汽车广场花园',
    osmIds: [MSG_OSM],
    async build(ctx) { return buildMSG(ctx); },
  },
  {
    key: 'highlandBuilding',
    name: 'Highland Building',
    nameZh: '海兰大楼',
    osmIds: [HIGHLAND_OSM],
    async build(ctx) { return buildHighland(ctx); },
  },
  {
    key: 'wallaceBuilding',
    name: 'Wallace Building',
    nameZh: '华莱士大楼',
    osmIds: [WALLACE_OSM],
    async build(ctx) { return buildWallace(ctx); },
  },
  {
    key: 'clpEastLiberty',
    name: 'Carnegie Library of Pittsburgh – East Liberty',
    nameZh: '匹兹堡卡内基图书馆东自由分馆',
    osmIds: [LIBRARY_OSM],
    async build(ctx) { return buildLibrary(ctx); },
  },
  {
    key: 'targetEastLiberty',
    name: 'Target (East Liberty)',
    nameZh: 'Target 超市（东自由）',
    osmIds: [TARGET_OSM],
    async build(ctx) { return buildTarget(ctx); },
  },
];
