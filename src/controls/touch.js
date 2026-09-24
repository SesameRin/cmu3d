// Touch controls for walk / fly on phones and tablets: a floating virtual joystick (any touch that starts on the
// left part of the screen), right-side drag to look (handled in controls.js) and round action buttons
// (walk: 跳 jump · fly: 升 / 降 rise / sink).
//
// DOM (inside #ui):  .nav-touch[data-mode=walk|fly] > .nav-joystick > .nav-joystick-knob
//                                                  > button.nav-btn.nav-jump, button.nav-btn.nav-fly-down
// Default looks come from a small injected stylesheet using zero-specificity :where() selectors, so any rule in
// css/styles.css overrides them. Only functional styles (transforms, visibility) are set inline. The joystick
// size is read from the DOM, so it may be resized in CSS.
//
// The joystick visuals are pointer-events:none — touches are received by the canvas and routed here by
// controls.js, so the joystick works anywhere in the left zone, not just on the drawn circle.
import { clamp } from './tween.js';

const CSS = `
:where(.nav-touch){position:fixed;inset:0;pointer-events:none;z-index:5;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
:where(.nav-joystick){position:absolute;left:0;top:0;width:112px;height:112px;border-radius:50%;box-sizing:border-box;
  background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.16),rgba(255,255,255,.05) 70%);
  border:1.5px solid rgba(255,255,255,.5);box-shadow:0 4px 18px rgba(0,0,0,.28);opacity:.5;transition:opacity .18s;will-change:transform}
:where(.nav-joystick.active){opacity:.92}
:where(.nav-joystick-knob){position:absolute;left:50%;top:50%;width:50px;height:50px;margin:-25px 0 0 -25px;border-radius:50%;
  background:rgba(255,255,255,.88);box-shadow:0 2px 8px rgba(0,0,0,.35);will-change:transform}
:where(.nav-btn){position:absolute;right:calc(22px + env(safe-area-inset-right,0px));width:62px;height:62px;border-radius:50%;
  pointer-events:auto;touch-action:none;padding:0;display:flex;align-items:center;justify-content:center;
  border:1.5px solid rgba(255,255,255,.55);background:rgba(18,20,24,.42);color:#fff;font:600 17px/1 "Noto Sans SC",system-ui,sans-serif;
  backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);box-shadow:0 3px 14px rgba(0,0,0,.3);-webkit-tap-highlight-color:transparent}
:where(.nav-btn.pressed){background:rgba(196,18,48,.6)}
:where(.nav-jump){bottom:calc(40px + env(safe-area-inset-bottom,0px))}
:where(.nav-touch[data-mode="fly"] .nav-jump){bottom:calc(112px + env(safe-area-inset-bottom,0px))}
:where(.nav-fly-down){bottom:calc(40px + env(safe-area-inset-bottom,0px));display:none}
:where(.nav-touch[data-mode="fly"] .nav-fly-down){display:flex}
`;

function el(tag, cls, parent) {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export function createTouchUI(ctx, { onJump, onVert } = {}) {
  if (!document.getElementById('nav-touch-style')) {
    const st = document.createElement('style');
    st.id = 'nav-touch-style';
    st.textContent = CSS;
    // before other stylesheets so the app's CSS wins ties as well
    document.head.insertBefore(st, document.head.firstChild);
  }
  const root = document.getElementById('ui') || document.body;
  const wrap = el('div', 'nav-touch', root);
  wrap.style.display = 'none';
  const base = el('div', 'nav-joystick', wrap);
  const knob = el('div', 'nav-joystick-knob', base);
  const jumpBtn = el('button', 'nav-btn nav-jump', wrap);
  jumpBtn.type = 'button';
  const downBtn = el('button', 'nav-btn nav-fly-down', wrap);
  downBtn.type = 'button';
  downBtn.textContent = '降';
  downBtn.setAttribute('aria-label', '下降');

  let mode = 'orbit';
  // Phones/tablets. Headless screenshot browsers can look "mobile" (10 touch points, small screen), so in ?shot
  // mode the touch UI only appears after a real touch.
  const shot = !!(ctx.shotMode ?? new URLSearchParams(location.search).has('shot'));
  let capable = !shot && (!!ctx.isMobile || (navigator.maxTouchPoints > 0 && typeof matchMedia === 'function' &&
    matchMedia('(hover: none) and (pointer: coarse)').matches));
  let joyId = null;
  let cx = 0, cy = 0;
  const axes = { x: 0, y: 0, mag: 0 };
  let upHeld = false, downHeld = false;

  const radius = () => (base.offsetWidth || 112) / 2;
  function restPos() {
    const R = radius();
    return [36 + R, innerHeight - (60 + R)];
  }
  function placeBase(x, y) {
    const R = radius();
    cx = x; cy = y;
    base.style.transform = `translate(${x - R}px, ${y - R}px)`;
  }
  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function refresh() {
    const show = capable && (mode === 'walk' || mode === 'fly');
    wrap.style.display = show ? '' : 'none';
    wrap.dataset.mode = mode;
    jumpBtn.textContent = mode === 'fly' ? '升' : '跳';
    jumpBtn.setAttribute('aria-label', mode === 'fly' ? '上升' : '跳跃');
    if (show && joyId === null) { const [x, y] = restPos(); placeBase(x, y); setKnob(0, 0); }
  }

  // hold-to-act buttons
  function bindHold(btn, down, up) {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      btn.classList.add('pressed');
      down();
    });
    const end = (e) => { e?.preventDefault?.(); btn.classList.remove('pressed'); up(); };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindHold(jumpBtn, () => { if (mode === 'fly') { upHeld = true; onVert?.(); } else onJump?.(); }, () => { upHeld = false; });
  bindHold(downBtn, () => { downHeld = true; onVert?.(); }, () => { downHeld = false; });

  addEventListener('resize', () => { if (joyId === null) refresh(); });

  return {
    el: wrap,
    axes,
    get joyId() { return joyId; },
    get capable() { return capable; },
    get vert() { return (upHeld ? 1 : 0) - (downHeld ? 1 : 0); },
    markTouch() { if (!capable) { capable = true; refresh(); } },
    setMode(m) { mode = m; if (m === 'orbit') this.end(joyId); refresh(); },
    // Is a new touch at screen x meant for the joystick?
    wantsJoystick(x) { return capable && joyId === null && x < innerWidth * 0.42 && (mode === 'walk' || mode === 'fly'); },
    start(id, x, y) {
      const R = radius();
      joyId = id;
      // the ring appears under the finger (kept fully on screen)
      placeBase(clamp(x, R + 6, innerWidth - R - 6), clamp(y, R + 6, innerHeight - R - 6));
      base.classList.add('active');
      this.move(id, x, y);
    },
    move(id, x, y) {
      if (id !== joyId) return;
      const R = radius();
      let dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      setKnob(dx, dy);
      axes.x = dx / R; axes.y = dy / R; axes.mag = Math.min(1, d / R);
    },
    end(id) {
      if (id === null || id !== joyId) return;
      joyId = null;
      axes.x = axes.y = axes.mag = 0;
      base.classList.remove('active');
      const [x, y] = restPos();
      placeBase(x, y); setKnob(0, 0);
    },
    reset() { this.end(joyId); upHeld = downHeld = false; jumpBtn.classList.remove('pressed'); downBtn.classList.remove('pressed'); },
  };
}
