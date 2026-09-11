import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Points,
  ShaderMaterial,
  ShadowMaterial,
  SphereGeometry,
  TorusGeometry,
  UniformsLib,
  UniformsUtils,
} from 'three'
import { THEMES } from '../themes.js'
import { disposeTree, hdr } from './kit.js'

// The world around the arena: sky, floor, walls, props, weather and light.
// Built fresh for each sector's theme; gameplay never touches it.

const PATTERN = { grid: 0, hex: 1, circuit: 2, tiles: 3, caustic: 4, synth: 5, dunes: 6, squares: 7, stars: 8, lava: 9 }

// Seeded, so a world looks the same every time you enter it.
function seeded(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

const FLOOR_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`

const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uBase;
  uniform vec3 uLine;
  uniform vec3 uAccent;
  uniform float uLineAlpha;
  uniform float uTime;
  uniform vec2 uHalf;
  uniform vec3 uCore;
  uniform float uPulse;
  uniform float uReveal;
  uniform int uPattern;
  uniform float uLight;
  varying vec3 vWorld;
  #include <common>
  #include <fog_pars_fragment>

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  vec2 hash22(vec2 p) {
    vec3 a = fract(p.xyx * vec3(123.34, 234.34, 345.65));
    a += dot(a, a + 34.45);
    return fract(vec2(a.x * a.y, a.y * a.z));
  }
  // The max() guards matter: where the derivative is zero the division would
  // be 0/0, and a single NaN pixel blooms into a black screen.
  float line1D(float v, float scale, float width) {
    float c = v / scale;
    float g = abs(fract(c - 0.5) - 0.5) / max(fwidth(c) * width, 1e-5);
    return 1.0 - min(g, 1.0);
  }
  float gridAA(vec2 p, float scale, float width) {
    vec2 c = p / scale;
    vec2 g = abs(fract(c - 0.5) - 0.5) / max(fwidth(c) * width, vec2(1e-5));
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  float hexLines(vec2 p, float scale) {
    vec2 uv = p / scale;
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    vec2 q = abs(gv);
    float d = max(dot(q, normalize(r)), q.x);
    float w = fwidth(d) * 1.5;
    return 1.0 - smoothstep(0.0, w + 0.012, abs(d - 0.5));
  }
  float circuit(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float h = hash21(cell);
    float w = fwidth(p.x) * 1.4 + 0.02;
    float line = 0.0;
    if (h < 0.34) line = 1.0 - smoothstep(0.0, w, abs(f.y - 0.5));
    else if (h < 0.68) line = 1.0 - smoothstep(0.0, w, abs(f.x - 0.5));
    float node = 1.0 - smoothstep(0.07, 0.07 + w, length(f - 0.5));
    return max(line * 0.75, node * step(0.8, h));
  }
  float tiles(vec2 p) {
    vec2 c = p / 2.0;
    vec2 f = abs(fract(c) - 0.5);
    float w = fwidth(c.x) * 1.5;
    return smoothstep(0.5 - w - 0.018, 0.5, max(f.x, f.y));
  }
  float caustic(vec2 p, float t) {
    vec2 i = p;
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < 4; n++) {
      float tt = t * (1.0 - (3.5 / float(n + 1)));
      i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
    }
    c /= 4.0;
    c = 1.17 - pow(c, 1.4);
    return clamp(pow(abs(c), 8.0), 0.0, 1.0);
  }
  float dunes(vec2 p) {
    float s = sin(p.x * 0.9 + sin(p.y * 0.4) * 2.2 + p.y * 0.25);
    return (1.0 - smoothstep(0.0, fwidth(s) * 2.0 + 0.06, abs(s - 0.82))) * 0.8;
  }
  float stars(vec2 p) {
    vec2 q = p * 1.4;
    vec2 c = floor(q);
    float h = hash21(c);
    vec2 f = fract(q) - 0.5 - (hash22(c + 3.1) - 0.5) * 0.6;
    float s = step(0.9, h) * (1.0 - smoothstep(0.0, 0.07, length(f)));
    return s * (0.45 + 0.55 * sin(uTime * (1.0 + h * 3.0) + h * 40.0));
  }
  float lava(vec2 p, float t) {
    vec2 uv = p * 0.55;
    vec2 cell = floor(uv);
    vec2 f = fract(uv);
    float d1 = 8.0;
    float d2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 o = vec2(float(x), float(y));
        vec2 r = o + hash22(cell + o) - f;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
      }
    }
    float edge = sqrt(d2) - sqrt(d1);
    float glow = 1.0 - smoothstep(0.0, 0.11, edge);
    return glow * (0.6 + 0.4 * sin(t * 1.7 + p.x * 0.7 + p.y * 0.5));
  }

  void main() {
    vec2 p = vWorld.xz;
    vec2 q = abs(p) - uHalf;
    float outside = max(q.x, q.y);
    float inside = 1.0 - step(0.0, outside);
    float distC = length(p);
    float rv = 1.0 - smoothstep(uReveal * 30.0 - 3.0, uReveal * 30.0, distC);

    // A pool of light in the middle - except in a white world, where it would
    // push the floor over the bloom threshold and haze everything.
    vec3 col = uBase * mix(1.0, uLight > 0.5 ? 1.03 : 1.45, exp(-distC * 0.05));

    float minor = gridAA(p, 1.0, 1.0) * 0.5;
    float major = gridAA(p, 4.0, 1.4);
    float lines = max(minor, major) * inside;

    float pat = 0.0;
    float glow = 0.0;
    if (uPattern == 1) pat = hexLines(p, 1.2);
    else if (uPattern == 2) pat = circuit(p * 0.8);
    else if (uPattern == 3) { pat = tiles(p); col *= 0.86 + 0.28 * hash21(floor(p / 2.0)); }
    // The caustic formula needs coordinates far from zero, or it saturates.
    else if (uPattern == 4) glow = caustic(p * 0.45 - 250.0, uTime * 0.45) * 0.8;
    else if (uPattern == 5) { pat = max(line1D(p.x, 1.5, 1.3), line1D(p.y + uTime * 1.2, 1.5, 1.3)); lines *= 0.25; }
    else if (uPattern == 6) pat = dunes(p);
    else if (uPattern == 7) pat = line1D(max(abs(p.x), abs(p.y)), 1.5, 1.2);
    else if (uPattern == 8) glow = stars(p);
    // Kept dimmer than the orange bullets, which must win against the floor.
    else if (uPattern == 9) glow = lava(p, uTime) * 0.75;
    pat *= inside;
    glow *= inside + (1.0 - inside) * 0.35;

    float far = gridAA(p, 4.0, 1.2) * (1.0 - inside) * 0.55;
    float mixL = clamp((lines + pat * 0.85) * uLineAlpha * 2.3 + far * uLineAlpha, 0.0, 1.0) * rv;
    if (uLight > 0.5) col = mix(col, uLine, mixL);
    else col += uLine * mixL;
    col += uAccent * glow * rv * (uLight > 0.5 ? 0.5 : 1.25);

    float bw = fwidth(outside) * 1.5;
    float border = 1.0 - smoothstep(0.0, bw + 0.03, abs(outside));
    col += uAccent * border * (uLight > 0.5 ? 0.8 : 1.8) * rv;
    col += uAccent * exp(-abs(outside) * 3.0) * 0.12 * inside * rv;
    col *= mix(1.0, 0.55, smoothstep(0.0, 3.0, outside));

    float dc = length(p - uCore.xy);
    col += uAccent * uCore.z * 0.5 * exp(-dc * 0.8);
    float ring = exp(-abs(dc - uPulse * 9.0) * 3.0) * max(0.0, 1.0 - uPulse * 0.6);
    col += uAccent * ring * 0.9 * inside;

    gl_FragColor = vec4(col, 1.0);
    #include <fog_fragment>
  }
`

function buildFloor(theme, W, D) {
  const uniforms = UniformsUtils.merge([
    UniformsLib.fog,
    {
      uBase: { value: new Color(theme.floor.base) },
      uLine: { value: new Color(theme.floor.line) },
      uAccent: { value: new Color(theme.floor.accent) },
      uLineAlpha: { value: theme.floor.lineAlpha },
      uTime: { value: 0 },
      uHalf: { value: { x: W / 2, y: D / 2 } },
      uCore: { value: { x: 0, y: 0, z: 0 } },
      uPulse: { value: 99 },
      uReveal: { value: 1 },
      uPattern: { value: PATTERN[theme.floor.pattern] ?? 0 },
      uLight: { value: theme.light2 ? 1 : 0 },
    },
  ])
  const mat = new ShaderMaterial({ uniforms, vertexShader: FLOOR_VERT, fragmentShader: FLOOR_FRAG, fog: true })
  const floor = new Mesh(new PlaneGeometry(W + 140, D + 140).rotateX(-Math.PI / 2), mat)
  floor.position.y = -0.002

  // Shadows land on a transparent catcher just above the shader floor.
  const catcher = new Mesh(
    new PlaneGeometry(W + 6, D + 6).rotateX(-Math.PI / 2),
    new ShadowMaterial({ opacity: theme.light2 ? 0.16 : 0.42, depthWrite: false }),
  )
  catcher.receiveShadow = true
  catcher.position.y = 0.003
  return { floor, catcher, uniforms }
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform float uTime;
  uniform int uSun;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(uHorizon, uTop, smoothstep(-0.02, 0.5, h));
    col += uHorizon * 0.3 * exp(-abs(h) * 12.0);
    if (uSun == 1) {
      // Straight up or down would make both atan arguments zero.
      float az = (abs(d.x) < 1e-5 && abs(d.z) < 1e-5) ? 0.0 : atan(d.x, -d.z);
      vec2 sp = vec2(az, h);
      float r = length(sp - vec2(0.0, 0.16));
      float disc = smoothstep(0.34, 0.33, r);
      float band = step(0.45, fract((sp.y - 0.16) * 22.0 - uTime * 0.25));
      float cut = mix(1.0, band, smoothstep(0.18, 0.0, sp.y - 0.02));
      vec3 sun = mix(vec3(1.0, 0.25, 0.65), vec3(1.0, 0.85, 0.35), smoothstep(0.0, 0.46, sp.y));
      col = mix(col, sun * 1.6, disc * cut);
      col += vec3(1.0, 0.3, 0.7) * 0.25 * exp(-r * 4.0);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`

function buildSky(theme) {
  const mat = new ShaderMaterial({
    uniforms: {
      uTop: { value: new Color(theme.sky[0]) },
      uHorizon: { value: new Color(theme.sky[1]) },
      uTime: { value: 0 },
      uSun: { value: theme.props === 'sun' ? 1 : 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
    fog: false,
  })
  const sky = new Mesh(new SphereGeometry(300, 32, 16), mat)
  sky.renderOrder = -10
  return { sky, uniforms: mat.uniforms }
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

const PARTICLES = {
  dust: { vel: [0.05, 0.08, 0.02], jit: [0.15, 0.06, 0.15], size: 2.2, sway: 0.4, shape: 0, add: true, k: 1 },
  snow: { vel: [0.25, -0.75, 0.1], jit: [0.2, 0.25, 0.2], size: 2.8, sway: 0.8, shape: 0, add: false, k: 1.1 },
  spores: { vel: [0, 0.35, 0], jit: [0.1, 0.2, 0.1], size: 3.2, sway: 0.6, shape: 0, add: true, k: 2 },
  embers: { vel: [0.1, 0.95, 0], jit: [0.2, 0.5, 0.2], size: 2.4, sway: 0.5, shape: 2, add: true, k: 2.6 },
  bubbles: { vel: [0, 0.6, 0], jit: [0.05, 0.3, 0.05], size: 4.6, sway: 0.35, shape: 1, add: true, k: 1.2 },
  sparks: { vel: [0, 1.4, 0], jit: [0.3, 0.8, 0.3], size: 2, sway: 0.2, shape: 2, add: true, k: 2.8 },
  sand: { vel: [2.2, -0.05, 0.3], jit: [0.8, 0.05, 0.3], size: 1.8, sway: 0.2, shape: 2, add: false, k: 1 },
  ash: { vel: [0.15, -0.35, 0], jit: [0.2, 0.1, 0.2], size: 2.4, sway: 0.6, shape: 2, add: false, k: 1 },
  motes: { vel: [0.05, 0.15, 0.02], jit: [0.1, 0.1, 0.1], size: 3.4, sway: 0.9, shape: 0, add: true, k: 2.2 },
}

const PART_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform vec3 uBox;
  uniform float uPixelRatio;
  uniform float uSway;
  attribute vec3 aVel;
  attribute float aPhase;
  varying float vAlpha;
  void main() {
    vec3 p = position + aVel * uTime;
    p.x += sin(uTime * 0.8 + aPhase * 6.283) * uSway;
    p.z += cos(uTime * 0.6 + aPhase * 4.0) * uSway * 0.6;
    p.x = mod(p.x + uBox.x * 0.5, uBox.x) - uBox.x * 0.5;
    p.z = mod(p.z + uBox.z * 0.5, uBox.z) - uBox.z * 0.5;
    p.y = mod(p.y, uBox.y);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float fade = smoothstep(0.0, 0.8, p.y) * (1.0 - smoothstep(uBox.y - 1.5, uBox.y, p.y));
    vAlpha = fade * (0.55 + 0.45 * sin(uTime * (1.0 + aPhase * 2.0) + aPhase * 30.0));
    gl_PointSize = uSize * (0.6 + aPhase * 0.8) * uPixelRatio * (24.0 / max(1.0, -mv.z));
  }
`
const PART_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform int uShape;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a;
    if (uShape == 1) a = smoothstep(0.5, 0.4, d) * smoothstep(0.2, 0.34, d) + smoothstep(0.5, 0.0, d) * 0.12;
    else if (uShape == 2) a = smoothstep(0.5, 0.18, d);
    else a = smoothstep(0.5, 0.0, d);
    a *= vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

function buildParticles(theme, W, D, rnd) {
  const kind = PARTICLES[theme.particles.kind] || PARTICLES.dust
  const n = theme.particles.count
  const box = [W + 16, 9, D + 16]
  const pos = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const phase = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rnd() - 0.5) * box[0]
    pos[i * 3 + 1] = rnd() * box[1]
    pos[i * 3 + 2] = (rnd() - 0.5) * box[2]
    for (let k = 0; k < 3; k++) vel[i * 3 + k] = kind.vel[k] + (rnd() - 0.5) * 2 * kind.jit[k]
    phase[i] = rnd()
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setAttribute('aVel', new Float32BufferAttribute(vel, 3))
  geo.setAttribute('aPhase', new Float32BufferAttribute(phase, 1))
  const mat = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: kind.size },
      uBox: { value: { x: box[0], y: box[1], z: box[2] } },
      uPixelRatio: { value: 1 },
      uSway: { value: kind.sway },
      uColor: { value: hdr(theme.particles.color, theme.light2 ? 1 : kind.k) },
      uShape: { value: kind.shape },
    },
    vertexShader: PART_VERT,
    fragmentShader: PART_FRAG,
    transparent: true,
    depthWrite: false,
    blending: kind.add && !theme.light2 ? AdditiveBlending : NormalBlending,
    toneMapped: false,
  })
  const points = new Points(geo, mat)
  points.frustumCulled = false
  return { points, uniforms: mat.uniforms }
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

