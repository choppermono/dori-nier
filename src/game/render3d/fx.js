import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TetrahedronGeometry,
  Vector4,
} from 'three'
import { SIGNAL, TIMING } from '../config.js'
import { clamp01, ease, hdr } from './kit.js'

// Everything short-lived: bullets, sparks, debris, shockwave rings, beams,
// mortar markers, mines, spawn columns, tethers. Bullets and particles are
// instanced - hundreds of them cost a handful of draw calls - and nothing is
// allocated while a sector runs.

const dummy = new Object3D()

// Writes a matrix with a rotation about y and a per-axis scale.
function setTRS(arr, i, x, y, z, rotY, sx, sy, sz) {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  const o = i * 16
  arr[o] = c * sx
  arr[o + 1] = 0
  arr[o + 2] = -s * sx
  arr[o + 3] = 0
  arr[o + 4] = 0
  arr[o + 5] = sy
  arr[o + 6] = 0
  arr[o + 7] = 0
  arr[o + 8] = s * sz
  arr[o + 9] = 0
  arr[o + 10] = c * sz
  arr[o + 11] = 0
  arr[o + 12] = x
  arr[o + 13] = y
  arr[o + 14] = z
  arr[o + 15] = 1
}

function instanced(geo, mat, cap) {
  const m = new InstancedMesh(geo, mat, cap)
  m.instanceMatrix.setUsage(DynamicDrawUsage)
  m.frustumCulled = false
  m.count = 0
  return m
}

const DASH_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const DASH_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uLen;
  varying vec2 vUv;
  void main() {
    // A faint band as wide as the danger, with a thin dashed line down the
    // middle: reads as "something comes along here", never as bullets.
    float across = abs(vUv.y - 0.5);
    float band = 1.0 - smoothstep(0.42, 0.5, across);
    float centre = 1.0 - smoothstep(0.05, 0.1, across);
    float dash = step(0.5, fract(vUv.x * uLen * 1.2 - uTime * 3.0));
    gl_FragColor = vec4(uColor, (band * 0.16 + centre * dash * 0.85) * uAlpha);
  }
`

const RING_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uProgress;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    // atan is undefined when both arguments are zero. That one centre pixel
    // would come out NaN, and the bloom pass then smears it over the whole
    // screen as black.
    if (r < 0.06) discard;
    float band = smoothstep(0.78, 0.84, r) * (1.0 - smoothstep(0.94, 1.0, r));
    float a = atan(d.y, d.x) / 6.2831853 + 0.5;
    float filled = step(a, uProgress);
    float brackets = step(0.8, fract(a * 4.0 + 0.1)) * smoothstep(0.9, 0.96, r) * (1.0 - step(1.0, r));
    gl_FragColor = vec4(uColor, (band * (0.25 + 0.75 * filled) + brackets) * uAlpha);
  }
`

// The arc a sweeping beam will cover, drawn on the floor before and while it
// burns. Brighter towards the end of the sweep, so the direction reads too.
const WEDGE_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const WEDGE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uA0;
  uniform float uArc;
  uniform float uAlpha;
  uniform float uTime;
  uniform vec2 uHalf;
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    // Only inside the arena: past the walls the beam can't reach you anyway.
    if (abs(vWorld.x) > uHalf.x || abs(vWorld.y) > uHalf.y) discard;
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0 || r < 0.02) discard;
    float angle = atan(-d.y, d.x);
    float arcAbs = abs(uArc);
    float rel = uArc >= 0.0 ? mod(angle - uA0 + 12.566371, 6.283185) : mod(uA0 - angle + 12.566371, 6.283185);
    if (rel > arcAbs) discard;
    float k = rel / max(arcAbs, 0.001);
    float radial = smoothstep(1.0, 0.9, r) * smoothstep(0.03, 0.12, r);
    float stripes = 0.6 + 0.4 * step(0.5, fract(r * 12.0 - uTime * 2.0));
    gl_FragColor = vec4(uColor, (0.08 + 0.24 * k) * radial * stripes * uAlpha);
  }
