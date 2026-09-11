import { BULLET, TIMING } from './config.js'
import { TAU, angleTo, clamp, dist, normalizeAngle, rand, nudgeOutOfBlocks } from './geom.js'

// Everything that puts danger into the arena: bullets, beams, shells, mines,
// shockwaves, and the spawn queue. Enemies and bosses call these; none of them
// know about each other.

export function event(game, type, data = {}) {
  data.type = type
  game.events.push(data)
}

// Runs fn after a delay in game time, so slow motion and pause apply to it.
export function later(game, delay, fn) {
  game.timers.push({ t: delay, fn })
}

// 'mix' alternates, 'mix3' makes every third bullet black.
export function kindAt(kind, i) {
  if (kind === 'mix') return i % 2 === 0 ? 'hot' : 'cold'
  if (kind === 'mix3') return i % 3 === 2 ? 'cold' : 'hot'
  return kind || 'hot'
}

export function aimAt(game, src) {
  return angleTo(src.x, src.y, game.player.x, game.player.y)
}

// One enemy bullet. Speed scales with the sector's difficulty tier.
export function emit(game, x, y, a, s, kind = 'hot', o = {}) {
  if (game.bullets.length >= BULLET.max) return null
  const k = game.tier.speed
  const b = {
    x,
    y,
    a,
    s: s * k,
    kind,
    r: kind === 'hot' ? BULLET.hotRadius : BULLET.coldRadius,
    curve: o.curve || 0,
    accel: (o.accel || 0) * k,
    maxS: (o.maxS || 30) * k,
    minS: (o.minS ?? 0.8) * k,
    homing: o.homing || 0,
    homingT: o.homingT || 0,
    // Curving bullets can circle forever, so they always get a lifetime.
    life: o.life || (o.curve ? 8 : 0),
    age: 0,
  }
  game.bullets.push(b)
  return b
}

// Fired from the rim of the shooter instead of its centre.
export function shoot(game, src, a, s, kind, o) {
  const off = (src.r || 0) * 0.9
  return emit(game, src.x + Math.cos(a) * off, src.y + Math.sin(a) * off, a, s, kind, o)
}

export function fan(game, src, a, n, arc, s, kind = 'hot', o) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    shoot(game, src, a - arc / 2 + arc * t, s, kindAt(kind, i), o)
  }
}

export function ring(game, x, y, n, s, kind = 'hot', offset = 0, r0 = 0, o) {
  for (let i = 0; i < n; i++) {
    const a = offset + (i / n) * TAU
    emit(game, x + Math.cos(a) * r0, y + Math.sin(a) * r0, a, s, kindAt(kind, i), o)
  }
}

// Shots in quick succession. aimPlayer re-aims each one; otherwise they follow
// the shooter's own (slowly turning) facing, which is what makes them dodgeable.
export function burst(game, src, n, gap, s, kind = 'hot', aimPlayer = false) {
  const fire = () => {
    if (src.alive === false) return
    shoot(game, src, aimPlayer ? aimAt(game, src) : src.angle, s, kind)
  }
  fire()
  for (let i = 1; i < n; i++) later(game, gap * i, fire)
}

// Black homing orbs: they cannot be shot, only outrun until they give up.
export function homing(game, src, n, arc, s, o = {}) {
  const a0 = aimAt(game, src)
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1)
    shoot(game, src, a0 - arc / 2 + arc * t, s, 'cold', {
      homing: o.turn ?? 1.5,
      homingT: o.homingT ?? 3.2,
      life: o.life ?? 6.5,
    })
  }
}

// A beam always announces itself: warn seconds of a thin line first, then the
// real thing. It can follow its owner and sweep while it burns.
export function beam(game, src, o = {}) {
  const warn = o.warn ?? 1.0
  const active = o.active ?? 0.28
  const h = {
    type: 'beam',
    id: game.nextId++,
    owner: src,
    x: src.x,
    y: src.y,
    a: o.a ?? src.angle,
    warn,
    warnMax: warn,
    active,
    activeMax: active,
    width: o.width ?? 0.36,
    spin: o.spin ?? 0,
    pierce: !!o.pierce,
    offset: o.offset ?? (src.r || 0) * 0.8,
    len: 0,
  }
  game.hazards.push(h)
  event(game, 'beamWarn', { x: h.x, y: h.y })
  return h
}

