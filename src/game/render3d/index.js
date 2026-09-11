import {
  ACESFilmicToneMapping,
  Color,
  FogExp2,
  Group,
  HalfFloatType,
  MathUtils,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { THEMES } from '../themes.js'
import { TIMING } from '../config.js'
import { createEnvironment } from './environment.js'
import { clamp01, disposeTree, ease, makeGlowTexture, themeMaterials } from './kit.js'
import { buildBlock, buildBoss, buildCore, buildEnemy, buildPlayer, createGeometryCache, setFlash } from './models.js'
import { createFx } from './fx.js'

// The 3D view of a game. It reads the engine's state and events every frame
// and never writes to them. One renderer lives for the whole session; worlds
// (theme + arena size) and levels (one game object) are swapped inside it.

// A slightly lower camera with a narrow lens: depth squeezes less on screen and
// the far edge is not much narrower than the near one.
const PITCH = MathUtils.degToRad(55)
const FOV = 34
// Models are drawn larger than their hitboxes: easier to read at this
// distance, and grazing a bullet feels fair rather than cheap.
const ENEMY_SCALE = 1.3
const PLAYER_SCALE = 1.2

// Last pass before tone mapping: chromatic fringe on hits, film grain,
// vignette, white flashes, and the colour draining out when you die.
const FINAL = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.42 },
    uChroma: { value: 0 },
    uGrain: { value: 0.035 },
    uFlash: { value: 0 },
    uFlashColor: { value: new Color(1, 1, 1) },
    uDesat: { value: 0 },
    // Screen tear when a guardian changes phase, and a scan sweep on a new wave.
    uGlitch: { value: 0 },
    uScan: { value: 1 },
    uScanColor: { value: new Color('#dcd8c0') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uChroma;
    uniform float uGrain;
    uniform float uFlash;
    uniform vec3 uFlashColor;
    uniform float uDesat;
    uniform float uGlitch;
    uniform float uScan;
    uniform vec3 uScanColor;
    varying vec2 vUv;
    float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // Horizontal bands slide apart: the screen tears for a moment.
      if (uGlitch > 0.001) {
        float band = floor(vUv.y * 20.0);
        float n = rand(vec2(band, floor(uTime * 45.0)));
        uv.x = fract(uv.x + (n - 0.5) * 0.14 * uGlitch * step(0.55, n));
      }
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * (0.0025 + (uChroma + uGlitch) * 0.02) * (0.4 + r2 * 2.5);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), uDesat);
      float v = smoothstep(0.85, 0.25, length(d) * 1.2);
      col *= mix(1.0 - uVignette, 1.0, v);
      col += (rand(vUv * 1000.0 + fract(uTime)) - 0.5) * uGrain;
      // A bright line sweeping down the arena announces the next wave.
      if (uScan < 1.0) {
        float band = smoothstep(0.07, 0.0, abs(vUv.y - (1.0 - uScan)));
        col += uScanColor * band * 0.3 * (1.0 - uScan);
      }
      col = mix(col, uFlashColor, uFlash);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
}

