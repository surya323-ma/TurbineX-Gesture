
import * as THREE from 'three';

const TAU = Math.PI * 2;
const $ = (id) => document.getElementById(id);

const MP_VERSION = '0.10.14';
// Local copies (./vendor/mediapipe, ./vendor/hand_landmarker.task) are tried first; CDN is the fallback.
const MP_LOCAL_MODULE = './vendor/mediapipe/vision_bundle.mjs';
const MP_LOCAL_WASM = './vendor/mediapipe';
const MP_LOCAL_MODEL = './vendor/hand_landmarker.task';
const MP_CDN_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const MP_CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MP_CDN_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const HOLD_MS = 200;

const EXPLODED_X = { fan: -9.6, core: 0, nozzle: 9.6 };
const ASSEMBLED_X = { fan: -7.4, core: 0, nozzle: 7.4 };
const SELECT_OFFSET = new THREE.Vector3(0, 0.8, 1.3);

const SECTIONS = {
  nozzle: { label: 'NOZZLE SECTION', glyph: '✋', name: 'exhaust/nozzle', anchor: new THREE.Vector3(0.2, 3.3, 0) },
  core:   { label: 'COMPRESSOR\nCOMBUSTION\nTURBINE', glyph: '✌️', name: 'core', anchor: new THREE.Vector3(0.2, 2.5, 0) },
  fan:    { label: 'FAN SECTION', glyph: '3️⃣', name: 'fan', anchor: new THREE.Vector3(0, 3.2, 0) },
};
const COMPRESS = { glyph: '✊', name: 'compress' };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Lines {
  constructor() { this.p = []; }

  seg(a, b) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2]); }

  poly(pts, closed = false) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1]);
    if (closed && pts.length > 2) this.seg(pts[pts.length - 1], pts[0]);
  }

  ring(x, r, n = 64, a0 = 0, a1 = TAU, cy = 0, cz = 0) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push([x, cy + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
    this.poly(pts);
  }

  tube(x0, x1, r0, r1, o = {}) {
    const { nLong = 24, nRing = 4, n = 64, a0 = 0, a1 = TAU, cy = 0, cz = 0, hatch = false } = o;
    const full = Math.abs(a1 - a0 - TAU) < 1e-6;
    for (let i = 0; i < nRing; i++) {
      const t = nRing === 1 ? 0 : i / (nRing - 1);
      this.ring(x0 + (x1 - x0) * t, r0 + (r1 - r0) * t, n, a0, a1, cy, cz);
    }
    const count = full ? nLong : nLong + 1;
    for (let i = 0; i < count; i++) {
      const a = a0 + ((a1 - a0) * i) / nLong;
      this.seg(
        [x0, cy + r0 * Math.cos(a), cz + r0 * Math.sin(a)],
        [x1, cy + r1 * Math.cos(a), cz + r1 * Math.sin(a)]
      );
    }
    if (hatch) {
      for (let j = 0; j < nRing - 1; j++) {
        const ta = j / (nRing - 1), tb = (j + 1) / (nRing - 1);
        const xa = x0 + (x1 - x0) * ta, xb = x0 + (x1 - x0) * tb;
        const ra = r0 + (r1 - r0) * ta, rb = r0 + (r1 - r0) * tb;
        for (let i = 0; i < count; i++) {
          const a = a0 + ((a1 - a0) * i) / nLong;
          const b = a + (a1 - a0) / nLong;
          this.seg([xa, cy + ra * Math.cos(a), cz + ra * Math.sin(a)], [xb, cy + rb * Math.cos(b), cz + rb * Math.sin(b)]);
        }
      }
    }
  }

  spokes(x, r0, r1, count, phase = 0) {
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * TAU;
      this.seg([x, r0 * Math.cos(a), r0 * Math.sin(a)], [x, r1 * Math.cos(a), r1 * Math.sin(a)]);
    }
  }

  gridBox(cx, cy, cz, sx, sy, sz, div = 3) {
    const x0 = cx - sx / 2, y0 = cy - sy / 2, z0 = cz - sz / 2;
    for (let i = 0; i <= div; i++) {
      const t = i / div;
      const x = x0 + sx * t, y = y0 + sy * t, z = z0 + sz * t;
      this.poly([[x, y0, z0], [x, y0 + sy, z0], [x, y0 + sy, z0 + sz], [x, y0, z0 + sz]], true);
      this.poly([[x0, y, z0], [x0 + sx, y, z0], [x0 + sx, y, z0 + sz], [x0, y, z0 + sz]], true);
      this.poly([[x0, y0, z], [x0 + sx, y0, z], [x0 + sx, y0 + sy, z], [x0, y0 + sy, z]], true);
    }
  }

  plate(p00, p10, p01, nu, nv) {
    const P = (u, v) => [
      p00[0] + (p10[0] - p00[0]) * u + (p01[0] - p00[0]) * v,
      p00[1] + (p10[1] - p00[1]) * u + (p01[1] - p00[1]) * v,
      p00[2] + (p10[2] - p00[2]) * u + (p01[2] - p00[2]) * v,
    ];
    for (let i = 0; i <= nu; i++) this.seg(P(i / nu, 0), P(i / nu, 1));
    for (let j = 0; j <= nv; j++) this.seg(P(0, j / nv), P(1, j / nv));
  }

  curveTube(pts, r, nSeg = 10, steps = 44, ringEvery = 2) {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    const fr = curve.computeFrenetFrames(steps, false);
    const rings = [];
    for (let i = 0; i <= steps; i++) {
      const P = curve.getPoint(i / steps), N = fr.normals[i], B = fr.binormals[i];
      const ring = [];
      for (let k = 0; k < nSeg; k++) {
        const a = (k / nSeg) * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r;
        ring.push([P.x + c * N.x + s * B.x, P.y + c * N.y + s * B.y, P.z + c * N.z + s * B.z]);
      }
      rings.push(ring);
    }
    rings.forEach((ring, i) => { if (i % ringEvery === 0) this.poly(ring, true); });
    for (let k = 0; k < nSeg; k++) this.poly(rings.map((rg) => rg[k]));
  }

  build(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    return new THREE.LineSegments(geo, material);
  }
}

