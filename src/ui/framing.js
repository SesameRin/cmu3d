// Screen framing: while a panel covers part of the screen (the info side panel on desktop, the bottom sheet on
// phones, the guided-tour card) the camera projection is shifted with camera.setViewOffset so the orbit target —
// what flyTo centred — sits in the middle of the part of the screen that is still visible. Picking, labels and
// controls all project through camera.projectionMatrix, so they stay consistent. Only in orbit mode: walk / fly
// keep the true centre (crosshair, pointer-lock picking). The shift is eased so the scene glides aside.
import { navMode } from './navutil.js';

export function createFraming(ctx, { getInset }) {
  const cur = { x: 0, y: 0 };
  let applied = { x: NaN, y: NaN, w: 0, h: 0 };
  let insetT = 1;
  let want = { x: 0, y: 0 };


  function update(dt) {
    const cam = ctx.camera;
    if (!cam?.setViewOffset) return;
    insetT += dt || 0;
    if (insetT > 0.2) {                       // layout reads are throttled
      insetT = 0;
      want = navMode(ctx) === 'orbit' ? (getInset() || { x: 0, y: 0 }) : { x: 0, y: 0 };
    }
    const k = 1 - Math.exp(-(dt || 0.016) * 7);
    cur.x += (want.x - cur.x) * k;
    cur.y += (want.y - cur.y) * k;
    if (Math.abs(want.x - cur.x) < 0.5) cur.x = want.x;
    if (Math.abs(want.y - cur.y) < 0.5) cur.y = want.y;
    const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);   // the canvas fills the window (no layout read)
    const x = Math.round(cur.x * 2) / 2, y = Math.round(cur.y * 2) / 2;
    if (x === applied.x && y === applied.y && w === applied.w && h === applied.h && (!!cam.view?.enabled) === (x !== 0 || y !== 0)) return;
    applied = { x, y, w, h };
    if (x === 0 && y === 0) { if (cam.view?.enabled) cam.clearViewOffset(); }
    else cam.setViewOffset(w, h, x, y, w, h);
  }

  /** Where a world point would be framed: screen offset of the visible-area centre from the screen centre. */
  const offset = () => ({ x: -cur.x, y: -cur.y, targetX: -want.x, targetY: -want.y });

  function reset() {
    cur.x = cur.y = 0; want = { x: 0, y: 0 };
    if (ctx.camera?.view?.enabled) ctx.camera.clearViewOffset();
    applied = { x: 0, y: 0, w: 0, h: 0 };
  }

  return { update, offset, reset, refresh() { insetT = 1; } };
}
