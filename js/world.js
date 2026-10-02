// Procedural 3D world for the Northvane replica.
// World A = photographic-ish terrain flight, World B = tactical map, plus tail "views"
// (globe / close-up / landing) rendered into DOM rects with scissor. No external models.
import * as THREE from './vendor/three.module.min.js';
import { bakeNormals } from './normals.js';

/* ------------------------------------------------------------------ noise */
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PERM = (() => { const r = mulberry(1337); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } const out = new Uint8Array(512); for (let i = 0; i < 512; i++) out[i] = p[i & 255]; return out; })();
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
function snoise(xin, yin) {
  const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let n = 0, tt;
  tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { const g = GRAD[PERM[ii + PERM[jj]] & 7]; tt *= tt; n += tt * tt * (g[0] * x0 + g[1] * y0); }
  tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { const g = GRAD[PERM[ii + i1 + PERM[jj + j1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x1 + g[1] * y1); }
  tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { const g = GRAD[PERM[ii + 1 + PERM[jj + 1]] & 7]; tt *= tt; n += tt * tt * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
function fbm(x, y, o) { let a = 0.5, s = 0; for (let i = 0; i < o; i++) { s += a * snoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; }
function ridged(x, y, o) { let a = 0.5, s = 0, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(snoise(x, y)); n *= n; n *= w; w = Math.min(1, n * 1.6); s += n * a; x *= 2.1; y *= 2.1; a *= 0.5; } return s; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/* --------------------------------------------------------------- terrain */
const TS = 0.5; // world units per baked-terrain unit
export const TOWN = { x: 520 * TS, z: -820 * TS };
export const HOT = { x: 180, z: -325 };
const TERRAIN_SIZE = 2200, TERRAIN_SEG = 384;
const WATER = 14 * TS;
let HM = null, HN = 1024, HMAX = 320;
async function loadHeights() {
  const [meta, buf] = await Promise.all([
    fetch('assets/terrain/meta.json').then((r) => r.json()),
    fetch('assets/terrain/height.bin').then((r) => r.arrayBuffer()),
  ]);
  HN = meta.N; HMAX = meta.hmax;
  const u = new Uint16Array(buf); HM = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) HM[i] = (u[i] / 65535) * HMAX;
}
const mirror01 = (t) => 1 - Math.abs((((t % 2) + 2) % 2) - 1);
function Hbase(bx, bz) { // bx,bz in baked units, any range (mirror-tiled)
  if (!HM) return 0;
  const ux = mirror01(bx / TERRAIN_SIZE + 0.5), uz = mirror01(bz / TERRAIN_SIZE + 0.5);
  const fx = Math.min(HN - 1.001, Math.max(0, ux * HN - 0.5));
  const fz = Math.min(HN - 1.001, Math.max(0, uz * HN - 0.5));
  const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, i = iz * HN + ix;
  return (HM[i] * (1 - tx) + HM[i + 1] * tx) * (1 - tz) + (HM[i + HN] * (1 - tx) + HM[i + HN + 1] * tx) * tz;
}
export function H(x, z) { return Hbase(x / TS, z / TS) * TS; }

const GLSL_NOISE = /* glsl */`
vec3 permute3(vec3 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0,0.0) : vec2(0.0,1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm4(vec2 p){ float a=.5,s=0.; for(int i=0;i<4;i++){ s+=a*snoise(p); p=p*2.03+vec2(17.1,3.7); a*=.5; } return s; }
`;

function textureFromNormals(d) {
  const t = new THREE.DataTexture(d, HN, HN, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
function bakeNormalsOffThread(hm, N, cell) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./normal.worker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(err);
      return;
    }
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('normals timed out')); }, 4000);
    worker.onmessage = (e) => { clearTimeout(timer); worker.terminate(); resolve(e.data); };
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('normals worker failed')); };
    const copy = new Float32Array(hm);
    worker.postMessage({ hm: copy, N, cell }, [copy.buffer]);
  });
}
async function normalTexture() {
  const N = HN;
  const cell = TERRAIN_SIZE / N;
  let d;
  try {
    d = await bakeNormalsOffThread(HM, N, cell);
    if (!(d instanceof Uint8Array) || d.length !== N * N * 4) throw new Error('normals short');
  } catch {
    d = bakeNormals(HM, N, cell);
  }
  return textureFromNormals(d);
}

async function loadTerrainMap(url, srgb) {
  // createImageBitmap decodes off the main thread. imageOrientation none matches the old flipY:false upload.
  const loader = new THREE.ImageBitmapLoader();
  loader.setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none' });
  const bitmap = await loader.loadAsync(url);
  const tex = new THREE.Texture(bitmap);
  tex.flipY = false;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
async function makeTerrain(renderer) {
  const [alb, light] = await Promise.all([
    loadTerrainMap('assets/terrain/albedo.jpg', true),
    loadTerrainMap('assets/terrain/light.jpg', false),
  ]);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  alb.anisotropy = aniso;
  light.anisotropy = aniso;
  const nrm = await normalTexture(); nrm.anisotropy = aniso;
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Hbase(pos.getX(i), pos.getZ(i)));
  geo.computeBoundingSphere();
  // skirt: wide dark plane under the terrain so oblique views never see the void
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000).rotateX(-Math.PI / 2), null);
  const uniforms = {
    uTime: { value: 0 },
    tAlb: { value: alb }, tLight: { value: light }, tNrm: { value: nrm },
    uSize: { value: TERRAIN_SIZE * TS },
    uSunDir: { value: new THREE.Vector3(-0.55, 0.62, 0.35).normalize() },
    uSunCol: { value: new THREE.Color(2.05, 1.92, 1.72) },
    uAmb: { value: new THREE.Color(0.26, 0.31, 0.36) },
    uFogCol: { value: new THREE.Color(0.25, 0.29, 0.32) },
    uFogDen: { value: 0.00030 },
    uMist: { value: 0.22 },
    uShadow: { value: 1 },
    uDesert: { value: 0 },
    uNight: { value: 0 },
    uWater: { value: WATER },
    uHot: { value: new THREE.Vector3() },
    uHotAmt: { value: 0 },
    uGrade: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tAlb, tLight, tNrm;
      uniform float uTime, uFogDen, uMist, uDesert, uNight, uWater, uHotAmt, uSize, uShadow, uGrade;
      uniform vec3 uSunDir, uSunCol, uAmb, uFogCol, uHot;
      varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        vec2 p = vW.xz;
        vec2 q = p / uSize + .5;
        vec2 fl = mod(floor(q), 2.);
        vec2 uv = mix(fract(q), 1. - fract(q), fl);
        vec3 alb = texture2D(tAlb, uv).rgb;
        vec3 N = texture2D(tNrm, uv).xyz * 2. - 1.;
        N.x *= fl.x > .5 ? -1. : 1.; N.z *= fl.y > .5 ? -1. : 1.;
        N = normalize(N);
        vec2 L = texture2D(tLight, uv).rg;
        float fine = snoise(p * .55);
        alb *= .88 + .24 * (fine * .5 + .5);
        alb = mix(alb, alb * vec3(.9, 1.0, .86), .35 * uGrade);
        // desert palette (card bake)
        float lum = dot(alb, vec3(.3,.5,.2));
        vec3 desert = vec3(.36,.26,.16) * (.55 + lum*3.2);
        alb = mix(alb, desert, uDesert);
        float diff = max(dot(N, uSunDir), 0.) * mix(1., L.r, uShadow);
        float cs = smoothstep(.1, .65, snoise(p*0.0021 + vec2(uTime*.006, uTime*.003)));
        diff *= 1. - cs*.5;
        vec3 lit = alb * (uSunCol*diff + uAmb*(.45+.55*N.y)*L.g);
        float w = smoothstep(uWater+1.5, uWater-1., vW.y);
        vec3 V = normalize(cameraPosition - vW);
        lit = mix(lit, vec3(.012,.018,.022) + uAmb*.06*pow(1.-max(V.y,0.),3.), w*.85);
        float hd = length(vW.xz - uHot.xz);
        lit += uHotAmt * vec3(2.6,.9,.2) * (smoothstep(16., 0., hd) * (.6+.4*snoise(p*.3+uTime*2.)));
        lit += uHotAmt * vec3(.5,.14,.03) * smoothstep(55., 0., hd);
        lit = mix(lit, lit*vec3(.10,.12,.2), uNight);
        float dist = length(vW - cameraPosition);
        float f = 1. - exp(-pow(dist*uFogDen, 1.5));
        float mist = uMist * smoothstep(-.15, .75, snoise(p*0.004 + vec2(-uTime*.004, uTime*.002))) * smoothstep(75., 18., vW.y);
        f = clamp(max(f, mist), 0., 1.);
        vec3 c = mix(lit, uFogCol, f);
        // cinematic grade: cooler shadows, slight desaturation
        float g = dot(c, vec3(.299,.587,.114));
        c = mix(c, mix(vec3(g), c, .95) * vec3(.95,1.,1.01), uGrade);
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  skirt.material = new THREE.MeshBasicMaterial({ color: uniforms.uFogCol.value });
  skirt.position.y = 12;
  const group = new THREE.Group(); group.add(skirt);
  const W = TERRAIN_SIZE * TS;
  const geoLow = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 128, 128); geoLow.rotateX(-Math.PI / 2);
  { const pl = geoLow.attributes.position; for (let i = 0; i < pl.count; i++) pl.setY(i, Hbase(pl.getX(i), pl.getZ(i))); geoLow.computeBoundingSphere(); }
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    const outer = Math.abs(i) === 2 || Math.abs(j) === 2;
    const m = new THREE.Mesh(outer ? geoLow : geo, mat);
    m.scale.set(TS * (Math.abs(i) % 2 ? -1 : 1), TS, TS * (Math.abs(j) % 2 ? -1 : 1));
    m.position.set(i * W, 0, j * W);
    group.add(m);
  }
  return { mesh: group, uniforms, skirt };
}

function cloudTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = (x - 128) / 128, dy = (y - 128) / 128, r = Math.sqrt(dx * dx + dy * dy);
    const n = fbm(x * 0.02, y * 0.02, 5) * 0.5 + 0.5;
    const a = Math.max(0, 1 - r) ** 1.6 * smooth(0.3, 0.8, n);
    const i = (y * 256 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ---------------------------------------------------------------- drone */
const PLAN_R = [[0, -5.3], [7.0, 1.5], [6.45, 2.45], [4.55, 0.95], [3.6, 2.0], [1.35, 0.35], [0, 1.25]];
function planShape(scale = 1) {
  const pts = [...PLAN_R, ...PLAN_R.slice(1, -1).reverse().map(([x, z]) => [-x, z])];
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x * scale, z * scale) : s.moveTo(x * scale, z * scale)));
  s.closePath();
  return { shape: s, pts };
}