function buildFan(L) {

  const BLADES = 100, SPAN = 3, XD = 2.2;
  for (let b = 0; b < BLADES; b++) {
    const th = (b / BLADES) * TAU;
    const rows = [];
    for (let j = 0; j <= SPAN; j++) {
      const u = j / SPAN;
      const r = 0.45 + 1.75 * u;
      const tw = 0.95 - 0.55 * u;
      const cw = 0.24 * (1 - 0.4 * u);
      const sweep = th + 0.18 * u;
      const row = [-1, 1].map((s) => {
        const c = s * cw;
        const ax = c * Math.cos(tw), tang = c * Math.sin(tw);
        return [
          XD + ax,
          r * Math.cos(sweep) - tang * Math.sin(sweep),
          r * Math.sin(sweep) + tang * Math.cos(sweep),
        ];
      });
      rows.push(row);
    }
    L.poly(rows.map((r) => r[0]));
    L.poly(rows.map((r) => r[1]));
    rows.forEach((r) => L.seg(r[0], r[1]));
  }
  L.ring(XD, 2.2, 96);
  L.ring(XD, 2.12, 96);
  L.tube(XD, 3.3, 0.5, 0, { nLong: 24, nRing: 9, n: 48 });
  L.tube(1.3, XD, 0.55, 0.55, { nLong: 24, nRing: 5, n: 48 });

  L.tube(-2.7, -1.4, 1.65, 1.65, { nLong: 36, nRing: 7, n: 72 });
  L.ring(-1.4, 1.8, 72);
  L.spokes(-2.7, 0.4, 1.65, 14);

  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * TAU + 0.35, c = Math.cos(ang), s = Math.sin(ang);
    const P = (x, r) => [x, r * c, r * s];
    L.curveTube([P(-1.8, 1.0), P(-1.0, 1.8), P(0.0, 2.45), P(1.1, 2.55), P(1.9, 2.0), P(2.15, 1.25)], 0.22, 10, 46, 2);
  }

  const rnd = rng(11);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * TAU, x = -1.9 + rnd() * 2.2, r = 1.2 + rnd() * 0.5;
    L.gridBox(x, r * Math.cos(a), r * Math.sin(a), 0.4 + rnd() * 0.4, 0.3 + rnd() * 0.25, 0.3 + rnd() * 0.25, 2);
  }
}