export function createRenderer(canvas, options = {}) {
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap

  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  let pixelRatio = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 2)
  let reduced = !!options.reduced
  const insets = { top: 72, bottom: 72 }
  let width = 1
  let height = 1

  const scene = new Scene()
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 600)
  const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: coarse ? 0 : 4 })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.8, 0.5, 0.75)
  composer.addPass(bloom)
  const finalPass = new ShaderPass(FINAL)
  composer.addPass(finalPass)
  composer.addPass(new OutputPass())

  const raycaster = new Raycaster()
  const ndc = new Vector2()
  const hitPlane = new Plane(new Vector3(0, 1, 0), -0.34)
  const hitPoint = new Vector3()

  const G = createGeometryCache()
  const glowTex = makeGlowTexture()
  glowTex.userData.shared = true

  let world = null
  let level = null
  let clock = 0
  let frameNo = 0
  let worldAge = 0

  const cam = { d: 20, lookZ: 0, pos: new Vector3(0, 20, 12), look: new Vector3(), ready: false }
  const post = { chroma: 0, flash: 0, desat: 0, glitch: 0, scan: 1, color: new Color(1, 1, 1) }
  const charging = new Set()
  const ctx = { charging }
  const perf = { acc: 0, n: 0, slow: 0, cooldown: 0 }

  // ---------------------------------------------------------------------------
  // Size and camera fit
  // ---------------------------------------------------------------------------

  function setSize(w, h) {
    width = Math.max(1, Math.round(w))
    height = Math.max(1, Math.round(h))
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    composer.setPixelRatio(pixelRatio)
    composer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (world) fitCamera()
  }

  // Finds the closest camera that still shows the whole arena between the HUD
  // rows, then centres the arena in that band.
  function fitCamera() {
    const { W, D } = world
    const m = 0.75
    const corners = []
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const y of [0, 0.7]) corners.push(new Vector3(sx * (W / 2 + m), y, sz * (D / 2 + m)))
      }
    }
    const yMin = -1 + (2 * insets.bottom) / height
    const yMax = 1 - (2 * insets.top) / height
    const xMax = 0.97
    const v = new Vector3()
    const place = (d, lz) => {
      camera.position.set(0, Math.sin(PITCH) * d, lz + Math.cos(PITCH) * d)
      camera.lookAt(0, 0, lz)
      camera.updateMatrixWorld(true)
    }
    const fits = (d, lz) => {
      place(d, lz)
      for (const c of corners) {
        v.copy(c).project(camera)
        if (v.x < -xMax || v.x > xMax || v.y < yMin || v.y > yMax || v.z > 1) return false
      }
      return true
    }
    const search = (lz) => {
      let lo = 3
      let hi = 200
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2
        if (fits(mid, lz)) hi = mid
        else lo = mid
      }
      return hi
    }
    let lookZ = 0
    let d = search(lookZ)
    for (let pass = 0; pass < 4; pass++) {
      place(d, lookZ)
      const near = v.set(0, 0, D / 2 + m).project(camera).y
      const far = v.set(0, 0, -D / 2 - m).project(camera).y
      lookZ -= ((near + far) / 2 - (yMin + yMax) / 2) * D * 0.35
      d = search(lookZ)
    }
    cam.d = d * 1.02
    cam.lookZ = lookZ
  }

  function setInsets(top, bottom) {
    insets.top = top
    insets.bottom = bottom
    if (world) fitCamera()
  }

  // ---------------------------------------------------------------------------
  // Worlds and levels
  // ---------------------------------------------------------------------------

  function disposeWorld() {
    if (!world) return
    scene.remove(world.env.group)
    world.env.dispose()
    world.fx.dispose()
    world.M.dispose()
    world = null
  }

  function ensureWorld(game) {
    if (world && world.themeId === game.theme && world.W === game.W && world.D === game.D) return
    teardownLevel()
    disposeWorld()
    const theme = THEMES[game.theme] || THEMES.terminal
    const M = themeMaterials(theme, glowTex)
    const env = createEnvironment(game.theme, game.W, game.D, M)
    env.setShadowSize(coarse ? 1024 : 2048)
    scene.add(env.group)
    scene.fog = new FogExp2(theme.fog, theme.fogDensity)
    renderer.setClearColor(theme.fog, 1)
    renderer.toneMappingExposure = theme.exposure
    bloom.strength = theme.bloom.strength
    bloom.radius = theme.bloom.radius
    bloom.threshold = theme.bloom.threshold
    finalPass.uniforms.uScanColor.value.set(theme.floor.line)
    const fx = createFx(scene, M, glowTex, theme)
    world = { themeId: game.theme, W: game.W, D: game.D, theme, M, env, fx }
    worldAge = 0
    fitCamera()
  }

  function teardownLevel() {
    if (!level) return
    scene.remove(level.root)
    disposeTree(level.root)
    level = null
  }

  function ensureLevel(game) {
    if (level && level.game === game) return
    ensureWorld(game)
    teardownLevel()
    const M = world.M
    const root = new Group()
    scene.add(root)
    const player = buildPlayer(M, G)
    root.add(player.root)
    const core = buildCore(game.core, M, G)
    root.add(core.root)
    level = { game, root, player, core, blocks: new Map(), enemies: new Map(), bossActor: null, bossBorn: 0 }
    world.fx.reset()
    cam.ready = false
    post.desat = 0
    // Compile every shader now, not when the first enemy shows up mid-fight.
    try {
      renderer.compile(scene, camera)
    } catch {
      // Harmless: they compile on first use instead.
    }
  }

  // ---------------------------------------------------------------------------
  // Actors
  // ---------------------------------------------------------------------------

  function syncBlocks(game, t, dt) {
    for (const b of game.blocks) {
      let a = level.blocks.get(b)
      if (!a) {
        a = buildBlock(b, world.theme.block.style, world.M)
        level.root.add(a.root)
        level.blocks.set(b, a)
      }
      a.seen = frameNo
      a.update(b, t, dt)
    }
    for (const [b, a] of level.blocks) {
      if (a.seen === frameNo) continue
      level.root.remove(a.root)
      disposeTree(a.root)
      level.blocks.delete(b)
    }
  }

  function syncEnemies(game, t, dt) {
    for (const e of game.enemies) {
      if (!e.alive) continue
      let a = level.enemies.get(e)
      if (!a) {
        a = buildEnemy(e, world.M, G)
        a.born = t
        level.root.add(a.root)
        level.enemies.set(e, a)
      }
      a.seen = frameNo
      a.update(e, t, dt, ctx)
      const age = t - a.born
      a.root.scale.setScalar((age < 0.4 ? Math.max(0.001, ease.outBack(age / 0.4)) : 1) * ENEMY_SCALE)
      const fl = e.flash > 0
      if (fl !== a.flashing) {
        setFlash(a.flashList, fl, world.M.flash)
        a.flashing = fl
      }
      a.bubble.visible = e.shielded
      if (e.shielded) a.bubble.rotation.y += dt * 0.8
    }
    for (const [e, a] of level.enemies) {
      if (a.seen === frameNo) continue
      level.root.remove(a.root)
      level.enemies.delete(e)
    }
  }

  function syncBoss(game, t, dt) {
    const B = game.boss
    if (!B) return
    if (!level.bossActor) {
      const a = buildBoss(B, world.M, G)
      level.root.add(a.root)
      if (a.extra) level.root.add(a.extra)
      level.bossActor = a
      level.bossBorn = t
    }
    const a = level.bossActor
    a.root.visible = B.alive
    if (a.extra) a.extra.visible = B.alive
    if (!B.alive) return
    a.update(B, t, dt, ctx)
    if (a.ownRoot) {
      a.under?.position.set(B.x, 0.03, B.y)
    } else {
      a.root.position.set(B.x, 0, B.y)
      const age = t - level.bossBorn
      const grow = age < 1.2 ? Math.max(0.001, ease.outBack(age / 1.2)) : 1
      a.root.scale.setScalar(grow * (B.flash > 0 ? 1.035 : 1))
    }
  }

  // ---------------------------------------------------------------------------
  // Events -> effects
  // ---------------------------------------------------------------------------

  function handleEvent(ev, game) {
    const fx = world.fx
    const P = fx.P
    switch (ev.type) {
      case 'pop':
        fx.sparks(ev.x, 0.42, ev.y, P.hot, 6, 3)
        fx.ring(ev.x, ev.y, 0.1, 0.55, 0.22, P.hot, 0.8, 0.4)
        break
      case 'hit':
        fx.sparks(ev.x, 0.5, ev.y, ev.target === 'boss' ? P.white : P.trim, 3, 2.6)
        break
      case 'deflect':
        fx.sparks(ev.x, 0.5, ev.y, P.grey, 3, 3.2)
        fx.ring(ev.x, ev.y, 0.05, 0.35, 0.18, P.grey, 0.6, 0.45)
        break
      case 'spark':
        fx.sparks(ev.x, 0.45, ev.y, P.player, 2, 2)
        break
      case 'blockHit':
        fx.sparks(ev.x, 0.4, ev.y, P.accent, 3, 2.4)
        break
      case 'kill': {
        const r = ev.r || 0.4
        fx.sparks(ev.x, 0.5, ev.y, P.trim, Math.round(10 + r * 26), 4 + r * 3)
        fx.sparks(ev.x, 0.5, ev.y, P.white, 6, 3)
        fx.debris(ev.x, 0.5, ev.y, P.hull, Math.round(6 + r * 10), 4, 0.08 + r * 0.12)
        fx.ring(ev.x, ev.y, 0.2, 1 + r * 3, 0.45, P.trim)
        fx.flash(ev.x, ev.y, P.trim, 2.5, 0.25)
        break
      }
      case 'playerHit': {
        const piece = level.player.pieces[ev.seg]
        if (piece) fx.chunk(piece, ev.from + Math.PI)
        fx.sparks(ev.x, 0.4, ev.y, P.player, 16, 4)
        fx.ring(ev.x, ev.y, 0.2, 2.2, 0.4, P.player)
        post.chroma = 1
        break
      }
      case 'playerDown':
        for (const piece of level.player.pieces) if (piece.visible) fx.chunk(piece, Math.random() * Math.PI * 2)
        fx.sparks(ev.x, 0.4, ev.y, P.player, 60, 6)
        fx.debris(ev.x, 0.4, ev.y, new Color(world.theme.player.hull), 16, 5)
        fx.ring(ev.x, ev.y, 0.2, 5, 0.9, P.player)
        fx.flash(ev.x, ev.y, P.player, 6, 0.6, 14)
        post.flash = 0.35
        post.color.set(world.theme.enemy.trim)
        break
      case 'spawn':
        fx.ring(ev.x, ev.y, 0.1, ev.quick ? 0.8 : 1.5, 0.4, P.trim)
        fx.sparks(ev.x, 0.2, ev.y, P.trim, ev.quick ? 4 : 10, 2.5, 1.6)
        break
      case 'blockBreak':
        fx.debris(ev.x, 0.5, ev.y, P.block, 16, 4, 0.14)
        fx.sparks(ev.x, 0.5, ev.y, ev.temp ? P.ice : P.accent, 16, 4)
        fx.ring(ev.x, ev.y, 0.3, 2.2, 0.45, ev.temp ? P.ice : P.accent)
        break
      case 'beamFire':
        if (!ev.line) fx.flash(ev.x, ev.y, P.trim, 2.5, 0.2)
        break
      case 'boom':
        fx.ring(ev.x, ev.y, 0.2, (ev.r || 1) * 1.3, 0.45, P.hot)
        fx.sparks(ev.x, 0.3, ev.y, P.hot, ev.small ? 10 : 18, 4)
        fx.debris(ev.x, 0.3, ev.y, P.hull, ev.small ? 3 : 6, 3.5)
        fx.flash(ev.x, ev.y, P.hot, ev.small ? 2 : 3.5, 0.3)
        break
      case 'mineShot':
        fx.sparks(ev.x, 0.3, ev.y, P.trim, 8, 3)
        fx.ring(ev.x, ev.y, 0.1, 0.8, 0.3, P.trim)
        break
      case 'shieldHit':
        fx.sparks(ev.x, 0.8, ev.y, P.accent, 2, 2)
        break
      case 'wave':
        world.env.pulse()
        post.scan = 0
        // The floor ripples where each enemy is about to arrive.
        for (const s of game.spawns) fx.ring(s.x, s.y, 0.2, 2.2, 0.7, P.trim, 0.5)
        break
      case 'waveClear':
        world.env.pulse()
        post.scan = 0
        fx.ring(game.core.x, game.core.y, 0.5, 5, 0.9, P.accent)
        fx.ring(game.core.x, game.core.y, 0.5, 3, 0.6, P.white, 0.8, 0.07, 0.12)
        fx.debris(game.core.x, 1.2, game.core.y, P.accent, 10, 3)
        fx.flash(game.core.x, game.core.y, P.accent, 2.5, 0.4)
        break
      case 'shieldBreak':
        fx.debris(ev.x, 1.4, ev.y, P.accent, 30, 6, 0.14)
        fx.sparks(ev.x, 1.4, ev.y, P.accent, 50, 7)
        fx.ring(ev.x, ev.y, 0.5, 7, 0.9, P.accent)
        fx.flash(ev.x, ev.y, P.accent, 6, 0.6, 14)
        post.flash = 0.22
        post.color.set(world.theme.floor.accent)
        break
      case 'bossSpawn':
        fx.ring(ev.x, ev.y, 0.5, 9, 1.1, P.trim)
        fx.ring(ev.x, ev.y, 0.5, 5, 0.8, P.white, 1, 0.08, 0.15)
        fx.sparks(ev.x, 1.2, ev.y, P.trim, 50, 6)
        fx.flash(ev.x, ev.y, P.trim, 7, 0.7, 16)
        post.flash = 0.3
        post.glitch = 0.8
        post.color.set(world.theme.enemy.trim)
        break
      case 'bossPhase':
        for (let i = 0; i < 3; i++) {
          fx.ring(ev.x, ev.y, 0.5, 7 + i * 3, 0.7 + i * 0.2, i === 1 ? P.white : P.trim, 1, 0.07, i * 0.1)
        }
        fx.sparks(ev.x, 1.2, ev.y, P.white, 40, 6)
        fx.sparks(ev.x, 1.2, ev.y, P.trim, 30, 5)
        fx.flash(ev.x, ev.y, P.trim, 6, 0.5, 16)
        post.chroma = 1
        post.glitch = 1
        post.flash = 0.18
        post.color.set(world.theme.enemy.trim)
        break
      case 'bossDown':
        fx.sparks(ev.x, 1.2, ev.y, P.trim, 140, 9)
        fx.sparks(ev.x, 1.2, ev.y, P.white, 60, 7)
        fx.debris(ev.x, 1.2, ev.y, P.hull, 60, 7, 0.22)
        fx.debris(ev.x, 1.2, ev.y, P.trim, 20, 6, 0.12)
        for (let i = 0; i < 3; i++) fx.ring(ev.x, ev.y, 0.5, 6 + i * 4, 1 + i * 0.3, i === 1 ? P.white : P.trim, 1, 0.07, i * 0.18)
        fx.flash(ev.x, ev.y, P.white, 9, 1.2, 22)
        post.flash = 0.55
        post.color.set('#ffffff')
        break
      case 'dissolve': {
        const pts = ev.pts
        for (let i = 0; i < pts.length; i += 3) {
          fx.sparks(pts[i], 0.42, pts[i + 1], pts[i + 2] ? P.hot : P.white, 1, 1.4, 0.8, 0.06)
        }
        break
      }
      case 'heal':
        fx.ring(ev.x, ev.y, 0.2, 1.6, 0.6, P.player)
        fx.sparks(ev.x, 0.4, ev.y, P.player, 14, 2.4, 1.5)
        break
      case 'blinkOut':
      case 'blinkIn':
        fx.ring(ev.x, ev.y, 0.1, ev.boss ? 3 : 1.4, 0.35, P.trim)
        fx.sparks(ev.x, 0.6, ev.y, P.trim, ev.boss ? 18 : 8, 3)
        break
      case 'slam':
        fx.ring(ev.x, ev.y, 0.3, ev.small ? 1.6 : 4.5, 0.5, P.trim)
        fx.debris(ev.x, 0.3, ev.y, P.hull, ev.small ? 4 : 14, 4)
        break
      case 'summon':
        fx.ring(ev.x, ev.y, 0.5, 3.2, 0.5, P.trim)
        break
      case 'pillar':
        fx.sparks(ev.x, 0.2, ev.y, P.ice, 14, 3, 1.4)
        fx.ring(ev.x, ev.y, 0.2, 1.4, 0.4, P.ice)
        break
      case 'mortarLaunch':
        fx.sparks(ev.x, 0.8, ev.y, P.hot, 5, 2, 2)
        break
    }
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  function updateCamera(game, dt) {
    const t = clock
    const p = game.player
    let d = cam.d
    let lookX = 0
    let lookZ = cam.lookZ
    let pitch = PITCH
    let yaw = 0

    if (game.phase === 'preview') {
      yaw = Math.sin(t * 0.13) * 0.45
      pitch = MathUtils.degToRad(44)
      d *= 1.08
    } else {
      // A little follow: the camera leans towards where you are.
      lookX += p.x * 0.06
      lookZ += p.y * 0.04
      if (game.phase === 'intro' && !reduced) {
        const k = ease.inOutCubic(clamp01(game.phaseT / TIMING.intro))
        pitch = MathUtils.lerp(MathUtils.degToRad(84), PITCH, k)
        d *= MathUtils.lerp(1.9, 1, k)
        yaw = (1 - k) * 0.9
      } else if (game.phase === 'awaken' && !reduced) {
        const k = Math.sin(clamp01(game.phaseT / TIMING.awaken) * Math.PI)
        d *= 1 - 0.22 * k
        lookX = MathUtils.lerp(lookX, game.core.x, 0.5 * k)
        lookZ = MathUtils.lerp(lookZ, game.core.y, 0.5 * k)
      } else if (game.phase === 'clear' && game.boss && !reduced) {
        const k = ease.outCubic(clamp01(game.phaseT / 1.2)) * (1 - clamp01((game.phaseT - 1.8) / 1))
        d *= 1 - 0.16 * k
        lookX = MathUtils.lerp(lookX, game.boss.x, 0.45 * k)
        lookZ = MathUtils.lerp(lookZ, game.boss.y, 0.45 * k)
      } else if (game.phase === 'dead' && !reduced) {
        const k = ease.outCubic(clamp01(game.phaseT / 1.2))
        d *= 1 - 0.2 * k
        lookX = MathUtils.lerp(lookX, p.x, 0.5 * k)
        lookZ = MathUtils.lerp(lookZ, p.y, 0.5 * k)
      }
    }

    const tx = lookX + Math.sin(yaw) * Math.cos(pitch) * d
    const ty = Math.sin(pitch) * d
    const tz = lookZ + Math.cos(yaw) * Math.cos(pitch) * d
    const k = cam.ready ? 1 - Math.exp(-dt * 5) : 1
    cam.pos.x += (tx - cam.pos.x) * k
    cam.pos.y += (ty - cam.pos.y) * k
    cam.pos.z += (tz - cam.pos.z) * k
    cam.look.x += (lookX - cam.look.x) * k
    cam.look.z += (lookZ - cam.look.z) * k
    cam.ready = true

    const s = reduced ? 0 : game.shake * 0.3
    camera.position.set(
      cam.pos.x + (Math.random() - 0.5) * s,
      cam.pos.y + (Math.random() - 0.5) * s,
      cam.pos.z + (Math.random() - 0.5) * s,
    )
    camera.lookAt(cam.look.x, 0, cam.look.z)
  }

  // ---------------------------------------------------------------------------
  // Quality: step down when frames are slow, so phones stay smooth
  // ---------------------------------------------------------------------------

  function adaptQuality(dt) {
    if (worldAge < 3) return
    perf.acc += dt
    perf.n += 1
    if (dt > 1 / 40) perf.slow += 1
    perf.cooldown -= dt
    if (perf.acc < 2) return
    const slowShare = perf.slow / perf.n
    perf.acc = 0
    perf.n = 0
    perf.slow = 0
    if (slowShare < 0.6 || perf.cooldown > 0) return
    perf.cooldown = 3
    if (pixelRatio > 1.01) {
      pixelRatio = Math.max(1, pixelRatio * 0.8)
      setSize(width, height)
    } else if (renderer.shadowMap.enabled) {
      renderer.shadowMap.enabled = false
      if (world) world.env.sun.castShadow = false
    } else if (bloom.enabled) {
      bloom.enabled = false
    }
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------

  function frame(game, rawDt, events, opts = {}) {
    const dt = Math.min(rawDt, 0.1)
    clock += dt
    frameNo += 1
    worldAge += dt
    if (!game) return

    ensureLevel(game)
    const paused = !!opts.paused
    const slow = game.slow > 0 && !reduced ? 0.35 : 1
    const adt = paused ? 0 : dt * slow
    const t = clock

    if (events) for (const ev of events) handleEvent(ev, game)

    const reveal = game.phase === 'intro' && !reduced ? ease.outCubic(clamp01(game.phaseT / (TIMING.intro * 0.8))) : 1
    world.env.setReveal(reveal)
    const c = game.core
    const B = game.boss
    if (c.alive) world.env.setCore(c.x, c.y, game.phase === 'awaken' ? 1.4 : 0.6)
    else if (B && B.alive) world.env.setCore(B.x, B.y, 0.45)
    else world.env.setCore(0, 0, 0)
    world.env.update(t, adt, pixelRatio)

    charging.clear()
    for (const h of game.hazards) if (h.type === 'beam' && h.warn > 0 && h.owner) charging.add(h.owner)

    syncBlocks(game, t, adt)
    syncEnemies(game, t, adt)
    syncBoss(game, t, adt)
    level.core.update(c, t, adt, game.phase, game.phaseT)
    level.player.update(game.player, t, adt)
    if (game.phase === 'intro') {
      const k = reduced ? 1 : clamp01((game.phaseT - TIMING.intro * 0.45) / 0.45)
      level.player.root.scale.setScalar(Math.max(0.001, ease.outBack(k)) * PLAYER_SCALE)
    } else {
      level.player.root.scale.setScalar(PLAYER_SCALE)
    }

    world.fx.sync(game, t, adt)
    world.fx.update(adt)
    updateCamera(game, dt)

    post.chroma = Math.max(0, post.chroma - dt * 2.2)
    post.flash = Math.max(0, post.flash - dt * 1.6)
    post.glitch = Math.max(0, post.glitch - dt * 2.6)
    post.scan = Math.min(1, post.scan + dt * 1.7)
    const wantDesat = game.phase === 'dead' || game.status === 'lost' ? 0.7 : 0
    post.desat += (wantDesat - post.desat) * (1 - Math.exp(-dt * 3))
    const u = finalPass.uniforms
    u.uTime.value = t
    u.uChroma.value = reduced ? 0 : post.chroma
    u.uFlash.value = reduced ? post.flash * 0.3 : post.flash
    u.uFlashColor.value.copy(post.color)
    u.uDesat.value = post.desat
    u.uGlitch.value = reduced ? 0 : post.glitch
    u.uScan.value = reduced ? 1 : post.scan
    u.uVignette.value = world.theme.light2 ? 0.25 : 0.42

    composer.render(dt)
    adaptQuality(rawDt)
  }

  // Pointer position on the canvas -> arena coordinates (engine x/y).
  function screenToWorld(px, py) {
    ndc.set((px / width) * 2 - 1, -(py / height) * 2 + 1)
    raycaster.setFromCamera(ndc, camera)
    if (!raycaster.ray.intersectPlane(hitPlane, hitPoint)) return null
    return { x: hitPoint.x, y: hitPoint.z }
  }

  return {
    setSize,
    setInsets,
    frame,
    screenToWorld,
    setReduced(v) {
      reduced = !!v
    },
    // For the dev tools only.
    debug: { scene, camera, bloom, composer, renderer },
    dispose() {
      teardownLevel()
      disposeWorld()
      G.dispose()
      glowTex.dispose()
      bloom.dispose?.()
      composer.dispose?.()
      target.dispose()
      renderer.dispose()
    },
  }
}