function buildWalls(W, D, mats) {
  const g = new Group()
  const t = 0.26
  const h = 0.55
  const edge = new LineBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35 })
  edge.userData.owned = true
  const segs = [
    [0, -D / 2 - t / 2, W + t * 2, t],
    [0, D / 2 + t / 2, W + t * 2, t],
    [-W / 2 - t / 2, 0, t, D],
    [W / 2 + t / 2, 0, t, D],
  ]
  for (const [x, z, sx, sz] of segs) {
    const geo = new BoxGeometry(sx, h, sz)
    const m = new Mesh(geo, mats.wall)
    m.position.set(x, h / 2, z)
    m.castShadow = true
    m.receiveShadow = true
    m.add(new LineSegments(new EdgesGeometry(geo), edge))
    g.add(m)
    // A glowing strip along the inner top edge.
    const inward = Math.abs(x) > Math.abs(z) ? [-Math.sign(x) * (t / 2 - 0.03), 0] : [0, -Math.sign(z) * (t / 2 - 0.03)]
    const strip = new Mesh(new BoxGeometry(sx === t ? 0.05 : sx, 0.05, sz === t ? 0.05 : sz), mats.wallTrim)
    strip.position.set(x + inward[0], h + 0.01, z + inward[1])
    g.add(strip)
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const geo = new BoxGeometry(0.7, 1.5, 0.7)
      const m = new Mesh(geo, mats.wall)
      m.position.set(sx * (W / 2 + 0.35), 0.75, sz * (D / 2 + 0.35))
      m.castShadow = true
      m.add(new LineSegments(new EdgesGeometry(geo), edge))
      const cap = new Mesh(new BoxGeometry(0.44, 0.08, 0.44), mats.wallTrim)
      cap.position.y = 0.79
      m.add(cap)
      g.add(m)
    }
  }
  return g
}