// A beam across the whole arena. axis 'x' is a horizontal line at y = pos.
export function laserLine(game, axis, pos, o = {}) {
  const horizontal = axis === 'x'
  const warn = o.warn ?? 1.2
  const active = o.active ?? 0.5
  const h = {
    type: 'beam',
    id: game.nextId++,
    owner: null,
    x: horizontal ? -game.W / 2 : pos,
    y: horizontal ? pos : -game.D / 2,
    a: horizontal ? 0 : Math.PI / 2,
    warn,
    warnMax: warn,
    active,
    activeMax: active,
    width: o.width ?? 0.42,
    spin: 0,
    pierce: true,
    offset: 0,
    len: 0,
    line: true,
  }
  game.hazards.push(h)
  event(game, 'beamWarn', { x: 0, y: 0 })
  return h
}

// A shell lobbed at a spot. The landing circle is visible for the whole flight.
export function mortar(game, src, tx, ty, o = {}) {
  const h = {
    type: 'mortar',
    id: game.nextId++,
    sx: src.x,
    sy: src.y,
    x: clamp(tx, -game.W / 2 + 0.5, game.W / 2 - 0.5),
    y: clamp(ty, -game.D / 2 + 0.5, game.D / 2 - 0.5),
    t: 0,
    flight: o.flight ?? 1.3,
    blast: o.blast ?? 1.3,
    n: o.n ?? 0,
  }
  game.hazards.push(h)
  event(game, 'mortarLaunch', { x: src.x, y: src.y })
  return h
}

// A mine sits still, blinks faster as the fuse runs down, then bursts into a
// ring. One shot defuses it.
export function mine(game, x, y, o = {}) {
  const fuse = o.fuse ?? 3.4
  const h = {
    type: 'mine',
    id: game.nextId++,
    x: clamp(x, -game.W / 2 + 0.5, game.W / 2 - 0.5),
    y: clamp(y, -game.D / 2 + 0.5, game.D / 2 - 0.5),
    r: 0.3,
    fuse,
    fuseMax: fuse,
    n: o.n ?? 8,
    dead: false,
  }
  game.hazards.push(h)
  event(game, 'mineDrop', { x: h.x, y: h.y })
  return h
}

// An expanding ring along the floor, with gaps in it. Slip through a gap or
// put a block between you and the centre; otherwise it hits once as it passes.
// A ring without gaps would cross the whole arena and could not be dodged.
export function shockwave(game, x, y, o = {}) {
  const n = o.gaps ?? 3
  const off = rand(0, TAU)
  const gaps = []
  for (let i = 0; i < n; i++) gaps.push(normalizeAngle(off + (i / n) * TAU + rand(-0.35, 0.35)))
  game.hazards.push({
    type: 'shock',
    id: game.nextId++,
    x,
    y,
    r: o.r0 ?? 0.6,
    speed: o.speed ?? 6.5,
    maxR: o.maxR ?? 17,
    width: o.width ?? 0.5,
    gaps,
    gapW: o.gapW ?? 0.62,
    hit: false,
  })
  event(game, 'shock', { x, y })
}

// A wall of bullets from the top edge with one or two gaps in it.
export function curtain(game, o = {}) {
  const spacing = o.spacing ?? 0.78
  const gapW = o.gap ?? 2.4
  const gaps = o.gaps ?? 1
  const half = game.W / 2 - 0.35
  const centers = []
  for (let g = 0; g < gaps; g++) {
    let c = 0
    for (let t = 0; t < 10; t++) {
      c = rand(-half + gapW * 0.6, half - gapW * 0.6)
      if (centers.every((q) => Math.abs(q - c) > gapW * 1.6)) break
    }
    centers.push(c)
  }
  const y = -game.D / 2 + 0.3
  let i = 0
  for (let x = -half; x <= half + 0.001; x += spacing) {
    if (centers.some((c) => Math.abs(x - c) < gapW / 2)) continue
    emit(game, x, y, Math.PI / 2, o.speed ?? 3, kindAt(o.kind ?? 'cold', i++))
  }
}

