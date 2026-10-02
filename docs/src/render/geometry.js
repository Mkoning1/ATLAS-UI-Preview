// Procedural nucleus geometry (repo-owned, seeded, deterministic). No assets.
// Each vertex: [dx,dy,dz (unit direction), layer, seedA, seedB]
// layer: 0 = dense nucleus, 1..3 = shells, 4 = impulses, 5 = sub-core cloud

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sphereDir(rng) {
  const z = rng() * 2 - 1;
  const t = rng() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

/** @returns {{points: Float32Array, lines: Float32Array, pointCount: number, lineVertexCount: number}} */
export function buildNucleus(tier, seed = 0xa71a5) {
  const rng = mulberry32(seed);
  const stride = 6;
  const nCore = Math.floor(tier.particles * 0.3);
  const nShell = Math.floor(tier.particles * 0.45);
  const nSub = tier.subCores > 0 ? tier.subCores * 60 : 0;
  const nImp = tier.impulses;
  const total = nCore + nShell + nImp + nSub;
  const points = new Float32Array(total * stride);
  let o = 0;
  const push = (d, layer, a, b) => {
    points[o++] = d[0];
    points[o++] = d[1];
    points[o++] = d[2];
    points[o++] = layer;
    points[o++] = a;
    points[o++] = b;
  };
  for (let i = 0; i < nCore; i++) push(sphereDir(rng), 0, rng(), rng());
  for (let i = 0; i < nShell; i++) push(sphereDir(rng), 1 + Math.floor(rng() * 3), rng(), rng());
  for (let i = 0; i < nImp; i++) push(sphereDir(rng), 4, rng(), rng());
  for (let i = 0; i < nSub; i++) push(sphereDir(rng), 5, rng(), Math.floor(i / 60) + rng() * 0.5);

  // Shell line segments: random chords between nearby directions on a shell (organic, asymmetric web).
  const segs = tier.shellSegments;
  const lines = new Float32Array(segs * 2 * stride);
  let l = 0;
  for (let i = 0; i < segs; i++) {
    const a = sphereDir(rng);
    const b = norm3([a[0] + (rng() - 0.5) * 0.32, a[1] + (rng() - 0.5) * 0.32, a[2] + (rng() - 0.5) * 0.32]);
    const layer = 1 + Math.floor(rng() * 3);
    const s1 = rng();
    const s2 = rng();
    for (const d of [a, b]) {
      lines[l++] = d[0];
      lines[l++] = d[1];
      lines[l++] = d[2];
      lines[l++] = layer;
      lines[l++] = s1;
      lines[l++] = s2;
    }
  }
  return { points, lines, pointCount: total, lineVertexCount: segs * 2 };
}

function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
