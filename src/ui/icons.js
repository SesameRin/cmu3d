// Hand-drawn inline SVG icon set (24×24 grid, 1.75 px round strokes, currentColor).
// icon('search') → SVG markup string; iconEl('search') → element.

const P = {
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M20 20l-4.6-4.6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  orbit: '<circle cx="12" cy="12" r="3.3"/><ellipse cx="12" cy="12" rx="9.6" ry="4.1" transform="rotate(-22 12 12)"/><circle cx="19.6" cy="8.6" r="1" fill="currentColor" stroke="none"/>',
  walk: '<circle cx="13.4" cy="4.4" r="1.9"/><path d="M9.2 21.2l2.6-6.4 2.8 2.6.2 3.8"/><path d="M11.8 14.8l1-6.2-3.7 1.7-1.5 3.3"/><path d="M12.8 8.6l2.4 3.2 3.2.8"/>',
  fly: '<path d="M21.2 2.8L2.8 10.4l7.3 2.9 2.9 7.3z"/><path d="M10.1 13.3l5-5"/>',
  tour: '<path d="M5 21.5V3.5"/><path d="M5 4h12.2l-2.4 4 2.4 4H5"/>',
  labels: '<path d="M3.5 12.3V4.6c0-.6.5-1.1 1.1-1.1h7.7l8.2 8.2-8.8 8.8z"/><circle cx="8.2" cy="8.2" r="1.5"/>',
  map: '<path d="M9 4.4L3.5 6.4v13.2L9 17.6l6 2 5.5-2V4.4L15 6.4z"/><path d="M9 4.4v13.2M15 6.4v13.2"/>',
  help: '<circle cx="12" cy="12" r="9.2"/><path d="M9.5 9.4a2.6 2.6 0 015 .9c0 1.8-2.5 2.2-2.5 3.9"/><circle cx="12" cy="17.3" r=".7" fill="currentColor"/>',
  link: '<path d="M10.2 13.8a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.1 1.1"/><path d="M13.8 10.2a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.1-1.1"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  sliders: '<path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20"/><circle cx="16" cy="7" r="2.4"/><circle cx="10" cy="17" r="2.4"/>',
  play: '<path d="M8 5.2v13.6L18.8 12z" fill="currentColor" stroke-linejoin="round"/>',
  pause: '<rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none"/>',
  prev: '<path d="M6 5v14"/><path d="M18.5 5.8L9.3 12l9.2 6.2z" fill="currentColor"/>',
  next: '<path d="M18 5v14"/><path d="M5.5 5.8l9.2 6.2-9.2 6.2z" fill="currentColor"/>',
  chevL: '<path d="M14.5 6l-6 6 6 6"/>',
  chevR: '<path d="M9.5 6l6 6-6 6"/>',
  chevD: '<path d="M6 9.5l6 6 6-6"/>',
  chevU: '<path d="M6 14.5l6-6 6 6"/>',
  sun: '<circle cx="12" cy="12" r="4.1"/><path d="M12 2.4v2.2M12 19.4v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.4 12h2.2M19.4 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6"/>',
  moon: '<path d="M19.8 14.6A8.2 8.2 0 019.4 4.2a8.2 8.2 0 1010.4 10.4z"/>',
  sunset: '<path d="M4 18h16M7 21.5h10"/><path d="M7.2 18a4.8 4.8 0 019.6 0"/><path d="M12 5v3.2M5 10.6l1.9 1.4M19 10.6l-1.9 1.4"/>',
  pin: '<path d="M12 21.4s-6.6-5.7-6.6-11.2a6.6 6.6 0 0113.2 0c0 5.5-6.6 11.2-6.6 11.2z"/><circle cx="12" cy="10.1" r="2.4"/>',
  building: '<path d="M4.5 21V6.2L12 3.5l7.5 2.7V21"/><path d="M2.5 21h19M8.3 8.8h1.8M13.9 8.8h1.8M8.3 12.6h1.8M13.9 12.6h1.8M10.4 21v-4.4h3.2V21"/>',
  landmark: '<path d="M3 9.4L12 4l9 5.4z"/><path d="M5.4 10.6v7M9.8 10.6v7M14.2 10.6v7M18.6 10.6v7M3.5 17.8h17M2.5 21h19"/>',
  tree: '<path d="M12 21.5v-4.8"/><path d="M12 2.8l5.8 7.4h-3.1l3.9 5H5.4l3.9-5H6.2z"/>',
  palette: '<path d="M12 3a9 9 0 100 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.7-1-2.8 0-1 .8-1.7 1.9-1.7h2.3a4 4 0 004-4C21 6.4 17 3 12 3z"/><circle cx="7.4" cy="11.4" r="1.1" fill="currentColor"/><circle cx="9.6" cy="7.3" r="1.1" fill="currentColor"/><circle cx="14.6" cy="7.1" r="1.1" fill="currentColor"/>',
  cup: '<path d="M4.2 9h11.6v4.6a5.2 5.2 0 01-5.2 5.2H9.4a5.2 5.2 0 01-5.2-5.2z"/><path d="M15.8 10.4h1.5a2.6 2.6 0 010 5.2h-1.8"/><path d="M8 3.2c-.7.9.7 1.8 0 2.8M11.8 3.2c-.7.9.7 1.8 0 2.8"/>',
  fork: '<path d="M7 3v7.6M4.8 3v4.6a2.2 2.2 0 004.4 0V3M7 10.6V21"/><path d="M17.4 21V3c-2.4 1.3-3.4 3.9-3.4 7.6h3.4"/>',
  memorial: '<path d="M9.8 19.5l1-13.4L12 3l1.2 3.1 1 13.4"/><path d="M6.5 21.2h11M8.4 19.5h7.2"/>',
  drop: '<path d="M12 3.3s-6.2 6.8-6.2 11a6.2 6.2 0 0012.4 0c0-4.2-6.2-11-6.2-11z"/>',
  stadium: '<ellipse cx="12" cy="12" rx="9.3" ry="6.2"/><ellipse cx="12" cy="12" rx="4.6" ry="2.6"/>',
  book: '<path d="M4 19.5V5.3A2.3 2.3 0 016.3 3H20v14.2H6.3A2.3 2.3 0 004 19.5a2.3 2.3 0 002.3 2.3H20"/><path d="M8.5 7.2h7"/>',
  home: '<path d="M3.5 11.2L12 4l8.5 7.2"/><path d="M5.6 9.6V20.5h12.8V9.6"/><path d="M10 20.5v-5.2h4v5.2"/>',
  parking: '<rect x="4" y="3.5" width="16" height="17" rx="3.4"/><path d="M9.6 16.6V7.4h3.2a2.7 2.7 0 010 5.4H9.6"/>',
  church: '<path d="M12 2.4v4.2M10 4.4h4"/><path d="M6.6 21v-8.6L12 7.6l5.4 4.8V21M3.5 21h17"/><path d="M10.4 21v-3.4a1.6 1.6 0 013.2 0V21"/>',
  bike: '<circle cx="6" cy="16" r="3.6"/><circle cx="18" cy="16" r="3.6"/><path d="M6 16l3.5-7h6.2L18 16M9.5 9L12 16h2.6M8 6.5h3"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.3" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  check: '<path d="M5 12.6l4.4 4.4L19.2 7.4"/>',
  info: '<circle cx="12" cy="12" r="9.2"/><path d="M12 10.8v6"/><circle cx="12" cy="7.6" r=".8" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  clock: '<circle cx="12" cy="12" r="9.2"/><path d="M12 6.8V12l3.4 2.2"/>',
  layers: '<path d="M12 3.2l9 4.9-9 4.9-9-4.9z"/><path d="M3 12.3l9 4.9 9-4.9M3 16.4l9 4.9 9-4.9"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6 9.6h.01M9.3 9.6h.01M12.6 9.6h.01M15.9 9.6h.01M18.2 9.6h.01M6 12.6h.01M18.2 12.6h.01M8.6 15h6.8"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 6.5v3.2"/>',
  touch: '<path d="M9 11.5V5.2a1.7 1.7 0 013.4 0v5.6"/><path d="M12.4 10.2a1.7 1.7 0 013.4 0v1.3a1.7 1.7 0 013.4 0v3.6a6.2 6.2 0 01-6.2 6.2h-.7a6 6 0 01-4.9-2.5l-3-4.2a1.7 1.7 0 012.7-2L9 13.9"/>',
  star: '<path d="M12 3.3l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.6l6-.8z"/>',
  bank: '<path d="M3 9.2L12 4l9 5.2z"/><path d="M5.5 10.5v6.8M10 10.5v6.8M14 10.5v6.8M18.5 10.5v6.8M3 20.5h18"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/>',
  leaf: '<path d="M5.2 19.3C4 11 8.6 4.9 20 4.4c.2 11.3-6.1 15.9-14.8 14.9z"/><path d="M5.2 19.3L14 10.5"/>',
  compassN: '<path d="M12 3l3 9h-6z" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  gauge: '<path d="M4.2 17.5a8.6 8.6 0 1115.6 0"/><path d="M12 13.2l4-4.2"/><circle cx="12" cy="13.6" r="1.3" fill="currentColor"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 8.5V6.2A2.2 2.2 0 0013.3 4H6.2A2.2 2.2 0 004 6.2v7.1a2.2 2.2 0 002.2 2.2h2.3"/>',
  warn: '<path d="M12 3.6L21.5 20H2.5z"/><path d="M12 9.8v4.6"/><circle cx="12" cy="17.1" r=".7" fill="currentColor"/>',
  refresh: '<path d="M20 11.5A8 8 0 105.5 17"/><path d="M20 4.5v7h-7"/>',
  season: '<path d="M12 3.2c3.6 2.4 5.2 5.4 5.2 8.8a5.2 5.2 0 01-10.4 0c0-3.4 1.6-6.4 5.2-8.8z"/><path d="M12 21v-9"/>',
  snow: '<path d="M12 2.8v18.4M4 7.4l16 9.2M20 7.4L4 16.6"/><path d="M9.5 4.3L12 6.3l2.5-2M9.5 19.7l2.5-2 2.5 2"/>',
  flower: '<circle cx="12" cy="9.2" r="2.1"/><path d="M12 7.1a2.6 2.6 0 110-5.2 2.6 2.6 0 110 5.2zM14.1 9.2a2.6 2.6 0 115.2 0 2.6 2.6 0 11-5.2 0zM9.9 9.2a2.6 2.6 0 11-5.2 0 2.6 2.6 0 115.2 0zM12 11.3a2.6 2.6 0 110 5.2 2.6 2.6 0 110-5.2z"/><path d="M12 16.5V22M12 19.5c1.8-.2 3-1.2 3.6-2.8"/>',
  maple: '<path d="M12 21.5v-6.3"/><path d="M12 2.6l1.7 3.5 2.4-1-0.6 4 3.4-1.2-1 2.6 2.6 1.2-4.4 3.3.6 1.8-4.7-.7L12 15.2l0 0-.1-.1-4.7.7.6-1.8-4.4-3.3 2.6-1.2-1-2.6 3.4 1.2-.6-4 2.4 1z"/>',
  summer: '<circle cx="12" cy="12" r="4.4"/><path d="M12 1.8v2.6M12 19.6v2.6M1.8 12h2.6M19.6 12h2.6M4.8 4.8l1.8 1.8M17.4 17.4l1.8 1.8M4.8 19.2l1.8-1.8M17.4 6.6l1.8-1.8"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.info;
  return `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function iconEl(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}

export const ICON_NAMES = Object.keys(P);