function buildCore(L) {

  L.tube(-4.8, 4.8, 0.2, 0.2, { nLong: 8, nRing: 26, n: 20 });

  [[3.5, 4.85, 1.9], [2.0, 3.35, 1.75]].forEach(([x0, x1, r]) => {
    L.tube(x0, x1, r, r, { nLong: 40, nRing: 10, n: 80 });
    L.tube(x0 + 0.1, x1 - 0.1, r * 0.78, r * 0.78, { nLong: 20, nRing: 6, n: 56 });
    L.spokes(x0, r * 0.3, r, 14);
    L.spokes(x1, r * 0.3, r, 14, 0.12);
    L.ring(x0, r + 0.12, 80);
  });

  for (let k = 0; k < 5; k++) {
    const x = 2.3 + k * 0.5;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU;
      L.poly([
        [x - 0.08, 0.7 * Math.cos(a), 0.7 * Math.sin(a)],
        [x + 0.08, 0.7 * Math.cos(a + 0.07), 0.7 * Math.sin(a + 0.07)],
        [x + 0.08, 1.45 * Math.cos(a + 0.14), 1.45 * Math.sin(a + 0.14)],
        [x - 0.08, 1.45 * Math.cos(a + 0.07), 1.45 * Math.sin(a + 0.07)],
      ], true);
    }
  }

  L.tube(1.2, 2.0, 0.95, 0.95, { nLong: 20, nRing: 6, n: 40 });

  L.tube(-0.9, 1.2, 1.55, 1.55, { nLong: 84, nRing: 30, n: 84, hatch: true });
  L.ring(-0.9, 1.7, 90);
  L.ring(1.2, 1.7, 90);

  L.tube(-3.2, -0.9, 1.5, 1.5, { nLong: 18, nRing: 7, n: 72 });
  L.tube(-3.1, -1.0, 1.0, 1.0, { nLong: 28, nRing: 10, n: 56 });
  L.ring(-3.2, 1.65, 80);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU, c = Math.cos(a), s = Math.sin(a);
    L.seg([-2.6, 1.5 * c, 1.5 * s], [-2.6, 1.0 * c, 1.0 * s]);
    L.gridBox(-2.6, 1.68 * c, 1.68 * s, 0.25, 0.2, 0.2, 1);
  }

  L.tube(-4.8, -3.2, 0.95, 1.3, { nLong: 36, nRing: 10, n: 64 });
  for (let k = 0; k < 3; k++) {
    const x = -4.4 + k * 0.45;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      L.seg([x - 0.08, 0.6 * Math.cos(a), 0.6 * Math.sin(a)], [x + 0.08, 1.2 * Math.cos(a + 0.12), 1.2 * Math.sin(a + 0.12)]);
    }
  }
}

function buildNozzle(L) {
  L.tube(-2.2, 2.2, 1.45, 1.45, { nLong: 28, nRing: 13, n: 64 });

  L.tube(2.2, 2.6, 1.75, 1.75, { nLong: 40, nRing: 3 });
  L.ring(2.6, 1.95, 72);
  L.spokes(2.6, 0.6, 1.95, 16);

  for (const s of [1, -1]) {
    const p00 = [2.5, s * 2.0, -1.9], p10 = [-2.9, s * 2.95, -1.9], p01 = [2.5, s * 2.0, 1.9];
    L.plate(p00, p10, p01, 16, 8);
    const up = [0, s * 0.12, 0];
    L.plate(
      [p00[0], p00[1] + up[1], p00[2]],
      [p10[0], p10[1] + up[1], p10[2]],
      [p01[0], p01[1] + up[1], p01[2]], 16, 8
    );
    L.seg(p00, [p00[0], p00[1] + up[1], p00[2]]);
    L.seg(p10, [p10[0], p10[1] + up[1], p10[2]]);
  }

  const rnd = rng(7);
  for (let i = 0; i < 16; i++) {
    L.gridBox(-1.4 + rnd() * 3.0, (rnd() - 0.5) * 2.2, (rnd() - 0.5) * 2.2, 0.4 + rnd() * 0.5, 0.35 + rnd() * 0.5, 0.35 + rnd() * 0.5, 3);
  }

  L.tube(1.8, -2.6, 0.7, 0, { nLong: 18, nRing: 8, n: 40 });
}

