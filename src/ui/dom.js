// Small DOM / formatting helpers shared by the UI modules. No framework — just tiny utilities.

/**
 * Hyperscript-style element factory.
 *   h('button.btn.primary', { title: 'x', onclick }, [child, 'text'])
 * Attribute keys: `class`, `style` (string or object), `html` (innerHTML), `on<event>` (listener),
 * `data-*` / `aria-*` / anything else → setAttribute. `false`/`null` values are skipped.
 */
export function h(tag, attrs = null, children = null) {
  let cls = '';
  let id = '';
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  let name = 'div';
  if (m) {
    name = m[1] || 'div';
    for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
      if (part[0] === '.') cls += (cls ? ' ' : '') + part.slice(1);
      else id = part.slice(1);
    }
  }
  const el = document.createElement(name);
  if (cls) el.className = cls;
  if (id) el.id = id;
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === false || v === null || v === undefined) continue;
      if (k === 'class') el.className = (el.className ? el.className + ' ' : '') + v;
      else if (k === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else Object.assign(el.style, v);
      } else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  if (children !== null && children !== undefined) append(el, children);
  return el;
}

export function append(el, children) {
  if (Array.isArray(children)) { for (const c of children) append(el, c); return el; }
  if (children === null || children === undefined || children === false) return el;
  el.appendChild(children instanceof Node ? children : document.createTextNode(String(children)));
  return el;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 320 → "320 m", 1540 → "1.5 km" */
export function fmtDist(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m / (m < 100 ? 5 : 10)) * (m < 100 ? 5 : 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

/** hours (0..24, fractional) → "15:30" */
export function fmtClock(hours) {
  let h = ((hours % 24) + 24) % 24;
  let mins = Math.round(h * 60);
  if (mins >= 1440) mins -= 1440;
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** Chinese part-of-day word for an hour. */
export function dayPart(hours) {
  const h = ((hours % 24) + 24) % 24;
  if (h < 5) return '凌晨';
  if (h < 7.5) return '清晨';
  if (h < 11.5) return '上午';
  if (h < 13.5) return '中午';
  if (h < 17.5) return '下午';
  if (h < 19.5) return '傍晚';
  return '夜晚';
}

/** True while the user is typing in a text field (keyboard shortcuts must be ignored). */
export function isTyping() {
  const a = document.activeElement;
  if (!a) return false;
  const tag = a.tagName;
  if (tag === 'TEXTAREA' || a.isContentEditable) return true;
  if (tag === 'INPUT') return !['range', 'checkbox', 'radio', 'button'].includes(a.type);
  return tag === 'SELECT';
}

/** Copy text to the clipboard with a legacy fallback (file:// pages, older browsers). */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext !== false) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export const storage = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
};

export const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : false);
export const isNarrow = () => mq('(max-width: 720px)');
/** Touch-first device (phone / tablet). Desktop touch-screens with a mouse count as desktop. */
export const isTouchUI = (ctx) => mq('(pointer: coarse)') || (!!ctx?.isMobile && !mq('(pointer: fine)'));
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');

/** The #ui overlay root (created if the page shell does not have one, e.g. in the test harness). */
export function uiRoot() {
  let root = document.getElementById('ui');
  if (!root) {
    root = document.createElement('div');
    root.id = 'ui';
    document.body.appendChild(root);
  }
  root.classList.add('cmu-ui');
  return root;
}

/** Normalise a vector-ish value ([x,y,z] | {x,y,z}) to an array, or null. */
export function vec3(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v.length >= 3 ? [+v[0], +v[1], +v[2]] : v.length === 2 ? [+v[0], 0, +v[1]] : null;
  if (typeof v === 'object' && 'x' in v) return [+v.x, +(v.y ?? 0), +v.z];
  return null;
}
