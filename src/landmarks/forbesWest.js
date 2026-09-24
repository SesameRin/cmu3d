// CMU buildings on Forbes Avenue west of the Cut, above Junction Hollow:
//   Collaborative Innovation Center (CIC), Hamburg Hall (Heinz College), Smith Hall, TCS Hall.
// Each is a hand-modelled landmark fitted to its OSM footprint; see the builders in ./lib/forbesWest-*.js for the
// reference notes (massing, facade rhythm, materials) behind each model.
import { buildCIC, CIC_OSM } from './lib/forbesWest-cic.js';
import { buildHamburg, buildSmith, HAMBURG_OSM, SMITH_OSM } from './lib/forbesWest-hamburg.js';
import { buildTCS, TCS_OSM } from './lib/forbesWest-tcs.js';

export default [
  {
    key: 'cic',
    name: 'Collaborative Innovation Center (CIC)',
    nameZh: '协同创新中心',
    osmIds: [CIC_OSM],
    async build(ctx) { return buildCIC(ctx); },
  },
  {
    key: 'hamburgHall',
    name: 'Hamburg Hall',
    nameZh: '汉堡楼（海因茨学院）',
    osmIds: [HAMBURG_OSM],
    async build(ctx) { return buildHamburg(ctx); },
  },
  {
    key: 'smithHall',
    name: 'Smith Hall',
    nameZh: '史密斯楼',
    osmIds: [SMITH_OSM],
    async build(ctx) { return buildSmith(ctx); },
  },
  {
    key: 'tcsHall',
    name: 'TCS Hall',
    nameZh: 'TCS 楼',
    osmIds: [TCS_OSM],
    async build(ctx) { return buildTCS(ctx); },
  },
];
