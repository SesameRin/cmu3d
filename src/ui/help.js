// Help overlay (H / ?): navigation modes, desktop + touch controls, keyboard shortcut table, attribution.
// Also exports the toast() stack.
import { h, isTouchUI } from './dom.js';
import { icon } from './icons.js';

export const ATTRIBUTION = '地图数据 © OpenStreetMap 贡献者 (ODbL) · 高程 AWS Terrain Tiles · 非官方爱好者作品，与卡内基梅隆大学无关';

const kbd = (...keys) => h('span.keys', null, keys.map((k) => h('kbd', null, k)));

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
/** Keep Tab / Shift+Tab inside `container` while isOpen() (modal dialogs). */
export function trapFocus(container, isOpen) {
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab' || e.defaultPrevented || !isOpen()) return;
    const list = [...container.querySelectorAll(FOCUSABLE)].filter((x) => !x.hidden && x.getClientRects().length > 0);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    const a = document.activeElement;
    const inside = container.contains(a) && a !== container;
    if (e.shiftKey && (!inside || a === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || a === last)) { e.preventDefault(); first.focus(); }
  });
}

export function createHelp(ctx, { root, onOpenChange }) {
  const closeBtn = h('button.icon-btn.help-close', { type: 'button', 'aria-label': '关闭 (Esc)', title: '关闭 (Esc)', html: icon('close') });
  const touchFirst = isTouchUI(ctx);

  const modeCard = (ico, zh, en, key, text) => h('div.mode-card', null, [
    h('div.mode-card-h', null, [h('span.mode-card-ico', { html: icon(ico) }), h('span', null, [h('b', null, zh), h('small', null, en)]), h('kbd', null, key)]),
    h('p', null, text),
  ]);
  const row = (keys, text) => h('div.krow', null, [keys, h('span', null, text)]);

  const desktop = h('div.help-col', null, [
    h('h3', { html: `${icon('mouse')}<span>鼠标与键盘</span>` }),
    h('div.klist', null, [
      row(kbd('左键拖动'), '旋转视角（俯瞰）'),
      row(kbd('右键拖动'), '平移'),
      row(kbd('滚轮'), '缩放 · 飞行模式下调节速度'),
      row(kbd('双击'), '飞到该位置'),
      row(kbd('单击'), '查看建筑 / 地标信息'),
      row(kbd('W', 'A', 'S', 'D'), '移动（步行 / 飞行）'),
      row(kbd('Shift'), '奔跑 / 加速'),
      row(kbd('空格'), '跳跃（步行）'),
      row(kbd('E', 'Q'), '上升 / 下降（飞行）'),
    ]),
  ]);
  const touch = h('div.help-col', null, [
    h('h3', { html: `${icon('touch')}<span>触屏</span>` }),
    h('div.klist', null, [
      row(kbd('单指拖动'), '旋转视角'),
      row(kbd('双指拖动'), '平移'),
      row(kbd('双指捏合'), '缩放'),
      row(kbd('轻点'), '查看建筑 / 地标信息'),
      row(kbd('左下摇杆'), '步行模式下移动'),
      row(kbd('右侧拖动'), '步行模式下环视'),
    ]),
  ]);
  const shortcuts = h('div.help-col.help-keys', null, [
    h('h3', { html: `${icon('keyboard')}<span>快捷键</span>` }),
    h('div.kgrid', null, [
      row(kbd('1', '2', '3'), '俯瞰 / 步行 / 飞行'),
      row(kbd('/', 'F'), '搜索地点'),
      row(kbd('T'), '开始 / 结束导览'),
      row(kbd('M'), '小地图'),
      row(kbd('L'), '显示 / 隐藏标签'),
      row(kbd('N'), '白天 / 夜晚'),
      row(kbd('H', '?'), '帮助'),
      row(kbd('Esc'), '关闭面板 · 退出步行'),
    ]),
  ]);

  const panel = h('div.help-panel.glass', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title', tabindex: '-1' }, [
    h('header.help-head', null, [
      h('div', null, [h('div.help-kicker', null, 'How to explore'), h('h2', { id: 'help-title' }, '操作指南')]),
      closeBtn,
    ]),
    h('div.help-scroll', null, [
      h('div.mode-cards', null, [
        modeCard('orbit', '俯瞰', 'Orbit', '1', '像看沙盘一样环绕校园：拖动旋转、滚轮缩放，点击建筑查看介绍。'),
        modeCard('walk', '步行', 'Walk', '2', '以 1.65 米的视角在校园里散步，会被建筑挡住，也能走上台阶与桥。'),
        modeCard('fly', '飞行', 'Fly', '3', '自由飞行的无人机视角，可以穿梭在楼宇之间，适合寻找好角度。'),
      ]),
      h('div.help-grid', null, touchFirst ? [touch, desktop, shortcuts] : [desktop, touch, shortcuts]),
      h('p.help-attrib', null, ATTRIBUTION),
    ]),
  ]);
  const el = h('div.help-overlay', { 'aria-hidden': 'true' }, [h('div.help-backdrop'), panel]);
  root.appendChild(el);

  let open = false;
  let opener = null;
  function show() {
    if (open) return;
    open = true;
    const a = document.activeElement;
    opener = a && a !== document.body && !el.contains(a) ? a : null;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    onOpenChange?.(true);
    requestAnimationFrame(() => panel.focus({ preventScroll: true }));
  }
  function hide() {
    if (!open) return;
    open = false;
    el.classList.remove('open');
    el.setAttribute('aria-hidden', 'true');
    const back = opener;
    opener = null;
    if (el.contains(document.activeElement)) document.activeElement.blur();
    if (back?.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch { /* ignore */ } }
    onOpenChange?.(false);
  }
  trapFocus(panel, () => open);
  closeBtn.addEventListener('click', hide);
  el.querySelector('.help-backdrop').addEventListener('click', hide);

  return { show, hide, toggle: () => (open ? hide() : show()), get isOpen() { return open; } };
}

export function createToasts(root) {
  const box = h('div.toasts', { role: 'status', 'aria-live': 'polite' });
  root.appendChild(box);
  let lastMsg = '', lastT = 0;
  return function toast(msg, { icon: ico = null, ms = 2600 } = {}) {
    if (!msg) return;
    const now = performance.now();
    if (msg === lastMsg && now - lastT < 800) return;
    lastMsg = msg; lastT = now;
    const t = h('div.toast', null, [ico ? h('span.toast-ico', { html: icon(ico) }) : null, h('span', null, String(msg))]);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); t.classList.add('out'); setTimeout(() => t.remove(), 420); }, ms);
  };
}
