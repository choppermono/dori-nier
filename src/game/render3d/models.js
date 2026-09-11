import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
} from 'three'
import { PLAYER } from '../config.js'
import { clamp01, ease, hdr } from './kit.js'

// Every 3D model in the game, built from primitives. Enemy geometry is cached
// per renderer (a wave of twelve wasps shares one cone); materials come from
// the world's set in kit.js, so models recolour with the theme for free.
//
// Engine coordinates map as (x, y) -> (x, height, z). A model faces +x and is
// turned with rotation.y = -angle.

export function createGeometryCache() {
  const map = new Map()
  return {
    get(key, make) {
      let g = map.get(key)
      if (!g) {
        g = make()
        g.userData.shared = true
        map.set(key, g)
      }
      return g
    },
    dispose() {
      map.forEach((g) => g.dispose())
      map.clear()
    },
  }
}

function pair(G, key, make) {
  const geo = G.get(key, make)
  return [geo, G.get(`${key}:edges`, () => new EdgesGeometry(geo, 25))]
}

function solid(geo, mat, edges, edgeMat) {
  const m = new Mesh(geo, mat)
  m.castShadow = true
  m.userData.baseMat = mat
  if (edges) m.add(new LineSegments(edges, edgeMat))
  return m
}

function glow(G, mat, size, y = 0.03) {
  const m = new Mesh(
    G.get('glowPlane', () => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
    mat,
  )
  m.scale.setScalar(size)
  m.position.y = y
  m.renderOrder = 2
  return m
}

function sphere(G, r, key = `sphere:${r}`) {
  return G.get(key, () => new SphereGeometry(r, 12, 9))
}

// A flat outline in the ground plane, extruded upward.
function extrude(pts, depth, bevel = 0.02) {
  const s = new Shape()
  s.moveTo(pts[0][0], -pts[0][1])
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], -pts[i][1])
  s.closePath()
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  })
  g.rotateX(-Math.PI / 2)
  g.translate(0, -depth / 2, 0)
  return g
}

function lerp(a, b, k) {
  return a + (b - a) * k
}

export function collectFlashables(root) {
  const list = []
  root.traverse((o) => {
    if (o.isMesh && o.userData.baseMat) list.push(o)
  })
  return list
}

export function setFlash(list, on, flashMat) {
  for (const m of list) m.material = on ? flashMat : m.userData.baseMat
}

// ---------------------------------------------------------------------------
// The player: a diamond of four segments, each centred on its own side.
// ---------------------------------------------------------------------------

export function buildPlayer(M, G) {
  const root = new Group()
  const body = new Group()
  body.rotation.order = 'YXZ'
  root.add(body)

  const r = PLAYER.radius * 1.18
  const V = [
    [r * 1.5, 0],
    [0, r * 1.05],
    [-r * 1.05, 0],
    [0, -r * 1.05],
  ]
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const pieces = []
  for (let i = 0; i < 4; i++) {
    const prev = V[(i + 3) % 4]
    const cur = V[i]
    const next = V[(i + 1) % 4]
    let pts = [[0, 0], mid(prev, cur), cur, mid(cur, next)]
    // Shrink towards the piece's own centre: a hairline seam between segments.
    const cx = pts.reduce((s, p) => s + p[0], 0) / 4
    const cz = pts.reduce((s, p) => s + p[1], 0) / 4
    pts = pts.map(([x, z]) => [cx + (x - cx) * 0.93, cz + (z - cz) * 0.93])
    const geo = extrude(pts, 0.13, 0.02)
    const m = solid(geo, M.playerHull, new EdgesGeometry(geo, 30), M.playerEdge)
    m.userData.dir = (i * Math.PI) / 2
    m.userData.pts = pts
    body.add(m)
    pieces.push(m)
  }

  const core = new Mesh(sphere(G, 0.085), M.playerTrim)
  core.position.y = 0.12
  body.add(core)
  const nose = new Mesh(G.get('player.nose', () => new BoxGeometry(0.16, 0.05, 0.05)), M.playerTrim)
  nose.position.set(r * 1.25, 0.05, 0)
  body.add(nose)
  const under = glow(G, M.glowPlayer, 1.7, -0.28)
  root.add(under)

  // Aim guide: dots running forward, so you can aim with the front gone.
  const aimMat = M.extra(
    'aimDots',
    () =>
      new MeshBasicMaterial({
        color: hdr('#ffffff', 1),
        transparent: true,
        opacity: M.light ? 0.5 : 0.35,
        depthWrite: false,
        toneMapped: false,
      }),
  )
  aimMat.color.copy(M.playerTrim.color).multiplyScalar(0.5)
  const aim = new Group()
  const dotGeo = G.get('aimDot', () => new PlaneGeometry(0.07, 0.07).rotateX(-Math.PI / 2))
  for (let i = 0; i < 6; i++) {
    const d = new Mesh(dotGeo, aimMat)
    d.position.set(0.75 + i * 0.36, -0.26, 0)
    d.scale.setScalar(1 - i * 0.12)
    aim.add(d)
  }
  body.add(aim)

  const regrow = [0, 0, 0, 0]
  const shown = [true, true, true, true]
  let roll = 0
  let pitch = 0

  return {
    root,
    body,
    pieces,
    update(p, t, dt) {
      root.position.set(p.x, 0.34 + Math.sin(t * 4) * 0.035, p.y)
      body.rotation.y = -p.angle
      const lat = -p.vx * Math.sin(p.angle) + p.vy * Math.cos(p.angle)
      const fwd = p.vx * Math.cos(p.angle) + p.vy * Math.sin(p.angle)
      const k = 1 - Math.exp(-dt * 10)
      roll = lerp(roll, Math.max(-0.45, Math.min(0.45, -lat * 0.055)), k)
      pitch = lerp(pitch, Math.max(-0.2, Math.min(0.2, -fwd * 0.02)), k)
      body.rotation.x = roll
      body.rotation.z = pitch
      for (let i = 0; i < 4; i++) {
        const alive = p.segments[i]
        if (alive && !shown[i]) regrow[i] = 0.001
        shown[i] = alive
        pieces[i].visible = alive
        if (regrow[i] > 0) {
          regrow[i] = Math.min(1, regrow[i] + dt * 2.5)
          pieces[i].scale.setScalar(ease.outBack(regrow[i]))
          if (regrow[i] >= 1) regrow[i] = 0
        }
      }
      root.visible = p.alive && (p.invuln <= 0 || Math.floor(p.invuln * 16) % 2 === 0)
      aim.visible = p.alive
      core.scale.setScalar(p.firing ? 1.25 + Math.sin(t * 40) * 0.15 : 1)
    },
  }
}

// ---------------------------------------------------------------------------
// Enemies
// ---------------------------------------------------------------------------