// Queues an enemy behind a spawn marker. Never right on top of the player,
// never inside a block or the core.
export function queueSpawn(game, type, x, y, delay = 0, opts = {}) {
  const spot = { x, y }
  const p = game.player
  const minD = 3.2
  const d = dist(spot.x, spot.y, p.x, p.y)
  if (d < minD) {
    const a = d > 0.01 ? angleTo(p.x, p.y, spot.x, spot.y) : -Math.PI / 2
    spot.x = p.x + Math.cos(a) * minD
    spot.y = p.y + Math.sin(a) * minD
  }
  const c = game.core
  if (c && c.alive) {
    const dc = dist(spot.x, spot.y, c.x, c.y)
    const need = c.r + 1.1
    if (dc < need) {
      const a = dc > 0.01 ? angleTo(c.x, c.y, spot.x, spot.y) : Math.PI / 2
      spot.x = c.x + Math.cos(a) * need
      spot.y = c.y + Math.sin(a) * need
    }
  }
  spot.x = clamp(spot.x, -game.W / 2 + 0.7, game.W / 2 - 0.7)
  spot.y = clamp(spot.y, -game.D / 2 + 0.7, game.D / 2 - 0.7)
  nudgeOutOfBlocks(game, spot, 0.6)

  game.spawns.push({
    id: game.nextId++,
    type,
    x: spot.x,
    y: spot.y,
    t: TIMING.spawnWarn + delay,
    warn: TIMING.spawnWarn,
    warned: false,
    opts,
  })
}

// ---------------------------------------------------------------------------
// Enemy fire patterns. every is the base interval in seconds; the sector's
// tier shortens it. They fire along the enemy's own facing, which lags behind
// the player - moving sideways is always a way out.
// ---------------------------------------------------------------------------

export const ENEMY_PATTERNS = {
  aimed: {
    every: 1.5,
    fire(g, e) {
      shoot(g, e, e.angle, 5.4, 'hot')
    },
  },
  twin: {
    every: 1.7,
    fire(g, e) {
      const nx = Math.cos(e.angle + Math.PI / 2) * 0.2
      const ny = Math.sin(e.angle + Math.PI / 2) * 0.2
      const fx = Math.cos(e.angle) * e.r
      const fy = Math.sin(e.angle) * e.r
      emit(g, e.x + fx + nx, e.y + fy + ny, e.angle, 5.8, 'hot')
      emit(g, e.x + fx - nx, e.y + fy - ny, e.angle, 5.8, 'hot')
    },
  },
  spread: {
    every: 2.1,
    fire(g, e) {
      fan(g, e, e.angle, 5, 0.85, 4.8, 'hot')
    },
  },
  burst: {
    every: 2.3,
    fire(g, e) {
      burst(g, e, 4, 0.1, 6.4, 'hot')
    },
  },
  ring: {
    every: 2.9,
    fire(g, e) {
      e.state.ringOff = (e.state.ringOff || 0) + 0.26
      ring(g, e.x, e.y, 12, 3.6, 'mix', e.state.ringOff, e.r)
    },
  },
  // Only fired by a Phantom when it reappears.
  ringSmall: {
    every: Infinity,
    fire(g, e) {
      ring(g, e.x, e.y, 8, 4.4, 'hot', rand(0, TAU), e.r)
    },
  },
  spiral: {
    every: 0.24,
    fire(g, e) {
      e.state.sn = (e.state.sn || 0) + 1
      for (let k = 0; k < 3; k++) {
        shoot(g, e, e.angle + (k * TAU) / 3, 3.6, e.state.sn % 4 === 0 ? 'cold' : 'hot')
      }
    },
  },
  homing: {
    every: 2.7,
    fire(g, e) {
      homing(g, e, 2, 0.8, 3.4)
    },
  },
  beam: {
    every: 3.7,
    fire(g, e) {
      beam(g, e, { a: e.angle, warn: 1.05, active: 0.3, width: 0.36 })
    },
  },
  mortar: {
    every: 3.3,
    fire(g, e) {
      // Leads the target a little: standing still is the one thing that fails.
      const p = g.player
      mortar(g, e, p.x + p.vx * 0.35, p.y + p.vy * 0.35, { flight: 1.3, blast: 1.35, n: 6 })
    },
  },
}
