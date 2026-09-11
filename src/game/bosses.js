import { TIMING } from './config.js'
import {
  TAU,
  angleTo,
  circleCircle,
  circleRect,
  clamp,
  clampToArena,
  dist,
  normalizeAngle,
  pushOut,
  rand,
  turnTowards,
} from './geom.js'
import {
  aimAt,
  beam,
  burst,
  curtain,
  emit,
  event,
  fan,
  homing,
  laserLine,
  later,
  mine,
  mortar,
  queueSpawn,
  ring,
  shockwave,
  shoot,
} from './patterns.js'
import { damagePlayer } from './combat.js'

// Each sector's core wakes up as one of these. A boss is a movement style, a
// list of phases (switching at hp fractions), and per phase a set of attacks
// on their own timers. Special mechanics live in the optional hooks.

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[list[i], list[j]] = [list[j], list[i]]
  }
  return list
}

function freeSpot(game, minFromPlayer, yMaxFrac = 0.22) {
  const p = game.player
  for (let i = 0; i < 16; i++) {
    const x = rand(-game.W / 2 + 1.8, game.W / 2 - 1.8)
    const y = rand(-game.D / 2 + 1.8, game.D * yMaxFrac)
    if (dist(x, y, p.x, p.y) < minFromPlayer) continue
    if (game.blocks.some((b) => b.alive && circleRect(x, y, 1.3, b))) continue
    return { x, y }
  }
  return { x: rand(-game.W / 4, game.W / 4), y: -game.D * 0.28 }
}

// ---------------------------------------------------------------------------
// Attack library. src is anything with x, y, r, angle and a state object - a
// boss, or the sleeping core during the waves.
// ---------------------------------------------------------------------------