// Lofted wing: planform grid, boundary-snapped, airfoil-ish thickness (thick centre body -> thin rounded edges)
let wingGeoCache = null;
function wingGeometry() {
  if (wingGeoCache) return wingGeoCache;
  const { pts } = planShape();
  const E = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
  const inside = (x, z) => { let c = false; for (const [a, b] of E) { if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const nearest = (x, z) => { let best = 1e9, bx = x, bz = z; for (const [a, b] of E) { const dx = b[0] - a[0], dz = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz))); const px = a[0] + dx * t, pz = a[1] + dz * t; const d = Math.hypot(x - px, z - pz); if (d < best) { best = d; bx = px; bz = pz; } } return [best, bx, bz]; };
  const NX = 150, NZ = 90, x0 = -7.15, x1 = 7.15, z0 = -5.45, z1 = 2.6;
  const vx = [], vz = [], vd = [], ins = [];
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    let x = x0 + ((x1 - x0) * i) / NX, z = z0 + ((z1 - z0) * j) / NZ;
    const inn = inside(x, z); const [d, bx, bz] = nearest(x, z);
    if (!inn) { x = bx; z = bz; }
    vx.push(x); vz.push(z); vd.push(inn ? d : 0); ins.push(inn);
  }
  const thick = (x, z, d) => {
    const edge = Math.sqrt(Math.min(1, d / 0.75));
    const chordT = 0.07 + 0.05 * Math.max(0, 1 - Math.abs(x) / 7);
    const body = 0.42 * Math.exp(-((x / 1.35) ** 2)) * Math.min(1, Math.max(0, (z + 5.3) / 2.2)) * Math.min(1, Math.max(0.25, (1.6 - z) / 1.6));
    return edge * (chordT + body);
  };
  const pos = [], uv = [], idx = [];
  const V = vx.length;
  for (let k = 0; k < V; k++) { const t = thick(vx[k], vz[k], vd[k]); pos.push(vx[k], t, vz[k]); uv.push((vx[k] + 7) / 14, (vz[k] + 5.3) / 7.8); }
  for (let k = 0; k < V; k++) { const t = thick(vx[k], vz[k], vd[k]); pos.push(vx[k], -t * 0.55, vz[k]); uv.push((vx[k] + 7) / 14, (vz[k] + 5.3) / 7.8); }
  const W = NX + 1;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    if (!(ins[a] || ins[b] || ins[c] || ins[d])) continue;
    idx.push(a, c, b, b, c, d);            // top (faces +y)
    idx.push(V + a, V + b, V + c, V + b, V + d, V + c); // bottom
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  wingGeoCache = g; return g;
}

async function readyDecalFonts() {
  if (!document.fonts?.load) return;
  const loaded = Promise.all([
    document.fonts.load('600 64px Geist'),
    document.fonts.load('500 16px "Geist Mono"'),
  ]).catch(() => {});
  await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 1500))]);
}

function droneDecal() {
  const W = 1024, Hh = 768; // x: -7..7, z: -5.3..2.5 -> canvas
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  const X = (x) => ((x + 7) / 14) * W, Y = (z) => ((2.5 - z) / 7.8) * Hh; // top of canvas = rear
  g.fillStyle = '#2a2c2f'; g.fillRect(0, 0, W, Hh);
  // subtle tonal noise
  for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '255,255,255' : '0,0,0'},${Math.random() * .035})`; g.fillRect(Math.random() * W, Math.random() * Hh, 2 + Math.random() * 18, 2 + Math.random() * 6); }
  g.strokeStyle = 'rgba(210,212,214,.75)'; g.lineWidth = 3;
  const panel = (pts) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Y(z)) : g.moveTo(X(x), Y(z)))); g.closePath(); g.stroke(); };
  for (const sgn of [1, -1]) {
    // outer wing panel
    panel([[sgn * 4.9, -0.2], [sgn * 6.55, 1.3], [sgn * 6.2, 1.95], [sgn * 4.65, 0.75]]);
    // flap panels
    panel([[sgn * 3.75, 1.55], [sgn * 4.35, 0.95], [sgn * 3.95, 0.6], [sgn * 3.35, 1.2]]);
    panel([[sgn * 1.8, 0.2], [sgn * 3.1, 1.35], [sgn * 2.8, 1.62], [sgn * 1.5, 0.5]]);
    // intake doors
    panel([[sgn * 1.05, -1.9], [sgn * 2.0, -0.85], [sgn * 2.0, 0.1], [sgn * 1.05, -0.4]]);
    // grille
    g.fillStyle = 'rgba(200,200,200,.55)';
    for (let k = 0; k < 6; k++) g.fillRect(X(sgn * 5.45) - 22 + k * 8, Y(1.05) - 14, 4, 26);
    // tip markers
    g.fillStyle = 'rgba(210,210,210,.5)'; g.fillRect(X(sgn * 5.7) - 20, Y(0.55) - 5, 40, 10);
  }
  // spine
  g.strokeStyle = 'rgba(210,212,214,.45)'; g.lineWidth = 2;
  panel([[-0.6, -4.1], [0.6, -4.1], [0.75, -2.4], [-0.75, -2.4]]);
  // number (big, on left wing as seen from above)
  g.save(); g.translate(X(4.9), Y(0.35)); g.rotate(-0.72); g.font = '600 64px Geist, Arial'; g.fillStyle = 'rgba(225,225,225,.85)'; g.textAlign = 'center'; g.fillText('07', 0, 0); g.restore();
  g.save(); g.translate(X(-3.4), Y(-0.9)); g.rotate(0.72); g.font = '500 16px "Geist Mono", monospace'; g.fillStyle = 'rgba(210,210,210,.6)'; g.fillText('NORTHVANE', 0, 0); g.restore();
  g.save(); g.translate(X(2.6), Y(-1.4)); g.rotate(-0.72); g.font = '500 14px "Geist Mono", monospace'; g.fillStyle = 'rgba(210,210,210,.55)'; g.fillText('KTE-007', 0, 0); g.restore();
  // yellow service marks
  g.fillStyle = '#d7b33a'; g.fillRect(X(-0.9) - 8, Y(-2.2), 14, 6); g.fillRect(X(0.9) - 6, Y(-2.2), 14, 6);
  g.fillRect(X(-0.25), Y(-3.0), 4, 18);
  // leading edge highlight
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 10; g.beginPath(); g.moveTo(X(0), Y(-5.3)); g.lineTo(X(7), Y(1.5)); g.moveTo(X(0), Y(-5.3)); g.lineTo(X(-7), Y(1.5)); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

let decalTex = null;
let flockWing = null;
let flockNacelle = null;
function flockGeometry() {
  if (flockWing) return { wing: flockWing, nacelle: flockNacelle };
  const { shape } = planShape();
  flockWing = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false, curveSegments: 4 });
  flockWing.rotateX(Math.PI / 2);
  flockWing.translate(0, 0.06, 0);
  flockNacelle = new THREE.CylinderGeometry(0.55, 0.55, 5.4, 8);
  return { wing: flockWing, nacelle: flockNacelle };
}
function makeDrone({ env, legs = false, lod = 'high', color = 0x2b2d30, material = null } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  if (lod === 'low') {
    const { wing, nacelle } = flockGeometry();
    const m = material || new THREE.MeshLambertMaterial({ color });
    body.add(new THREE.Mesh(wing, m));
    const nac = new THREE.Mesh(nacelle, m); nac.rotation.x = Math.PI / 2; nac.position.set(0, 0.4, 0.2); body.add(nac);
    root.userData.materials = [m];
    return root;
  }
  if (!decalTex) decalTex = droneDecal();
  const capMat = new THREE.MeshStandardMaterial({ map: decalTex, metalness: 0.55, roughness: 0.42, envMap: env, envMapIntensity: 1.2 });
  const wing = new THREE.Mesh(wingGeometry(), capMat); body.add(wing);
  // engine nacelle (lathe along z)
  const prof = [[0.0, -3.0], [0.42, -3.0], [0.62, -2.6], [0.72, -1.8], [0.74, 1.4], [0.66, 2.6], [0.52, 3.2], [0.44, 3.25]].map(([r, y]) => new THREE.Vector2(r, y));
  const lathe = new THREE.LatheGeometry(prof, 32); lathe.rotateX(Math.PI / 2);
  const nacMat = new THREE.MeshStandardMaterial({ color: 0x34373b, metalness: 0.75, roughness: 0.32, envMap: env, envMapIntensity: 1.3 });
  const nac = new THREE.Mesh(lathe, nacMat); nac.position.set(0, 0.5, 0.1); body.add(nac);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.52, 0.5, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 1, roughness: 0.25, envMap: env, side: THREE.DoubleSide }));
  nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0.5, 3.45); body.add(nozzle);
  const inner = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: 0x0a0a0c }));
  inner.position.set(0, 0.5, 3.3); body.add(inner);
  const intake = new THREE.Mesh(new THREE.CircleGeometry(0.4, 24), new THREE.MeshBasicMaterial({ color: 0x060607 }));
  intake.rotation.y = Math.PI; intake.position.set(0, 0.5, -2.88); body.add(intake);
  // accent stripes on nacelle
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.745, 0.745, 0.12, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xc9a634, metalness: 0.3, roughness: 0.5 }));
  band.rotation.x = Math.PI / 2; band.position.set(0, 0.5, -1.6); body.add(band);
  // exhaust heat glow (subtle)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,210,170,.5)', 'rgba(255,160,90,0)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.set(1.1, 1.1, 1); glow.position.set(0, 0.5, 3.6); glow.material.opacity = 0.25; body.add(glow);
  root.userData.glow = glow;
  if (legs) {
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1d1f22, metalness: 0.7, roughness: 0.4, envMap: env });
    const footMat = new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.5, roughness: 0.6 });
    const pts = [[3.2, 0.1, 1.2, 0.9], [-3.2, 0.1, 1.2, -0.9], [0.9, 0.2, 2.2, 0.35], [-0.9, 0.2, 2.2, -0.35]];
    for (const [x, y, z, s] of pts) {
      const dir = new THREE.Vector3(s * 0.45, -0.35, 1).normalize();
      const len = 4.4;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, len, 10), legMat);
      const a = new THREE.Vector3(x, y, z);
      leg.position.copy(a).addScaledVector(dir, len / 2);
      leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      body.add(leg);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), footMat);
      foot.position.copy(a).addScaledVector(dir, len);
      body.add(foot);
    }
  }
  // anchors for DOM callouts
  const anchors = {
    nacelle: new THREE.Vector3(0, 0.9, 2.9),
    wingL: new THREE.Vector3(4.2, 0.25, 0.35),
    body: new THREE.Vector3(0, 0.95, 0.4),
    nose: new THREE.Vector3(0, 0.3, -4.2),
    center: new THREE.Vector3(0, 0.6, -0.4),
  };
  root.userData.anchors = anchors;
  root.userData.materials = [capMat, nacMat];
  return root;
}

function makeEnv(renderer) {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vP; void main(){ float y = normalize(vP).y;
      vec3 top = vec3(.9,.95,1.05); vec3 hor = vec3(.55,.6,.62); vec3 gnd = vec3(.09,.1,.07);
      vec3 c = y>0. ? mix(hor, top, pow(y,.6)) : mix(hor, gnd, pow(-y,.35));
      float sun = pow(max(dot(normalize(vP), normalize(vec3(-.55,.62,.35))),0.), 60.)*6.;
      gl_FragColor = vec4(c + sun, 1.); }`,
  }));
  scene.add(sky);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.02);
  pm.dispose();
  return rt.texture;
}

