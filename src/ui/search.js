// Command-palette style search (/ or F): fuzzy zh/en matching over the catalogue, category filters,
// keyboard navigation, distance from the camera; selecting a result flies there and opens the info panel.
import { h, escapeHtml, fmtDist, isTouchUI } from './dom.js';
import { icon } from './icons.js';
import { trapFocus } from './help.js';

const FILTERS = [
  { id: 'all', zh: '全部', test: () => true },
  { id: 'landmark', zh: '地标', test: (r) => r.kind === 'landmark' },
  { id: 'building', zh: '建筑', test: (r) => r.kind === 'building' },
  { id: 'outdoor', zh: '户外', test: (r) => r.kind === 'area' },
  { id: 'art', zh: '艺术', test: (r) => r.kind === 'poi' && ['artwork', 'memorial', 'museum', 'fountain'].includes(r.type) },
  { id: 'food', zh: '餐饮', test: (r) => r.kind === 'poi' && ['cafe', 'restaurant', 'fast_food', 'bar'].includes(r.type) },
];

export function createSearch(ctx, { root, catalog, onPick, onHome, onOpenChange }) {
  const input = h('input.search-input', {
    type: 'search', placeholder: '搜索建筑、地标、艺术品、咖啡馆…', 'aria-label': '搜索地点', autocomplete: 'off', spellcheck: 'false',
    role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'search-list', 'aria-autocomplete': 'list',
  });
  const clearBtn = h('button.icon-btn.search-clear', { type: 'button', 'aria-label': '清除', html: icon('close') });
  // phones: the sheet covers the whole screen (and its backdrop), so it needs its own way out
  const cancelBtn = h('button.search-cancel', { type: 'button', 'aria-label': '关闭搜索' }, '取消');
  const filterBar = h('div.search-filters', { role: 'tablist', 'aria-label': '分类' });
  const hint = h('div.search-hint');
  const list = h('ul.search-results', { id: 'search-list', role: 'listbox', 'aria-label': '搜索结果' });
  const panel = h('div.search-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '搜索' }, [
    h('div.search-field', null, [h('span.search-ico', { html: icon('search') }), input, clearBtn, h('kbd.search-esc', null, 'Esc'), cancelBtn]),
    filterBar,
    hint,
    list,
    h('div.search-foot', null, [
      h('span', null, [h('kbd', null, '↑'), h('kbd', null, '↓'), ' 选择']),
      h('span', null, [h('kbd', null, 'Enter'), ' 前往']),
      h('span', null, [h('kbd', null, 'Esc'), ' 关闭']),
    ]),
  ]);
  const el = h('div.search-overlay', { 'aria-hidden': 'true' }, [h('div.search-backdrop'), panel]);
  root.appendChild(el);

  let open = false;
  let filter = 'all';
  let results = [];
  let active = 0;

  for (const f of FILTERS) {
    const b = h('button.fchip', { type: 'button', role: 'tab', 'data-id': f.id, 'aria-selected': f.id === filter ? 'true' : 'false' }, f.zh);
    b.addEventListener('click', () => { filter = f.id; for (const c of filterBar.children) c.setAttribute('aria-selected', c.dataset.id === filter ? 'true' : 'false'); run(); input.focus(); });
    filterBar.appendChild(b);
  }

  function highlight(text, q) {
    const s = String(text || '');
    if (!q) return escapeHtml(s);
    const i = s.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return escapeHtml(s);
    return `${escapeHtml(s.slice(0, i))}<mark>${escapeHtml(s.slice(i, i + q.length))}</mark>${escapeHtml(s.slice(i + q.length))}`;
  }

  function run() {
    const q = input.value.trim();
    const cam = ctx.camera?.position;
    const from = cam ? [cam.x, cam.y, cam.z] : null;
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
    let res = catalog.search(q, from, 300).filter((o) => f.test(o.r));
    const pins = filter === 'all' && catalog.pinned ? catalog.pinned(q).map((r) => ({ r, s: 1000, d: 0 })) : [];
    if (pins.length) res = pins.concat(res);
    if (!q && filter !== 'all') {
      // browsing a category with no query: list it by distance
      res = catalog.records.filter((r) => f.test(r) && r.position && (r.nameZh || r.nameEn))
        .map((r) => ({ r, s: 1, d: from ? Math.hypot(r.position[0] - from[0], r.position[2] - from[2]) : 0 }))
        .sort((a, b) => a.d - b.d);
      if (catalog.dedupe) res = catalog.dedupe(res);
    }
    results = res.slice(0, 40);
    active = 0;
    clearBtn.hidden = !q;
    hint.textContent = q ? (results.length ? `找到 ${results.length}${res.length > 40 ? '+' : ''} 个地点` : '') : (filter === 'all' ? '推荐地点 · Featured' : `${f.zh} · 按距离排序`);
    list.innerHTML = '';
    if (!results.length) {
      list.append(h('li.search-empty', null, [h('span', { html: icon('search') }), h('b', null, '没有找到相关地点'), h('small', null, '试试英文名、缩写（如 GHC）或类别（如 咖啡）')]));
      return;
    }
    results.forEach((o, i) => {
      const r = o.r;
      const primary = r.nameZh || r.nameEn;
      const nearTxt = r.near ? (r.near.nameZh || r.near.nameEn) : '';
      const secondary = [r.nameZh ? r.nameEn : '', nearTxt ? `@ ${nearTxt}` : ''].filter(Boolean).join('  ·  ');
      const li = h('li.search-item', { role: 'option', id: `sr-${i}`, 'aria-selected': i === active ? 'true' : 'false', 'data-i': i }, [
        h(`span.res-ico.k-${r.kind}`, { html: icon(r.cat?.icon || 'pin') }),
        h('span.res-main', null, [
          h('b', { html: highlight(primary, q) }),
          secondary ? h('small', { html: highlight(secondary, q) }) : null,
        ]),
        h('span.res-meta', null, [
          h('span.res-cat', null, r.cat?.zh || ''),
          o.d ? h('span.res-dist', null, fmtDist(o.d)) : null,
        ]),
      ]);
      li.addEventListener('click', () => choose(i));
      li.addEventListener('mousemove', () => { if (active !== i) setActive(i, false); });
      list.appendChild(li);
    });
    input.setAttribute('aria-activedescendant', 'sr-0');
  }

  function setActive(i, scroll = true) {
    if (!results.length) return;
    active = (i + results.length) % results.length;
    for (const li of list.children) li.setAttribute('aria-selected', String(+li.dataset.i === active));
    input.setAttribute('aria-activedescendant', `sr-${active}`);
    if (scroll) list.children[active]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(i) {
    const o = results[i];
    if (!o) return;
    close();
    if (o.r.action === 'home') onHome?.();
    else onPick?.(o.r);
  }

  input.addEventListener('input', run);
  input.addEventListener('keydown', (e) => {
    // Pinyin / IME composition: Enter commits the letters and arrows pick candidates — not ours.
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab' && !e.shiftKey && results.length) { e.preventDefault(); setActive(active + 1); }
  });
  clearBtn.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
  cancelBtn.addEventListener('click', () => close());
  el.querySelector('.search-backdrop').addEventListener('click', () => close());
  // modal: Tab / Shift+Tab stay inside the panel (the input handles plain Tab itself when there are results)
  trapFocus(panel, () => open);

  // Touch devices: the system Back button / gesture closes the search instead of leaving the page.
  const useHistory = isTouchUI(ctx) && !!history.pushState;
  let histToken = 0;
  addEventListener('popstate', () => { if (open && histToken) { histToken = 0; close(); } });

  let opener = null;
  function openSearch(prefill = '') {
    if (!open) {
      opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      open = true;
      el.classList.add('open');
      el.setAttribute('aria-hidden', 'false');
      onOpenChange?.(true);
      if (useHistory) {
        try { histToken = Date.now(); history.pushState({ ...(history.state || {}), cmu3dSearch: histToken }, ''); } catch { histToken = 0; }
      }
    }
    if (typeof prefill === 'string') input.value = prefill;
    run();
    // focus after the transition frame so the key that opened search isn't typed into the field
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }
  function close() {
    if (!open) return;
    open = false;
    // closed by the UI (not by Back): drop the history entry we pushed, if it is still the current one
    if (histToken) {
      const t = histToken;
      histToken = 0;
      try { if (history.state?.cmu3dSearch === t) history.back(); } catch { /* ignore */ }
    }
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    input.blur();
    // give focus back to whatever opened the search (toolbar button); canvas-driven opens just blur
    if (opener && opener.isConnected && typeof opener.focus === 'function') { try { opener.focus({ preventScroll: true }); } catch { /* ignore */ } }
    opener = null;
    onOpenChange?.(false);
  }

  return {
    open: openSearch, close,
    get isOpen() { return open; },
    toggle() { open ? close() : openSearch(); },
    input,
  };
}