export const ATTACKS = {
  ring(g, s, o) {
    s.state.ringOff = (s.state.ringOff || 0) + (o.step ?? 0.17)
    ring(g, s.x, s.y, o.n, o.speed, o.kind ?? 'mix', s.state.ringOff, s.r * 0.9, o.curve ? { curve: o.curve } : undefined)
  },

  spiral(g, s, o) {
    const st = s.state
    st.spA = (st.spA || 0) + (o.step ?? 0.22) * (o.dir ?? 1)
    st.spN = (st.spN || 0) + 1
    const arms = o.arms ?? 3
    const kind = o.kind === 'mix' ? (st.spN % 3 === 0 ? 'cold' : 'hot') : o.kind ?? 'hot'
    for (let k = 0; k < arms; k++) {
      shoot(g, s, st.spA + (k * TAU) / arms, o.speed, kind, o.curve ? { curve: o.curve } : undefined)
    }
  },

  fan(g, s, o) {
    fan(g, s, aimAt(g, s), o.n, o.arc, o.speed, o.kind ?? 'hot')
  },

  burst(g, s, o) {
    burst(g, s, o.n, o.gap ?? 0.09, o.speed, o.kind ?? 'hot', true)
  },

  homing(g, s, o) {
    homing(g, s, o.n, o.arc ?? 1.2, o.speed, { turn: o.turn ?? 1.4, homingT: o.time ?? 3, life: o.life ?? 6.5 })
  },

  // A ring whose bullets bend - alternating left and right on every volley.
  flower(g, s, o) {
    s.state.fl = -(s.state.fl || -1)
    ring(g, s.x, s.y, o.n, o.speed, o.kind ?? 'hot', rand(0, TAU), s.r * 0.9, {
      curve: (o.curve ?? 0.7) * s.state.fl,
      life: 7,
    })
  },

  curtain(g, s, o) {
    curtain(g, o)
  },

  lattice(g, s, o) {
    curtain(g, { ...o, gaps: 2 })
  },

  // Parallel lines across the whole arena. Positions come from evenly spaced
  // slots, so there is always somewhere to stand.
  lasers(g, s, o) {
    let axis = o.axis ?? 'x'
    if (axis === 'alt') {
      s.state.lz = !s.state.lz
      axis = s.state.lz ? 'x' : 'y'
    }
    const span = axis === 'x' ? g.D : g.W
    const count = o.n * 2 + 1
    const slots = []
    for (let i = 1; i < count; i++) slots.push(-span / 2 + (span * i) / count)
    shuffle(slots)
    for (let i = 0; i < o.n; i++) {
      laserLine(g, axis, slots[i], { warn: o.warn ?? 1.2, active: o.active ?? 0.5, width: o.width ?? 0.42 })
    }
  },

  // Beams from the boss that rotate while they burn. They start to one side
  // of the player and sweep across, alternating direction each time.
  sweep(g, s, o) {
    s.state.sw = -(s.state.sw || -1)
    const spin = (o.spin ?? 0.6) * s.state.sw
    const arc = spin * (o.active ?? 1.6)
    const base = aimAt(g, s) - arc / 2
    for (let k = 0; k < o.n; k++) {
      beam(g, s, {
        a: base + (k * TAU) / o.n,
        warn: o.warn ?? 1.1,
        active: o.active ?? 1.6,
        width: o.width ?? 0.42,
        spin,
        pierce: !!o.pierce,
        offset: s.r * 0.85,
      })
    }
  },

  mortars(g, s, o) {
    const p = g.player
    for (let i = 0; i < o.n; i++) {
      later(g, i * 0.2, () => {
        if (s.alive === false) return
        const a = rand(0, TAU)
        const r = i === 0 ? 0 : rand(1.3, o.spread ?? 3.2)
        mortar(g, s, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, {
          flight: o.flight ?? 1.35,
          blast: o.blast ?? 1.3,
          n: o.ring ?? 0,
        })
      })
    }
  },

  summon(g, s, o) {
    const have =
      g.enemies.filter((e) => e.alive && e.type === o.type).length +
      g.spawns.filter((sp) => sp.type === o.type).length
    const n = Math.min(o.count ?? 2, Math.max(0, (o.max ?? 4) - have))
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU)
      const r = s.r + rand(1.4, 2.6)
      queueSpawn(g, o.type, s.x + Math.cos(a) * r, s.y + Math.sin(a) * r, i * 0.1, o.opts || {})
    }
    if (n) event(g, 'summon', { x: s.x, y: s.y })
  },

  mines(g, s, o) {
    const p = g.player
    for (let i = 0; i < o.n; i++) {
      const a = rand(0, TAU)
      const r = rand(2.2, 5.5)
      mine(g, p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, { fuse: (o.fuse ?? 3.2) + i * 0.2, n: o.ring ?? 8 })
    }
  },

  shock(g, s, o) {
    shockwave(g, s.x, s.y, { speed: o.speed ?? 6.5, width: o.width ?? 0.5, maxR: 17 })
  },

  // Ice pillars rise around the player: cover for a few seconds, then they
  // shatter into a ring of black shards.
  pillars(g, s, o) {
    const p = g.player
    for (let i = 0; i < (o.n ?? 2); i++) {
      for (let tries = 0; tries < 12; tries++) {
        const a = rand(0, TAU)
        const r = rand(2.2, 3.8)
        const cx = p.x + Math.cos(a) * r
        const cy = p.y + Math.sin(a) * r
        const w = 0.95
        const h = 0.95
        const blk = { x: cx - w / 2, y: cy - h / 2, w, h }
        if (Math.abs(cx) > g.W / 2 - 1 || Math.abs(cy) > g.D / 2 - 1) continue
        if (circleRect(p.x, p.y, p.r + 0.7, blk)) continue
        if (g.boss && circleRect(g.boss.x, g.boss.y, g.boss.r + 0.4, blk)) continue
        const clash = g.blocks.some(
          (b) => b.alive && b.x < blk.x + w + 0.3 && b.x + b.w > blk.x - 0.3 && b.y < blk.y + h + 0.3 && b.y + b.h > blk.y - 0.3,
        )
        if (clash) continue
        g.blocks.push({
          id: g.nextId++,
          ...blk,
          cx,
          cy,
          kind: 'crate',
          hp: 5,
          maxHp: 5,
          alive: true,
          flash: 0,
          temp: true,
          life: o.life ?? 5.5,
          shatter: o.ring ?? 8,
        })
        event(g, 'pillar', { x: cx, y: cy })
        break
      }
    }
  },

  // Leviathan: body segments fire in turns.
  segFire(g, b, o) {
    const stride = o.stride ?? 2
    b.state.segK = ((b.state.segK ?? -1) + 1) % stride
    let n = 0
    b.parts.forEach((part, i) => {
      if (i % stride !== b.state.segK) return
      later(g, n++ * 0.07, () => {
        if (!b.alive) return
        emit(g, part.x, part.y, angleTo(part.x, part.y, g.player.x, g.player.y), o.speed, o.kind ?? 'hot')
      })
    })
    event(g, 'enemyShot', { x: b.x, y: b.y })
  },

  segRing(g, b, o) {
    b.parts.forEach((part, i) => {
      if (i % 3 !== 0) return
      later(g, i * 0.08, () => {
        if (!b.alive) return
        ring(g, part.x, part.y, o.n ?? 6, o.speed, o.kind ?? 'cold', rand(0, TAU), part.r)
      })
    })
  },

  // Mirage: the decoys shoot too.
  decoyFire(g, b, o) {
    for (const d of b.parts) {
      if (d.alive && d.decoy && !d.phased) {
        emit(g, d.x, d.y, angleTo(d.x, d.y, g.player.x, g.player.y), o.speed ?? 4.8, 'hot')
      }
    }
  },
}