/* ------------------------------------------------------------- map world */
export const R1 = { x: 0, z: 0 };
export const R2 = { x: 330, z: -30 };
export const FLOCK = { x: -900, z: 600 };
export function G(x, z) { return 7 * snoise(x * 0.0035 + 40, z * 0.0035) + 3 * snoise(x * 0.011, z * 0.011 + 9); }

function regionPoly(cx, cz, R, seed, n = 64) {
  const rnd = mulberry(seed); const off = rnd() * 100;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    let r = R * (1 + 0.26 * snoise(Math.cos(a) * 1.2 + off, Math.sin(a) * 1.2) + 0.08 * snoise(Math.cos(a) * 4 + off, Math.sin(a) * 4 + 3));
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r * 0.85]);
  }
  // add a couple of straight "jag" cuts
  for (let k = 0; k < 3; k++) { const i = Math.floor(rnd() * n); const j = (i + 3) % n; const m = (i + 1) % n, m2 = (i + 2) % n; pts[m] = [lerp(pts[i][0], pts[j][0], 1 / 3), lerp(pts[i][1], pts[j][1], 1 / 3)]; pts[m2] = [lerp(pts[i][0], pts[j][0], 2 / 3) + (rnd() - 0.5) * 18, lerp(pts[i][1], pts[j][1], 2 / 3) + (rnd() - 0.5) * 18]; }
  return pts;
}

function ribbon(pts, width, yOff, closed = true) {
  const P = closed ? [...pts, pts[0]] : pts;
  let total = 0; const lens = [0];
  for (let i = 1; i < P.length; i++) { total += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); lens.push(total); }
  const pos = [], arc = [], idx = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const nx = -dz * width / 2, nz = dx * width / 2;
    const y = G(P[i][0], P[i][1]) + yOff;
    pos.push(P[i][0] + nx, y, P[i][1] + nz, P[i][0] - nx, y, P[i][1] - nz);
    arc.push(lens[i] / total, lens[i] / total);
    if (i < P.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('arc', new THREE.Float32BufferAttribute(arc, 1));
  g.setIndex(idx);
  return g;
}

function wall(pts, top, bottom) {
  const P = [...pts, pts[0]]; const pos = [], v = [], idx = [];
  for (let i = 0; i < P.length; i++) {
    const g = G(P[i][0], P[i][1]);
    pos.push(P[i][0], g + top, P[i][1], P[i][0], g + bottom, P[i][1]); v.push(1, 0);
    if (i < P.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('vv', new THREE.Float32BufferAttribute(v, 1)); geo.setIndex(idx); return geo;
}

const LINE_VS = 'attribute float arc; varying float vA; void main(){ vA = arc; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }';
const LINE_FS = 'uniform float uP; uniform float uO; uniform vec3 uC; varying float vA; void main(){ if (vA > uP) discard; gl_FragColor = vec4(uC, uO); }';

function makeRegion(pts, opts = {}) {
  const grp = new THREE.Group();
  const u = { uP: { value: 0 }, uO: { value: 0.95 }, uC: { value: new THREE.Color(0xf2f2f2) } };
  const lineMat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const u2 = { uP: u.uP, uO: { value: 0.35 }, uC: u.uC };
  const lineMat2 = new THREE.ShaderMaterial({ uniforms: u2, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const top = 9, bot = 1.5;
  grp.add(new THREE.Mesh(ribbon(pts, opts.width || 1.25, top), lineMat));
  grp.add(new THREE.Mesh(ribbon(pts, 0.8, bot), lineMat2));
  const wu = { uO: { value: 0 } };
  const wallMat = new THREE.ShaderMaterial({ uniforms: wu, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'attribute float vv; varying float v; void main(){ v = vv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float uO; varying float v; void main(){ gl_FragColor = vec4(vec3(.95), uO * (.05 + .12*v)); }' });
  grp.add(new THREE.Mesh(wall(pts, top, bot), wallMat));
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const fillGeo = new THREE.ShapeGeometry(shape); fillGeo.rotateX(-Math.PI / 2);
  const fillMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const fill = new THREE.Mesh(fillGeo, fillMat); fill.position.y = top - 1; grp.add(fill);
  // anchor = most upper-left (screen) point: min(x + z)
  let best = pts[0]; for (const p of pts) if (p[0] * 0.7 + p[1] < best[0] * 0.7 + best[1]) best = p;
  grp.userData = { u, wu, fillMat, anchor: new THREE.Vector3(best[0], G(best[0], best[1]) + top, best[1]), pts };
  grp.renderOrder = 2;
  return grp;
}

function markerMat(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uT: { value: 0 }, uO: { value: 0 }, uPh: { value: Math.random() } },
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `uniform vec3 uC; uniform float uT, uO, uPh; varying vec2 vUv;
      void main(){ float d = length(vUv-.5)*2.;
        float core = smoothstep(.075,.055,d);
        float disk = smoothstep(.62,.18,d)*.28 + smoothstep(.36,.2,d)*.25;
        float r = fract(uT*.45+uPh); float ring = smoothstep(.035,0.,abs(d-(.2+r*.6)))*(1.-r)*.6;
        float halo = smoothstep(1.,.3,d)*.12;
        vec3 c = uC*(disk+ring+halo) + vec3(1.,.98,.9)*core;
        gl_FragColor = vec4(c*uO, 1.); }`,
  });
}

function makeChevron(scale = 1) {
  const s = new THREE.Shape();
  s.moveTo(0, -6 * scale); s.lineTo(4.4 * scale, 3.5 * scale); s.lineTo(0, 1.4 * scale); s.lineTo(-4.4 * scale, 3.5 * scale); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.2 * scale, bevelEnabled: true, bevelSize: 0.4 * scale, bevelThickness: 0.4 * scale, bevelSegments: 1 });
  g.rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0xf4f4f4, transparent: true, opacity: 1 }));
  return m;
}

function gridMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uFocus: { value: new THREE.Vector3() }, uRad: { value: 900 }, uTime: { value: 0 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: /* glsl */`
      uniform vec3 uFocus; uniform float uRad, uTime; varying vec3 vW;
      ${GLSL_NOISE}
      void main(){
        float S = 22.;
        vec2 g = vW.xz / S;
        vec2 fw = fwidth(g);
        vec2 f = abs(fract(g - .5) - .5) / max(fw, 1e-4);
        float line = 1. - min(min(f.x, f.y), 1.);
        vec2 q = (g - floor(g + .5)) * S;
        float dd = length(q); float px = length(fw)*S;
        float dot1 = 1. - smoothstep(.55, .55 + px, dd);
        float plus = (1. - smoothstep(0., px*1.2, min(abs(q.x), abs(q.y)))) * (1. - smoothstep(2.5, 3.5, max(abs(q.x),abs(q.y))));
        float smudge = smoothstep(.1, .9, fbm4(vW.xz*.004 + 3.)) * .05 + smoothstep(.55,.95, snoise(vW.xz*.02))*.02;
        vec3 base = vec3(.011,.012,.013) + smudge*.35;
        vec3 c = base + vec3(1.) * (line*.012 + dot1*.16 + plus*.05);
        float dist = length(vW.xz - uFocus.xz);
        c *= 1. - smoothstep(uRad*.45, uRad, dist)*.92;
        gl_FragColor = vec4(c, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/* ------------------------------------------------------------- keyframes */
// Stops in vh (see main.js) -> index
export const STOPS = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6100, 6600, 6700];
const d0Path = [
  { x: -260, y: 820, z: 640 },  // 0 intro
  { x: -250, y: 830, z: 360 },  // 1 specs
  { x: -250, y: 840, z: 80 },   // 2 swarm
  { x: -230, y: 760, z: -220 }, // 3 mission
  { x: -100, y: 760, z: -420 }, // 4 flock (hidden by wipe)
  { x: 80, y: 860, z: -540 },   // 5 detect
  { x: 65, y: 200, z: -205 },  // 6 thermal
  { x: 240, y: 420, z: -390 },  // 7 ignition
];

function V(x, y, z) { return new THREE.Vector3(x, y, z); }
function buildKeysA() {
  const k = [];
  const P = d0Path;
  const add = (o) => k.push(o);
  // 0 intro: seen from above-behind-left, drone left of centre
  add({ cam: { p: V(P[0].x - 15, P[0].y + 22, P[0].z + 11), t: V(P[0].x + 2.6, P[0].y - 6, P[0].z - 3), up: V(0, 1, 0), fov: 36 },
    d: [{ p: V(P[0].x, P[0].y, P[0].z), r: [0.95, 0.05, -0.32], s: 1 }, { p: V(P[0].x + 60, P[0].y + 30, P[0].z + 80), r: [0, 0, 0], s: 0 }, { p: V(P[0].x - 70, P[0].y + 20, P[0].z + 90), r: [0, 0, 0], s: 0 }] });
  // 1 specs: straight down, nose to screen bottom
  add({ cam: { p: V(P[1].x, P[1].y + 36, P[1].z - 0.8), t: V(P[1].x, P[1].y, P[1].z - 0.8), up: V(0, 0, 1), fov: 35 },
    d: [{ p: V(P[1].x, P[1].y, P[1].z), r: [0, 0, 0], s: 1 }, { p: V(P[1].x + 34, P[1].y - 6, P[1].z + 60), r: [0, 0, 0], s: 0 }, { p: V(P[1].x - 40, P[1].y - 4, P[1].z + 70), r: [0, 0, 0], s: 0 }] });
  // 2 swarm: higher top-down, three aircraft
  add({ cam: { p: V(P[2].x + 1, P[2].y + 72, P[2].z - 2), t: V(P[2].x + 1, P[2].y, P[2].z - 2), up: V(0, 0, 1), fov: 35 },
    d: [{ p: V(P[2].x, P[2].y, P[2].z), r: [0.02, 0, 0], s: 1 }, { p: V(P[2].x + 20.5, P[2].y - 3, P[2].z - 14.5), r: [-0.03, 0, 0.03], s: 1 }, { p: V(P[2].x - 22.5, P[2].y - 2, P[2].z + 7.5), r: [0.03, 0, -0.03], s: 1 }] });
  // 3 mission: oblique from behind, V formation
  add({ cam: { p: V(P[3].x, P[3].y + 74, P[3].z + 44), t: V(P[3].x, P[3].y - 6, P[3].z - 4), up: V(0, 1, 0), fov: 35 },
    d: [{ p: V(P[3].x + 3, P[3].y, P[3].z - 12), r: [0, 0, 0.04], s: 1 }, { p: V(P[3].x - 25, P[3].y - 1, P[3].z + 8), r: [0, 0, -0.05], s: 1 }, { p: V(P[3].x + 25, P[3].y + 1, P[3].z + 6), r: [0, 0, 0.06], s: 1 }] });
  // 4 flock (dissolving) — keep flying forward
  add({ cam: { p: V(P[4].x, P[4].y + 70, P[4].z + 70), t: V(P[4].x, P[4].y - 10, P[4].z - 20), up: V(0, 1, 0), fov: 35 },
    d: [{ p: V(P[4].x, P[4].y, P[4].z - 20), r: [0.2, 0, 0.1], s: 1 }, { p: V(P[4].x - 30, P[4].y, P[4].z), r: [0.2, 0, 0.1], s: 1 }, { p: V(P[4].x + 30, P[4].y, P[4].z), r: [0.2, 0, 0.1], s: 1 }] });
  // 5 detect: high oblique, drone small centre
  add({ cam: { p: V(P[5].x, P[5].y + 104, P[5].z + 52), t: V(P[5].x, P[5].y - 10, P[5].z - 4), up: V(0, 1, 0), fov: 35 },
    d: [{ p: V(P[5].x, P[5].y, P[5].z), r: [0, 0.05, 0], s: 1 }, { p: V(P[5].x - 60, P[5].y + 30, P[5].z + 120), r: [0, 0, 0], s: 0 }, { p: V(P[5].x + 60, P[5].y + 30, P[5].z + 120), r: [0, 0, 0], s: 0 }] });
  // 6 thermal: low oblique from behind-right, drone lower-left, beam ahead to the hot spot
  { const Hs = V(HOT.x, H(HOT.x, HOT.z), HOT.z); const D = V(HOT.x - 115, Hs.y + 150, HOT.z + 120);
    const dir = Hs.clone().sub(D).setY(0).normalize(); const right = new THREE.Vector3().crossVectors(dir, V(0, 1, 0)).normalize();
    const cp = D.clone().addScaledVector(dir, -34).addScaledVector(right, 13).add(V(0, 12, 0));
    const tg = D.clone().lerp(Hs, 0.42).addScaledVector(right, 22).add(V(0, 40, 0));
    const yaw = Math.atan2(-dir.x, -dir.z);
    add({ cam: { p: cp, t: tg, up: V(0, 1, 0), fov: 38 },
      d: [{ p: D, r: [yaw + 0.25, 0.1, 0.3], s: 1 }, { p: V(P[6].x - 60, P[6].y, P[6].z + 60), r: [0, 0, 0], s: 0 }, { p: V(P[6].x - 60, P[6].y, P[6].z + 60), r: [0, 0, 0], s: 0 }] }); }
  // 7 ignition: very high, straight down over town
  add({ cam: { p: V(TOWN.x - 40, 700, TOWN.z + 22.5), t: V(TOWN.x - 40, 30, TOWN.z + 22), up: V(0, 0, -1), fov: 35 },
    d: [{ p: V(P[7].x, P[7].y, P[7].z), r: [-0.9, 0, 0.1], s: 1 }, { p: V(P[7].x, P[7].y, P[7].z), r: [0, 0, 0], s: 0 }, { p: V(P[7].x, P[7].y, P[7].z), r: [0, 0, 0], s: 0 }] });
  // 8+ (map world visible) — keep A parked
  while (k.length < STOPS.length) k.push(k[k.length - 1]);
  return k;
}

function buildKeysB() {
  const k = [];
  const F = FLOCK;
  const cam = (p, t, fov = 35) => ({ p, t, up: V(0, 1, 0), fov });
  const c = [
    cam(V(F.x, 420, F.z + 520), V(F.x, 0, F.z)), // 0
    cam(V(F.x, 420, F.z + 520), V(F.x, 0, F.z)), // 1
    cam(V(F.x, 420, F.z + 520), V(F.x, 0, F.z)), // 2
    cam(V(F.x + 40, 330, F.z + 380), V(F.x, 0, F.z - 20)), // 3
    cam(V(F.x, 420, F.z + 170), V(F.x, 0, F.z - 20)), // 4 flock
    cam(V(F.x - 30, 170, F.z + 60), V(F.x - 20, 0, F.z - 180)), // 5
    cam(V(F.x - 30, 170, F.z + 60), V(F.x - 20, 0, F.z - 180)), // 6
    cam(V(R1.x - 20, 980, R1.z + 330), V(R1.x - 10, 0, R1.z + 10)), // 7 (approach)
    cam(V(R1.x + 8, 600, R1.z + 205), V(R1.x + 8, 0, R1.z + 22)), // 8 meridian
    cam(V(R1.x - 40, 575, R1.z + 260), V(R1.x + 5, 0, R1.z + 26)), // 9 analysis
    cam(V(R1.x + 40, 585, R1.z + 240), V(R1.x + 10, 0, R1.z + 22)), // 10 alerts
    cam(V(R2.x - 30, 305, R2.z + 285), V(R2.x - 50, 0, R2.z + 20)), // 11 coord
    cam(V(R2.x + 10, 285, R2.z + 290), V(R2.x - 45, 0, R2.z + 25)), // 12 support
    cam(V(R2.x - 20, 280, R2.z + 300), V(R2.x - 40, 0, R2.z + 28)), // 13 secured
    cam(V(160, 1150, 700), V(160, 0, 20)), // 14 multi
    cam(V(160, 1350, 760), V(160, 0, 0)), // 15 end
  ];
  for (const x of c) k.push({ cam: x });
  return k;
}

const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

function delaunayEdges(P) {
  // Bowyer-Watson; P = [[x,z],...] -> Set of edge keys (i*1000+j)
  const pts = P.slice(); const n = pts.length;
  let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
  for (const [x, z] of pts) { minX = Math.min(minX, x); minZ = Math.min(minZ, z); maxX = Math.max(maxX, x); maxZ = Math.max(maxZ, z); }
  const d = Math.max(maxX - minX, maxZ - minZ) * 20, mx = (minX + maxX) / 2, mz = (minZ + maxZ) / 2;
  pts.push([mx - d, mz - d], [mx, mz + d], [mx + d, mz - d]);
  const circ = (a, b, c) => {
    const [ax, az] = pts[a], [bx, bz] = pts[b], [cx, cz] = pts[c];
    const D = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
    const ux = ((ax * ax + az * az) * (bz - cz) + (bx * bx + bz * bz) * (cz - az) + (cx * cx + cz * cz) * (az - bz)) / D;
    const uz = ((ax * ax + az * az) * (cx - bx) + (bx * bx + bz * bz) * (ax - cx) + (cx * cx + cz * cz) * (bx - ax)) / D;
    return [ux, uz, (ax - ux) ** 2 + (az - uz) ** 2];
  };
  let tris = [[n, n + 1, n + 2, ...circ(n, n + 1, n + 2)]];
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i]; const bad = [], keep = [];
    for (const t of tris) ((x - t[3]) ** 2 + (z - t[4]) ** 2 < t[5] ? bad : keep).push(t);
    const ec = new Map();
    for (const t of bad) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) { const k = a < b ? a * 1000 + b : b * 1000 + a; ec.set(k, (ec.get(k) || 0) + 1); }
    tris = keep;
    for (const [k, c] of ec) if (c === 1) { const a = Math.floor(k / 1000), b = k % 1000; tris.push([a, b, i, ...circ(a, b, i)]); }
  }
  const E = new Set();
  for (const t of tris) for (const [a, b] of [[t[0], t[1]], [t[1], t[2]], [t[2], t[0]]]) if (a < n && b < n) E.add(a < b ? a * 1000 + b : b * 1000 + a);
  return E;
}

/* ----------------------------------------------------------------- world */
export async function createWorld(canvas, { onProgress = () => {}, dprMax = 1.5, perf = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprMax));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const stages = [];
  let stageAt = performance.now();
  const stage = (name) => {
    if (!perf) return;
    const now = performance.now();
    stages.push({ name, ms: Math.round(now - stageAt) });
    stageAt = now;
  };

  const env = makeEnv(renderer);
  stage('env');
  onProgress(0.15); await tick();

  /* ---------- World A ---------- */
  const sceneA = new THREE.Scene();
  const camA = new THREE.PerspectiveCamera(35, 1, 1, 9000);
  await loadHeights();
  const terrain = await makeTerrain(renderer); sceneA.add(terrain.mesh);
  terrain.uniforms.uHot.value.set(HOT.x, H(HOT.x, HOT.z), HOT.z);
  sceneA.background = terrain.uniforms.uFogCol.value;
  stage('terrain');
  onProgress(0.55); await tick();
  const hemiA = new THREE.HemisphereLight(0xcfd8e0, 0x2a2a20, 0.9); sceneA.add(hemiA);
  const sun = new THREE.DirectionalLight(0xfff2e0, 3.2); sun.position.copy(terrain.uniforms.uSunDir.value).multiplyScalar(100); sceneA.add(sun);

  await readyDecalFonts();
  const drones = [makeDrone({ env }), makeDrone({ env }), makeDrone({ env })];
  drones.forEach((d) => sceneA.add(d));

  // mist sprites
  const cloudTex = cloudTexture();
  const mists = [];
  const rndM = mulberry(9);
  const mistAt = (x, z, n, yMin, yMax, spread) => { for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0xdfe6ea, transparent: true, opacity: 0.07 + rndM() * 0.08, depthWrite: false, fog: false }));
    const sc = 300 + rndM() * 500; s.scale.set(sc, sc * (0.55 + rndM() * 0.3), 1);
    s.position.set(x + (rndM() - 0.5) * spread, yMin + rndM() * (yMax - yMin), z + (rndM() - 0.5) * spread);
    s.userData.base = s.position.clone(); s.userData.ph = rndM() * 10; s.userData.o = s.material.opacity;
    sceneA.add(s); mists.push(s);
  } };
  mistAt(-250, 500, 12, 260, 620, 1100);
  mistAt(-250, 60, 14, 260, 620, 1200);
  mistAt(60, -520, 10, 240, 600, 1000);
  mistAt(160, -300, 8, 120, 260, 600);

  // town (instanced boxes)
  const townGroup = new THREE.Group(); sceneA.add(townGroup);
  {
    const rnd = mulberry(77);
    const box = new THREE.BoxGeometry(1, 1, 1); box.translate(0, 0.5, 0);
    const n = 520;
    const townMat = new THREE.MeshLambertMaterial({ color: 0xffffff }); const im = new THREE.InstancedMesh(box, townMat, n); townGroup.userData.mat = townMat;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    let c = 0;
    for (let i = 0; i < n * 3 && c < n; i++) {
      const gx = Math.round((rnd() - 0.5) * 22), gz = Math.round((rnd() - 0.5) * 22);
      const x = TOWN.x + gx * 4.5 + (rnd() - 0.5) * 3, z = TOWN.z + gz * 4.5 + (rnd() - 0.5) * 3;
      if (Math.hypot(x - TOWN.x, z - TOWN.z) > 52 + rnd() * 10) continue;
      if ((gx % 5 === 0 && rnd() < 0.8) || (gz % 6 === 0 && rnd() < 0.8) || rnd() < 0.18) continue; // streets + gaps
      const w = 1.4 + rnd() * 1.8, d = 1.4 + rnd() * 2.2, h = 0.6 + rnd() * 1.2;
      p.set(x, H(x, z) - 0.3, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.12 + Math.round(snoise(x * 0.05, z * 0.05) * 2) * 0.35 + (rnd() - 0.5) * 0.15); s.set(w, h, d);
      m.compose(p, q, s); im.setMatrixAt(c, m);
      col.setHSL(0.08 + rnd() * 0.04, 0.05, 0.16 + rnd() * 0.16); im.setColorAt(c, col); c++;
    }
    im.count = c; townGroup.add(im);
    // roads
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x8c8a82 }); townGroup.userData.road = roadMat;
    const addRoad = (pts, w) => {
      const ctrl = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(TOWN.x + (x - TOWN.x) * TS, 0, TOWN.z + (z - TOWN.z) * TS)));
      const curve = new THREE.CatmullRomCurve3(ctrl.getSpacedPoints(220).map((v) => v.setY(H(v.x, v.z) + 0.5)));
      const tube = new THREE.TubeGeometry(curve, 440, w * 0.5, 3, false);
      townGroup.add(new THREE.Mesh(tube, roadMat));
    };
    addRoad([[TOWN.x - 420, TOWN.z + 260], [TOWN.x - 220, TOWN.z + 120], [TOWN.x - 60, TOWN.z + 30], [TOWN.x + 60, TOWN.z - 20], [TOWN.x + 260, TOWN.z - 160], [TOWN.x + 420, TOWN.z - 180]], 1.4);
    addRoad([[TOWN.x - 30, TOWN.z - 300], [TOWN.x - 10, TOWN.z - 120], [TOWN.x, TOWN.z], [TOWN.x + 30, TOWN.z + 160], [TOWN.x + 10, TOWN.z + 340]], 1.1);
    // lights for night
    const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0 }), 400);
    for (let i = 0; i < 400; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 58; const x = TOWN.x + Math.cos(a) * r, z = TOWN.z + Math.sin(a) * r; m.makeTranslation(x, H(x, z) + 3, z); lights.setMatrixAt(i, m); }
    townGroup.add(lights); townGroup.userData.lights = lights;
  }

  // fire + smoke + scan beam
  const hotY = H(HOT.x, HOT.z);
  const fireGroup = new THREE.Group(); fireGroup.position.set(HOT.x, hotY, HOT.z); sceneA.add(fireGroup);
  const fireTex = glowTexture('rgba(255,190,90,1)', 'rgba(255,80,10,0)');
  const flames = [];
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    s.position.set((Math.random() - 0.5) * 30, 3 + Math.random() * 4, (Math.random() - 0.5) * 30); s.scale.setScalar(10 + Math.random() * 12);
    s.userData.ph = Math.random() * 10; fireGroup.add(s); flames.push(s);
  }
  const smoke = [];
  for (let i = 0; i < 38; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, color: 0x9a9690, transparent: true, depthWrite: false, opacity: 0 }));
    s.userData = { ph: Math.random(), dx: (Math.random() - 0.5) * 20, dz: (Math.random() - 0.5) * 20 };
    fireGroup.add(s); smoke.push(s);
  }
  const beamU = { uO: { value: 0 }, uT: { value: 0 } };
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 48, 1, true), new THREE.ShaderMaterial({
    uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float uO, uT; varying vec2 vUv; void main(){ float a = (1.-vUv.y); a = pow(a,.7)*.9 + .1; float stripe = .9+.1*sin(vUv.y*40.-uT*6.); float edge = smoothstep(0.,.08,vUv.x)*smoothstep(1.,.92,vUv.x); gl_FragColor = vec4(vec3(1.,.98,.94)*a*stripe*edge*uO*.16, 1.); }',
  }));
  sceneA.add(beam);

  /* ---------- World B ---------- */
  const sceneB = new THREE.Scene();
  const camB = new THREE.PerspectiveCamera(35, 1, 1, 6000);
  const groundGeo = new THREE.PlaneGeometry(4200, 4200, 240, 240); groundGeo.rotateX(-Math.PI / 2);
  { const p = groundGeo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, G(p.getX(i), p.getZ(i))); groundGeo.computeVertexNormals(); }
  const gridMat = gridMaterial();
  const ground = new THREE.Mesh(groundGeo, gridMat); sceneB.add(ground);
  sceneB.add(new THREE.HemisphereLight(0xffffff, 0x222222, 1.4));
  const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-1, 2, 1); sceneB.add(dl);
  stage('flight');
  onProgress(0.7); await tick();

  const regions = {
    r1: makeRegion(regionPoly(R1.x, R1.z, 170, 3)),
    r2: makeRegion(regionPoly(R2.x + 20, R2.z, 150, 11)),
    r0: makeRegion(regionPoly(R1.x - 330, R1.z - 40, 190, 21)), // left neighbour seen in coord scenes
    r3: makeRegion(regionPoly(-360, -380, 110, 31)),
    r4: makeRegion(regionPoly(620, -330, 120, 41)),
    r5: makeRegion(regionPoly(-420, 330, 100, 51)),
    r6: makeRegion(regionPoly(700, 290, 110, 61)),
    r7: makeRegion(regionPoly(170, 440, 90, 71)),
  };
  Object.values(regions).forEach((r) => sceneB.add(r));

  const mkMarker = (x, z, size, color) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), markerMat(color)); m.rotation.x = -Math.PI / 2; m.position.set(x, G(x, z) + 10, z); m.renderOrder = 5; sceneB.add(m); return m; };
  const m1 = [mkMarker(R1.x - 62, R1.z + 18, 64, 0xffcb47), mkMarker(R1.x + 72, R1.z - 28, 64, 0xffcb47), mkMarker(R1.x + 48, R1.z + 92, 64, 0xffcb47)];
  const m2 = mkMarker(R2.x + 45, R2.z + 25, 90, 0xffcb47);
  const m0 = mkMarker(R1.x - 330, R1.z - 10, 90, 0x7aebff);
  const mOthers = [mkMarker(-360, -380, 60, 0x7aebff), mkMarker(620, -330, 60, 0x7aebff), mkMarker(-420, 330, 55, 0x7aebff), mkMarker(700, 290, 60, 0x7aebff), mkMarker(170, 440, 50, 0x7aebff), mkMarker(640, -290, 46, 0x7aebff)];

  // substation buildings in R2
  const station = new THREE.Group(); sceneB.add(station);
  const stationMat = new THREE.MeshLambertMaterial({ color: 0xff6666, emissive: 0x000000, transparent: true, opacity: 0 });
  {
    const rnd = mulberry(5);
    const bx = R2.x - 30, bz = R2.z - 60;
    for (let i = 0; i < 46; i++) {
      const w = 3 + rnd() * 9, d = 3 + rnd() * 9, h = 3 + rnd() * 16;
      const x = bx + (rnd() - 0.5) * 70, z = bz + (rnd() - 0.5) * 50;
      const b = new THREE.Mesh(rnd() < 0.2 ? new THREE.CylinderGeometry(w * 0.3, w * 0.3, h * 1.6, 10) : new THREE.BoxGeometry(w, h, d), stationMat);
      b.position.set(x, G(x, z) + h / 2 + 2, z); station.add(b);
    }
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.2, 40, 8), stationMat); const x = bx - 10 + i * 12, z = bz - 20; t.position.set(x, G(x, z) + 22, z); station.add(t); }
  }
  // white factory block with hatching
  const hatch = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#9a9a9a'; g.lineWidth = 3; for (let i = -128; i < 256; i += 12) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const factory = new THREE.Group(); sceneB.add(factory);
  { const mat = new THREE.MeshLambertMaterial({ map: hatch, transparent: true, opacity: 0 });
    const x = R2.x - 95, z = R2.z + 72, y = G(x, z);
    const a = new THREE.Mesh(new THREE.BoxGeometry(38, 14, 22), mat); a.position.set(x, y + 9, z); factory.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(14, 30, 22), mat); b.position.set(x + 20, y + 17, z - 1); factory.add(b);
    factory.userData.mat = mat; }

  const chevrons = [];
  for (let i = 0; i < 9; i++) {
    const c = makeChevron(1.7); c.material = c.material.clone(); c.visible = false; sceneB.add(c); chevrons.push(c);
    const tg = new THREE.BufferGeometry(); const TP = 40;
    tg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(TP * 3), 3));
    const cols = new Float32Array(TP * 4); for (let k = 0; k < TP; k++) cols.set([1, 1, 1, (1 - k / TP) * 0.8], k * 4);
    tg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 4));
    const tl = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    tl.visible = false; sceneB.add(tl); c.userData.trail = tl;
  }

  // flock (sync scene)
  const flockN = 38; const flock = [];
  const flockMat = new THREE.MeshLambertMaterial({ color: 0xe6e8ea });
  { const rnd = mulberry(123);
    for (let i = 0; i < flockN; i++) {
      const d = makeDrone({ lod: 'low', material: flockMat }); d.scale.setScalar(0.8);
      const x = FLOCK.x + (rnd() - 0.5) * 700, z = FLOCK.z - 30 + (rnd() - 0.5) * 430;
      d.userData.base = new THREE.Vector3(x, 0, z); d.userData.ph = rnd() * 100; d.userData.sp = 0.5 + rnd() * 0.6;
      d.position.set(x, G(x, z) + 14, z); sceneB.add(d); flock.push(d);
    } }
  const edgeMax = flockN * 6;
  const edgeGeo = new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(edgeMax * 6), 3));
  const edges = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
  sceneB.add(edges);
  const flockDots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(flockN * 3), 3)), new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false }));
  sceneB.add(flockDots);

  /* ---------- composite ---------- */
  const rtOpts = { type: THREE.HalfFloatType, samples: 4, depthBuffer: true };
  const rtA = new THREE.WebGLRenderTarget(4, 4, rtOpts), rtB = new THREE.WebGLRenderTarget(4, 4, rtOpts);
  const compU = { tA: { value: rtA.texture }, tB: { value: rtB.texture }, uMix: { value: 0 }, uFade: { value: 0 }, uAspect: { value: 1 }, uTime: { value: 0 }, uDir: { value: 1 } };
  const comp = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: compU, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }',
    fragmentShader: /* glsl */`
      uniform sampler2D tA, tB; uniform float uMix, uFade, uAspect, uTime, uDir; varying vec2 vUv;
      void main(){
        vec4 a = texture2D(tA, vUv), b = texture2D(tB, vUv);
        float d = (vUv.x*uAspect + (1.-vUv.y)) / (uAspect + 1.);
        float e = .02;
        float m2 = uMix*(1.+2.*e) - e;
        float t = uDir > 0. ? d - (1. - m2) : m2 - d;
        float m = smoothstep(-e, e, t);
        vec3 c = mix(a.rgb, b.rgb, m);
        float line = smoothstep(.006, 0., abs(t)) * step(.001, uMix) * step(uMix, .999);
        c += line * .35;
        vec2 v = vUv-.5; c *= 1. - dot(v,v)*.6;
        gl_FragColor = vec4(c*(1.-uFade), 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  const compScene = new THREE.Scene(); compScene.add(comp);
  const compCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  stage('map');

  /* ---------- Tail views ---------- */
  let views = null;
  const getViews = () => {
    if (views) return views;
    views = makeViews(env);
    // Tail views draw to the canvas, so the default (no target) variants are the ones used.
    try { views.compile(renderer); } catch (_) { /* compile on first draw */ }
    return views;
  };

  onProgress(0.9); await tick();

  const keysA = buildKeysA(), keysB = buildKeysB();
  const state = { v: 0, vs: 0, time: 0, thermalT: 0, pointer: new THREE.Vector2(), pointerS: new THREE.Vector2(), w: 1, h: 1, intro: 1, events: {} };

  function resize(w, h) {
    state.w = w; state.h = h;
    renderer.setSize(w, h, false);
    const pr = renderer.getPixelRatio();
    rtA.setSize(Math.floor(w * pr), Math.floor(h * pr)); rtB.setSize(Math.floor(w * pr), Math.floor(h * pr));
    compU.uAspect.value = w / h;
  }

  // interpolate keyframes by scroll position (vh)
  function seg(v) {
    let i = 0; while (i < STOPS.length - 2 && v >= STOPS[i + 1]) i++;
    const a = STOPS[i], b = STOPS[i + 1];
    return { i, t: clamp01((v - a) / (b - a)) };
  }
  const tmpV = new THREE.Vector3(), tmpT = new THREE.Vector3(), tmpU = new THREE.Vector3();
  function applyCam(cam, keys, v, aspect, extraFov = 0) {
    const { i, t } = seg(v); const e = ease(t);
    const A = keys[i].cam, B = keys[Math.min(i + 1, keys.length - 1)].cam;
    tmpV.lerpVectors(A.p, B.p, e); tmpT.lerpVectors(A.t, B.t, e); tmpU.lerpVectors(A.up, B.up, e).normalize();
    // pointer parallax
    const dir = tmpT.clone().sub(tmpV); const dist = dir.length();
    const right = dir.clone().cross(tmpU).normalize(); const up2 = right.clone().cross(dir).normalize();
    tmpV.addScaledVector(right, state.pointerS.x * dist * 0.012).addScaledVector(up2, -state.pointerS.y * dist * 0.008);
    cam.position.copy(tmpV); cam.up.copy(tmpU); cam.lookAt(tmpT);
    let fov = lerp(A.fov, B.fov, e) + extraFov;
    if (aspect < 1) fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * Math.min(1.9, 1.05 / aspect)));
    cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix();
    return { i, t, e };
  }

  function keyed(v, pairs) { // [[v,val],...] numeric
    if (v <= pairs[0][0]) return pairs[0][1];
    for (let k = 1; k < pairs.length; k++) if (v <= pairs[k][0]) { const [a, x] = pairs[k - 1], [b, y] = pairs[k]; return lerp(x, y, smooth(0, 1, (v - a) / (b - a))); }
    return pairs[pairs.length - 1][1];
  }
  const YEL = new THREE.Color(0xffcb47), RED = new THREE.Color(0xff6666), CYN = new THREE.Color(0x7aebff), WHT = new THREE.Color(0xf2f2f2);
  function colorKeyed(v, pairs, out) {
    if (v <= pairs[0][0]) return out.copy(pairs[0][1]);
    for (let k = 1; k < pairs.length; k++) if (v <= pairs[k][0]) { const [a, x] = pairs[k - 1], [b, y] = pairs[k]; return out.copy(x).lerp(y, smooth(0, 1, (v - a) / (b - a))); }
    return out.copy(pairs[pairs.length - 1][1]);
  }

  const proj = new THREE.Vector3();
  function project(p, cam) {
    proj.copy(p).project(cam);
    return { x: (proj.x * 0.5 + 0.5) * state.w, y: (-proj.y * 0.5 + 0.5) * state.h, vis: proj.z < 1 && proj.z > -1 };
  }

  // detection points around the detect stop
  const detPts = (() => { const rnd = mulberry(404); const out = []; const K = keysA[5].cam;
    const c = new THREE.PerspectiveCamera(35, 1.6, 1, 5000); c.position.copy(K.p); c.up.copy(K.up); c.lookAt(K.t); c.updateMatrixWorld(); c.updateProjectionMatrix();
    const ray = new THREE.Raycaster();
    for (let i = 0; i < 22; i++) {
      const sx = (rnd() * 2.1 - 1.05), sy = (rnd() * 2.0 - 1.0);
      if (Math.abs(sx) < 0.18 && Math.abs(sy) < 0.2) { i--; continue; }
      ray.setFromCamera(new THREE.Vector2(sx, sy), c);
      const o = ray.ray.origin, d = ray.ray.direction; const t = (60 - o.y) / d.y;
      const x = o.x + d.x * t, z = o.z + d.z * t; out.push(new THREE.Vector3(x, H(x, z), z));
    } return out; })();

  const S = STOPS; // alias
  const out = { callouts: {}, droneTags: [], detect: [], chips: {}, multi: [], thermalDone: false };

  function update(dt) {
    state.time += dt;
    if (Math.abs(state.v - state.vs) > 700 || state.snap) { state.vs = state.v; state.snap = false; }
    state.vs += (state.v - state.vs) * (1 - Math.exp(-dt * 4.5));
    const T = state.time, v = state.vs;
    state.pointerS.lerp(state.pointer, Math.min(1, dt * 2.5));
    const aspect = state.w / state.h;

    /* ---- A ---- */
    terrain.uniforms.uTime.value = T;
    const { i, e } = applyCam(camA, keysA, v, aspect);
    // intro reveal: pull camera in from boot distance
    if (state.intro < 1) { const k = 1 - ease(state.intro); camA.position.lerp(drones[0].position, -k * 0.6); camA.fov += k * 10; camA.updateProjectionMatrix(); }
    const KA = keysA[i].d, KB = keysA[Math.min(i + 1, keysA.length - 1)].d;
    drones.forEach((d, n) => {
      const a = KA[n], b = KB[n];
      d.position.lerpVectors(a.p, b.p, e);
      const bob = Math.sin(T * 0.9 + n * 1.7) * 0.25;
      d.position.y += bob;
      d.rotation.set(lerp(a.r[1], b.r[1], e) + Math.sin(T * 0.7 + n) * 0.012, lerp(a.r[0], b.r[0], e), lerp(a.r[2], b.r[2], e) + Math.sin(T * 0.5 + n * 2) * 0.03, 'YXZ');
      const s = lerp(a.s, b.s, e); d.scale.setScalar(Math.max(0.0001, s)); d.visible = s > 0.01;
      d.userData.glow.material.opacity = 0.18 + 0.08 * Math.sin(T * 30 + n);
    });
    // mist drift
    for (const m of mists) { m.position.x = m.userData.base.x + Math.sin(T * 0.05 + m.userData.ph) * 20; m.position.z = m.userData.base.z + T * 1.2 % 60; m.material.opacity = m.userData.o * (1 - state.bakeNoMist); }

    // fire / beam
    const thermalIn = keyed(v, [[S[5] + 250, 0], [S[6] - 60, 1], [S[7] + 100, 1], [S[8], 0]]);
    const hotAmt = state.thermalT > 0 ? Math.min(1, state.thermalT / 2.6) * thermalIn : 0;
    terrain.uniforms.uHotAmt.value = Math.max(hotAmt, keyed(v, [[S[6] + 150, 0], [S[7] - 50, 1], [S[8], 1]]) * keyed(v, [[S[7], 1], [S[8] + 50, 0]])) + state.bakeFire;
    const fireA = terrain.uniforms.uHotAmt.value;
    flames.forEach((f, k) => { f.material.opacity = fireA * (0.55 + 0.45 * Math.sin(T * 9 + f.userData.ph)); f.scale.setScalar((10 + 6 * Math.sin(T * 3 + k)) * (0.6 + fireA * 0.6)); });
    smoke.forEach((s) => { const ph = (T * 0.05 + s.userData.ph) % 1; s.position.set(s.userData.dx + ph * 60, 6 + ph * 170, s.userData.dz - ph * 40); const sc = 20 + ph * 130; s.scale.set(sc, sc, 1); s.material.opacity = fireA * 0.34 * Math.sin(ph * Math.PI); });
    const beamOn = state.thermalT > 0 ? keyed(v, [[S[6] - 40, 0], [S[6] - 10, 1], [S[6] + 120, 1], [S[6] + 170, 0]]) * clamp01(state.thermalT / 0.6) : 0;
    beamU.uO.value = beamOn; beamU.uT.value = T;
    if (beamOn > 0) {
      const from = drones[0].localToWorld(new THREE.Vector3(0, -0.2, -2.5));
      const sweep = Math.sin(Math.min(state.thermalT, 3) / 3 * Math.PI) * 18;
      const to = new THREE.Vector3(HOT.x + sweep - 8, hotY, HOT.z + sweep * 0.5);
      const len = from.distanceTo(to);
      beam.position.copy(from).lerp(to, 0.5);
      beam.scale.set(len * 0.085, len, len * 0.085);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
      beam.visible = true;
    } else beam.visible = false;
    townGroup.userData.lights.material.opacity = state.bakeNight;

    /* ---- B ---- */
    applyCam(camB, keysB, v, aspect);
    gridMat.uniforms.uFocus.value.copy(keysB[seg(v).i].cam.t).lerp(keysB[Math.min(seg(v).i + 1, 15)].cam.t, ease(seg(v).t));
    gridMat.uniforms.uRad.value = camB.position.y * 2.2 + 300;
    // flock
    const fl = keyed(v, [[S[3] + 200, 0], [S[4] - 60, 1], [S[4] + 250, 1], [S[5], 0]]);
    const posArr = edgeGeo.attributes.position.array; const dots = flockDots.geometry.attributes.position.array;
    flock.forEach((d, k) => {
      const b = d.userData.base; const ph = d.userData.ph;
      const x = b.x + Math.sin(T * 0.15 * d.userData.sp + ph) * 24, z = b.z + Math.cos(T * 0.12 * d.userData.sp + ph * 1.3) * 18 - ((T * 3) % 40);
      d.position.set(x, G(x, z) + 14, z); d.rotation.y = Math.sin(T * 0.2 + ph) * 0.25;
      d.visible = fl > 0.01; d.scale.setScalar(0.8 * Math.max(0.001, fl));
      dots[k * 3] = x; dots[k * 3 + 1] = G(x, z) + 14.5; dots[k * 3 + 2] = z;
    });
    flockDots.geometry.attributes.position.needsUpdate = true; flockDots.visible = false;
    let ne = 0;
    if (fl > 0.01) {
      if (!state.flockE || T - state.flockT > 0.12) { state.flockE = delaunayEdges(flock.map((d) => [d.position.x, d.position.z])); state.flockT = T; }
      for (const key of state.flockE) {
        const a2 = Math.floor(key / 1000), b2 = key % 1000; const pa = flock[a2].position, pb = flock[b2].position;
        if (pa.distanceToSquared(pb) > 175 * 175 || ne >= edgeMax) continue;
        posArr.set([pa.x, pa.y, pa.z, pb.x, pb.y, pb.z], ne * 6); ne++;
      }
    }
    edgeGeo.setDrawRange(0, ne * 2); edgeGeo.attributes.position.needsUpdate = true; edges.material.opacity = 0.7 * fl;

    // regions
    const r1Draw = keyed(v, [[S[7] + 150, 0], [S[8] - 20, 1]]);
    const setReg = (r, draw, fill, col) => { r.userData.u.uP.value = draw * 1.001; r.userData.wu.uO.value = draw; r.userData.fillMat.opacity = fill * draw; if (col) r.userData.u.uC.value.copy(col); r.visible = draw > 0.001; };
    setReg(regions.r1, r1Draw, 0.022);
    setReg(regions.r2, keyed(v, [[S[10] + 150, 0], [S[11] - 30, 1]]), 0.05);
    setReg(regions.r0, keyed(v, [[S[10] + 150, 0], [S[11] - 30, 1]]), 0.03);
    const multiDraw = keyed(v, [[S[13] + 40, 0], [S[14] - 30, 1]]);
    ['r3', 'r4', 'r5', 'r6', 'r7'].forEach((k) => setReg(regions[k], multiDraw, 0.04));

    const c1 = colorKeyed(v, [[S[8] + 100, YEL], [S[9] - 100, RED], [S[9] + 100, RED], [S[10] - 100, CYN]], new THREE.Color());
    m1.forEach((m, k) => { m.material.uniforms.uC.value.copy(c1); m.material.uniforms.uT.value = T; m.material.uniforms.uO.value = keyed(v, [[S[7] + 300, 0], [S[8] - 10, 1]]) * (k === 0 || v < S[11] - 150 ? 1 : keyed(v, [[S[10] + 100, 1], [S[11] - 60, 0]])); });
    const c2 = colorKeyed(v, [[S[11] + 100, YEL], [S[12] - 100, RED], [S[12] + 30, RED], [S[13] - 20, CYN]], new THREE.Color());
    m2.material.uniforms.uC.value.copy(c2); m2.material.uniforms.uT.value = T; m2.material.uniforms.uO.value = keyed(v, [[S[10] + 250, 0], [S[11] - 20, 1]]);
    m0.material.uniforms.uT.value = T; m0.material.uniforms.uO.value = keyed(v, [[S[10] + 250, 0], [S[11] - 20, 1]]);
    mOthers.forEach((m) => { m.material.uniforms.uT.value = T; m.material.uniforms.uO.value = multiDraw; });
    stationMat.opacity = keyed(v, [[S[11] + 150, 0], [S[12] - 60, 1]]);
    stationMat.color.copy(colorKeyed(v, [[S[12] + 20, RED], [S[13] - 20, CYN]], new THREE.Color()));
    stationMat.emissive.copy(stationMat.color).multiplyScalar(0.35);
    factory.userData.mat.opacity = keyed(v, [[S[10] + 200, 0], [S[11] - 40, 1]]);

    // chevrons (map aircraft)
    const chevOn = keyed(v, [[S[8] + 100, 0], [S[9] - 60, 1]]);
    const cp = (k, cx, cz, rad, sp, ph, on) => {
      const c = chevrons[k]; const at = (a) => [cx + Math.cos(a) * rad, cz + Math.sin(a) * rad * 0.8];
      const a = T * sp + ph; const [x, z] = at(a); const [x2, z2] = at(a + Math.sign(sp) * 0.01);
      c.position.set(x, G(x, z) + 12, z); c.rotation.y = Math.atan2(-(x2 - x), -(z2 - z));
      c.visible = on > 0.01; c.material.opacity = on; c.scale.setScalar(Math.max(0.01, on));
      const tl = c.userData.trail; tl.visible = on > 0.01; tl.material.opacity = on;
      const arr = tl.geometry.attributes.position.array;
      for (let q = 0; q < 40; q++) { const [tx, tz] = at(a - Math.sign(sp) * q * 0.022); arr[q * 3] = tx; arr[q * 3 + 1] = G(tx, tz) + 11; arr[q * 3 + 2] = tz; }
      tl.geometry.attributes.position.needsUpdate = true;
    };
    const inMulti = keyed(v, [[S[13] + 100, 0], [S[14] - 60, 1]]);
    cp(0, R1.x, R1.z, 70, 0.22, 0, chevOn * (1 - inMulti * 0));
    cp(1, R1.x + 10, R1.z + 10, 110, -0.16, 2, chevOn);
    cp(2, R2.x, R2.z, 60, 0.25, 1, keyed(v, [[S[11] + 60, 0], [S[12] - 60, 1]]));
    cp(3, R1.x - 330, R1.z - 30, 80, 0.2, 3, keyed(v, [[S[10] + 250, 0], [S[11] - 20, 1]]));
    [[-360, -380], [620, -330], [-420, 330], [700, 290], [170, 440]].forEach(([x, z], k) => cp(4 + k, x, z, 70, 0.18 * (k % 2 ? 1 : -1), k, inMulti));

    /* ---- mix + fade ---- */
    const mix = keyed(v, [[S[3] + 150, 0], [S[4] - 150, 1], [S[4] + 150, 1], [S[5] - 150, 0], [S[7] + 150, 0], [S[8] - 150, 1]]);
    const fade = keyed(v, [[S[14] + 40, 0], [S[15], 1]]);
    compU.uMix.value = mix; compU.uFade.value = fade; compU.uTime.value = T; compU.uDir.value = v > S[4] && v < S[5] ? -1 : 1;
    state.mix = mix;

    /* ---- DOM projections ---- */
    const d0 = drones[0];
    for (const k in d0.userData.anchors) out.callouts[k] = project(d0.localToWorld(d0.userData.anchors[k].clone()), camA);
    out.droneTags = drones.map((d) => project(d.localToWorld(new THREE.Vector3(0, 0.8, 0.8)), camA));
    out.detect = detPts.map((p) => project(p, camA));
    out.chips = {
      r1: project(regions.r1.userData.anchor, camB),
      r2: project(regions.r2.userData.anchor, camB),
    };
    out.multi = ['r0', 'r3', 'r4', 'r5', 'r6'].map((k) => project(regions[k].userData.anchor, camB));
    const rp = regions.r1.userData.pts;
    out.svc = [4, 14, 27, 40, 53].map((i) => { const [x, z] = rp[i % rp.length]; return project(new THREE.Vector3(x * 1.08, G(x, z) + 9, z * 1.08), camB); });
    out.mix = mix; out.fade = fade;
    return out;
  }

  function render(viewList) {
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    const fade = compU.uFade.value;
    if (fade < 0.999) {
      const mix = compU.uMix.value;
      if (mix < 0.999) { renderer.setRenderTarget(rtA); renderer.render(sceneA, camA); }
      if (mix > 0.001) { renderer.setRenderTarget(rtB); renderer.render(sceneB, camB); }
      renderer.setRenderTarget(null);
      renderer.render(compScene, compCam);
    } else {
      renderer.setRenderTarget(null); renderer.clear();
    }
    // tail views (scissored)
    if (viewList && viewList.length) {
      renderer.autoClear = false;
      renderer.setScissorTest(true);
      for (const vw of viewList) {
        const { rect, name, progress } = vw;
        if (rect.bottom < 0 || rect.top > state.h || rect.width < 2) continue;
        const y = state.h - rect.bottom;
        renderer.setViewport(rect.left, y, rect.width, rect.height);
        renderer.setScissor(rect.left, y, rect.width, rect.height);
        renderer.clearDepth();
        getViews()[name].render(renderer, rect, progress, state.time, state.pointerS);
      }
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, state.w, state.h);
    }
  }

  // bake presets for use-case card imagery
  state.bakeNoMist = 0; state.bakeFire = 0; state.bakeNight = 0;
  function bake(name) {
    const U = terrain.uniforms;
    state.thermalT = 0; U.uShadow.value = 0.25;
    if (name === 'wildfire') {
      U.uSunDir.value.set(0.9, 0.2, -0.3).normalize(); U.uSunCol.value.setRGB(2.6, 1.25, 0.55); U.uAmb.value.setRGB(0.3, 0.18, 0.15); U.uFogCol.value.setRGB(0.62, 0.36, 0.24); U.uFogDen.value = 0.0021;
      sceneA.background = new THREE.Color(0.62, 0.36, 0.24);
      state.bakeFire = 1; townGroup.visible = false;
      { const cp = V(HOT.x - 120, hotY + 150, HOT.z + 120), tg = V(HOT.x, hotY + 20, HOT.z);
        const dp = cp.clone().lerp(tg, 0.13).add(V(4, -6, 0));
        state.fixed = { cam: { p: cp, t: tg }, d: [dp, [-0.8, -0.35, 0.3]], d2: [cp.clone().lerp(tg, 0.45).add(V(40, 10, 0)), [-0.8, -0.2, 0.25]] }; }
    } else if (name === 'border') {
      U.uDesert.value = 1; U.uSunDir.value.set(-0.6, 0.6, 0.35).normalize(); U.uSunCol.value.setRGB(1.6, 1.42, 1.2); U.uAmb.value.setRGB(0.2, 0.2, 0.22); U.uFogCol.value.setRGB(0.5, 0.44, 0.38); U.uFogDen.value = 0.0006; state.bakeNoMist = 1;
      state.fixed = { cam: { p: V(-500, 560, -200), t: V(-500, 30, -230) }, d: [V(-515, 400, -240), [0.4, 0, 0]], d2: [V(-470, 410, -200), [0.4, 0, 0]], d3: [V(-540, 390, -170), [0.4, 0, 0]] };
    } else if (name === 'grid') {
      state.bakeNight = 1; U.uNight.value = 0.9; U.uSunDir.value.set(0.4, 0.3, -0.8).normalize(); U.uSunCol.value.setRGB(0.9, 0.7, 0.8); U.uFogCol.value.setRGB(0.07, 0.09, 0.17); U.uFogDen.value = 0.0018; state.bakeNoMist = 1;
      sceneA.background = new THREE.Color(0.07, 0.09, 0.17);
      hemiA.intensity = 0.12; sun.intensity = 0.25; townGroup.userData.mat.color.setRGB(0.35, 0.33, 0.3); townGroup.userData.mat.emissive.setRGB(0.05, 0.035, 0.02); townGroup.userData.road.color.setRGB(0.06, 0.055, 0.05);
      state.fixed = { cam: { p: V(TOWN.x - 70, 175, TOWN.z + 85), t: V(TOWN.x + 5, 30, TOWN.z - 5) }, d: [V(TOWN.x - 48, 150, TOWN.z + 58), [-0.8, 0.25, 0.2]] };
    }
    const f = state.fixed;
    camA.position.copy(f.cam.p); camA.up.set(0, 1, 0); camA.lookAt(f.cam.t); camA.fov = 40; camA.aspect = state.w / state.h; camA.updateProjectionMatrix();
    drones.forEach((d) => (d.visible = false));
    const place = (d, a) => { if (!a) return; d.visible = true; d.scale.setScalar(1); d.position.copy(a[0]); d.rotation.set(a[1][1], a[1][0], a[1][2], 'YXZ'); };
    place(drones[0], f.d); place(drones[1], f.d2); place(drones[2], f.d3);
    terrain.uniforms.uHotAmt.value = state.bakeFire;
    flames.forEach((fl) => (fl.material.opacity = state.bakeFire * 0.9));
    smoke.forEach((s) => { const ph = s.userData.ph; s.position.set(s.userData.dx * 2 + ph * 70, 6 + ph * 110, s.userData.dz * 2 - ph * 50); const sc = 30 + ph * 120; s.scale.set(sc, sc, 1); s.material.color.setRGB(0.45, 0.4, 0.38); s.material.opacity = state.bakeFire * 0.8 * Math.sin(ph * Math.PI); });
    flames.forEach((fl) => fl.scale.setScalar(18 + Math.random() * 16));
    mists.forEach((m) => (m.material.opacity = m.userData.o * (1 - state.bakeNoMist)));
    townGroup.userData.lights.material.opacity = state.bakeNight;
    renderer.setRenderTarget(null); renderer.render(sceneA, camA);
  }

  function setPixelRatio(pr) { renderer.setPixelRatio(pr); resize(state.w, state.h); }
  // Upload the big maps before the first draw so that frame is not also a texture stall.
  for (const tex of [terrain.uniforms.tAlb.value, terrain.uniforms.tLight.value, terrain.uniforms.tNrm.value, decalTex, cloudTex]) {
    if (tex) renderer.initTexture(tex);
  }
  // Program cache key includes the bound target. Scene A/B are only ever drawn into half-float
  // targets (no tone mapping, linear output). Compiling with the screen target builds variants
  // the first frame cannot reuse.
  try {
    renderer.setRenderTarget(rtA);
    const compileA = renderer.compileAsync(sceneA, camA);
    renderer.setRenderTarget(rtB);
    const compileB = renderer.compileAsync(sceneB, camB);
    renderer.setRenderTarget(null);
    const compileC = renderer.compileAsync(compScene, compCam);
    await Promise.all([compileA, compileB, compileC]);
  } catch (_) { /* older drivers: compile on first draw */ }
  renderer.setRenderTarget(null);
  stage('compile');
  onProgress(1);
  return { renderer, update, render, resize, state, project, bake, keysA, getViews, setPixelRatio, perf: perf ? { stages, programs: () => renderer.info.programs.length } : null };
}

