// Shared vertical placement rules so generic buildings and hand-made landmarks sit on the terrain the same way.

// For a CAMPUS_DATA building record returns:
//   baseY  — bottom of the walls (sunk below the lowest ground point so no gaps show on slopes)
//   groundY — lowest terrain point under the footprint (where the "ground floor" sits)
//   roofY  — top of the walls / start of the roof
export function buildingLevels(b) {
  const gMin = b.ground.min, gMax = b.ground.max;
  const h = b.height;
  const minH = b.minHeight || 0;
  const roofY = Math.max(gMin + h, gMax + Math.min(h * 0.6, 4));
  const groundY = gMin;
  const baseY = minH > 0 ? gMin + minH : gMin - 1.5;
  return { baseY, groundY, roofY, height: roofY - groundY };
}

// Lookup helpers over CAMPUS_DATA
export function buildingById(data, id) {
  return data.buildings.find((b) => b.id === id || b.osmId === id) || null;
}
export function buildingsByOsmId(data, osmId) {
  return data.buildings.filter((b) => b.osmId === osmId || b.id === osmId);
}
export function poiByName(data, name) {
  return data.pois.find((p) => p.name === name) || null;
}
export function areaByName(data, name) {
  return data.areas.find((a) => a.name === name) || null;
}

// Principal axis of a footprint ring: { angle (radians, rotation about +Y that maps local +X onto the long axis),
// length, width, center:[x,z] } — handy for fitting a hand-made model onto an OSM footprint.
export function footprintFrame(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= ring.length; cz /= ring.length;
  let bestA = 0, bestArea = Infinity, best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) {
      const u = (x - cx) * c + (z - cz) * s, v = -(x - cx) * s + (z - cz) * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (area < bestArea) { bestArea = area; bestA = ang; best = { u0, u1, v0, v1 }; }
  }
  let { u0, u1, v0, v1 } = best;
  let angle = bestA;
  if (v1 - v0 > u1 - u0) { angle += Math.PI / 2; [u0, u1, v0, v1] = [v0, v1, -u1, -u0]; }
  const c = Math.cos(angle), s = Math.sin(angle);
  const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
  const center = [cx + mu * c - mv * s, cz + mu * s + mv * c];
  // rotation.y for a THREE object whose local +X should follow the long axis (world z is south, so negate)
  return { angle, rotationY: -angle, length: u1 - u0, width: v1 - v0, center };
}