const ENEMY_BUILDERS = {
  sentry(M, G) {
    const root = new Group()
    const [bg, be] = pair(G, 'sentry.base', () => new CylinderGeometry(0.44, 0.52, 0.26, 6))
    const base = solid(bg, M.enemyHull, be, M.enemyEdge)
    base.position.y = 0.13
    const ring = new Mesh(G.get('sentry.ring', () => new TorusGeometry(0.47, 0.035, 6, 28)), M.enemyGlow)
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.28
    const head = new Group()
    head.position.y = 0.62
    const [hg, he] = pair(G, 'sentry.head', () => new OctahedronGeometry(0.34).scale(1, 0.8, 1))
    head.add(solid(hg, M.enemyHull, he, M.enemyEdge))
    const barrel = solid(G.get('sentry.barrel', () => new BoxGeometry(0.5, 0.09, 0.09)), M.enemyTrim)
    barrel.position.x = 0.4
    head.add(barrel)
    const eye = new Mesh(sphere(G, 0.075), M.enemyGlow)
    eye.position.set(0.2, 0.09, 0)
    head.add(eye)
    root.add(base, ring, head, glow(G, M.glowEnemy, 1.6))
    return {
      root,
      height: 0.6,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        head.rotation.y = -e.angle
        ring.rotation.z += dt * 1.2
        eye.scale.setScalar(1 + (Math.max(0, 0.35 - e.cd) / 0.35) * 1.6)
      },
    }
  },

  hunter(M, G) {
    const root = new Group()
    const body = new Group()
    body.rotation.order = 'YXZ'
    const [ag, ae] = pair(G, 'hunter.body', () =>
      extrude(
        [
          [0.48, 0],
          [-0.3, 0.32],
          [-0.12, 0],
          [-0.3, -0.32],
        ],
        0.12,
      ),
    )
    body.add(solid(ag, M.enemyHull, ae, M.enemyEdge))
    const fin = solid(G.get('hunter.fin', () => new BoxGeometry(0.3, 0.15, 0.035)), M.enemyTrim)
    fin.position.set(-0.08, 0.12, 0)
    body.add(fin)
    for (const s of [-1, 1]) {
      const jet = new Mesh(sphere(G, 0.06), M.enemyGlow)
      jet.position.set(-0.26, 0.02, 0.16 * s)
      body.add(jet)
    }
    root.add(body, glow(G, M.glowEnemy, 1.4))
    let roll = 0
    return {
      root,
      height: 0.45,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        body.position.y = 0.45 + Math.sin(t * 3 + e.id) * 0.04
        body.rotation.y = -e.angle
        const lat = -e.vx * Math.sin(e.angle) + e.vy * Math.cos(e.angle)
        roll = lerp(roll, Math.max(-0.5, Math.min(0.5, -lat * 0.13)), 1 - Math.exp(-dt * 8))
        body.rotation.x = roll
      },
    }
  },

  ram(M, G) {
    const root = new Group()
    const body = new Group()
    body.rotation.order = 'YXZ'
    const [wg, we] = pair(G, 'ram.body', () =>
      extrude(
        [
          [0.58, 0],
          [-0.36, 0.44],
          [-0.24, 0],
          [-0.36, -0.44],
        ],
        0.3,
        0.04,
      ),
    )
    body.add(solid(wg, M.enemyHull, we, M.enemyEdge))
    const hornGeo = G.get('ram.horn', () => new ConeGeometry(0.07, 0.46, 5).rotateZ(-Math.PI / 2))
    for (const s of [-1, 1]) {
      const h = solid(hornGeo, M.enemyTrim)
      h.position.set(0.3, 0.1, 0.24 * s)
      body.add(h)
    }
    const eye = new Mesh(sphere(G, 0.08), M.enemyGlow)
    eye.position.set(0.22, 0.2, 0)
    body.add(eye)
    root.add(body, glow(G, M.glowEnemy, 1.8))
    return {
      root,
      height: 0.35,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        body.rotation.y = -e.angle
        const mode = e.state.mode
        const wind = mode === 'windup'
        body.position.set(wind ? (Math.random() - 0.5) * 0.06 : 0, 0.32, wind ? (Math.random() - 0.5) * 0.06 : 0)
        body.rotation.z = lerp(body.rotation.z, mode === 'dash' ? -0.22 : wind ? 0.12 : 0, 1 - Math.exp(-dt * 10))
        eye.scale.setScalar(wind ? 2.2 + Math.sin(t * 40) * 0.4 : mode === 'dash' ? 1.8 : 1)
      },
    }
  },

  orbiter(M, G) {
    const root = new Group()
    const core = new Group()
    core.position.y = 0.65
    const [cg, ce] = pair(G, 'orbiter.core', () => new BoxGeometry(0.3, 0.3, 0.3))
    const cube = solid(cg, M.enemyHull, ce, M.enemyEdge)
    core.add(cube)
    const ringGeo = G.get('orbiter.ring', () => new TorusGeometry(0.38, 0.03, 6, 30))
    const r1 = new Mesh(ringGeo, M.enemyGlow)
    const r2 = new Mesh(ringGeo, M.enemyGlow)
    r2.rotation.x = Math.PI / 2
    core.add(r1, r2)
    const gun = solid(G.get('orbiter.gun', () => new BoxGeometry(0.3, 0.06, 0.06)), M.enemyTrim)
    gun.position.x = 0.28
    const aim = new Group()
    aim.add(gun)
    core.add(aim)
    root.add(core, glow(G, M.glowEnemy, 1.3))
    return {
      root,
      height: 0.65,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        core.position.y = 0.65 + Math.sin(t * 2.5 + e.id) * 0.06
        cube.rotation.x += dt * 1.4
        cube.rotation.y += dt * 1.9
        r1.rotation.y += dt * 2
        r2.rotation.z += dt * 2.6
        aim.rotation.y = -e.angle
      },
    }
  },

  spinner(M, G) {
    const root = new Group()
    const [hg, he] = pair(G, 'spinner.hub', () => new CylinderGeometry(0.24, 0.3, 0.26, 8))
    const hub = solid(hg, M.enemyHull, he, M.enemyEdge)
    hub.position.y = 0.45
    const blades = new Group()
    blades.position.y = 0.45
    const bladeGeo = pair(G, 'spinner.blade', () => new BoxGeometry(0.72, 0.07, 0.2))
    const tipGeo = G.get('spinner.tip', () => new BoxGeometry(0.16, 0.12, 0.26))
    for (let k = 0; k < 3; k++) {
      const arm = new Group()
      arm.rotation.y = -(k * Math.PI * 2) / 3
      const b = solid(bladeGeo[0], M.enemyHull, bladeGeo[1], M.enemyEdge)
      b.position.x = 0.46
      arm.add(b)
      const tip = new Mesh(tipGeo, M.enemyGlow)
      tip.position.x = 0.86
      arm.add(tip)
      blades.add(arm)
    }
    root.add(hub, blades, glow(G, M.glowEnemy, 2.2))
    return {
      root,
      height: 0.45,
      update(e, t) {
        root.position.set(e.x, 0, e.y)
        blades.rotation.y = -e.angle
        hub.rotation.y = e.angle * 0.5
        blades.position.y = 0.45 + Math.sin(t * 2 + e.id) * 0.03
      },
    }
  },

  splitter(M, G) {
    const root = new Group()
    const cluster = new Group()
    cluster.position.y = 0.55
    const [ig, ie] = pair(G, 'splitter.ico', () => new IcosahedronGeometry(0.27, 0))
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2
      const m = solid(ig, M.enemyHull, ie, M.enemyEdge)
      m.position.set(Math.cos(a) * 0.2, Math.sin(k * 2.1) * 0.06, Math.sin(a) * 0.2)
      cluster.add(m)
    }
    const heart = new Mesh(sphere(G, 0.15), M.enemyGlow)
    cluster.add(heart)
    root.add(cluster, glow(G, M.glowEnemy, 1.9))
    return {
      root,
      height: 0.55,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        cluster.rotation.y += dt * 0.9
        cluster.rotation.x = Math.sin(t * 1.3 + e.id) * 0.3
        const beat = 1 + Math.max(0, Math.sin(t * 5 + e.id)) * 0.08
        cluster.scale.setScalar(beat)
        heart.scale.setScalar(0.9 + (1 - e.hp / e.maxHp) * 0.8)
      },
    }
  },

  shard(M, G) {
    const root = new Group()
    const [tg, te] = pair(G, 'shard.tet', () => new TetrahedronGeometry(0.27))
    const m = solid(tg, M.enemyTrim, te, M.enemyEdge)
    m.position.y = 0.4
    root.add(m, glow(G, M.glowEnemy, 1.1))
    return {
      root,
      height: 0.4,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        m.rotation.x += dt * 6
        m.rotation.y += dt * 4
      },
    }
  },

  weaver(M, G) {
    const root = new Group()
    const top = new Group()
    top.position.y = 0.52
    const [dg, de] = pair(G, 'weaver.disc', () => new CylinderGeometry(0.44, 0.36, 0.14, 12))
    top.add(solid(dg, M.enemyHull, de, M.enemyEdge))
    const dome = solid(
      G.get('weaver.dome', () => new SphereGeometry(0.24, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
      M.enemyTrim,
    )
    dome.position.y = 0.06
    top.add(dome)
    const belly = new Mesh(G.get('weaver.belly', () => new TorusGeometry(0.28, 0.035, 6, 24)), M.enemyGlow)
    belly.rotation.x = Math.PI / 2
    belly.position.y = -0.1
    top.add(belly)
    const legs = []
    const legGeo = G.get('weaver.leg', () => new BoxGeometry(0.05, 0.5, 0.05).translate(0, -0.25, 0))
    for (let k = 0; k < 6; k++) {
      const pivot = new Group()
      const a = (k / 6) * Math.PI * 2
      pivot.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36)
      pivot.rotation.y = -a
      const leg = solid(legGeo, M.enemyHull)
      leg.rotation.z = 0.5
      pivot.add(leg)
      top.add(pivot)
      legs.push(leg)
    }
    root.add(top, glow(G, M.glowEnemy, 1.8))
    return {
      root,
      height: 0.5,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        top.rotation.y += dt * 0.6
        const speed = Math.hypot(e.vx, e.vy)
        legs.forEach((leg, k) => (leg.rotation.z = 0.5 + Math.sin(t * 9 + k * 1.3) * 0.18 * Math.min(1, speed)))
        belly.scale.setScalar(1 + Math.max(0, 0.5 - e.abilityCd) * 1.2)
      },
    }
  },

  lancer(M, G) {
    const root = new Group()
    const [bg, be] = pair(G, 'lancer.base', () => new CylinderGeometry(0.4, 0.46, 0.2, 6))
    const base = solid(bg, M.enemyHull, be, M.enemyEdge)
    base.position.y = 0.1
    const [sg, se] = pair(G, 'lancer.spire', () => new ConeGeometry(0.2, 1.4, 4))
    const spire = solid(sg, M.enemyHull, se, M.enemyEdge)
    spire.position.y = 0.9
    const head = new Group()
    head.position.y = 0.72
    const lens = new Mesh(G.get('lancer.lens', () => new TorusGeometry(0.26, 0.04, 6, 26)), M.enemyGlow)
    lens.rotation.y = Math.PI / 2
    lens.position.x = 0.22
    head.add(lens)
    const emitter = new Mesh(G.get('lancer.emit', () => new OctahedronGeometry(0.1)), M.enemyGlow)
    emitter.position.x = 0.3
    head.add(emitter)
    root.add(base, spire, head, glow(G, M.glowEnemy, 1.5))
    return {
      root,
      height: 0.72,
      update(e, t, dt, ctx) {
        root.position.set(e.x, 0, e.y)
        head.rotation.y = -e.angle
        const charging = ctx.charging.has(e)
        lens.rotation.x += dt * (charging ? 14 : 1.5)
        const s = charging ? 1.35 + Math.sin(t * 30) * 0.12 : 1
        lens.scale.setScalar(s)
        emitter.scale.setScalar(charging ? 2 : 1)
      },
    }
  },

  warden(M, G) {
    const root = new Group()
    const core = new Group()
    core.position.y = 0.62
    const [tg, te] = pair(G, 'warden.core', () => new TetrahedronGeometry(0.38))
    const tet = solid(tg, M.enemyHull, te, M.enemyEdge)
    core.add(tet)
    const hexGeo = G.get('warden.hex', () => new CylinderGeometry(0.2, 0.2, 0.04, 6))
    const panels = new Group()
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2
      const hx = solid(hexGeo, M.enemyTrim)
      hx.position.set(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62)
      hx.rotation.set(Math.PI / 2, 0, -a)
      panels.add(hx)
    }
    core.add(panels)
    const field = new Mesh(G.get('warden.field', () => new RingGeometry(6.42, 6.5, 96).rotateX(-Math.PI / 2)), M.fieldRing)
    field.position.y = 0.04
    root.add(core, field, glow(G, M.glowEnemy, 2))
    return {
      root,
      height: 0.62,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        core.position.y = 0.62 + Math.sin(t * 2 + e.id) * 0.05
        tet.rotation.y += dt * 1.1
        tet.rotation.x += dt * 0.7
        panels.rotation.y -= dt * 1.6
        field.rotation.y += dt * 0.2
      },
    }
  },

  mortar(M, G) {
    const root = new Group()
    const [bg, be] = pair(G, 'mortar.base', () => new CylinderGeometry(0.46, 0.54, 0.3, 8))
    const base = solid(bg, M.enemyHull, be, M.enemyEdge)
    base.position.y = 0.15
    const dome = solid(
      G.get('mortar.dome', () => new SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)),
      M.enemyHull,
    )
    dome.position.y = 0.3
    const turret = new Group()
    turret.position.y = 0.42
    const barrel = solid(
      G.get('mortar.barrel', () => new CylinderGeometry(0.1, 0.14, 0.64, 10).rotateZ(-Math.PI / 2).translate(0.3, 0, 0)),
      M.enemyTrim,
    )
    barrel.rotation.z = 0.7
    turret.add(barrel)
    const muzzle = new Mesh(G.get('mortar.muzzle', () => new TorusGeometry(0.12, 0.03, 6, 16)), M.enemyGlow)
    muzzle.position.set(Math.cos(0.7) * 0.6, Math.sin(0.7) * 0.6, 0)
    muzzle.rotation.y = Math.PI / 2
    muzzle.rotation.x = 0.7
    turret.add(muzzle)
    root.add(base, dome, turret, glow(G, M.glowEnemy, 1.9))
    return {
      root,
      height: 0.5,
      update(e, t) {
        root.position.set(e.x, 0, e.y)
        turret.rotation.y = -e.angle
        muzzle.scale.setScalar(1 + (Math.max(0, 0.5 - e.cd) / 0.5) * 1.2)
      },
    }
  },

  phantom(M, G) {
    const root = new Group()
    const body = new Group()
    body.position.y = 0.58
    const heart = new Mesh(sphere(G, 0.13), M.enemyGlow)
    body.add(heart)
    const [tg, te] = pair(G, 'phantom.shard', () => new TetrahedronGeometry(0.14))
    const orbit = new Group()
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2
      const m = solid(tg, M.enemyHull, te, M.enemyEdge)
      m.position.set(Math.cos(a) * 0.34, Math.sin(k * 1.7) * 0.1, Math.sin(a) * 0.34)
      orbit.add(m)
    }
    body.add(orbit)
    root.add(body, glow(G, M.glowEnemy, 1.4))
    return {
      root,
      height: 0.58,
      update(e, t, dt) {
        root.position.set(e.x, 0, e.y)
        orbit.rotation.y += dt * 3
        orbit.rotation.x = Math.sin(t * 2) * 0.4
        const s = e.state
        let k = 1
        if (s.mode === 'out') k = clamp01(s.t / 0.4)
        else if (s.mode === 'hidden') k = 0
        else if (s.mode === 'in') k = (1 - clamp01(s.t / 0.55)) * (Math.sin(t * 50) > 0 ? 1 : 0.6)
        body.scale.setScalar(Math.max(0.001, k))
        root.visible = e.visible
      },
    }
  },

  wasp(M, G) {
    const root = new Group()
    const body = new Group()
    body.position.y = 0.5
    const hull = solid(G.get('wasp.body', () => new ConeGeometry(0.1, 0.38, 4).rotateZ(-Math.PI / 2)), M.enemyTrim)
    body.add(hull)
    const wingMat = M.extra(
      'waspWing',
      () =>
        new MeshBasicMaterial({
          color: M.enemyGlow.color.clone().multiplyScalar(0.6),
          transparent: true,
          opacity: 0.55,
          side: DoubleSide,
          blending: M.glowBlend,
          depthWrite: false,
          toneMapped: false,
        }),
    )
    const wingGeo = G.get('wasp.wing', () => new PlaneGeometry(0.2, 0.26).rotateX(-Math.PI / 2).translate(0, 0, 0.14))
    const wings = []
    for (const s of [-1, 1]) {
      const w = new Mesh(wingGeo, wingMat)
      w.scale.z = s
      body.add(w)
      wings.push(w)
    }
    root.add(body, glow(G, M.glowEnemy, 0.9))
    return {
      root,
      height: 0.5,
      update(e, t) {
        root.position.set(e.x, 0, e.y)
        body.rotation.y = -e.angle
        body.position.y = 0.5 + Math.sin(t * 8 + e.id) * 0.05
        const flap = Math.sin(t * 60 + e.id) * 0.6
        wings[0].rotation.x = flap
        wings[1].rotation.x = -flap
      },
    }
  },

  bulwark(M, G) {
    const root = new Group()
    const body = new Group()
    const [bg, be] = pair(G, 'bulwark.body', () => new BoxGeometry(0.82, 0.42, 0.72))
    const hull = solid(bg, M.enemyHull, be, M.enemyEdge)
    hull.position.y = 0.36
    body.add(hull)
    const treadGeo = G.get('bulwark.tread', () => new BoxGeometry(0.94, 0.2, 0.16))
    for (const s of [-1, 1]) {
      const tr = solid(treadGeo, M.enemyPlate)
      tr.position.set(0, 0.12, 0.38 * s)
      body.add(tr)
    }
    // The shield arc faces forward; the glowing core at the back is the target.
    const shield = solid(
      G.get('bulwark.shield', () => new CylinderGeometry(0.74, 0.74, 0.64, 18, 1, true, 0, Math.PI)),
      M.enemyPlate,
    )
    shield.position.y = 0.4
    body.add(shield)
    const rim = new Mesh(G.get('bulwark.rim', () => new TorusGeometry(0.74, 0.03, 4, 24, Math.PI)), M.enemyGlow)
    rim.rotation.set(Math.PI / 2, Math.PI / 2, 0)
    rim.position.y = 0.72
    body.add(rim)
    const weak = new Mesh(sphere(G, 0.14), M.enemyGlow)
    weak.position.set(-0.46, 0.42, 0)
    body.add(weak)
    root.add(body, glow(G, M.glowEnemy, 2.1))
    return {
      root,
      height: 0.45,
      update(e, t) {
        root.position.set(e.x, 0, e.y)
        body.rotation.y = -e.angle
        weak.scale.setScalar(1 + Math.sin(t * 6) * 0.25)
        body.position.y = Math.abs(Math.sin(t * 8)) * 0.02 * Math.min(1, Math.hypot(e.vx, e.vy))
      },
    }
  },
}