const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
} catch (err) {
  console.error('WebGL unavailable:', err);
  document.body.insertAdjacentHTML('beforeend',
    '<p class="noscript">WebGL is not available in this browser. Try Chrome or Edge with hardware acceleration enabled.</p>');
  throw err;
}
renderer.setClearColor(0x000000, 1);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 400);
const root = new THREE.Group();
root.rotation.order = 'ZXY';
scene.add(root);

const sections = {};

function makeSection(key, buildFn) {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const L = new Lines();
  buildFn(L);
  group.add(L.build(mat));
  group.rotation.order = 'XYZ';
  group.rotation.y = Math.PI;
  group.position.set(EXPLODED_X[key], 0, 0);
  root.add(group);
  sections[key] = { key, group, mat, accents: [], k: 0, lineOp: 0.8, accentOp: 0.6, spin: 0, spinAngle: 0 };
}
makeSection('fan', buildFan);
makeSection('core', buildCore);
makeSection('nozzle', buildNozzle);

const accentHolders = {};
function accentRing(key, radius, color, rot) {
  const pts = [];
  for (let i = 0; i <= 180; i++) {
    const a = (i / 180) * TAU;
    pts.push(new THREE.Vector3(0, radius * Math.cos(a), radius * Math.sin(a)));
  }
  const mat = new THREE.LineDashedMaterial({
    color, dashSize: 0.1, gapSize: 0.1, transparent: true, opacity: 0.6, depthWrite: false,
  });
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  line.computeLineDistances();
  line.rotation.set(rot[0], rot[1], rot[2]);
  if (!accentHolders[key]) {
    accentHolders[key] = new THREE.Group();
    root.add(accentHolders[key]);
  }
  accentHolders[key].add(line);
  sections[key].accents.push(mat);
}
const BLUE = 0x3b46ff, LIME = 0xd2f21c;
accentRing('fan', 3.5, LIME, [0, 0.25, 0.1]);
accentRing('fan', 3.0, LIME, [0.5, 0.2, -0.4]);
accentRing('core', 3.1, BLUE, [0, 0.05, 0]);
accentRing('core', 3.4, BLUE, [0.35, 0.1, 0.05]);
accentRing('nozzle', 3.6, LIME, [0, -0.3, -0.15]);
accentRing('nozzle', 3.1, LIME, [0.45, 0.25, 0.3]);

function addArrow(L, a, b, head = 0.55) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A).normalize();
  L.seg(a, b);
  const up = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const p = new THREE.Vector3().crossVectors(d, up).normalize();
  const q = new THREE.Vector3().crossVectors(d, p);
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    const off = p.clone().multiplyScalar(Math.cos(ang)).add(q.clone().multiplyScalar(Math.sin(ang))).multiplyScalar(head * 0.22);
    const base = B.clone().addScaledVector(d, -head).add(off);
    L.seg(B.toArray(), base.toArray());
  }
}
{
  const axes = new Lines();
  addArrow(axes, [0, -5.4, 0], [0, 6.8, 0], 0.6);
  addArrow(axes, [-13.5, 0, 0], [13.6, 0, 0], 0.7);
  addArrow(axes, [3.4, -3.4, 0], [-4.6, 4.6, 0], 0.55);
  addArrow(axes, [0, 0, 5.0], [0, 0, -5.0], 0.5);
  const axMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
  root.add(axes.build(axMat));
}