export function runAttack(game, src, atk) {
  const fn = ATTACKS[atk.fn]
  if (fn) fn(game, src, atk)
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

function approach(b, tx, ty, dt, rate = 3.5) {
  const k = 1 - Math.exp(-dt * rate)
  b.x += (tx - b.x) * k
  b.y += (ty - b.y) * k
}

const MOVES = {
  hover(g, b, dt, o) {
    const tx = b.home.x + Math.sin(b.t * (o.fx ?? 0.45)) * g.W * (o.ax ?? 0.18)
    const ty = b.home.y + Math.sin(b.t * (o.fy ?? 0.8)) * (o.ay ?? 0.55)
    approach(b, tx, ty, dt)
  },

  figure8(g, b, dt) {
    const tx = Math.sin(b.t * 0.42) * g.W * 0.3
    const ty = -g.D * 0.12 + Math.sin(b.t * 0.84) * g.D * 0.16
    approach(b, tx, ty, dt, 2.5)
  },

  // Follows the player from above, never coming all the way down.
  stalk(g, b, dt, o) {
    const p = g.player
    const tx = p.x
    const ty = Math.min(p.y - 4.8, g.D * 0.1)
    const d = dist(b.x, b.y, tx, ty)
    if (d > 0.3) {
      const a = angleTo(b.x, b.y, tx, ty)
      const sp = Math.min(o.speed ?? 1, d)
      b.x += Math.cos(a) * sp * dt
      b.y += Math.sin(a) * sp * dt
    }
    clampToArena(g, b, b.r + 0.3)
  },

  // Leviathan: the head traces a wide curve, the body follows its trail.
  serpent(g, b, dt) {
    const st = b.state
    st.tau = (st.tau || 0) + dt * (st.speedMul || 1)
    const tx = Math.sin(st.tau * 0.52) * g.W * 0.36
    const ty = -g.D * 0.08 + Math.sin(st.tau * 0.83 + 1.1) * g.D * 0.28
    const ox = b.x
    const oy = b.y
    approach(b, tx, ty, dt, 3)
    if (Math.hypot(b.x - ox, b.y - oy) > 1e-4) b.angle = Math.atan2(b.y - oy, b.x - ox)

    const tr = st.trail
    const last = tr[tr.length - 1]
    if (!last || Math.hypot(last.x - b.x, last.y - b.y) > 0.08) tr.push({ x: b.x, y: b.y })
    if (tr.length > 420) tr.splice(0, tr.length - 420)

    const spacing = 0.74
    let need = spacing
    let acc = 0
    let pi = 0
    let px = b.x
    let py = b.y
    for (let i = tr.length - 1; i >= 0 && pi < b.parts.length; i--) {
      const q = tr[i]
      const seg = Math.hypot(px - q.x, py - q.y)
      while (pi < b.parts.length && seg > 1e-6 && acc + seg >= need) {
        const t = (need - acc) / seg
        const part = b.parts[pi]
        part.x = px + (q.x - px) * t
        part.y = py + (q.y - py) * t
        part.angle = Math.atan2(py - q.y, px - q.x)
        pi++
        need += spacing
      }
      acc += seg
      px = q.x
      py = q.y
    }
    for (; pi < b.parts.length; pi++) {
      b.parts[pi].x = px
      b.parts[pi].y = py
    }
  },

  // Colossus: walks at you, announces a charge, rams, slams into the wall.
  charge(g, b, dt) {
    const st = b.state
    const p = g.player
    st.cm = st.cm || 'walk'
    st.ct = (st.ct ?? 3.2) - dt
    const every = [4.6, 3.6, 2.8][b.phase] ?? 3
    const turn = [0.8, 1.0, 1.25][b.phase] ?? 1

    if (st.cm === 'walk') {
      b.angle = turnTowards(b.angle, angleTo(b.x, b.y, p.x, p.y), turn * dt)
      if (dist(b.x, b.y, p.x, p.y) > 3.5) {
        b.x += Math.cos(b.angle) * 1.2 * dt
        b.y += Math.sin(b.angle) * 1.2 * dt
      }
      if (st.ct <= 0) {
        st.cm = 'windup'
        st.ct = 1.15
        st.ca = angleTo(b.x, b.y, p.x, p.y)
        event(g, 'charge', { x: b.x, y: b.y, boss: true })
      }
    } else if (st.cm === 'windup') {
      b.angle = turnTowards(b.angle, st.ca, 4 * dt)
      if (st.ct <= 0) {
        st.cm = 'dash'
        st.ct = 1.4
        b.angle = st.ca
      }
    } else if (st.cm === 'dash') {
      const bx = b.x
      const by = b.y
      b.x += Math.cos(st.ca) * 12 * dt
      b.y += Math.sin(st.ca) * 12 * dt
      clampToArena(g, b, b.r)
      for (const bl of g.blocks) {
        if (!bl.alive || !pushOut(b, b.r, bl)) continue
        if (bl.kind === 'crate') {
          bl.alive = false
          event(g, 'blockBreak', { x: bl.cx, y: bl.cy, w: bl.w, h: bl.h, id: bl.id })
        }
      }
      const moved = Math.hypot(b.x - bx, b.y - by)
      const blocked = moved < 12 * dt * 0.5
      if (blocked || st.ct <= 0) {
        st.cm = 'recover'
        st.ct = 1.25
        if (blocked) {
          g.shake = Math.max(g.shake, 0.6)
          event(g, 'slam', { x: b.x, y: b.y })
          // Only in its last phase, and with wide gaps: the slam itself is the threat.
          if (b.phase >= 2) shockwave(g, b.x, b.y, { speed: 6, width: 0.5, maxR: 16, gapW: 0.85 })
        }
      }
    } else if (st.ct <= 0) {
      st.cm = 'walk'
      st.ct = every
    }
    clampToArena(g, b, b.r)
    if (st.cm !== 'dash') for (const bl of g.blocks) if (bl.alive) pushOut(b, b.r, bl)
  },

  // Mirage: fades out, reappears somewhere else among its decoys.
  teleport(g, b, dt, o) {
    const st = b.state
    st.tp = (st.tp ?? 3.2) - dt
    if (st.tm === 'out') {
      if (st.tp <= 0) {
        relocateMirage(g, b)
        st.tm = 'in'
        st.tp = 0.5
        event(g, 'blinkIn', { x: b.x, y: b.y, boss: true })
      }
    } else if (st.tm === 'in') {
      if (st.tp <= 0) {
        st.tm = null
        b.phased = false
        for (const d of b.parts) d.phased = false
        st.tp = o.every ?? 4.6
      }
    } else if (st.tp <= 0) {
      st.tm = 'out'
      st.tp = 0.45
      b.phased = true
      for (const d of b.parts) d.phased = true
      event(g, 'blinkOut', { x: b.x, y: b.y, boss: true })
    }
  },

  static() {},
}

function relocateMirage(g, b) {
  const n = [2, 3, 3][b.phase] ?? 3
  const spots = []
  for (let i = 0; i <= n; i++) {
    let s = freeSpot(g, 4)
    for (let t = 0; t < 14 && !spots.every((q) => dist(q.x, q.y, s.x, s.y) > 3); t++) s = freeSpot(g, 4)
    spots.push(s)
  }
  shuffle(spots)
  const real = spots.pop()
  b.x = real.x
  b.y = real.y
  b.parts = spots.map((s) => ({ x: s.x, y: s.y, r: b.r * 0.9, alive: true, decoy: true, phased: true, angle: 0 }))
}

export function destroyDecoy(g, b, part) {
  part.alive = false
  event(g, 'kill', { x: part.x, y: part.y, type: 'decoy', r: part.r })
  if (b.phase >= 2) ring(g, part.x, part.y, 8, 3.4, 'hot', rand(0, TAU), part.r)
}

// ---------------------------------------------------------------------------
// The ten bosses
// ---------------------------------------------------------------------------

export const BOSSES = {
  gatekeeper: {
    name: 'Gatekeeper',
    title: 'Warden of the first lock',
    hp: 170,
    r: 1.2,
    move: 'hover',
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'ring', every: 2.3, n: 14, speed: 3.5, kind: 'mix' },
          { fn: 'fan', every: 1.5, n: 5, arc: 0.9, speed: 5 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'spiral', every: 0.13, arms: 3, step: 0.2, speed: 3.7, kind: 'hot' },
          { fn: 'ring', every: 3, n: 16, speed: 3, kind: 'cold' },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'spiral', every: 0.12, arms: 4, step: 0.18, speed: 3.8, kind: 'mix' },
          { fn: 'fan', every: 1.7, n: 7, arc: 1.1, speed: 5.4 },
          { fn: 'summon', every: 9, type: 'hunter', count: 2, max: 2, delay: 2 },
        ],
      },
    ],
  },

  cryo: {
    name: 'Cryo Lattice',
    title: 'It keeps its heart frozen',
    hp: 210,
    r: 1.25,
    move: 'hover',
    moveOpts: { ax: 0.14, fx: 0.35 },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'fan', every: 1.35, n: 7, arc: 1.2, speed: 6 },
          { fn: 'pillars', every: 6.5, n: 2, delay: 2.5, life: 5.5, ring: 8 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'sweep', every: 5.2, n: 3, spin: 0.55, warn: 1.15, active: 1.7 },
          { fn: 'ring', every: 2.7, n: 18, speed: 3.1, kind: 'cold' },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'sweep', every: 4.8, n: 4, spin: 0.6, warn: 1.1, active: 1.6 },
          { fn: 'fan', every: 1.25, n: 9, arc: 1.4, speed: 6.2 },
          { fn: 'pillars', every: 7, n: 3, life: 5, ring: 10 },
        ],
      },
    ],
  },

  hive: {
    name: 'Hive Mother',
    title: 'Everything here came from her',
    hp: 230,
    r: 1.3,
    move: 'stalk',
    moveOpts: { speed: 0.9 },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'summon', every: 6.5, type: 'wasp', count: 5, max: 10, delay: 1 },
          { fn: 'homing', every: 3, n: 3, arc: 1.4, speed: 3.1, turn: 1.4 },
          { fn: 'fan', every: 1.8, n: 3, arc: 0.5, speed: 5.2 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'spiral', every: 0.16, arms: 2, step: 0.34, speed: 3.6, kind: 'mix' },
          { fn: 'summon', every: 6, type: 'wasp', count: 6, max: 12 },
          { fn: 'homing', every: 3.2, n: 4, arc: 1.6, speed: 3.2 },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'mortars', every: 3.6, n: 4, spread: 3, blast: 1.3 },
          { fn: 'summon', every: 10, type: 'splitter', count: 1, max: 2 },
          { fn: 'spiral', every: 0.14, arms: 3, step: 0.3, speed: 3.8, kind: 'mix' },
        ],
      },
    ],
  },

  colossus: {
    name: 'Colossus',
    title: 'Strike where it cannot turn',
    hp: 250,
    r: 1.35,
    move: 'charge',
    ownAngle: true,
    // Armoured in front: only shots from the sides or behind get through.
    hurt(b, fx, fy) {
      return Math.abs(normalizeAngle(angleTo(b.x, b.y, fx, fy) - b.angle)) > 1.15
    },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'fan', every: 1.9, n: 5, arc: 0.8, speed: 5.2 },
          { fn: 'mortars', every: 4, n: 3, spread: 2.6 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'ring', every: 3, n: 16, speed: 3.4, kind: 'mix' },
          { fn: 'fan', every: 1.7, n: 5, arc: 0.9, speed: 5.6 },
          { fn: 'mortars', every: 3.8, n: 4 },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'fan', every: 1.4, n: 7, arc: 1.1, speed: 5.8 },
          { fn: 'mortars', every: 3.2, n: 5, spread: 3.4 },
          { fn: 'ring', every: 2.8, n: 18, speed: 3.6, kind: 'mix' },
        ],
      },
    ],
  },

  leviathan: {
    name: 'Leviathan',
    title: 'The deep has a spine',
    hp: 240,
    r: 0.95,
    move: 'serpent',
    ownAngle: true,
    init(g, b) {
      b.state.trail = []
      b.state.speedMul = 1
      b.parts = Array.from({ length: 10 }, (_, i) => ({
        x: b.x,
        y: b.y,
        r: 0.72 - i * 0.035,
        alive: true,
        segment: true,
        solidHit: true,
        angle: 0,
      }))
    },
    onPhase(g, b, i) {
      b.state.speedMul = [1, 1.2, 1.45][i] ?? 1.45
    },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'segFire', every: 2.4, speed: 4.6, stride: 2 },
          { fn: 'fan', every: 1.7, n: 3, arc: 0.5, speed: 5.4 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'segRing', every: 3.6, n: 6, speed: 3.4, kind: 'cold' },
          { fn: 'homing', every: 2.8, n: 2, arc: 0.6, speed: 3.4 },
          { fn: 'segFire', every: 2.2, speed: 4.8 },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'segFire', every: 1.5, speed: 5 },
          { fn: 'spiral', every: 0.15, arms: 2, step: 0.3, speed: 3.8, kind: 'hot' },
          { fn: 'segRing', every: 3.2, n: 6, speed: 3.6, kind: 'mix' },
        ],
      },
    ],
  },

  overclock: {
    name: 'Overclock',
    title: 'Running past the limit',
    hp: 300,
    r: 1.3,
    move: 'hover',
    moveOpts: { ax: 0.1, fx: 0.3 },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'curtain', every: 2.5, speed: 3.1, spacing: 0.8, gap: 2.6, kind: 'mix3' },
          { fn: 'ring', every: 3.2, n: 20, speed: 3, kind: 'mix' },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'lasers', every: 4.2, n: 3, axis: 'alt', warn: 1.2, active: 0.5 },
          { fn: 'flower', every: 2.2, n: 12, speed: 3.6, curve: 0.65 },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'sweep', every: 6.2, n: 4, spin: 0.5, warn: 1.2, active: 3 },
          { fn: 'curtain', every: 2.6, speed: 3.4, spacing: 0.78, gap: 2.4, kind: 'mix3' },
          { fn: 'flower', every: 2, n: 14, speed: 3.8, curve: 0.7 },
        ],
      },
    ],
  },

  mirage: {
    name: 'Mirage',
    title: 'Only one of them is real',
    hp: 280,
    r: 1.1,
    move: 'teleport',
    moveOpts: { every: 4.6 },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'spiral', every: 0.18, arms: 2, step: 0.3, speed: 3.4, kind: 'hot', curve: 0.35 },
          { fn: 'burst', every: 2.1, n: 4, speed: 6 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'decoyFire', every: 2.2, speed: 4.8 },
          { fn: 'fan', every: 1.6, n: 6, arc: 1, speed: 5.2 },
          { fn: 'spiral', every: 0.16, arms: 3, step: 0.28, speed: 3.6, kind: 'mix', curve: 0.3 },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'flower', every: 1.9, n: 12, speed: 3.6, curve: 0.75 },
          { fn: 'homing', every: 3, n: 3, speed: 3.2 },
          { fn: 'decoyFire', every: 2, speed: 5 },
        ],
      },
    ],
  },

  monolith: {
    name: 'Monolith',
    title: 'Nothing reflects here',
    hp: 330,
    r: 1.2,
    move: 'hover',
    moveOpts: { ax: 0.06, fx: 0.25, ay: 0.3 },
    // In its last phase it pulls you in.
    update(g, b) {
      g.pull = b.phase >= 2 ? { x: b.x, y: b.y, k: 1.5 } : null
    },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'lattice', every: 3.0, speed: 2.4, spacing: 0.7, gap: 2.7, kind: 'cold' },
          { fn: 'fan', every: 1.5, n: 5, arc: 0.8, speed: 5.6 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'sweep', every: 6.6, n: 4, spin: 0.42, warn: 1.3, active: 3.6 },
          { fn: 'ring', every: 3, n: 24, speed: 3, kind: 'mix' },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'ring', every: 2.6, n: 26, speed: 3.2, kind: 'mix' },
          { fn: 'fan', every: 1.4, n: 7, arc: 1, speed: 5.8 },
          { fn: 'lattice', every: 3.4, speed: 2.6, gap: 2.7, kind: 'cold' },
        ],
      },
    ],
  },

  seraph: {
    name: 'Seraph',
    title: 'Wings of light, eyes of glass',
    hp: 350,
    r: 1.25,
    move: 'figure8',
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'flower', every: 1.6, n: 10, speed: 3.8, curve: 0.8 },
          { fn: 'homing', every: 3, n: 4, arc: 1.6, speed: 3.3 },
        ],
      },
      {
        at: 0.62,
        attacks: [
          { fn: 'sweep', every: 5.4, n: 1, spin: 0.75, warn: 1.25, active: 1.8 },
          { fn: 'fan', every: 1.5, n: 7, arc: 1.1, speed: 5.6 },
          { fn: 'summon', every: 10, type: 'phantom', count: 2, max: 2 },
        ],
      },
      {
        at: 0.3,
        attacks: [
          { fn: 'flower', every: 1.25, n: 14, speed: 4, curve: 0.8 },
          { fn: 'sweep', every: 5.2, n: 2, spin: 0.7, warn: 1.25, active: 1.8 },
          { fn: 'homing', every: 2.8, n: 5, arc: 1.8, speed: 3.4 },
        ],
      },
    ],
  },

  architect: {
    name: 'Architect',
    title: 'It built all of this',
    hp: 460,
    r: 1.5,
    move: 'hover',
    moveOpts: { ax: 0.16 },
    phases: [
      {
        at: 1,
        attacks: [
          { fn: 'ring', every: 2.4, n: 20, speed: 3.4, kind: 'mix' },
          { fn: 'spiral', every: 0.13, arms: 3, step: 0.21, speed: 3.8, kind: 'hot' },
          { fn: 'summon', every: 9, type: 'bulwark', count: 1, max: 2 },
        ],
      },
      {
        at: 0.66,
        attacks: [
          { fn: 'sweep', every: 6, n: 4, spin: 0.42, warn: 1.2, active: 3.2 },
          { fn: 'curtain', every: 2.8, speed: 3.1, spacing: 0.8, gap: 2.6, kind: 'mix3' },
          { fn: 'mortars', every: 4.2, n: 4 },
        ],
      },
      {
        at: 0.33,
        attacks: [
          { fn: 'flower', every: 1.4, n: 16, speed: 3.8, curve: 0.7 },
          { fn: 'lasers', every: 4.6, n: 3, axis: 'alt' },
          { fn: 'homing', every: 3, n: 4, speed: 3.4 },
          { fn: 'shock', every: 5.2, speed: 6 },
        ],
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function makeBoss(game, id) {
  const def = BOSSES[id]
  if (!def) throw new Error(`Unknown boss: ${id}`)
  const c = game.core
  const b = {
    id,
    def,
    name: def.name,
    x: c.x,
    y: c.y,
    home: { x: c.x, y: c.y },
    r: def.r,
    hp: def.hp,
    maxHp: def.hp,
    alive: true,
    flash: 0,
    t: 0,
    angle: Math.PI / 2,
    phase: 0,
    // Untouchable while it rises out of the core.
    invuln: 1.4,
    phased: false,
    cds: {},
    state: {},
    parts: [],
    vx: 0,
    vy: 0,
  }
  def.init?.(game, b)
  return b
}

export function updateBoss(g, b, dt) {
  if (!b.alive) return
  const def = b.def
  b.t += dt
  if (b.flash > 0) b.flash -= dt
  if (b.invuln > 0) b.invuln -= dt

  const ox = b.x
  const oy = b.y
  const move = MOVES[def.move] || MOVES.static
  move(g, b, dt, def.moveOpts || {})
  def.update?.(g, b, dt)
  b.vx = (b.x - ox) / Math.max(dt, 1e-4)
  b.vy = (b.y - oy) / Math.max(dt, 1e-4)
  if (!def.ownAngle) b.angle = turnTowards(b.angle, angleTo(b.x, b.y, g.player.x, g.player.y), 2.4 * dt)

  // Phase changes at hp thresholds, with a short breather.
  const frac = b.hp / b.maxHp
  while (b.phase + 1 < def.phases.length && frac <= def.phases[b.phase + 1].at) {
    b.phase += 1
    b.invuln = TIMING.bossPhaseInvuln
    b.cds = {}
    def.onPhase?.(g, b, b.phase)
    // A clean beat between phases: everything in the air burns away, time
    // slows for a moment, and the next pattern starts from an empty field.
    const pts = []
    for (let i = 0; i < g.bullets.length && pts.length < 600; i += 2) {
      const bl = g.bullets[i]
      pts.push(bl.x, bl.y, bl.kind === 'hot' ? 1 : 0)
    }
    if (pts.length) event(g, 'dissolve', { pts })
    g.bullets.length = 0
    g.shake = Math.max(g.shake, 0.7)
    if (!g.reduced) g.slow = 0.5
    event(g, 'bossPhase', { x: b.x, y: b.y, index: b.phase })
  }

  if (b.invuln <= 0 && !b.phased && g.phase === 'boss') {
    const attacks = def.phases[b.phase].attacks
    for (let i = 0; i < attacks.length; i++) {
      const atk = attacks[i]
      if (b.cds[i] === undefined) b.cds[i] = atk.delay ?? rand(0.3, 1.1)
      b.cds[i] -= dt
      if (b.cds[i] <= 0) {
        b.cds[i] = atk.every * g.tier.rate
        runAttack(g, b, atk)
        event(g, 'enemyShot', { x: b.x, y: b.y, boss: true })
      }
    }
  }

  const p = g.player
  if (p.alive && !b.phased) {
    if (circleCircle(b.x, b.y, b.r * 0.85, p.x, p.y, p.r)) damagePlayer(g, b.x, b.y)
    for (const part of b.parts) {
      if (part.alive && part.solidHit && circleCircle(part.x, part.y, part.r, p.x, p.y, p.r)) {
        damagePlayer(g, part.x, part.y)
      }
    }
  }
}

// Returns 'hit', 'kill', 'deflect' or null.
export function damageBoss(g, b, dmg, fromX, fromY) {
  if (!b.alive || b.phased) return null
  if (b.invuln > 0 || (b.def.hurt && !b.def.hurt(b, fromX, fromY))) {
    event(g, 'deflect', { x: fromX, y: fromY })
    return 'deflect'
  }
  b.hp -= dmg
  b.flash = 0.08
  event(g, 'hit', { x: fromX, y: fromY, target: 'boss' })
  if (b.hp <= 0) {
    b.hp = 0
    b.alive = false
    event(g, 'bossDown', { x: b.x, y: b.y, id: b.id })
    return 'kill'
  }
  return 'hit'
}

export function bossPhaseMarks(id) {
  return BOSSES[id].phases.slice(1).map((p) => p.at)
}

export { clamp }