export function buildEnemy(e, M, G) {
  const make = ENEMY_BUILDERS[e.type] || ENEMY_BUILDERS.sentry
  const actor = make(M, G)
  // Anything armoured that is not a Bulwark gets a shield plate bolted on.
  if (e.armored && e.type !== 'bulwark') {
    const plate = solid(
      G.get('armor.plate', () => new CylinderGeometry(1, 1, 0.5, 16, 1, true, 0, Math.PI)),
      M.enemyPlate,
    )
    plate.scale.set(e.r * 1.35, 1, e.r * 1.35)
    plate.position.y = 0.45
    const holder = new Group()
    holder.add(plate)
    actor.root.add(holder)
    const inner = actor.update
    actor.update = (en, t, dt, ctx) => {
      inner(en, t, dt, ctx)
      holder.rotation.y = -en.angle
    }
  }
  const bubble = new Mesh(G.get('bubble', () => new IcosahedronGeometry(1, 1)), M.shieldBubble)
  bubble.scale.setScalar(e.r * 1.6)
  bubble.position.y = actor.height
  bubble.visible = false
  actor.root.add(bubble)
  actor.bubble = bubble
  actor.flashList = collectFlashables(actor.root)
  actor.flashing = false
  actor.root.traverse((o) => {
    if (o.isMesh && o.userData.baseMat) o.castShadow = true
  })
  return actor
}

