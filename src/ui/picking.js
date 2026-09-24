// Hover + click picking over ctx.pick objects. Hover raycasts run once the pointer rests (not while the camera
// is moving or flying) and use a nearest-first bounding-sphere walk (raycast.js); click detection ignores drags
// and joystick taps; terrain occlusion via a cheap heightfield ray-march; a tooltip near the cursor that keeps
// clear of the info panel. With pointer lock (walk mode) picking uses the screen centre.
import * as THREE from 'three';
import { h, escapeHtml } from './dom.js';
import { icon } from './icons.js';
import { firstPickHit, terrainHitDistance, warmPickGrids, gridStats, pickGridQueue } from './raycast.js';

const HOVER_INTERVAL = 0.09;   // s between hover raycasts
const REST = 0.06;             // s the pointer must rest before a hover raycast
const CAM_STILL = 0.12;        // s the camera must be still before re-picking under a resting cursor
const LOCK_INTERVAL = 0.2;
const JOY_ZONE = 0.42;         // left part of the screen used by the touch joystick in walk / fly (see controls/touch.js)

export function createPicking(ctx, { root, catalog, labels, onHover, onSelect, isBlocked }) {
  const canvas = ctx.renderer?.domElement || ctx.canvas;
  const raycaster = new THREE.Raycaster();
  raycaster.far = 6000;
  const ndc = new THREE.Vector2();
  const tip = h('div.tooltip', { role: 'tooltip' });
  root.appendChild(tip);

  let px = -1, py = -1;           // last pointer position (client px)
  let moved = false, inside = false, dragging = false;
  let sinceHover = 0, sinceMove = 0, camStill = 0;
  let hoverEntry = null, hoverRec = null;
  let down = null;
  let tipVisible = false;
  let tipKey = '';

  const locked = () => !!document.pointerLockElement;
  const lastCam = new THREE.Vector3(1e9, 0, 0);
  const lastQuat = new THREE.Quaternion();

  /** Raycast at client coords (or the screen centre) → { entry, point } | null */
  function pickAt(cx, cy) {
    const cam = ctx.camera;
    if (!cam || !ctx.pick?.items?.size) return null;
    const rect = canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: innerWidth, height: innerHeight };
    if (cx === null) ndc.set(0, 0);
    else ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, cam);
    let hit = null;
    try { hit = firstPickHit(ctx, raycaster); } catch (e) { return null; }
    if (!hit) return null;
    if (terrainHitDistance(ctx, raycaster.ray, hit.distance) < hit.distance - 1) return null;
    let entry = null;
    try { entry = ctx.pick.resolve(hit); } catch { entry = null; }
    if (!entry) return null;
    return { entry, point: hit.point };
  }

  const keyOf = (e) => (e ? `${e.kind}:${e.key ?? ''}:${e.osmId ?? ''}` : '');

  function setHover(res) {
    const entry = res?.entry || null;
    if (keyOf(entry) === keyOf(hoverEntry)) return;
    hoverEntry = entry;
    hoverRec = entry ? catalog.fromPick(entry) : null;
    ctx.events.emit('hover', entry);
    onHover?.(entry, hoverRec);
    if (canvas) canvas.style.cursor = entry && !locked() ? 'pointer' : '';
    renderTip();
  }

  function renderTip() {
    const r = hoverRec;
    if (!r) { tip.classList.remove('show'); tipVisible = false; tipKey = ''; return; }
    const k = r.key;
    if (k !== tipKey) {
      tipKey = k;
      const zh = r.nameZh, en = r.nameEn;
      let title = zh || en;
      let sub = zh && en ? en : '';
      if (!title) {
        title = r.cat?.zh || '建筑';
        sub = r.building?.address || '未命名';
      }
      tip.innerHTML = `<span class="tt-ico">${icon(r.cat?.icon || 'pin')}</span><span class="tt-txt"><b>${escapeHtml(title)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</span><span class="tt-cat">${escapeHtml(r.cat?.zh || '')}</span>`;
    }
    tip.classList.add('show');
    tipVisible = true;
    placeTip();
  }

  // Keep the tooltip off the open info panel / sheet: flip it to the other side of the cursor, else hide it.
  const overlaps = (x, y, w, hh, r) => r && x < r.right && x + w > r.left && y < r.bottom && y + hh > r.top;
  function placeTip() {
    if (!tipVisible) return;
    let x, y;
    let blocked = false;
    if (locked()) { x = innerWidth / 2; y = innerHeight / 2 + 26; tip.classList.add('centre'); }
    else {
      tip.classList.remove('centre');
      x = px + 16; y = py + 18;
      const w = tip.offsetWidth || 180, hh = tip.offsetHeight || 40;
      if (x + w > innerWidth - 8) x = px - w - 12;
      if (y + hh > innerHeight - 8) y = py - hh - 12;
      const panel = root.querySelector('.info.open')?.getBoundingClientRect();
      if (overlaps(x, y, w, hh, panel)) {
        const alt = x > px ? px - w - 12 : px + 16;
        if (alt >= 4 && alt + w <= innerWidth - 4 && !overlaps(alt, y, w, hh, panel)) x = alt;
        else blocked = true;
      }
    }
    tip.classList.toggle('blocked', blocked);
    tip.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
  }

  // ---------------------------------------------------------------- pointer events
  let labelHover = null;
  function setLabelHover(st) {
    if (st === labelHover) return;
    labelHover = st;
    labels?.setHover(st);
    if (canvas) canvas.style.cursor = st ? 'pointer' : hoverEntry && !locked() ? 'pointer' : '';
  }
  function onMove(e) {
    if (e.pointerType === 'touch') return;
    px = e.clientX; py = e.clientY; moved = true; inside = true; sinceMove = 0;
    dragging = e.buttons !== 0;
    if (!dragging && labels && !locked()) {
      setLabelHover(labels.hitTest(px, py));
      if (labelHover && hoverEntry) setHover(null);
    } else if (dragging) setLabelHover(null);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.drag = true;
    if (tipVisible) placeTip();
  }
  function onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), drag: false, id: e.pointerId };
  }
  function onUp(e) {
    const d = down;
    down = null;
    if (!d || d.id !== e.pointerId || d.drag) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 550) return;
    if (isBlocked?.()) return;
    const wasLocked = locked();
    const mode = ctx.nav?.mode;
    // In walk mode without pointer lock the first click only locks the pointer (controls handle it).
    if (mode === 'walk' && !wasLocked && e.pointerType === 'mouse') return;
    // Touch in walk / fly: taps in the joystick zone steer, they don't select what is under the thumb.
    if (e.pointerType === 'touch' && (mode === 'walk' || mode === 'fly') && d.x < innerWidth * JOY_ZONE) return;
    if (!wasLocked && labels) {
      const st = labels.hitTest(e.clientX, e.clientY);
      if (st) { labels.select(st); return; }
    }
    const res = wasLocked ? pickAt(null) : pickAt(e.clientX, e.clientY);
    onSelect?.(res?.entry || null, res ? catalog.fromPick(res.entry) : null, res?.point || null);
  }
  function onLeave() { inside = false; setHover(null); setLabelHover(null); }

  if (canvas) {
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointerleave', onLeave);
  }
  // Picking acceleration structures are built in idle time once the app is up.
  ctx.events?.on?.('app:ready', () => setTimeout(() => { try { warmPickGrids(ctx); } catch { /* ignore */ } }, 2500));
  // Pointer lock moves aren't reported as pointer position changes; keep picking the centre.
  document.addEventListener('pointerlockchange', () => { moved = true; setHover(null); });

  function update(dt) {
    sinceHover += dt;
    sinceMove += dt;
    if (isBlocked?.()) { if (hoverEntry) setHover(null); return; }
    if (locked()) {
      if (sinceHover >= LOCK_INTERVAL) { sinceHover = 0; setHover(pickAt(null)); }
      return;
    }
    if (!inside || dragging) { if (dragging && hoverEntry) setHover(null); return; }
    // The camera moving under a still cursor (fly-to, keyboard, damping) also changes what is hovered:
    // drop the stale hover during scripted flights, and re-pick once the camera has settled.
    const cam = ctx.camera;
    if (cam) {
      if (cam.position.distanceToSquared(lastCam) > 0.0004 || 1 - Math.abs(cam.quaternion.dot(lastQuat)) > 1e-8) {
        lastCam.copy(cam.position); lastQuat.copy(cam.quaternion);
        camStill = 0;
        moved = true;
      } else camStill += dt;
    }
    if (ctx.nav?.busy) { if (hoverEntry) setHover(null); return; }
    if (camStill < CAM_STILL || sinceMove < REST) return;
    if (moved && sinceHover >= HOVER_INTERVAL) {
      moved = false; sinceHover = 0;
      if (labels) setLabelHover(labels.hitTest(px, py));
      setHover(labelHover ? null : pickAt(px, py));
    }
  }

  return {
    update,
    pickAt,
    clear: () => setHover(null),
    gridStats,
    get gridQueue() { return pickGridQueue(); },
    get hover() { return hoverEntry; },
  };
}