`

// A shockwave ring with its gaps cut out.
const SHOCK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uBand;
  uniform vec4 uGaps;
  uniform float uGapN;
  uniform float uGapW;
  varying vec2 vUv;
  float inGap(float a, float g) {
    float da = abs(mod(a - g + 9.424778, 6.283185) - 3.141593);
    return step(da, uGapW * 0.5);
  }
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    if (r < 0.02) discard;
    float band = 1.0 - smoothstep(uBand * 0.5, uBand * 0.5 + 0.015, abs(r - (1.0 - uBand * 0.5)));
    if (band < 0.01) discard;
    float a = atan(-d.y, d.x);
    float gap = 0.0;
    if (uGapN > 0.5) gap = max(gap, inGap(a, uGaps.x));
    if (uGapN > 1.5) gap = max(gap, inGap(a, uGaps.y));
    if (uGapN > 2.5) gap = max(gap, inGap(a, uGaps.z));
    if (uGapN > 3.5) gap = max(gap, inGap(a, uGaps.w));
    if (gap > 0.5) discard;
    gl_FragColor = vec4(uColor, band * uAlpha);
  }
`

const COLUMN_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float fade = pow(max(0.0, 1.0 - vUv.y), 1.6);
    float scan = 0.65 + 0.35 * sin(vUv.y * 40.0 - uTime * 10.0);
    gl_FragColor = vec4(uColor, fade * scan * uAlpha);
  }