// ---------------------------------------------------------------------------
// Core: the sleeping heart of each sector
// ---------------------------------------------------------------------------

const PILLAR_VERT = /* glsl */ `
  varying float vY;
  void main() {
    vY = uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const PILLAR_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uAlpha;
  varying float vY;
  void main() {
    float a = (1.0 - vY) * (0.55 + 0.45 * sin(vY * 30.0 - uTime * 4.0)) * uAlpha;
    gl_FragColor = vec4(uColor, a * 0.5);
  }
`

export function buildCore(core, M, G) {
  const root = new Group()
  root.position.set(core.x, 0, core.y)
  const body = new Group()
  body.position.y = 1.15
  root.add(body)

  const [ig, ie] = pair(G, 'core.hull', () => new IcosahedronGeometry(0.85, 0))
  const hull = solid(ig, M.enemyHull, ie, M.accentEdge)
  body.add(hull)
  const heart = new Mesh(sphere(G, 0.4, 'core.heart'), M.accentGlow)
  body.add(heart)

  const bubble = new Mesh(G.get('core.bubble', () => new IcosahedronGeometry(1.35, 1)), M.coreBubble)
  body.add(bubble)

  const shields = []
  const [sg, se] = pair(G, 'core.shield', () => new BoxGeometry(0.28, 0.28, 0.28))
  for (let k = 0; k < 3; k++) {
    const pivot = new Group()
    pivot.rotation.set(k * 0.9, k * 2.1, k * 0.4)
    const m = solid(sg, M.enemyPlate, se, M.accentEdge)
    m.position.x = 1.7
    pivot.add(m)
    body.add(pivot)
    shields.push({ pivot, mesh: m })
  }

  const pillarMat = M.extra(
    'pillar',
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: hdr(M.accentGlow.color.getHex(), 1) }, uTime: { value: 0 }, uAlpha: { value: 1 } },
        vertexShader: PILLAR_VERT,
        fragmentShader: PILLAR_FRAG,
        transparent: true,
        depthWrite: false,
        blending: M.glowBlend,
        side: DoubleSide,
        toneMapped: false,
      }),
  )
  pillarMat.uniforms.uColor.value.copy(M.accentGlow.color).multiplyScalar(0.45)
  const pillar = new Mesh(G.get('core.pillar', () => new CylinderGeometry(0.34, 0.34, 16, 20, 1, true).translate(0, 8, 0)), pillarMat)
  pillar.position.y = 1.2
  root.add(pillar)

  const ringMat = M.extra(
    'coreRing',
    () =>
      new MeshBasicMaterial({
        color: M.accentGlow.color.clone().multiplyScalar(0.6),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: M.glowBlend,
        side: DoubleSide,
        toneMapped: false,
      }),
  )
  const threat = new Mesh(G.get('core.threat', () => new RingGeometry(1.9, 2.0, 6, 1).rotateX(-Math.PI / 2)), ringMat)
  threat.position.y = 0.04
  root.add(threat, glow(G, M.glowAccent, 5.5))

  let rise = 0
  return {
    root,
    update(c, t, dt, phase, phaseT) {
      root.visible = c.alive
      if (!c.alive) return
      const awakening = phase === 'awaken'
      rise = lerp(rise, awakening ? 1 : 0, 1 - Math.exp(-dt * 2))
      body.position.y = 1.15 + Math.sin(t * 1.6) * 0.1 + rise * 0.9
      const jitter = awakening ? Math.min(1, phaseT / 3) * 0.08 : 0
      body.position.x = (Math.random() - 0.5) * jitter
      body.position.z = (Math.random() - 0.5) * jitter
      hull.rotation.x = c.spin * 0.6
      hull.rotation.y = c.spin
      heart.scale.setScalar(1 + Math.sin(t * 3) * 0.08 + rise * 0.6 + (c.flash > 0 ? 0.25 : 0))
      bubble.visible = c.shielded
      bubble.rotation.y -= dt * 0.3
      bubble.scale.setScalar(c.flash > 0 ? 1.06 : 1)
      shields.forEach((s, k) => {
        s.pivot.visible = k < c.shields
        s.pivot.rotation.y += dt * (0.8 + k * 0.25)
        s.mesh.rotation.x += dt * 2
      })
      threat.rotation.y -= dt * 0.4
      pillarMat.uniforms.uTime.value = t
      pillarMat.uniforms.uAlpha.value = c.shielded ? 1 : 0.4 + rise
      pillar.visible = true
    },
  }
}