const state = {
  mode: null,
  selected: null,
  explode: 1,
  dragYaw: 0,
  dragPitch: 0,
  zoom: 1,

  hand: { present: false, lastSeen: 0, yaw: 0, pitch: 0, roll: 0, sYaw: 0, sPitch: 0, sRoll: 0 },
};

const ui = {
  tag: $('tag'),
  leader: $('leader'),
  leaderLine: $('leaderLine'),
  leaderDot: $('leaderDot'),
  gGlyph: $('g-glyph'),
  gName: $('g-name'),
  camWrap: $('cam-wrap'),
  status: $('cam-status'),
  video: $('cam'),
  overlay: $('overlay'),
};

function syncButtons() {
  document.querySelectorAll('#controls [data-mode]').forEach((b) => {
    const on = b.dataset.mode === state.mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function setMode(mode) {
  state.mode = mode;
  setTimeout(syncButtons, 0);
  if (mode === 'compress') {
    state.explode = 0;
    state.selected = null;
    ui.gGlyph.textContent = COMPRESS.glyph;
    ui.gName.textContent = COMPRESS.name;
    ui.tag.classList.remove('on');
    ui.leader.classList.remove('on');
  } else if (SECTIONS[mode]) {
    const s = SECTIONS[mode];
    state.explode = 1;
    state.selected = mode;
    ui.gGlyph.textContent = s.glyph;
    ui.gName.textContent = s.name;
    ui.tag.textContent = s.label;
    ui.tag.classList.add('on');
    ui.leader.classList.add('on');
  }
}

function resetView() {
  state.dragYaw = 0;
  state.dragPitch = 0;
  state.zoom = 1;
  state.hand.yaw = state.hand.pitch = state.hand.roll = 0;
}

let W = 1, H = 1, baseCamZ = 30;
function resize() {
  W = window.innerWidth || 1;
  H = window.innerHeight || 1;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  baseCamZ = 30 * Math.max(1, 1.55 / camera.aspect);
  camera.position.set(0, 0, baseCamZ / state.zoom);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  root.position.set(0, 1.2, 0);
}
window.addEventListener('resize', resize);
resize();

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, yaw: state.dragYaw, pitch: state.dragPitch };
  if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  state.dragYaw = THREE.MathUtils.clamp(drag.yaw + (e.clientX - drag.x) * 0.005, -1.0, 1.0);
  state.dragPitch = THREE.MathUtils.clamp(drag.pitch + (e.clientY - drag.y) * 0.004, -0.7, 0.7);
});
const endDrag = () => { drag = null; };
const zoomBy = (f) => { state.zoom = THREE.MathUtils.clamp(state.zoom * f, 0.5, 2.2); };
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0012)); }, { passive: false });
let pinch = null;
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) { pinch = null; return; }
  const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  if (pinch) zoomBy(d / pinch);
  pinch = d;
}, { passive: true });
canvas.addEventListener('touchend', () => { pinch = null; });
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

const helpEl = $('help');
function toggleHelp(force) {
  const show = force === undefined ? helpEl.hidden : force;
  helpEl.hidden = !show;
}
$('help-close').addEventListener('click', () => toggleHelp(false));
helpEl.addEventListener('click', (e) => { if (e.target === helpEl) toggleHelp(false); });

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
}

document.querySelectorAll('#controls button').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.mode) setMode(b.dataset.mode);
    else if (b.dataset.action === 'reset') { resetView(); toast('View reset'); }
    else if (b.dataset.action === 'cam') ui.camWrap.classList.toggle('hidden');
    else if (b.dataset.action === 'help') toggleHelp();
    b.blur();
  });
});

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  switch (e.key.toLowerCase()) {
    case '1': setMode('nozzle'); break;
    case '2': setMode('core'); break;
    case '3': setMode('fan'); break;
    case '4': case 'c': setMode('compress'); break;
    case 'r': resetView(); break;
    case 'h': ui.camWrap.classList.toggle('hidden'); break;
    case '?': case '/': toggleHelp(); break;
    case 'escape': toggleHelp(false); break;
    case '+': case '=': zoomBy(1.15); break;
    case '-': zoomBy(1 / 1.15); break;
    default:
  }
});