/* ------------------------------------------------------------ tail views */
function makeViews(env) {
  const views = {};

  // Globe
  {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100); cam.position.set(0, 0.25, 4.4); cam.lookAt(0, 0, 0);
    const globe = new THREE.Group(); scene.add(globe);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vP; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vP = position; vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: /* glsl */`
        varying vec3 vN; varying vec3 vP; varying vec3 vV;
        ${GLSL_NOISE}
        float land(vec3 p){ return fbm4(p.xy*1.35 + p.z*.9) + .55*snoise(p.yz*2.1+p.x) - .08; }
        void main(){
          vec3 p = normalize(vP);
          float l = land(p);
          float fw = fwidth(l);
          float isLand = smoothstep(-fw, fw, l);
          float coast = 1. - smoothstep(0., fw*1.6, abs(l));
          float lat = asin(p.y), lon = atan(p.z, p.x);
          vec2 g = vec2(lon, lat) / (3.14159/12.);
          vec2 gf = abs(fract(g-.5)-.5)/fwidth(g);
          float grid = 1. - min(min(gf.x, gf.y), 1.);
          float fres = pow(1. - max(dot(vN, vV), 0.), 2.5);
          float light = .35 + .65*max(dot(vN, normalize(vec3(-.4,.6,.7))),0.);
          vec3 c = mix(vec3(.018), vec3(.07,.075,.08), isLand) * light;
          c += coast * .22 + grid * .13 * (1.-isLand*.3);
          c += fres * vec3(.35,.4,.45);
          gl_FragColor = vec4(c, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    globe.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat));
    // arcs + event dots
    const toV = (lat, lon, r = 1) => { const la = THREE.MathUtils.degToRad(lat), lo = THREE.MathUtils.degToRad(lon); return new THREE.Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, Math.cos(la) * Math.sin(lo) * r); };
    const events = [[34, -112], [41, -95], [47, -121], [38, -106], [30, -97], [36, -119]];
    const hub = toV(39, -104, 1.001);
    const arcs = []; const dots = [];
    events.forEach(([la, lo], k) => {
      const e = toV(la, lo, 1.002);
      const mid = hub.clone().add(e).multiplyScalar(0.5).normalize().multiplyScalar(1.12 + k * 0.01);
      const curve = new THREE.QuadraticBezierCurve3(hub, mid, e);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(60));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7aebff, transparent: true, opacity: 0.8 }));
      globe.add(line); arcs.push(line);
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: 0x7aebff })); dot.position.copy(e); globe.add(dot); dots.push(dot);
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 32), new THREE.ShaderMaterial({ transparent: true, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(dot(vN, vV),0.), 3.); gl_FragColor = vec4(vec3(.5,.6,.7)*f*.25, 1.); }' }));
    scene.add(halo);
    const proj = new THREE.Vector3();
    views.globe = {
      scene, cam, globe, dots,
      render(renderer, rect, p, T) {
        cam.aspect = rect.width / rect.height; cam.updateProjectionMatrix();
        globe.rotation.y = 2.35 + p * 0.9 + T * 0.01; globe.rotation.x = 0.3;
        arcs.forEach((a, k) => { const n = a.geometry.attributes.position.count; a.geometry.setDrawRange(0, Math.floor(n * clamp01(p * 2.2 - k * 0.12))); });
        renderer.render(scene, cam);
      },
      labelPositions(rect) {
        return dots.map((d) => { d.getWorldPosition(proj); const facing = proj.clone().normalize().dot(cam.position.clone().normalize()) > 0.15; proj.project(cam); return { x: rect.left + (proj.x * 0.5 + 0.5) * rect.width, y: rect.top + (-proj.y * 0.5 + 0.5) * rect.height, vis: facing }; });
      },
    };
  }

  // Autonomy close-up: rear three-quarter hero shot, dark studio, fine dot floor
  {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 400);
    const drone = makeDrone({ env }); scene.add(drone);
    drone.userData.glow.visible = false;
    drone.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { if ('envMapIntensity' in m) m.envMapIntensity = 0.35; }); });
    scene.add(new THREE.HemisphereLight(0x8c96a4, 0x050505, 0.35));
    const key = new THREE.DirectionalLight(0xfff1e0, 3.4); key.position.set(-5, 9, -7); scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 3.2); rim.position.set(9, 2.5, 5); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-8, 1, 9); scene.add(fill);
    // nozzle heat: faint warm disc inside the exhaust
    const heat = new THREE.Mesh(new THREE.CircleGeometry(0.36, 32), new THREE.MeshBasicMaterial({ color: 0x4a2a18 }));
    heat.position.set(0, 0.5, 3.31); drone.children[0].add(heat);
    const floorMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
      fragmentShader: `varying vec3 vW;
        void main(){
          vec2 g = vW.xz / 1.6; vec2 q = (g - floor(g + .5)) * 1.6;
          float px = length(fwidth(g)) * 1.6;
          float dotv = 1. - smoothstep(.045, .045 + px, length(q));
          vec2 f = abs(fract(g - .5) - .5) / max(fwidth(g), 1e-4);
          float line = (1. - min(min(f.x, f.y), 1.)) * .25;
          float fade = 1. - smoothstep(4., 26., length(vW.xz - vec2(0., -2.)));
          gl_FragColor = vec4(vec3(1.), (dotv * .5 + line * .12) * fade);
        }`,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), floorMat); floor.position.y = -3.2; scene.add(floor);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(0,0,0,.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
    shadow.position.y = -3.18; shadow.scale.set(1.4, 1, 1); scene.add(shadow);
    const aim = new THREE.Vector3(), right = new THREE.Vector3();
    views.auto = {
      scene, cam,
      render(renderer, rect, p, T, ptr) {
        cam.aspect = rect.width / rect.height;
        const narrow = cam.aspect < 1;
        // keep the horizontal field of view fixed (~38°) so framing is the same whatever the section height
        cam.fov = narrow ? 34 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) / cam.aspect)); cam.updateProjectionMatrix();
        const e = ease(clamp01(p));
        drone.rotation.set(0.04 + Math.sin(T * 0.6) * 0.01, 0.95 - e * 0.45 + ptr.x * 0.04, -0.2 + Math.sin(T * 0.45) * 0.02, 'YXZ');
        drone.position.set(0, Math.sin(T * 0.8) * 0.07, 0);
        cam.position.set(-11 + e * 2.5, 15.5 - e * 2, 19.5 - e * 2.5).multiplyScalar(narrow ? 1.3 : 1);
        aim.set(0.2, -0.6, -0.4);
        // push the aircraft into the left part of the frame on wide screens
        if (!narrow) { right.subVectors(aim, cam.position).cross(cam.up).normalize(); aim.addScaledVector(right, 3.4); }
        cam.lookAt(aim);
        renderer.render(scene, cam);
      },
    };
  }

  // Landing (founders -> footer)
  {
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(28, 1, 0.1, 600);
    const drone = makeDrone({ env, legs: true }); scene.add(drone);
    drone.userData.glow.visible = false;
    scene.add(new THREE.HemisphereLight(0xb8c0cc, 0x0a0a0a, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-4, 10, 8); scene.add(key);
    const rim = new THREE.DirectionalLight(0xa9c1ff, 1.6); rim.position.set(5, 3, -8); scene.add(rim);
    // Same directional-light count as the close-up, so the aircraft programs are reused. Intensity 0 adds no light.
    scene.add(new THREE.DirectionalLight(0x000000, 0));
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(7, 48), new THREE.MeshBasicMaterial({ map: glowTexture('rgba(0,0,0,.9)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
    const floorMat = gridMaterial(); floorMat.uniforms.uRad.value = 70;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), floorMat); floor.rotation.x = 0; floor.position.y = -0.02; floor.geometry.rotateX(-Math.PI / 2); floor.scale.setScalar(0.18); scene.add(floor);
    views.land = {
      scene, cam,
      render(renderer, rect, p, T) {
        cam.aspect = rect.width / rect.height; cam.updateProjectionMatrix();
        // p: 0 = drone high above (over founders), 1 = landed in footer
        const e = ease(clamp01(p));
        const baseY = 5.4; // tail-sitter: nose up, feet on ground
        drone.rotation.set(Math.PI / 2 - 0.03, 0.4 - e * 0.4 + Math.sin(T * 0.4) * 0.03 * (1 - e), 0, 'YXZ');
        drone.position.set(0, baseY + (1 - e) * 52 + Math.sin(T * 1.2) * 0.15 * (1 - e), 0);
        shadow.material.opacity = 0.15 + e * 0.85; shadow.scale.setScalar(1.8 - e * 0.8);
        const mob = rect.width < 768 ? 1.5 : 1;
        cam.position.set(0, 26, 96 * mob); cam.lookAt(0, 18.5, 0);
        renderer.render(scene, cam);
      },
    };
  }
  views.compile = (gl) => {
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(null);
    gl.compile(views.globe.scene, views.globe.cam);
    gl.compile(views.auto.scene, views.auto.cam);
    gl.compile(views.land.scene, views.land.cam);
    gl.setRenderTarget(prev);
  };
  return views;
}