// ---------------------------------------------------------------------------
// Bosses
// ---------------------------------------------------------------------------

function ownGeo(geo) {
  return geo
}

const BOSS_BUILDERS = {
  gatekeeper(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.35
    const oct = new OctahedronGeometry(0.95)
    const hull = solid(oct, M.enemyHull, new EdgesGeometry(oct), M.enemyEdge)
    body.add(hull)
    const face = new Group()
    const eye = new Mesh(new SphereGeometry(0.22, 14, 10), M.enemyGlow)
    eye.position.x = 0.62
    face.add(eye)
    body.add(face)
    const halo = new Mesh(new TorusGeometry(1.45, 0.05, 6, 56), M.enemyGlow)
    halo.rotation.x = Math.PI / 2
    body.add(halo)
    const sats = new Group()
    const box = new BoxGeometry(0.36, 0.36, 0.36)
    const boxE = new EdgesGeometry(box)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2
      const m = solid(box, M.enemyPlate, boxE, M.enemyEdge)
      m.position.set(Math.cos(a) * 1.8, Math.sin(k * 1.6) * 0.2, Math.sin(a) * 1.8)
      sats.add(m)
    }
    body.add(sats)
    root.add(body)
    return {
      root,
      height: 1.35,
      update(B, t, dt) {
        body.position.y = 1.35 + Math.sin(t * 1.5) * 0.12
        hull.rotation.y += dt * (0.5 + B.phase * 0.4)
        face.rotation.y = -B.angle
        halo.rotation.z += dt * 0.8
        sats.rotation.y -= dt * (0.9 + B.phase * 0.5)
      },
    }
  },

  cryo(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.45
    const crystal = new OctahedronGeometry(0.5, 0)
    crystal.scale(0.42, 1.7, 0.42)
    const cE = new EdgesGeometry(crystal)
    const dirs = [
      [0, 1, 0],
      [0, -1, 0],
      [1, 0.2, 0],
      [-1, 0.2, 0],
      [0, 0.2, 1],
      [0, 0.2, -1],
      [0.7, 0.6, 0.7],
      [-0.7, 0.6, -0.7],
      [0.7, -0.5, -0.7],
      [-0.7, -0.5, 0.7],
    ]
    const spikes = new Group()
    for (const [x, y, z] of dirs) {
      const m = solid(crystal, M.blockIce, cE, M.enemyEdge)
      const len = Math.hypot(x, y, z)
      m.position.set((x / len) * 0.75, (y / len) * 0.75, (z / len) * 0.75)
      m.lookAt(m.position.clone().multiplyScalar(2))
      m.rotateX(Math.PI / 2)
      spikes.add(m)
    }
    body.add(spikes)
    const heart = new Mesh(new SphereGeometry(0.42, 16, 12), M.enemyGlow)
    body.add(heart)
    root.add(body)
    return {
      root,
      height: 1.45,
      update(B, t, dt) {
        body.position.y = 1.45 + Math.sin(t * 1.2) * 0.1
        spikes.rotation.y += dt * (0.35 + B.phase * 0.3)
        spikes.rotation.x = Math.sin(t * 0.5) * 0.2
        heart.scale.setScalar(1 + Math.sin(t * 4) * 0.07)
      },
    }
  },

  hive(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.5
    const ico = new IcosahedronGeometry(1.05, 1)
    const hull = solid(ico, M.enemyHull, new EdgesGeometry(ico), M.enemyEdge)
    body.add(hull)
    const sacs = []
    const sacGeo = new SphereGeometry(0.26, 12, 9)
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2
      const m = solid(sacGeo, M.enemyTrim)
      m.position.set(Math.cos(a) * 0.95, -0.35 + Math.sin(k * 2) * 0.12, Math.sin(a) * 0.95)
      body.add(m)
      sacs.push(m)
    }
    const face = new Group()
    const jawGeo = new ConeGeometry(0.12, 0.7, 5).rotateZ(-Math.PI / 2)
    const jaws = []
    for (const s of [-1, 1]) {
      const j = solid(jawGeo, M.enemyPlate)
      j.position.set(1.0, -0.25, 0.3 * s)
      face.add(j)
      jaws.push(j)
    }
    const eyeGeo = new SphereGeometry(0.1, 10, 8)
    for (let k = 0; k < 3; k++) {
      const eye = new Mesh(eyeGeo, M.enemyGlow)
      eye.position.set(0.95, 0.15 + (k === 1 ? 0.15 : 0), (k - 1) * 0.25)
      face.add(eye)
    }
    body.add(face)
    root.add(body)
    return {
      root,
      height: 1.5,
      update(B, t, dt) {
        body.position.y = 1.5 + Math.sin(t * 1.1) * 0.12
        hull.rotation.y += dt * 0.25
        face.rotation.y = -B.angle
        sacs.forEach((m, k) => m.scale.setScalar(1 + Math.max(0, Math.sin(t * 3 + k)) * 0.35))
        const open = 0.25 + Math.sin(t * 4) * 0.2
        jaws[0].rotation.y = open
        jaws[1].rotation.y = -open
      },
    }
  },

  colossus(b, M) {
    const root = new Group()
    const body = new Group()
    root.add(body)
    const torsoGeo = new BoxGeometry(1.9, 0.95, 1.5)
    const torso = solid(torsoGeo, M.enemyHull, new EdgesGeometry(torsoGeo), M.enemyEdge)
    torso.position.y = 1.15
    body.add(torso)
    const headGeo = new BoxGeometry(0.7, 0.44, 0.7)
    const head = solid(headGeo, M.enemyHull, new EdgesGeometry(headGeo), M.enemyEdge)
    head.position.set(0.3, 1.82, 0)
    body.add(head)
    const visor = new Mesh(new BoxGeometry(0.06, 0.1, 0.52), M.enemyGlow)
    visor.position.set(0.66, 1.84, 0)
    body.add(visor)
    const shield = solid(new CylinderGeometry(1.6, 1.6, 1.55, 24, 1, true, 0, Math.PI), M.enemyPlate)
    shield.position.y = 1.0
    body.add(shield)
    const rim = new Mesh(new TorusGeometry(1.6, 0.05, 4, 30, Math.PI), M.enemyGlow)
    rim.rotation.set(Math.PI / 2, Math.PI / 2, 0)
    rim.position.y = 1.78
    body.add(rim)
    const shoulderGeo = new BoxGeometry(0.62, 0.5, 0.5)
    for (const s of [-1, 1]) {
      const sh = solid(shoulderGeo, M.enemyPlate)
      sh.position.set(-0.1, 1.55, 0.98 * s)
      body.add(sh)
    }
    const legs = []
    const legGeo = new BoxGeometry(0.32, 0.8, 0.32).translate(0, -0.4, 0)
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = solid(legGeo, M.enemyHull)
        leg.position.set(sx * 0.55, 0.8, sz * 0.55)
        body.add(leg)
        legs.push(leg)
      }
    }
    const weak = new Mesh(new SphereGeometry(0.32, 14, 10), M.enemyGlow)
    weak.position.set(-1.0, 1.15, 0)
    body.add(weak)
    return {
      root,
      height: 1.2,
      update(B, t, dt) {
        body.rotation.y = -B.angle
        const mode = B.state.cm
        const moving = Math.min(1, Math.hypot(B.vx, B.vy) / 2)
        legs.forEach((leg, k) => (leg.rotation.z = Math.sin(t * 7 + (k % 2) * Math.PI) * 0.3 * moving))
        const wind = mode === 'windup'
        body.position.x = wind ? (Math.random() - 0.5) * 0.08 : 0
        body.rotation.z = lerp(body.rotation.z, mode === 'dash' ? -0.18 : 0, 1 - Math.exp(-dt * 8))
        visor.scale.setScalar(wind ? 1.6 + Math.sin(t * 40) * 0.3 : 1)
        weak.scale.setScalar(1 + Math.sin(t * 5) * 0.2)
      },
    }
  },

  leviathan(b, M) {
    const root = new Group()
    const head = new Group()
    root.add(head)
    const skull = new ConeGeometry(0.72, 1.9, 6).rotateZ(-Math.PI / 2)
    const hull = solid(skull, M.enemyHull, new EdgesGeometry(skull), M.enemyEdge)
    head.add(hull)
    const jaw = solid(new BoxGeometry(0.95, 0.16, 0.66), M.enemyPlate)
    jaw.position.set(0.25, -0.36, 0)
    head.add(jaw)
    const eyeGeo = new SphereGeometry(0.11, 10, 8)
    for (const s of [-1, 1]) {
      const eye = new Mesh(eyeGeo, M.enemyGlow)
      eye.position.set(0.42, 0.22, 0.3 * s)
      head.add(eye)
    }
    const finGeo = new ConeGeometry(0.09, 0.5, 4)
    for (let k = 0; k < 3; k++) {
      const f = solid(finGeo, M.enemyTrim)
      f.position.set(-0.2 - k * 0.3, 0.52 - k * 0.06, 0)
      head.add(f)
    }
    const segs = []
    const segGeo = new SphereGeometry(1, 14, 10)
    const segE = new EdgesGeometry(new IcosahedronGeometry(1, 1))
    const ringGeo = new TorusGeometry(1.04, 0.04, 5, 24)
    for (const part of b.parts) {
      const g = new Group()
      const s = solid(segGeo, M.enemyHull, segE, M.enemyEdge)
      s.scale.setScalar(part.r)
      g.add(s)
      const ring = new Mesh(ringGeo, M.enemyGlow)
      ring.scale.setScalar(part.r)
      ring.rotation.y = Math.PI / 2
      g.add(ring)
      const fin = solid(finGeo, M.enemyTrim)
      fin.position.y = part.r * 0.95
      g.add(fin)
      root.add(g)
      segs.push(g)
    }
    return {
      root,
      height: 0.8,
      ownRoot: true,
      update(B, t) {
        head.position.set(B.x, 0.85 + Math.sin(t * 3) * 0.12, B.y)
        head.rotation.y = -B.angle
        jaw.rotation.z = -0.12 - Math.max(0, Math.sin(t * 3)) * 0.25
        B.parts.forEach((part, i) => {
          const g = segs[i]
          g.position.set(part.x, 0.75 + Math.sin(t * 3 - i * 0.6) * 0.14, part.y)
          g.rotation.y = -(part.angle || 0)
        })
      },
    }
  },

  overclock(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.5
    const cubeGeo = new BoxGeometry(1, 1, 1)
    const cube = solid(cubeGeo, M.enemyHull, new EdgesGeometry(cubeGeo), M.enemyEdge)
    body.add(cube)
    const rings = [1.35, 1.72, 2.08].map((r, k) => {
      const m = new Mesh(new TorusGeometry(r, 0.045, 6, 60), M.enemyGlow)
      m.rotation.set(k * 0.8, k * 0.5, 0)
      body.add(m)
      return m
    })
    root.add(body)
    const bars = []
    const barGeo = new BoxGeometry(0.12, 1, 0.12).translate(0, 0.5, 0)
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * Math.PI * 2
      const m = solid(barGeo, M.enemyTrim)
      m.position.set(Math.cos(a) * 1.55, 0, Math.sin(a) * 1.55)
      root.add(m)
      bars.push(m)
    }
    return {
      root,
      height: 1.5,
      update(B, t, dt) {
        body.position.y = 1.5 + Math.sin(t * 2) * 0.1
        cube.rotation.x += dt * (0.7 + B.phase * 0.6)
        cube.rotation.y += dt * (0.9 + B.phase * 0.6)
        rings.forEach((m, k) => {
          m.rotation.x += dt * (0.6 + k * 0.4) * (1 + B.phase * 0.5)
          m.rotation.y += dt * (0.4 + k * 0.3)
        })
        bars.forEach((m, k) => {
          const v = Math.abs(Math.sin(t * 5 + k * 0.7) * Math.sin(t * 2.3 + k * 1.9))
          m.scale.y = 0.2 + v * (1.2 + B.phase * 0.5)
        })
      },
    }
  },

  mirage(b, M) {
    const root = new Group()
    const make = (hullMat, glowMat) => {
      const g = new Group()
      const ob = new CylinderGeometry(0.2, 0.46, 2.1, 4)
      const m = solid(ob, hullMat, new EdgesGeometry(ob), M.enemyEdge)
      m.position.y = 1.3
      g.add(m)
      const eye = new Mesh(new SphereGeometry(0.16, 12, 9), glowMat)
      eye.position.set(0.3, 1.55, 0)
      g.add(eye)
      const rings = [0.82, 1.08].map((r, k) => {
        const ring = new Mesh(new TorusGeometry(r, 0.035, 5, 40), glowMat)
        ring.position.y = 1.2 + k * 0.4
        ring.rotation.x = Math.PI / 2 + (k ? 0.3 : -0.3)
        g.add(ring)
        return ring
      })
      return { g, rings, eye }
    }
    const real = make(M.enemyHull, M.enemyGlow)
    root.add(real.g)
    const ghostGlow = M.extra(
      'ghostGlow',
      () =>
        new MeshBasicMaterial({
          color: M.enemyGlow.color.clone().multiplyScalar(0.55),
          transparent: true,
          opacity: 0.6,
          toneMapped: false,
          depthWrite: false,
        }),
    )
    const decoys = [0, 1, 2].map(() => {
      const d = make(M.enemyGhost, ghostGlow)
      d.g.visible = false
      return d
    })
    const decoyRoot = new Group()
    decoys.forEach((d) => decoyRoot.add(d.g))
    return {
      root,
      extra: decoyRoot,
      height: 1.3,
      update(B, t, dt) {
        const phasing = B.phased
        real.g.scale.setScalar(phasing ? 0.25 + Math.random() * 0.2 : 1)
        real.g.rotation.y = -B.angle
        real.rings.forEach((r, k) => (r.rotation.z += dt * (1.2 + k)))
        decoys.forEach((d, k) => {
          const part = B.parts[k]
          d.g.visible = !!(part && part.alive)
          if (!d.g.visible) return
          d.g.position.set(part.x, 0, part.y)
          d.g.scale.setScalar(part.phased ? 0.25 : 0.95 + Math.sin(t * 7 + k) * 0.03)
          d.rings.forEach((r, j) => (r.rotation.z += dt * (1.2 + j)))
        })
      },
    }
  },

  monolith(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.7
    const slabGeo = new BoxGeometry(1.1, 3.0, 0.46)
    const slab = solid(slabGeo, M.enemyHull, new EdgesGeometry(slabGeo), M.enemyEdge)
    body.add(slab)
    const seam = new Mesh(new BoxGeometry(0.07, 2.6, 0.48), M.enemyGlow)
    body.add(seam)
    const cubes = new Group()
    const cGeo = new BoxGeometry(0.32, 0.32, 0.32)
    const cE = new EdgesGeometry(cGeo)
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2
      const m = solid(cGeo, M.enemyPlate, cE, M.enemyEdge)
      m.position.set(Math.cos(a) * 1.6, -0.8 + k * 0.5, Math.sin(a) * 1.6)
      cubes.add(m)
    }
    body.add(cubes)
    root.add(body)
    return {
      root,
      height: 1.7,
      update(B, t, dt) {
        body.position.y = 1.7 + Math.sin(t) * 0.08
        body.rotation.y = -B.angle + Math.PI / 2
        cubes.rotation.y += dt * (0.6 + B.phase * 0.5)
        seam.scale.x = 1 + Math.sin(t * 6) * 0.3 + (B.phase >= 2 ? 1 : 0)
      },
    }
  },

  seraph(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.7
    const core = new OctahedronGeometry(0.6)
    core.scale(0.8, 1.5, 0.8)
    const hull = solid(core, M.enemyHull, new EdgesGeometry(core), M.enemyEdge)
    body.add(hull)
    const halo = new Mesh(new TorusGeometry(0.7, 0.04, 6, 40), M.enemyGlow)
    halo.position.set(-0.3, 0.9, 0)
    halo.rotation.y = Math.PI / 2
    body.add(halo)
    const featherGeo = new BoxGeometry(0.1, 0.035, 1.5).translate(0, 0, 0.75)
    const wings = []
    for (const s of [-1, 1]) {
      const pivot = new Group()
      pivot.position.set(-0.1, 0.35, 0.25 * s)
      for (let k = 0; k < 7; k++) {
        const f = solid(featherGeo, k % 2 ? M.enemyTrim : M.enemyPlate)
        f.rotation.y = (k - 3) * 0.2 * s
        f.rotation.x = -k * 0.08 * s
        f.scale.z = s * (0.7 + (3 - Math.abs(k - 3)) * 0.12)
        pivot.add(f)
      }
      body.add(pivot)
      wings.push({ pivot, s })
    }
    root.add(body)
    return {
      root,
      height: 1.7,
      update(B, t, dt) {
        body.position.y = 1.7 + Math.sin(t * 1.4) * 0.15
        body.rotation.y = -B.angle
        halo.rotation.x += dt * 1.5
        for (const w of wings) w.pivot.rotation.x = Math.sin(t * 1.8) * 0.35 * w.s
      },
    }
  },

  architect(b, M) {
    const root = new Group()
    const body = new Group()
    body.position.y = 1.65
    // Dark shell, small molten heart: a big emissive sphere just blooms to white.
    const shellCore = solid(new SphereGeometry(0.82, 24, 18), M.enemyHull)
    body.add(shellCore)
    const heart = solid(new SphereGeometry(0.42, 20, 14), M.enemyTrim)
    heart.position.x = 0.52
    body.add(heart)
    const shell = new LineSegments(new EdgesGeometry(new IcosahedronGeometry(1.08, 1)), M.enemyEdge)
    body.add(shell)
    const rings = [1.5, 1.85, 2.2].map((r, k) => {
      const g = new Group()
      const m = solid(new TorusGeometry(r, 0.07, 6, 56), M.enemyPlate)
      const band = new Mesh(new TorusGeometry(r, 0.025, 4, 56), M.enemyGlow)
      band.position.y = 0.06
      g.add(m, band)
      g.rotation.set(k * 0.9, k * 0.4, 0)
      body.add(g)
      return g
    })
    const spikes = new Group()
    const spikeGeo = new ConeGeometry(0.1, 0.8, 5).translate(0, 1.15, 0)
    for (let k = 0; k < 8; k++) {
      const s = solid(spikeGeo, M.enemyPlate)
      s.rotation.set((k % 2) * 1.2 - 0.6, 0, (k / 8) * Math.PI * 2)
      spikes.add(s)
    }
    body.add(spikes)
    root.add(body)
    return {
      root,
      height: 1.65,
      update(B, t, dt) {
        body.position.y = 1.65 + Math.sin(t * 1.3) * 0.1
        const k = 1 + B.phase * 0.7
        rings.forEach((g, i) => {
          g.rotation.x += dt * (0.5 + i * 0.3) * k
          g.rotation.y += dt * (0.3 + i * 0.2) * k
        })
        spikes.rotation.y += dt * 0.6 * k
        spikes.rotation.x += dt * 0.3 * k
        shell.rotation.y -= dt * 0.4
        heart.scale.setScalar(1 + Math.sin(t * 4) * 0.05 * k)
      },
    }
  },
}