// ---------------------------------------------------------------------------
// Props: what stands around each world, outside the play area
// ---------------------------------------------------------------------------

// A spot outside the arena. Never on the near side: the camera looks in from
// there, and anything standing in between would block the view.
function ringSpot(rnd, W, D, near = 3, far = 22) {
  for (;;) {
    const x = (rnd() * 2 - 1) * (W / 2 + far)
    const z = (rnd() * 2 - 1) * (D / 2 + far)
    if (z > D / 2 - 1) continue
    if (Math.abs(x) > W / 2 + near || Math.abs(z) > D / 2 + near) return [x, z]
  }
}

function own(mat) {
  mat.userData.owned = true
  return mat
}

const PROPS = {
  cubes(theme, W, D, rnd) {
    const g = new Group()
    const edgeMat = own(new LineBasicMaterial({ color: hdr(theme.floor.line, 1.1), transparent: true, opacity: 0.4, toneMapped: false }))
    const box = new EdgesGeometry(new BoxGeometry(1, 1, 1))
    const spinners = []
    for (let i = 0; i < 26; i++) {
      const m = new LineSegments(box, edgeMat)
      const [x, z] = ringSpot(rnd, W, D, 2.5, 16)
      m.position.set(x, 0.6 + rnd() * 5, z)
      m.scale.setScalar(0.4 + rnd() * 1.5)
      m.rotation.set(rnd() * 3, rnd() * 3, 0)
      m.userData.spin = (rnd() - 0.5) * 0.6
      m.userData.base = m.position.y
      spinners.push(m)
      g.add(m)
    }
    const pillarMat = own(new MeshStandardMaterial({ color: '#1b1914', roughness: 0.7 }))
    const stripeMat = own(new MeshBasicMaterial({ color: hdr(theme.floor.accent, 2), toneMapped: false }))
    for (let i = 0; i < 12; i++) {
      const h = 4 + rnd() * 9
      const p = new Mesh(new BoxGeometry(0.5, h, 0.5), pillarMat)
      const [x, z] = ringSpot(rnd, W, D, 7, 26)
      p.position.set(x, h / 2, z)
      const s = new Mesh(new BoxGeometry(0.52, 0.12, 0.52), stripeMat)
      s.position.y = h * (rnd() * 0.4)
      p.add(s)
      g.add(p)
    }
    return {
      group: g,
      update(t, dt) {
        for (const m of spinners) {
          m.rotation.x += m.userData.spin * dt
          m.rotation.y += m.userData.spin * 0.7 * dt
          m.position.y = m.userData.base + Math.sin(t * 0.5 + m.userData.spin * 10) * 0.25
        }
      },
    }
  },

  spires(theme, W, D, rnd, mats) {
    const g = new Group()
    for (let i = 0; i < 30; i++) {
      const h = 2.5 + rnd() * 8
      const r = 0.5 + rnd() * 1.1
      const m = new Mesh(new ConeGeometry(r, h, 6), mats.blockIce)
      const [x, z] = ringSpot(rnd, W, D, 2.5, 22)
      m.position.set(x, h / 2 - 0.2, z)
      m.rotation.set((rnd() - 0.5) * 0.25, rnd() * 3, (rnd() - 0.5) * 0.25)
      m.castShadow = true
      g.add(m)
    }
    const shards = []
    const edge = own(new LineBasicMaterial({ color: hdr(theme.floor.line, 1.4), transparent: true, opacity: 0.6, toneMapped: false }))
    const oct = new EdgesGeometry(new OctahedronGeometry(0.5))
    for (let i = 0; i < 16; i++) {
      const m = new LineSegments(oct, edge)
      const [x, z] = ringSpot(rnd, W, D, 2, 12)
      m.position.set(x, 1.5 + rnd() * 4, z)
      m.scale.set(0.5 + rnd(), 1.5 + rnd() * 2, 0.5 + rnd())
      m.userData.spin = (rnd() - 0.5) * 0.8
      shards.push(m)
      g.add(m)
    }
    return {
      group: g,
      update(t, dt) {
        for (const m of shards) m.rotation.y += m.userData.spin * dt
      },
    }
  },

  vats(theme, W, D, rnd) {
    const g = new Group()
    const body = own(new MeshStandardMaterial({ color: '#1a2610', roughness: 0.45, metalness: 0.6, flatShading: true }))
    const liquid = own(new MeshBasicMaterial({ color: hdr(theme.floor.accent, 2.2), toneMapped: false }))
    const ringMat = own(new MeshStandardMaterial({ color: '#2d3d1c', roughness: 0.4, metalness: 0.8 }))
    const tops = []
    for (let i = 0; i < 12; i++) {
      const r = 0.9 + rnd() * 0.9
      const h = 1.5 + rnd() * 3
      const m = new Mesh(new CylinderGeometry(r, r * 1.05, h, 14), body)
      const [x, z] = ringSpot(rnd, W, D, 3, 18)
      m.position.set(x, h / 2, z)
      m.castShadow = true
      const top = new Mesh(new CylinderGeometry(r * 0.88, r * 0.88, 0.06, 14), liquid)
      top.position.y = h / 2 + 0.01
      m.add(top)
      tops.push(top)
      for (let k = 0; k < 2; k++) {
        const band = new Mesh(new TorusGeometry(r * 1.04, 0.07, 6, 18), ringMat)
        band.rotation.x = Math.PI / 2
        band.position.y = -h / 2 + h * (0.3 + k * 0.4)
        m.add(band)
      }
      g.add(m)
    }
    return {
      group: g,
      update(t) {
        tops.forEach((m, i) => m.scale.setScalar(0.92 + Math.sin(t * 2 + i) * 0.06))
      },
    }
  },

  monoliths(theme, W, D, rnd) {
    const g = new Group()
    const stone = own(new MeshStandardMaterial({ color: '#140709', roughness: 0.2, metalness: 0.8, flatShading: true }))
    const edge = own(new LineBasicMaterial({ color: hdr(theme.floor.accent, 1.8), transparent: true, opacity: 0.7, toneMapped: false }))
    for (let i = 0; i < 24; i++) {
      const h = 4 + rnd() * 12
      const geo = new OctahedronGeometry(1, 0)
      geo.scale(0.6 + rnd() * 1.2, h / 2, 0.6 + rnd() * 1.2)
      const m = new Mesh(geo, stone)
      const [x, z] = ringSpot(rnd, W, D, 3, 24)
      m.position.set(x, h / 2 - 1, z)
      m.rotation.set((rnd() - 0.5) * 0.4, rnd() * 3, (rnd() - 0.5) * 0.4)
      m.castShadow = true
      m.add(new LineSegments(new EdgesGeometry(geo), edge))
      g.add(m)
    }
    return { group: g }
  },

  kelp(theme, W, D, rnd) {
    const g = new Group()
    const mat = own(
      new MeshStandardMaterial({
        color: '#0b3a3a',
        emissive: theme.floor.accent,
        emissiveIntensity: 0.25,
        roughness: 0.6,
        flatShading: true,
      }),
    )
    const tipMat = own(new MeshBasicMaterial({ color: hdr(theme.floor.accent, 2), toneMapped: false }))
    const strands = []
    for (let i = 0; i < 44; i++) {
      const h = 3 + rnd() * 7
      const pivot = new Group()
      const [x, z] = ringSpot(rnd, W, D, 2.2, 18)
      pivot.position.set(x, 0, z)
      const m = new Mesh(new ConeGeometry(0.16 + rnd() * 0.12, h, 5), mat)
      m.position.y = h / 2
      pivot.add(m)
      const tip = new Mesh(new SphereGeometry(0.12, 6, 4), tipMat)
      tip.position.y = h
      pivot.add(tip)
      pivot.userData.phase = rnd() * 6
      strands.push(pivot)
      g.add(pivot)
    }
    const rock = own(new MeshStandardMaterial({ color: '#05141d', roughness: 0.9, flatShading: true }))
    for (let i = 0; i < 5; i++) {
      const arch = new Mesh(new TorusGeometry(3 + rnd() * 2, 0.7, 6, 14, Math.PI), rock)
      const [x, z] = ringSpot(rnd, W, D, 8, 24)
      arch.position.set(x, 0, z)
      arch.rotation.y = rnd() * 3
      g.add(arch)
    }
    return {
      group: g,
      update(t) {
        for (const s of strands) {
          s.rotation.z = Math.sin(t * 0.7 + s.userData.phase) * 0.12
          s.rotation.x = Math.cos(t * 0.5 + s.userData.phase) * 0.08
        }
      },
    }
  },

  sun(theme, W, D, rnd) {
    const g = new Group()
    // A wireframe mountain range on the horizon; the sun itself is in the sky.
    const geo = new PlaneGeometry(260, 60, 64, 14)
    const pos = geo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const ridge = Math.max(0, 1 - Math.abs(y) / 30)
      pos.setZ(i, (Math.abs(Math.sin(x * 0.07) * 6 + Math.sin(x * 0.19 + 1) * 3) + rnd() * 2.5) * ridge)
    }
    geo.computeVertexNormals()
    const mat = own(new MeshBasicMaterial({ color: hdr(theme.floor.line, 1.4), wireframe: true, transparent: true, opacity: 0.35, toneMapped: false }))
    const range = new Mesh(geo, mat)
    range.rotation.x = -Math.PI / 2
    range.position.set(0, -0.5, -D / 2 - 55)
    g.add(range)
    const pylonMat = own(new MeshBasicMaterial({ color: hdr(theme.enemy.trim, 2.2), toneMapped: false }))
    for (let i = 0; i < 14; i++) {
      const h = 2 + rnd() * 6
      const m = new Mesh(new BoxGeometry(0.12, h, 0.12), pylonMat)
      const [x, z] = ringSpot(rnd, W, D, 3, 18)
      m.position.set(x, h / 2, z)
      g.add(m)
    }
    return { group: g }
  },

  dunes(theme, W, D, rnd, mats) {
    const g = new Group()
    const sand = own(new MeshStandardMaterial({ color: '#7a5a3e', roughness: 0.95, flatShading: true }))
    for (let i = 0; i < 20; i++) {
      const r = 3 + rnd() * 6
      const m = new Mesh(new SphereGeometry(r, 14, 7), sand)
      m.scale.set(1, 0.18 + rnd() * 0.12, 0.55 + rnd() * 0.3)
      const [x, z] = ringSpot(rnd, W, D, 4, 26)
      m.position.set(x, -0.2, z)
      m.rotation.y = rnd() * 3
      g.add(m)
    }
    for (let i = 0; i < 9; i++) {
      const h = 2 + rnd() * 5
      const m = new Mesh(new BoxGeometry(0.8, h, 0.8), mats.block)
      const [x, z] = ringSpot(rnd, W, D, 3, 16)
      m.position.set(x, h / 2 - 0.3, z)
      m.rotation.set((rnd() - 0.5) * 0.5, rnd() * 3, (rnd() - 0.5) * 0.5)
      m.castShadow = true
      g.add(m)
    }
    return { group: g }
  },

  blocks(theme, W, D, rnd) {
    const g = new Group()
    const dark = own(new MeshStandardMaterial({ color: '#101010', roughness: 0.25, metalness: 0.6, flatShading: true }))
    const white = own(new MeshStandardMaterial({ color: '#f5f3ee', roughness: 0.6, flatShading: true }))
    const edge = own(new LineBasicMaterial({ color: '#16140f', transparent: true, opacity: 0.6 }))
    const floaters = []
    for (let i = 0; i < 34; i++) {
      const s = 0.4 + rnd() * 1.8
      const geo = new BoxGeometry(s, s, s)
      const m = new Mesh(geo, rnd() < 0.4 ? dark : white)
      m.add(new LineSegments(new EdgesGeometry(geo), edge))
      const [x, z] = ringSpot(rnd, W, D, 2.5, 20)
      m.position.set(x, 0.5 + rnd() * 6, z)
      m.rotation.set(rnd() * 3, rnd() * 3, 0)
      m.castShadow = true
      m.userData.spin = (rnd() - 0.5) * 0.3
      m.userData.base = m.position.y
      floaters.push(m)
      g.add(m)
    }
    return {
      group: g,
      update(t, dt) {
        for (const m of floaters) {
          m.rotation.y += m.userData.spin * dt
          m.position.y = m.userData.base + Math.sin(t * 0.4 + m.userData.spin * 20) * 0.2
        }
      },
    }
  },

  aurora(theme, W, D, rnd) {
    const g = new Group()
    const ribbons = []
    const vert = /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.y += sin(uv.x * 9.0 + uTime * 0.6) * 1.6 + sin(uv.x * 23.0 - uTime * 0.9) * 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `
    const frag = /* glsl */ `
      uniform float uTime;
      uniform vec3 uA;
      uniform vec3 uB;
      varying vec2 vUv;
      void main() {
        float band = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float wave = 0.55 + 0.45 * sin(vUv.x * 40.0 + uTime * 1.3 + sin(vUv.x * 7.0) * 3.0);
        vec3 col = mix(uA, uB, vUv.y);
        gl_FragColor = vec4(col * 1.6, band * wave * 0.55 * smoothstep(0.0, 0.1, vUv.x) * (1.0 - smoothstep(0.9, 1.0, vUv.x)));
      }
    `
    for (let i = 0; i < 3; i++) {
      const mat = own(
        new ShaderMaterial({
          uniforms: {
            uTime: { value: rnd() * 10 },
            uA: { value: new Color(theme.floor.line) },
            uB: { value: new Color(theme.floor.accent) },
          },
          vertexShader: vert,
          fragmentShader: frag,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          side: 2,
          toneMapped: false,
          fog: false,
        }),
      )
      const m = new Mesh(new PlaneGeometry(160, 16, 80, 1), mat)
      m.position.set((rnd() - 0.5) * 30, 20 + i * 5, -D / 2 - 30 - i * 14)
      m.rotation.set(-0.2, (rnd() - 0.5) * 0.5, 0)
      ribbons.push(mat)
      g.add(m)
    }
    const snow = own(new MeshStandardMaterial({ color: '#dfe8f2', roughness: 0.8, flatShading: true }))
    for (let i = 0; i < 16; i++) {
      const h = 5 + rnd() * 10
      const m = new Mesh(new ConeGeometry(3 + rnd() * 4, h, 5), snow)
      const [x, z] = ringSpot(rnd, W, D, 10, 30)
      m.position.set(x, h / 2 - 0.5, z)
      m.rotation.y = rnd() * 3
      g.add(m)
    }
    return {
      group: g,
      update(t, dt) {
        for (const r of ribbons) r.uniforms.uTime.value += dt
      },
    }
  },

  eruptions(theme, W, D, rnd) {
    const g = new Group()
    const rock = own(new MeshStandardMaterial({ color: '#150906', roughness: 0.85, flatShading: true }))
    const lava = own(new MeshBasicMaterial({ color: hdr(theme.floor.accent, 2.4), toneMapped: false }))
    const cores = []
    for (let i = 0; i < 10; i++) {
      const h = 2 + rnd() * 6
      const r = 0.7 + rnd() * 1.2
      const m = new Mesh(new CylinderGeometry(r * 0.6, r, h, 6), rock)
      const [x, z] = ringSpot(rnd, W, D, 3, 22)
      m.position.set(x, h / 2, z)
      m.castShadow = true
      const top = new Mesh(new CylinderGeometry(r * 0.5, r * 0.5, 0.08, 6), lava)
      top.position.y = h / 2 + 0.02
      m.add(top)
      cores.push(top)
      g.add(m)
    }
    for (let i = 0; i < 18; i++) {
      const s = 0.8 + rnd() * 2
      const m = new Mesh(new OctahedronGeometry(s, 0), rock)
      const [x, z] = ringSpot(rnd, W, D, 2.5, 14)
      m.position.set(x, s * 0.3, z)
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
      g.add(m)
    }
    return {
      group: g,
      update(t) {
        cores.forEach((m, i) => m.scale.setScalar(0.85 + Math.sin(t * 3 + i * 1.7) * 0.15))
      },
    }
  },
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function createEnvironment(themeId, W, D, mats) {
  const theme = THEMES[themeId] || THEMES.terminal
  const rnd = seeded(themeId)
  const group = new Group()

  const { sky, uniforms: skyU } = buildSky(theme)
  group.add(sky)

  const { floor, catcher, uniforms: floorU } = buildFloor(theme, W, D)
  group.add(floor, catcher)

  const walls = buildWalls(W, D, mats)
  group.add(walls)

  const props = (PROPS[theme.props] || PROPS.cubes)(theme, W, D, rnd, mats)
  group.add(props.group)

  const { points, uniforms: partU } = buildParticles(theme, W, D, rnd)
  group.add(points)

  const lift = theme.light2 ? 1 : 1.3
  const hemi = new HemisphereLight(theme.light.sky, theme.light.ground, theme.light.hemi * lift)
  const sun = new DirectionalLight(theme.light.sun, theme.light.sunI * (theme.light2 ? 1 : 1.15))
  sun.position.set(-7, 16, 9)
  sun.castShadow = true
  const ext = Math.max(W, D) / 2 + 3
  sun.shadow.camera.left = -ext
  sun.shadow.camera.right = ext
  sun.shadow.camera.top = ext
  sun.shadow.camera.bottom = -ext
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 50
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.03
  // Rim light from behind in the accent colour: silhouettes pop off the floor.
  const rim = new DirectionalLight(theme.floor.accent, theme.light2 ? 0.3 : 0.9)
  rim.position.set(4, 5, -14)
  group.add(hemi, sun, sun.target, rim)

  let pulseT = 99

  return {
    theme,
    group,
    sun,
    setShadowSize(size) {
      sun.shadow.mapSize.set(size, size)
      sun.shadow.map?.dispose()
      sun.shadow.map = null
    },
    // 0..1 while the arena builds itself at the start of a sector.
    setReveal(t) {
      floorU.uReveal.value = t
      walls.scale.y = Math.max(0.001, t)
      props.group.visible = t > 0.05
    },
    setCore(x, z, strength) {
      floorU.uCore.value.x = x
      floorU.uCore.value.y = z
      floorU.uCore.value.z = strength
    },
    pulse() {
      pulseT = 0
    },
    update(t, dt, pixelRatio) {
      floorU.uTime.value = t
      skyU.uTime.value = t
      partU.uTime.value = t
      partU.uPixelRatio.value = pixelRatio
      pulseT += dt
      floorU.uPulse.value = pulseT
      props.update?.(t, dt)
    },
    dispose() {
      disposeTree(group)
    },
  }
}