const tmp = new THREE.Vector3();
let explodeK = 1;
let camZoom = 1;
let rootScale = 1;

function anchorScreen(key) {
  const s = sections[key];
  tmp.copy(s.group.position).add(SECTIONS[key].anchor);
  root.localToWorld(tmp);
  tmp.project(camera);
  return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H };
}

function updateTag() {
  const key = state.selected;
  if (!key) return;
  const p = anchorScreen(key);
  const scale = THREE.MathUtils.clamp(Math.min(W, H * 1.7) / 1300, 0.55, 1.4);
  const len = 290 * scale;
  const ang = (30 * Math.PI) / 180;

  let sx = p.x - len * Math.cos(ang);
  let sy = p.y - len * Math.sin(ang);
  sx = Math.max(sx, 14);
  sy = Math.max(sy, 14 + ui.tag.offsetHeight * 1.1);
  const deg = (Math.atan2(p.y - sy, p.x - sx) * 180) / Math.PI;

  ui.leaderLine.setAttribute('x1', sx);
  ui.leaderLine.setAttribute('y1', sy);
  ui.leaderLine.setAttribute('x2', p.x);
  ui.leaderLine.setAttribute('y2', p.y);
  ui.leaderDot.setAttribute('cx', p.x);
  ui.leaderDot.setAttribute('cy', p.y);
  ui.tag.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) rotate(${deg.toFixed(2)}deg) translateY(-110%)`;
}

let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  const t = now / 1000;

  const h = state.hand;
  if (!h.present && now - h.lastSeen > 1500) { h.yaw = 0; h.pitch = 0; h.roll = 0; }
  const follow = 1 - Math.exp(-dt * (h.present ? 7 : 1.6));
  h.sYaw += (h.yaw - h.sYaw) * follow;
  h.sPitch += (h.pitch - h.sPitch) * follow;
  h.sRoll += (h.roll - h.sRoll) * follow;

  root.rotation.set(
    0.2 + Math.sin(t * 0.21) * 0.035 + state.dragPitch + h.sPitch,
    0.5 + Math.sin(t * 0.27) * 0.09 + state.dragYaw + h.sYaw,
    0.28 + h.sRoll
  );

  camZoom += (state.zoom - camZoom) * (1 - Math.exp(-dt * 8));
  camera.position.z = baseCamZ / camZoom;
  explodeK += (state.explode - explodeK) * (1 - Math.exp(-dt * 4.5));
  rootScale += ((state.mode === 'compress' ? 0.94 : 1) - rootScale) * (1 - Math.exp(-dt * 4));
  root.scale.setScalar(rootScale);

  const sel = state.selected;
  const ease = 1 - Math.exp(-dt * 6);
  const palm = state.mode === 'nozzle';

  for (const key of Object.keys(sections)) {
    const s = sections[key];
    const isSel = sel === key;
    s.k += ((isSel ? 1 : 0) - s.k) * ease;

    const lineTarget = !sel ? 0.8 : isSel ? 1.0 : 0.16;
    const accentTarget = !sel ? (state.mode === 'compress' ? 0.25 : 0.6) : isSel ? 0.95 : 0.1;
    s.lineOp += (lineTarget - s.lineOp) * ease;
    s.accentOp += (accentTarget - s.accentOp) * ease;
    s.mat.opacity = s.lineOp;
    s.accents.forEach((m) => { m.opacity = s.accentOp; });

    const bx = ASSEMBLED_X[key] + (EXPLODED_X[key] - ASSEMBLED_X[key]) * explodeK;
    s.group.position.set(
      bx + SELECT_OFFSET.x * s.k,
      SELECT_OFFSET.y * s.k,
      SELECT_OFFSET.z * s.k
    );
    s.group.scale.setScalar(1 + 0.05 * s.k);
    if (accentHolders[key]) {
      accentHolders[key].position.copy(s.group.position);
      accentHolders[key].scale.setScalar(s.group.scale.x);
    }

    let target = 0;
    if (key === 'fan') target = palm ? 2.4 : state.mode === 'fan' ? 1.3 : 0.3;
    if (key === 'nozzle') target = palm ? 0.9 : 0.1;
    s.spin += (target - s.spin) * (1 - Math.exp(-dt * 2.5));
    s.spinAngle += s.spin * dt;
    s.group.rotation.x = s.spinAngle;
  }

  root.updateMatrixWorld(true);
  updateTag();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

function setStatus(msg, kind = 'warn') {
  ui.status.textContent = msg;
  ui.status.className = kind;
}

let landmarker = null;

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('CAMERA UNAVAILABLE — OPEN VIA http://localhost OR HTTPS · KEYS 1 2 3 4 WORK', 'err');
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    ui.video.srcObject = stream;
    await ui.video.play();
    return true;
  } catch (err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') setStatus('CAMERA ACCESS DENIED — USE KEYS 1 2 3 4', 'err');
    else if (name === 'NotFoundError' || name === 'OverconstrainedError') setStatus('NO CAMERA FOUND — USE KEYS 1 2 3 4', 'err');
    else if (name === 'NotReadableError') setStatus('CAMERA IN USE BY ANOTHER APP — USE KEYS 1 2 3 4', 'err');
    else setStatus('CAMERA ERROR — USE KEYS 1 2 3 4', 'err');
    return false;
  }
}

async function startHandModel() {
  try {
    let vision, wasmBase = MP_LOCAL_WASM;
    try {
      vision = await import(MP_LOCAL_MODULE);
    } catch (e) {
      vision = await import(MP_CDN_MODULE);
      wasmBase = MP_CDN_WASM;
    }
    const fileset = await vision.FilesetResolver.forVisionTasks(wasmBase);
    let modelPath = MP_CDN_MODEL;
    try {
      const r = await fetch(MP_LOCAL_MODEL, { method: 'HEAD' });
      if (r.ok && !(r.headers.get('content-type') || '').includes('text/html')) modelPath = MP_LOCAL_MODEL;
    } catch (e) { /* use CDN */ }
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch (gpuErr) {
      landmarker = await vision.HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
    return true;
  } catch (err) {
    console.error('Hand model failed to load:', err);
    setStatus('HAND MODEL FAILED TO LOAD (CHECK INTERNET) — USE KEYS 1 2 3 4', 'err');
    return false;
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const FINGERS = [[8, 5], [12, 9], [16, 13], [20, 17]];
const UP_RATIO = 1.6, DOWN_RATIO = 1.4;
const fingerUp = [false, false, false, false];

function updateFingers(lm) {
  FINGERS.forEach(([tip, mcp], i) => {
    const ratio = dist(lm[tip], lm[0]) / Math.max(dist(lm[mcp], lm[0]), 1e-6);
    if (ratio > UP_RATIO) fingerUp[i] = true;
    else if (ratio < DOWN_RATIO) fingerUp[i] = false;
  });
  return fingerUp;
}

function classify(lm) {
  const [i, m, r, p] = updateFingers(lm);
  if (i && m && r && p) return 'nozzle';
  if (!i && !m && !r && !p) return 'compress';
  if (i && m && !r && !p) return 'core';
  if (i && m && r && !p) return 'fan';
  return null;
}

const history = [];
let pending = { g: null, t: 0 };

function feedGesture(g, now) {
  history.push(g);
  if (history.length > 5) history.shift();
  const counts = {};
  history.forEach((x) => { if (x) counts[x] = (counts[x] || 0) + 1; });
  let best = null, n = 0;
  for (const k of Object.keys(counts)) if (counts[k] > n) { best = k; n = counts[k]; }
  const stable = n >= 3 ? best : null;

  if (stable && stable !== state.mode) {
    if (pending.g !== stable) pending = { g: stable, t: now };
    else if (now - pending.t >= HOLD_MS) { setMode(stable); pending = { g: null, t: now }; }
  } else {
    pending = { g: null, t: now };
  }

}

const pose = { x: 0.5, y: 0.5, roll: 0, init: false };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function updateHandPose(lm, now) {
  const ids = [0, 5, 9, 13, 17];
  let cx = 0, cy = 0;
  ids.forEach((i) => { cx += lm[i].x; cy += lm[i].y; });
  cx = 1 - cx / ids.length;
  cy /= ids.length;
  const dx = -(lm[9].x - lm[0].x), dy = lm[9].y - lm[0].y;
  const cw = Math.atan2(dx, -dy);

  const a = pose.init ? 0.3 : 1;
  pose.x += (cx - pose.x) * a;
  pose.y += (cy - pose.y) * a;
  pose.roll += (cw - pose.roll) * a;
  pose.init = true;

  const h = state.hand;
  h.present = true;
  h.lastSeen = now;
  h.yaw = clamp((pose.x - 0.5) * 1.9, -0.95, 0.95);
  h.pitch = clamp((pose.y - 0.5) * 1.2, -0.6, 0.6);
  h.roll = clamp(-pose.roll * 0.8, -0.9, 0.9);
}

function handLost() {
  state.hand.present = false;
  pose.init = false;
}

const octx = ui.overlay.getContext('2d');
let lastVideoTime = -1;

function drawHand(lm) {
  const v = ui.video;
  if (ui.overlay.width !== v.videoWidth || ui.overlay.height !== v.videoHeight) {
    ui.overlay.width = v.videoWidth || 640;
    ui.overlay.height = v.videoHeight || 480;
  }
  const w = ui.overlay.width, h = ui.overlay.height;
  octx.clearRect(0, 0, w, h);
  if (!lm) return;
  octx.strokeStyle = 'rgba(255,255,255,0.95)';
  octx.lineWidth = Math.max(2, w * 0.005);
  const r = w * 0.028;
  [4, 8, 12, 16, 20].forEach((idx) => {
    octx.beginPath();
    octx.arc(lm[idx].x * w, lm[idx].y * h, r, 0, TAU);
    octx.stroke();
  });
}

let lastStatus = '';
function trackLoop() {
  requestAnimationFrame(trackLoop);
  const v = ui.video;
  if (!landmarker || v.readyState < 2 || v.currentTime === lastVideoTime) return;
  lastVideoTime = v.currentTime;
  try {
    const now = performance.now();
    const res = landmarker.detectForVideo(v, now);
    const img = res && res.landmarks && res.landmarks[0];
    const world = res && res.worldLandmarks && res.worldLandmarks[0];
    drawHand(img || null);
    let g = null;
    if (img) { g = classify(world || img); updateHandPose(img, now); } else handLost();
    feedGesture(g, now);

    const msg = img
      ? `HAND ACTIVE · FINGERS ${fingerUp.map((u) => (u ? '1' : '0')).join('')} · ${g ? g.toUpperCase() : '—'}`
      : 'SHOW YOUR HAND TO THE CAMERA';
    if (msg !== lastStatus) {
      lastStatus = msg;
      setStatus(msg, img ? 'ok' : 'warn');
    }
  } catch (err) {
    console.error('Tracking error:', err);
  }
}

let tracking = false;
const retryBtn = $('cam-retry');
async function initTracking() {
  retryBtn.hidden = true;
  setStatus('STARTING CAMERA…', 'warn');
  const camOk = await startCamera();
  if (!camOk) { retryBtn.hidden = false; return; }
  if (!landmarker) {
    setStatus('LOADING HAND MODEL (FIRST RUN DOWNLOADS ~8 MB)…', 'warn');
    const modelOk = await startHandModel();
    if (!modelOk) { retryBtn.hidden = false; return; }
  }
  setStatus('SHOW YOUR HAND TO THE CAMERA', 'warn');
  if (!tracking) { tracking = true; trackLoop(); }
}
retryBtn.addEventListener('click', initTracking);
document.addEventListener('visibilitychange', () => { if (document.hidden) handLost(); });
initTracking();