export function buildBoss(b, M, G) {
  const make = BOSS_BUILDERS[b.id] || BOSS_BUILDERS.gatekeeper
  const actor = make(b, M, G)
  actor.root.traverse((o) => {
    if (o.isMesh && o.userData.baseMat) o.castShadow = true
  })
  const under = glow(G, M.glowEnemy, b.r * 4)
  if (actor.ownRoot) {
    actor.under = under
    actor.root.add(under)
  } else {
    actor.root.add(under)
  }
  return actor
}

// ---------------------------------------------------------------------------
// Blocks: one look per world, plus the shootable data crate
// ---------------------------------------------------------------------------

function rectExtrude(w, d, h, bevel) {
  const s = new Shape()
  s.moveTo(-w / 2 + bevel, -d / 2 + bevel)
  s.lineTo(w / 2 - bevel, -d / 2 + bevel)
  s.lineTo(w / 2 - bevel, d / 2 - bevel)
  s.lineTo(-w / 2 + bevel, d / 2 - bevel)
  s.closePath()
  const g = new ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, bevel, 0)
  return g
}

// Deterministic per block, so a pillar keeps its shape between frames.
function blockRand(id) {
  let s = id * 9301 + 49297
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

const COVER = {
  slab(b, M) {
    const g = new Group()
    const h = 0.8
    const geo = rectExtrude(b.w, b.h, h, 0.05)
    const m = solid(geo, M.block, new EdgesGeometry(geo, 30), M.blockEdge)
    g.add(m)
    const line = new Mesh(new BoxGeometry(b.w * 0.8, 0.03, 0.04), M.blockGlow)
    line.position.set(0, h * 0.55, b.h / 2 + 0.005)
    g.add(line)
    return g
  },
  crystal(b, M, rnd) {
    const g = new Group()
    const long = Math.max(b.w, b.h)
    const n = Math.max(1, Math.round(long / 0.55))
    const rad = Math.min(b.w, b.h) * 0.5
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      const h = 0.8 + rnd() * 0.7
      const geo = new CylinderGeometry(rad * 0.8, rad, h, 6)
      const m = solid(geo, M.blockIce, new EdgesGeometry(geo), M.blockEdgeGlow)
      const off = (t - 0.5) * (long - rad * 1.6)
      m.position.set(b.w >= b.h ? off : 0, h / 2, b.w >= b.h ? 0 : off)
      m.rotation.set((rnd() - 0.5) * 0.12, rnd() * 3, (rnd() - 0.5) * 0.12)
      g.add(m)
    }
    return g
  },
  pod(b, M) {
    const g = new Group()
    const rad = Math.min(b.w, b.h) / 2
    const len = Math.max(0.01, Math.max(b.w, b.h) - rad * 2)
    const geo = new CapsuleGeometry(rad, len, 6, 14)
    if (b.w >= b.h) geo.rotateZ(Math.PI / 2)
    else geo.rotateX(Math.PI / 2)
    const m = solid(geo, M.block)
    m.position.y = rad * 0.85
    m.scale.y = 0.85
    g.add(m)
    const bands = Math.max(1, Math.round(len / 0.6) + 1)
    for (let i = 0; i < bands; i++) {
      const t = bands === 1 ? 0.5 : i / (bands - 1)
      const band = new Mesh(new TorusGeometry(rad * 1.01, 0.035, 5, 20), M.blockGlow)
      const off = (t - 0.5) * len
      band.position.set(b.w >= b.h ? off : 0, rad * 0.85, b.w >= b.h ? 0 : off)
      band.rotation.y = b.w >= b.h ? Math.PI / 2 : 0
      band.scale.y = 0.85
      g.add(band)
    }
    return g
  },
  obsidian(b, M) {
    const g = new Group()
    const geo = rectExtrude(b.w, b.h, 1.0, 0.07)
    g.add(solid(geo, M.blockGloss, new EdgesGeometry(geo, 30), M.blockEdgeGlow))
    return g
  },
  coral(b, M, rnd) {
    const g = new Group()
    const nx = Math.max(1, Math.round(b.w / 0.38))
    const nz = Math.max(1, Math.round(b.h / 0.38))
    const tip = new SphereGeometry(0.09, 8, 6)
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const h = 0.5 + rnd() * 0.8
        const r = 0.11 + rnd() * 0.08
        const geo = new CylinderGeometry(r * 0.7, r, h, 6)
        const m = solid(geo, M.block)
        const x = (nx === 1 ? 0 : (i / (nx - 1) - 0.5) * (b.w - 0.25)) + (rnd() - 0.5) * 0.08
        const z = (nz === 1 ? 0 : (j / (nz - 1) - 0.5) * (b.h - 0.25)) + (rnd() - 0.5) * 0.08
        m.position.set(x, h / 2, z)
        g.add(m)
        const t = new Mesh(tip, M.blockGlow)
        t.position.set(x, h + 0.03, z)
        g.add(t)
      }
    }
    // A solid core keeps the silhouette readable as an obstacle.
    const baseGeo = rectExtrude(b.w, b.h, 0.3, 0.04)
    g.add(solid(baseGeo, M.block))
    return g
  },
  neon(b, M) {
    const g = new Group()
    const h = 0.85
    const geo = new BoxGeometry(b.w, h, b.h)
    const m = solid(geo, M.block, new EdgesGeometry(geo), M.blockEdgeGlow)
    m.position.y = h / 2
    g.add(m)
    const bar = new Mesh(new BoxGeometry(b.w + 0.02, 0.04, b.h + 0.02), M.blockGlow)
    bar.position.y = h * 0.5
    g.add(bar)
    return g
  },
  sandstone(b, M) {
    const g = new Group()
    const geo = rectExtrude(b.w, b.h, 0.85, 0.12)
    g.add(solid(geo, M.block, new EdgesGeometry(geo, 30), M.blockEdge))
    return g
  },
  monolith(b, M) {
    const g = new Group()
    const h = 1.1
    const geo = new BoxGeometry(b.w, h, b.h)
    const m = solid(geo, M.block, new EdgesGeometry(geo), M.blockEdge)
    m.position.y = h / 2
    g.add(m)
    return g
  },
  shard(b, M, rnd) {
    const g = new Group()
    const long = Math.max(b.w, b.h)
    const n = Math.max(1, Math.round(long / 0.5))
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1)
      const h = 1.1 + rnd() * 0.9
      const geo = new OctahedronGeometry(0.5, 0)
      geo.scale(Math.min(b.w, b.h) * 0.9, h, Math.min(b.w, b.h) * 0.9)
      const m = solid(geo, M.blockIce, new EdgesGeometry(geo), M.blockEdgeGlow)
      const off = (t - 0.5) * (long - 0.4)
      m.position.set(b.w >= b.h ? off : 0, h * 0.42, b.w >= b.h ? 0 : off)
      m.rotation.set((rnd() - 0.5) * 0.25, rnd() * 3, (rnd() - 0.5) * 0.25)
      g.add(m)
    }
    return g
  },
  basalt(b, M, rnd) {
    const g = new Group()
    const nx = Math.max(1, Math.round(b.w / 0.42))
    const nz = Math.max(1, Math.round(b.h / 0.42))
    const capGeo = new CylinderGeometry(0.15, 0.15, 0.03, 6)
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const h = 0.7 + rnd() * 0.5
        const geo = new CylinderGeometry(0.22, 0.24, h, 6)
        const m = solid(geo, M.block)
        const x = nx === 1 ? 0 : (i / (nx - 1) - 0.5) * (b.w - 0.3)
        const z = nz === 1 ? 0 : (j / (nz - 1) - 0.5) * (b.h - 0.3)
        m.position.set(x, h / 2, z)
        g.add(m)
        const cap = new Mesh(capGeo, M.blockGlow)
        cap.position.set(x, h + 0.01, z)
        g.add(cap)
      }
    }
    return g
  },
}