`

export function createFx(scene, M, glowTex, theme) {
  const light = !!theme.light2
  const blend = light ? NormalBlending : AdditiveBlending
  const group = new Group()
  scene.add(group)
  const owned = [] // geometries and materials this module made

  const keep = (x) => {
    owned.push(x)
    return x
  }

  const P = {
    hot: hdr(SIGNAL.hot, light ? 1.2 : 1.9),
    trim: hdr(theme.enemy.trim, light ? 1 : 1.6),
    accent: hdr(theme.floor.accent, light ? 1 : 1.6),
    player: hdr(theme.player.trim, light ? 0.4 : 1.5),
    white: hdr('#ffffff', light ? 0.6 : 1.5),
    grey: new Color(light ? '#555555' : '#a8a8a8'),
    hull: new Color(theme.enemy.hull),
    block: new Color(theme.block.color),
    ice: hdr('#bff3ff', light ? 1 : 1.5),
  }

  // ---------- bullets ----------

  const orbGeo = keep(new IcosahedronGeometry(1, 1))
  const planeGeo = keep(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2))
  const hotCore = keep(new MeshBasicMaterial({ color: P.hot, toneMapped: false }))
  const hotShell = keep(new MeshBasicMaterial({ color: '#2a1000', side: 1 }))
  const hotGlow = keep(
    new MeshBasicMaterial({
      map: glowTex,
      color: hdr(SIGNAL.hot, light ? 0.8 : 1.2),
      transparent: true,
      opacity: light ? 0.5 : 0.7,
      blending: blend,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const coldCore = keep(new MeshBasicMaterial({ color: SIGNAL.cold }))
  // In the white world a white ring would vanish; there the ring turns red.
  // Kept just under the bloom threshold, so the black centre stays readable.
  const coldShell = keep(new MeshBasicMaterial({ color: light ? '#d81e1e' : hdr(SIGNAL.coldRing, 1.05), side: 1, toneMapped: false }))
  const coldGlow = keep(
    new MeshBasicMaterial({
      map: glowTex,
      color: hdr('#ffffff', 0.6),
      transparent: true,
      opacity: light ? 0 : 0.14,
      blending: blend,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const CAP = 900
  const hot = {
    core: instanced(orbGeo, hotCore, CAP),
    shell: instanced(orbGeo, hotShell, CAP),
    glow: instanced(planeGeo, hotGlow, CAP),
  }
  const cold = {
    core: instanced(orbGeo, coldCore, CAP),
    shell: instanced(orbGeo, coldShell, CAP),
    glow: instanced(planeGeo, coldGlow, CAP),
  }
  const shotGeo = keep(new BoxGeometry(1, 1, 1))
  const shotMat = keep(new MeshBasicMaterial({ color: light ? '#2a2a2a' : hdr(theme.player.trim, 2), toneMapped: false }))
  const shotGlowMat = keep(
    new MeshBasicMaterial({
      map: glowTex,
      color: hdr(theme.player.trim, 1.2),
      transparent: true,
      opacity: light ? 0 : 0.55,
      blending: blend,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  const shots = { core: instanced(shotGeo, shotMat, 128), glow: instanced(planeGeo, shotGlowMat, 128) }
  for (const m of [hot.glow, cold.glow, shots.glow]) m.renderOrder = 3
  group.add(hot.core, hot.shell, hot.glow, cold.core, cold.shell, cold.glow, shots.core, shots.glow)

  function syncBullets(game) {
    let nh = 0
    let nc = 0
    const H = [hot.core.instanceMatrix.array, hot.shell.instanceMatrix.array, hot.glow.instanceMatrix.array]
    const C = [cold.core.instanceMatrix.array, cold.shell.instanceMatrix.array, cold.glow.instanceMatrix.array]
    for (const b of game.bullets) {
      const grow = Math.min(1, 0.35 + b.age * 9)
      const r = b.r * grow
      const pulse = 1 + Math.sin(b.age * 18) * 0.06
      if (b.kind === 'hot') {
        if (nh >= CAP) continue
        setTRS(H[0], nh, b.x, 0.42, b.y, 0, r, r, r)
        setTRS(H[1], nh, b.x, 0.42, b.y, 0, r * 1.45, r * 1.45, r * 1.45)
        setTRS(H[2], nh, b.x, 0.4, b.y, 0, r * 7 * pulse, 1, r * 7 * pulse)
        nh++
      } else {
        if (nc >= CAP) continue
        setTRS(C[0], nc, b.x, 0.42, b.y, 0, r, r, r)
        setTRS(C[1], nc, b.x, 0.42, b.y, 0, r * 1.5, r * 1.5, r * 1.5)
        setTRS(C[2], nc, b.x, 0.4, b.y, 0, r * 5 * pulse, 1, r * 5 * pulse)
        nc++
      }
    }
    for (const m of [hot.core, hot.shell, hot.glow]) {
      m.count = nh
      m.instanceMatrix.needsUpdate = true
    }
    for (const m of [cold.core, cold.shell, cold.glow]) {
      m.count = nc
      m.instanceMatrix.needsUpdate = true
    }

    let ns = 0
    const S = [shots.core.instanceMatrix.array, shots.glow.instanceMatrix.array]
    for (const s of game.shots) {
      if (ns >= 128) break
      const a = -Math.atan2(s.vy, s.vx)
      setTRS(S[0], ns, s.x, 0.4, s.y, a, 0.62, 0.07, 0.07)
      setTRS(S[1], ns, s.x, 0.38, s.y, a, 1.6, 1, 0.55)
      ns++
    }
    for (const m of [shots.core, shots.glow]) {
      m.count = ns
      m.instanceMatrix.needsUpdate = true
    }
  }

  // ---------- sparks ----------

  const SPARKS = 1600
  const sparkMesh = instanced(keep(new BoxGeometry(1, 1, 1)), keep(new MeshBasicMaterial({ toneMapped: false })), SPARKS)
  sparkMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(SPARKS * 3), 3)
  sparkMesh.instanceColor.setUsage(DynamicDrawUsage)
  group.add(sparkMesh)
  const sparkList = []

  function sparks(x, y, z, color, n, speed = 3, up = 1, size = 0.07) {
    for (let i = 0; i < n; i++) {
      if (sparkList.length >= SPARKS) sparkList.shift()
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.35 + Math.random() * 0.9)
      const life = 0.35 + Math.random() * 0.55
      sparkList.push({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: (0.4 + Math.random()) * sp * up,
        vz: Math.sin(a) * sp,
        life,
        max: life,
        size: size * (0.6 + Math.random() * 0.9),
        r: color.r,
        g: color.g,
        b: color.b,
      })
    }
  }

  function updateSparks(dt) {
    const drag = Math.pow(0.2, dt)
    const arr = sparkMesh.instanceMatrix.array
    const col = sparkMesh.instanceColor.array
    let n = 0
    for (let i = sparkList.length - 1; i >= 0; i--) {
      const p = sparkList[i]
      p.life -= dt
      if (p.life <= 0) {
        sparkList[i] = sparkList[sparkList.length - 1]
        sparkList.pop()
        continue
      }
      p.vy -= 9 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < 0.04) {
        p.y = 0.04
        p.vy *= -0.3
      }
      p.vx *= drag
      p.vz *= drag
      const k = p.life / p.max
      const s = p.size * (0.4 + k * 0.6)
      // Stretched along travel: sparks read as streaks, not specks.
      const a = -Math.atan2(p.vz, p.vx)
      const len = s * (1 + Math.min(4, Math.hypot(p.vx, p.vz) * 0.35))
      setTRS(arr, n, p.x, p.y, p.z, a, len, s, s)
      col[n * 3] = p.r * k
      col[n * 3 + 1] = p.g * k
      col[n * 3 + 2] = p.b * k
      n++
    }
    sparkMesh.count = n
    sparkMesh.instanceMatrix.needsUpdate = true
    sparkMesh.instanceColor.needsUpdate = true
  }

  // ---------- debris ----------

  const DEBRIS = 500
  const debrisMesh = instanced(
    keep(new TetrahedronGeometry(1)),
    keep(new MeshStandardMaterial({ roughness: 0.45, metalness: 0.5, flatShading: true })),
    DEBRIS,
  )
  debrisMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(DEBRIS * 3), 3)
  debrisMesh.castShadow = true
  group.add(debrisMesh)
  const debrisList = []

  function debris(x, y, z, color, n, speed = 4, size = 0.12) {
    for (let i = 0; i < n; i++) {
      if (debrisList.length >= DEBRIS) debrisList.shift()
      const a = Math.random() * Math.PI * 2
      const sp = speed * (0.3 + Math.random() * 0.8)
      const life = 1.2 + Math.random() * 1.2
      debrisList.push({
        x,
        y,
        z,
        vx: Math.cos(a) * sp,
        vy: (1 + Math.random() * 1.6) * sp * 0.6,
        vz: Math.sin(a) * sp,
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        spin: (Math.random() - 0.5) * 14,
        life,
        max: life,
        size: size * (0.5 + Math.random()),
        color,
      })
    }
  }

  function updateDebris(dt) {
    const col = debrisMesh.instanceColor.array
    let n = 0
    for (let i = debrisList.length - 1; i >= 0; i--) {
      const p = debrisList[i]
      p.life -= dt
      if (p.life <= 0) {
        debrisList[i] = debrisList[debrisList.length - 1]
        debrisList.pop()
        continue
      }
      p.vy -= 12 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
      if (p.y < p.size) {
        p.y = p.size
        p.vy *= -0.35
        p.vx *= 0.6
        p.vz *= 0.6
        p.spin *= 0.6
      }
      p.rx += p.spin * dt
      p.ry += p.spin * 0.7 * dt
      const s = p.size * Math.min(1, p.life / 0.4)
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(p.rx, p.ry, 0)
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      debrisMesh.setMatrixAt(n, dummy.matrix)
      col[n * 3] = p.color.r
      col[n * 3 + 1] = p.color.g
      col[n * 3 + 2] = p.color.b
      n++
    }
    debrisMesh.count = n
    debrisMesh.instanceMatrix.needsUpdate = true
    debrisMesh.instanceColor.needsUpdate = true
  }

  // ---------- rings ----------

  const ringGeo = keep(new RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2))
  const rings = []
  for (let i = 0; i < 32; i++) {
    const mat = keep(
      new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: blend, side: DoubleSide, toneMapped: false }),
    )
    const m = new Mesh(ringGeo, mat)
    m.visible = false
    m.renderOrder = 4
    group.add(m)
    rings.push({ m, t: 0, dur: 1, r0: 0, r1: 1, a: 1, delay: 0 })
  }
  let ringNext = 0

  function ring(x, z, r0, r1, dur, color, alpha = 1, y = 0.06, delay = 0) {
    const R = rings[ringNext]
    ringNext = (ringNext + 1) % rings.length
    R.m.position.set(x, y, z)
    R.m.material.color.copy(color)
    R.t = -delay
    R.dur = dur
    R.r0 = r0
    R.r1 = r1
    R.a = alpha
    R.m.visible = delay <= 0
    R.m.scale.setScalar(Math.max(0.001, r0))
  }

  function updateRings(dt) {
    for (const R of rings) {
      if (R.t >= R.dur) continue
      R.t += dt
      if (R.t < 0) continue
      const k = clamp01(R.t / R.dur)
      R.m.visible = k < 1
      R.m.scale.setScalar(Math.max(0.001, R.r0 + (R.r1 - R.r0) * ease.outExpo(k)))
      R.m.material.opacity = (1 - k) * R.a
    }
  }

  // ---------- light flashes ----------

  const lights = []
  for (let i = 0; i < 4; i++) {
    const l = new PointLight('#ffffff', 0, 9, 2)
    l.visible = false
    group.add(l)
    lights.push({ l, t: 1, dur: 1, i: 0 })
  }
  let lightNext = 0

  function flash(x, z, color, intensity = 3, dur = 0.25, range = 9) {
    if (light) return
    const L = lights[lightNext]
    lightNext = (lightNext + 1) % lights.length
    L.l.position.set(x, 1.2, z)
    L.l.color.copy(color).multiplyScalar(1 / Math.max(color.r, color.g, color.b, 1))
    L.l.distance = range
    L.t = 0
    L.dur = dur
    L.i = intensity * 3.5
    L.l.visible = true
  }

  function updateLights(dt) {
    for (const L of lights) {
      if (!L.l.visible) continue
      L.t += dt
      const k = clamp01(L.t / L.dur)
      L.l.intensity = L.i * (1 - k) * (1 - k)
      if (k >= 1) L.l.visible = false
    }
  }

  // ---------- flying chunks (the player's broken segments) ----------

  const chunks = []
  function chunk(mesh, dirAngle) {
    const m = new Mesh(mesh.geometry, mesh.material)
    mesh.getWorldPosition(m.position)
    mesh.getWorldQuaternion(m.quaternion)
    m.castShadow = true
    group.add(m)
    const sp = 3 + Math.random() * 2
    chunks.push({
      m,
      vx: Math.cos(dirAngle) * sp,
      vy: 3.5 + Math.random() * 2,
      vz: Math.sin(dirAngle) * sp,
      sx: (Math.random() - 0.5) * 12,
      sz: (Math.random() - 0.5) * 12,
      life: 1.6,
    })
  }

  function updateChunks(dt) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const c = chunks[i]
      c.life -= dt
      if (c.life <= 0) {
        group.remove(c.m)
        chunks.splice(i, 1)
        continue
      }
      c.vy -= 12 * dt
      c.m.position.x += c.vx * dt
      c.m.position.y += c.vy * dt
      c.m.position.z += c.vz * dt
      if (c.m.position.y < 0.05) {
        c.m.position.y = 0.05
        c.vy *= -0.3
        c.vx *= 0.6
        c.vz *= 0.6
      }
      c.m.rotation.x += c.sx * dt
      c.m.rotation.z += c.sz * dt
      c.m.scale.setScalar(Math.min(1, c.life / 0.5))
    }
  }

  // ---------- beams ----------

  // Warnings stay under the bloom threshold, so they never outshine the bullets.
  const warnColor = hdr(theme.enemy.trim, light ? 1 : 1.3)
  const beamWarnMat = () =>
    keep(
      new ShaderMaterial({
        uniforms: { uColor: { value: warnColor.clone() }, uTime: { value: 0 }, uAlpha: { value: 1 }, uLen: { value: 1 } },
        vertexShader: DASH_VERT,
        fragmentShader: DASH_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blend,
        side: DoubleSide,
        toneMapped: false,
      }),
    )
  const stripGeo = keep(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0))
  // Tinted rather than pure white: a full-arena beam used to white out a
  // quarter of the screen.
  const beamCoreMat = keep(
    new MeshBasicMaterial({ color: new Color('#ffffff').lerp(new Color(theme.enemy.trim), 0.35).multiplyScalar(light ? 1 : 1.2), toneMapped: false }),
  )
  const beamGlowMat = keep(
    new MeshBasicMaterial({
      color: P.trim,
      transparent: true,
      opacity: light ? 0.6 : 0.32,
      blending: blend,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
  )
  const beamBoxGeo = keep(new BoxGeometry(1, 1, 1).translate(0.5, 0, 0))
  const wedgeGeo = keep(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2))
  const beams = []
  for (let i = 0; i < 16; i++) {
    const g = new Group()
    const warn = new Mesh(stripGeo, beamWarnMat())
    warn.position.y = 0.05
    const core = new Mesh(beamBoxGeo, beamCoreMat)
    core.position.y = 0.42
    const glowM = new Mesh(stripGeo, beamGlowMat)
    glowM.position.y = 0.06
    g.add(warn, core, glowM)
    g.visible = false
    group.add(g)
    const wedge = new Mesh(
      wedgeGeo,
      keep(
        new ShaderMaterial({
          uniforms: {
            uColor: { value: P.trim.clone() },
            uA0: { value: 0 },
            uArc: { value: 0 },
            uAlpha: { value: 0 },
            uTime: { value: 0 },
            uHalf: { value: { x: 13, y: 7 } },
          },
          vertexShader: WEDGE_VERT,
          fragmentShader: WEDGE_FRAG,
          transparent: true,
          depthWrite: false,
          blending: blend,
          side: DoubleSide,
          toneMapped: false,
        }),
      ),
    )
    wedge.position.y = 0.035
    wedge.visible = false
    wedge.renderOrder = 1
    group.add(wedge)
    beams.push({ g, warn, core, glow: glowM, wedge })
  }

  function syncBeams(game, t) {
    let i = 0
    for (const h of game.hazards) {
      if (h.type !== 'beam' || i >= beams.length) continue
      const B = beams[i++]
      B.g.visible = true
      const ox = h.x + Math.cos(h.a) * h.offset
      const oz = h.y + Math.sin(h.a) * h.offset
      const len = Math.max(0.01, h.len - h.offset)
      B.g.position.set(ox, 0, oz)
      B.g.rotation.y = -h.a
      if (h.spin) {
        const u = B.wedge.material.uniforms
        B.wedge.visible = true
        B.wedge.position.set(h.x, 0.035, h.y)
        const reach = Math.hypot(game.W, game.D)
        B.wedge.scale.set(reach, 1, reach)
        u.uA0.value = h.a
        u.uArc.value = h.warn > 0 ? h.spin * h.activeMax : h.spin * Math.max(0, h.active)
        u.uAlpha.value = h.warn > 0 ? 0.5 + 0.5 * (1 - h.warn / h.warnMax) : 0.7
        u.uTime.value = t
        u.uHalf.value.x = game.W / 2
        u.uHalf.value.y = game.D / 2
      } else {
        B.wedge.visible = false
      }
      if (h.warn > 0) {
        const k = 1 - h.warn / h.warnMax
        B.warn.visible = true
        B.core.visible = false
        B.glow.visible = false
        B.warn.scale.set(len, 1, h.width * 1.25)
        const u = B.warn.material.uniforms
        u.uTime.value = t
        u.uAlpha.value = 0.35 + 0.65 * k
        u.uLen.value = len
      } else {
        const k = h.active / h.activeMax
        B.warn.visible = false
        B.core.visible = true
        B.glow.visible = true
        // Thinner core, and thinner still for the lines that cross the whole
        // arena - three of those at once used to be blinding.
        const thin = h.line ? 0.6 : 1
        const w = h.width * thin * (0.22 + 0.12 * Math.sin(t * 60))
        B.core.scale.set(len, w, w)
        B.glow.scale.set(len, 1, h.width * thin * 1.9)
        B.glow.material.opacity = (light ? 0.6 : 0.32) * Math.min(1, k * 3)
      }
    }
    for (; i < beams.length; i++) {
      beams[i].g.visible = false
      beams[i].wedge.visible = false
    }
  }

  // ---------- mortar shells ----------

  const markerRingGeo = keep(new RingGeometry(0.93, 1, 48).rotateX(-Math.PI / 2))
  const discGeo = keep(new RingGeometry(0, 1, 48).rotateX(-Math.PI / 2))
  const markerMat = keep(
    new MeshBasicMaterial({ color: P.hot, transparent: true, opacity: 0.8, blending: blend, depthWrite: false, toneMapped: false }),
  )
  const fillMat = keep(
    new MeshBasicMaterial({ color: P.hot, transparent: true, opacity: 0.22, blending: blend, depthWrite: false, toneMapped: false }),
  )
  const shellGeo = keep(new SphereGeometry(0.17, 12, 9))
  const mortars = []
  for (let i = 0; i < 16; i++) {
    const g = new Group()
    const r = new Mesh(markerRingGeo, markerMat)
    const f = new Mesh(discGeo, fillMat)
    r.position.y = 0.05
    f.position.y = 0.045
    const s = new Mesh(shellGeo, hotCore)
    g.add(r, f)
    g.visible = false
    s.visible = false
    group.add(g, s)
    mortars.push({ g, r, f, s })
  }

  function syncMortars(game, t) {
    let i = 0
    for (const h of game.hazards) {
      if (h.type !== 'mortar' || i >= mortars.length) continue
      const K = mortars[i++]
      const k = clamp01(h.t / h.flight)
      K.g.visible = true
      K.s.visible = true
      K.g.position.set(h.x, 0, h.y)
      K.r.scale.setScalar(h.blast * (1 + Math.sin(t * 20) * 0.02))
      K.f.scale.setScalar(Math.max(0.001, h.blast * k))
      const arc = 4 * k * (1 - k)
      K.s.position.set(h.sx + (h.x - h.sx) * k, 0.5 + arc * 4.2, h.sy + (h.y - h.sy) * k)
    }
    for (; i < mortars.length; i++) {
      mortars[i].g.visible = false
      mortars[i].s.visible = false
    }
  }

  // ---------- mines ----------

  const mineGeo = keep(new OctahedronGeometry(0.24, 0))
  const mineLightGeo = keep(new SphereGeometry(0.09, 10, 8))
  const mineHullMat = M.enemyHull
  const mines = []
  for (let i = 0; i < 32; i++) {
    const g = new Group()
    const body = new Mesh(mineGeo, mineHullMat)
    body.position.y = 0.3
    body.castShadow = true
    const lamp = new Mesh(mineLightGeo, M.enemyGlow)
    lamp.position.y = 0.3
    const halo = new Mesh(markerRingGeo, fillMat)
    halo.position.y = 0.04
    g.add(body, lamp, halo)
    g.visible = false
    group.add(g)
    mines.push({ g, body, lamp, halo })
  }

  function syncMines(game, t, dt) {
    let i = 0
    for (const h of game.hazards) {
      if (h.type !== 'mine' || h.dead || i >= mines.length) continue
      const K = mines[i++]
      K.g.visible = true
      K.g.position.set(h.x, 0, h.y)
      const urgency = 1 - h.fuse / h.fuseMax
      const blink = Math.sin(t * (6 + urgency * 30)) > 0
      K.lamp.scale.setScalar(blink ? 1.4 + urgency : 0.6)
      K.body.rotation.y += dt * (1 + urgency * 6)
      K.halo.scale.setScalar(0.9 + urgency * 0.4)
    }
    for (; i < mines.length; i++) mines[i].g.visible = false
  }

  // ---------- shockwaves ----------

  const shockPlane = keep(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2))
  const shocks = []
  for (let i = 0; i < 8; i++) {
    const mat = keep(
      new ShaderMaterial({
        uniforms: {
          uColor: { value: hdr(theme.enemy.trim, light ? 1 : 1.3) },
          uAlpha: { value: 0.95 },
          uBand: { value: 0.1 },
          uGaps: { value: new Vector4() },
          uGapN: { value: 0 },
          uGapW: { value: 0.6 },
        },
        vertexShader: DASH_VERT,
        fragmentShader: SHOCK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blend,
        side: DoubleSide,
        toneMapped: false,
      }),
    )
    const m = new Mesh(shockPlane, mat)
    m.position.y = 0.08
    m.visible = false
    m.renderOrder = 4
    group.add(m)
    shocks.push(m)
  }

  function syncShocks(game) {
    let i = 0
    for (const h of game.hazards) {
      if (h.type !== 'shock' || i >= shocks.length) continue
      const m = shocks[i++]
      const outer = h.r + h.width / 2
      m.visible = true
      m.position.x = h.x
      m.position.z = h.y
      m.scale.set(outer, 1, outer)
      const u = m.material.uniforms
      u.uBand.value = Math.min(1, h.width / Math.max(outer, 0.1))
      u.uGaps.value.set(h.gaps[0] ?? 0, h.gaps[1] ?? 0, h.gaps[2] ?? 0, h.gaps[3] ?? 0)
      u.uGapN.value = h.gaps.length
      u.uGapW.value = h.gapW
      u.uAlpha.value = 0.95 * (1 - Math.max(0, (h.r - h.maxR * 0.7) / (h.maxR * 0.3)))
    }
    for (; i < shocks.length; i++) shocks[i].visible = false
  }

  // ---------- spawn markers ----------

  const colGeo = keep(new CylinderGeometry(0.55, 0.55, 5, 24, 1, true).translate(0, 2.5, 0))
  const ringPlane = keep(new PlaneGeometry(2, 2).rotateX(-Math.PI / 2))
  const spawns = []
  for (let i = 0; i < 28; i++) {
    const colMat = keep(
      new ShaderMaterial({
        uniforms: { uColor: { value: P.trim.clone() }, uAlpha: { value: 1 }, uTime: { value: 0 } },
        vertexShader: DASH_VERT,
        fragmentShader: COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blend,
        side: DoubleSide,
        toneMapped: false,
      }),
    )
    const ringMat = keep(
      new ShaderMaterial({
        uniforms: { uColor: { value: P.trim.clone() }, uProgress: { value: 0 }, uAlpha: { value: 1 } },
        vertexShader: DASH_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: blend,
        side: DoubleSide,
        toneMapped: false,
      }),
    )
    const g = new Group()
    const col = new Mesh(colGeo, colMat)
    const rg = new Mesh(ringPlane, ringMat)
    rg.position.y = 0.05
    g.add(col, rg)
    g.visible = false
    group.add(g)
    spawns.push({ g, col, rg })
  }

  function syncSpawns(game, t) {
    let i = 0
    for (const s of game.spawns) {
      if (s.t > s.warn || i >= spawns.length) continue
      const K = spawns[i++]
      const k = 1 - s.t / s.warn
      K.g.visible = true
      K.g.position.set(s.x, 0, s.y)
      K.rg.rotation.y = t * 1.5
      K.rg.scale.setScalar(0.7 + (1 - k) * 0.5)
      K.rg.material.uniforms.uProgress.value = k
      K.col.material.uniforms.uTime.value = t
      K.col.material.uniforms.uAlpha.value = 0.25 + k * 0.75
      K.col.scale.set(0.4 + k * 0.6, 1, 0.4 + k * 0.6)
    }
    for (; i < spawns.length; i++) spawns[i].g.visible = false
  }

  // ---------- telegraph lines (rams and the Colossus announcing a charge) ----------

  const teles = []
  for (let i = 0; i < 12; i++) {
    const m = new Mesh(stripGeo, beamWarnMat())
    m.position.y = 0.05
    m.visible = false
    group.add(m)
    teles.push(m)
  }

  function syncTelegraphs(game, t) {
    let i = 0
    const add = (x, z, a, len, width, k) => {
      if (i >= teles.length) return
      const m = teles[i++]
      m.visible = true
      m.position.set(x, 0.05, z)
      m.rotation.y = -a
      m.scale.set(len, 1, width)
      const u = m.material.uniforms
      u.uTime.value = t
      u.uAlpha.value = 0.45 + 0.55 * k
      u.uLen.value = len
    }
    for (const e of game.enemies) {
      if (e.type === 'ram' && e.state.mode === 'windup') {
        add(e.x, e.y, e.state.a, 8.5, 0.9, 1 - e.state.t / 0.8)
      }
    }
    const B = game.boss
    if (B && B.alive && B.state.cm === 'windup') add(B.x, B.y, B.state.ca, 16, 2.4, 1 - B.state.ct / 1.15)
    for (; i < teles.length; i++) teles[i].visible = false
  }

  // ---------- warden tethers ----------

  const MAX_TETHER = 48
  const tetherPos = new Float32Array(MAX_TETHER * 6)
  const tetherGeo = keep(new BufferGeometry())
  tetherGeo.setAttribute('position', new Float32BufferAttribute(tetherPos, 3).setUsage(DynamicDrawUsage))
  const tetherMat = keep(new LineBasicMaterial({ color: P.trim, transparent: true, opacity: 0.55, toneMapped: false }))
  const tethers = new LineSegments(tetherGeo, tetherMat)
  tethers.frustumCulled = false
  group.add(tethers)

  function syncTethers(game, t) {
    let n = 0
    for (const e of game.enemies) {
      if (!e.alive || !e.shieldedBy || n >= MAX_TETHER) continue
      const w = e.shieldedBy
      const o = n * 6
      tetherPos[o] = w.x
      tetherPos[o + 1] = 0.65
      tetherPos[o + 2] = w.y
      tetherPos[o + 3] = e.x
      tetherPos[o + 4] = 0.55
      tetherPos[o + 5] = e.y
      n++
    }
    tetherGeo.setDrawRange(0, n * 2)
    tetherGeo.attributes.position.needsUpdate = true
    tetherMat.opacity = 0.35 + Math.sin(t * 8) * 0.15
  }

  // ---------- thruster trail ----------

  let trailAcc = 0
  function trail(p, dt) {
    const sp = Math.hypot(p.vx, p.vy)
    if (!p.alive || sp < 0.5) return
    trailAcc += dt * 40
    while (trailAcc > 1) {
      trailAcc -= 1
      const bx = p.x - Math.cos(p.angle) * 0.3 + (Math.random() - 0.5) * 0.1
      const bz = p.y - Math.sin(p.angle) * 0.3 + (Math.random() - 0.5) * 0.1
      if (sparkList.length >= SPARKS) sparkList.shift()
      sparkList.push({
        x: bx,
        y: 0.32,
        z: bz,
        vx: -p.vx * 0.15 + (Math.random() - 0.5) * 0.4,
        vy: 0.3,
        vz: -p.vy * 0.15 + (Math.random() - 0.5) * 0.4,
        life: 0.3,
        max: 0.3,
        size: 0.05,
        r: P.player.r * 0.7,
        g: P.player.g * 0.7,
        b: P.player.b * 0.7,
      })
    }
  }

  function update(dt) {
    updateSparks(dt)
    updateDebris(dt)
    updateRings(dt)
    updateLights(dt)
    updateChunks(dt)
  }

  function sync(game, t, dt) {
    syncBullets(game)
    syncBeams(game, t)
    syncMortars(game, t)
    syncMines(game, t, dt)
    syncShocks(game)
    syncSpawns(game, t)
    syncTelegraphs(game, t)
    syncTethers(game, t)
    trail(game.player, dt)
  }

  function reset() {
    sparkList.length = 0
    debrisList.length = 0
    for (const R of rings) {
      R.t = R.dur
      R.m.visible = false
    }
    for (const c of chunks) group.remove(c.m)
    chunks.length = 0
    for (const L of lights) L.l.visible = false
  }

  return {
    P,
    sparks,
    debris,
    ring,
    flash,
    chunk,
    sync,
    update,
    reset,
    dispose() {
      reset()
      scene.remove(group)
      for (const x of owned) x.dispose()
    },
  }
}