export function buildBlock(b, style, M) {
  const root = new Group()
  root.position.set(b.cx, 0, b.cy)
  const rnd = blockRand(b.id)
  let crateCore = null

  if (b.kind === 'crate') {
    // Data crate: glass box with a glowing core that shrinks as it takes hits.
    const h = b.temp ? 1.2 : 0.66
    const boxGeo = new BoxGeometry(b.w, h, b.h)
    const shell = new Mesh(boxGeo, b.temp ? M.blockIce : M.crateFill)
    shell.position.y = h / 2
    shell.add(new LineSegments(new EdgesGeometry(boxGeo), b.temp ? M.blockEdgeGlow : M.accentEdge))
    root.add(shell)
    const coreGeo = new BoxGeometry(b.w * 0.55, h * 0.55, b.h * 0.55)
    crateCore = solid(coreGeo, b.temp ? M.blockGlow : M.crateCore)
    crateCore.position.y = h / 2
    root.add(crateCore)
  } else {
    root.add((COVER[style] || COVER.slab)(b, M, rnd))
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })

  let rise = b.temp ? 0 : 1
  return {
    root,
    update(bl, t, dt) {
      root.visible = bl.alive
      if (!bl.alive) return
      if (rise < 1) {
        rise = Math.min(1, rise + dt * 3.5)
        root.scale.y = Math.max(0.001, ease.outBack(rise))
      }
      if (crateCore) {
        const k = bl.hp / bl.maxHp
        crateCore.scale.setScalar(0.35 + 0.65 * k)
        crateCore.rotation.y += dt * 0.8
      }
      const hit = bl.flash > 0
      root.position.x = bl.cx + (hit ? (Math.random() - 0.5) * 0.05 : 0)
      root.position.z = bl.cy + (hit ? (Math.random() - 0.5) * 0.05 : 0)
      // Temporary ice flickers during its last second.
      if (bl.temp) root.visible = bl.life > 1 || Math.sin(t * 30) > -0.4
    },
  }
}

export { ownGeo, AdditiveBlending, Color }
