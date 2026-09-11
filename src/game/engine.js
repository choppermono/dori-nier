import { ARENA, PLAYER, TIMING, tierFor } from './config.js'
import { LEVELS } from './levels.js'
import {
  TAU,
  angleTo,
  circleCircle,
  circleRect,
  clamp,
  clampToArena,
  dist,
  distToSegment,
  insideArena,
  normalizeAngle,
  pushOut,
  rand,
  rayLength,
  turnTowards,
} from './geom.js'
import { event, queueSpawn, ring } from './patterns.js'
import { applyWardens, damageEnemy, killEnemy, makeEnemy, updateEnemy } from './ai.js'
import { BOSSES, damageBoss, destroyDecoy, makeBoss, runAttack, updateBoss } from './bosses.js'
import { damagePlayer, healPlayer, segmentsLeft } from './combat.js'

// Pure game logic: no Vue, no DOM, no three.js. It only knows how the state
// moves from one frame to the next, which is why it can be simulated without
// a browser. The renderer and the sound read the state and the events this
// file emits; they never change it.
//
// A sector runs through phases:
//   intro -> waves (3) -> awaken (core breaks open) -> boss -> clear
// and at any point -> dead when the last segment breaks.

export { segmentsLeft }
export const LEVEL_COUNT = LEVELS.length

export function createGame(levelIndex, aspect = 1.6, opts = {}) {
  const index = clamp(levelIndex | 0, 0, LEVELS.length - 1)
  const def = LEVELS[index]
  const portrait = aspect < 0.95
  const { w: W, d: D } = portrait ? ARENA.portrait : ARENA.landscape
  const toX = (fx) => (fx - 0.5) * W
  const toY = (fy) => (fy - 0.5) * D

  const game = {
    levelIndex: index,
    def,
    theme: def.theme,
    W,
    D,
    portrait,
    status: 'running', // running | won | lost
    phase: opts.preview ? 'preview' : 'intro',
    phaseT: 0,
    time: 0,
    clock: 0,
    tier: tierFor(index),
    player: {
      x: 0,
      y: D * 0.34,
      angle: -Math.PI / 2,
      r: PLAYER.radius,
      segments: [true, true, true, true],
      invuln: 0,
      fireCd: 0.2,
      firing: false,
      muzzle: 0,
      vx: 0,
      vy: 0,
      alive: true,
    },
    shots: [],
    bullets: [],
    enemies: [],
    spawns: [],
    hazards: [],
    timers: [],
    blocks: [],
    core: null,
    boss: null,
    waveIndex: -1,
    waveCount: def.waves.length,
    waveDelay: TIMING.wavePause,
    clearedWave: -1,
    events: [],
    shake: 0,
    slow: 0,
    pull: null,
    stats: { kills: 0, damage: 0, shots: 0 },
    nextId: 1,
    reduced: !!opts.reduced,
    god: !!opts.god,
    toX,
    toY,
  }

  game.blocks = def.blocks.map((b) => makeBlock(game, b))
  game.core = {
    x: toX(def.core.fx),
    y: toY(def.core.fy),
    r: 0.85,
    alive: true,
    shielded: true,
    broken: false,
    shields: def.waves.length,
    spin: 0,
    flash: 0,
    angle: Math.PI / 2,
    cd: 2,
    fire: def.coreFire || null,
    state: {},
  }
  return game
}

function makeBlock(game, b) {
  const crate = b.kind === 'crate'
  const cx = game.toX(b.fx)
  const cy = game.toY(b.fy)
  return {
    id: game.nextId++,
    x: cx - b.w / 2,
    y: cy - b.h / 2,
    w: b.w,
    h: b.h,
    cx,
    cy,
    kind: crate ? 'crate' : 'cover',
    hp: crate ? 4 : Infinity,
    maxHp: crate ? 4 : Infinity,
    alive: true,
    flash: 0,
    temp: false,
    life: 0,
  }
}

// The caller reads the events after each update and hands them to the
// renderer and the sound, exactly once.
export function drainEvents(game) {
  const list = game.events
  game.events = []
  return list
}

export function enemiesLeft(game) {
  return game.enemies.length + game.spawns.length
}

function setPhase(game, phase) {
  game.phase = phase
  game.phaseT = 0
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export function update(game, rawDt, input) {
  if (game.status !== 'running' || game.phase === 'preview') return

  const slowK = game.slow > 0 ? 0.28 : 1
  if (game.slow > 0) game.slow -= rawDt
  // Capped: after a stall, bullets must not tunnel through the player.
  const dt = Math.min(rawDt, 0.05) * slowK
  game.phaseT += dt
  game.clock += dt
  if (game.phase === 'waves' || game.phase === 'awaken' || game.phase === 'boss') game.time += dt
  game.shake = Math.max(0, game.shake - rawDt * 1.5)

  runTimers(game, dt)

  switch (game.phase) {
    case 'intro':
      if (game.phaseT >= TIMING.intro) {
        setPhase(game, 'waves')
        startWave(game, 0)
      }
      break
    case 'waves':
      updateWaves(game, dt)
      break
    case 'awaken':
      updateAwaken(game)
      break
    case 'clear':
      if (game.phaseT >= TIMING.clearDelay) {
        game.status = 'won'
        event(game, 'levelClear')
      }
      break
    case 'dead':
      if (game.phaseT >= TIMING.deathDelay) {
        game.status = 'lost'
        event(game, 'levelLost')
      }
      break
  }

  updatePlayer(game, dt, input)
  updateSpawns(game, dt)
  applyWardens(game)
  for (const e of game.enemies) if (e.alive) updateEnemy(game, e, dt)
  if (game.boss) updateBoss(game, game.boss, dt)
  updateCore(game, dt)
  separate(game)
  updateShots(game, dt)
  updateBullets(game, dt)
  updateHazards(game, dt)
  updateBlocks(game, dt)

  if (game.enemies.some((e) => !e.alive)) game.enemies = game.enemies.filter((e) => e.alive)
  if (game.phase === 'boss' && game.boss && !game.boss.alive) bossDefeated(game)
}

function runTimers(game, dt) {
  const list = game.timers
  for (let i = list.length - 1; i >= 0; i--) {
    const t = list[i]
    t.t -= dt
    if (t.t <= 0) {
      list.splice(i, 1)
      t.fn(game)
    }
  }
}

// ---------------------------------------------------------------------------
// Waves, awakening, boss
// ---------------------------------------------------------------------------

function startWave(game, index) {
  game.waveIndex = index
  game.waveDelay = TIMING.wavePause
  const wave = game.def.waves[index] || []
  wave.forEach((spec, si) => {
    const count = spec.count || 1
    const cx = game.toX(spec.fx)
    const cy = game.toY(spec.fy)
    for (let i = 0; i < count; i++) {
      let x = cx
      let y = cy
      if (count > 1) {
        const a = (i / count) * TAU
        x += Math.cos(a) * 0.85
        y += Math.sin(a) * 0.85
      }
      queueSpawn(game, spec.type, x, y, si * TIMING.spawnStagger + i * 0.05, {
        pattern: spec.pattern,
        armored: spec.armored,
        orbit: spec.orbit,
      })
    }
  })
  event(game, 'wave', { index, total: game.waveCount })
}

function updateWaves(game, dt) {
  const busy = game.spawns.length > 0 || game.enemies.some((e) => e.alive)
  if (busy) {
    game.waveDelay = TIMING.wavePause
    return
  }
  if (game.clearedWave < game.waveIndex) {
    game.clearedWave = game.waveIndex
    game.core.shields = Math.max(0, game.waveCount - game.waveIndex - 1)
    event(game, 'waveClear', { index: game.waveIndex, total: game.waveCount })
  }
  game.waveDelay -= dt
  if (game.waveDelay > 0) return
  if (game.waveIndex >= game.waveCount - 1) beginAwaken(game)
  else startWave(game, game.waveIndex + 1)
}

function beginAwaken(game) {
  setPhase(game, 'awaken')
  dissolveBullets(game)
  game.hazards.length = 0
  healPlayer(game)
  const def = BOSSES[game.def.boss]
  event(game, 'awaken', { name: def.name, title: def.title, x: game.core.x, y: game.core.y })
}

function updateAwaken(game) {
  const c = game.core
  if (!c.broken && game.phaseT >= 0.6) {
    c.broken = true
    c.shielded = false
    game.shake = Math.max(game.shake, 0.55)
    event(game, 'shieldBreak', { x: c.x, y: c.y })
  }
  if (game.phaseT >= TIMING.awaken) {
    c.alive = false
    game.boss = makeBoss(game, game.def.boss)
    setPhase(game, 'boss')
    event(game, 'bossSpawn', { x: c.x, y: c.y, id: game.def.boss })
  }
}

function bossDefeated(game) {
  setPhase(game, 'clear')
  dissolveBullets(game)
  game.hazards.length = 0
  game.spawns.length = 0
  for (const e of game.enemies) if (e.alive) killEnemy(game, e, true)
  game.enemies = []
  game.pull = null
  game.shake = 1
  if (!game.reduced) game.slow = 0.9
}

function dissolveBullets(game) {
  const pts = []
  for (let i = 0; i < game.bullets.length && pts.length < 600; i += 2) {
    const b = game.bullets[i]
    pts.push(b.x, b.y, b.kind === 'hot' ? 1 : 0)
  }
  if (pts.length) event(game, 'dissolve', { pts })
  game.bullets.length = 0
  game.timers.length = 0
}

function updateSpawns(game, dt) {
  for (let i = game.spawns.length - 1; i >= 0; i--) {
    const s = game.spawns[i]
    s.t -= dt
    if (!s.warned && s.t <= s.warn) {
      s.warned = true
      event(game, 'spawnWarn', { x: s.x, y: s.y, type: s.type })
    }
    if (s.t <= 0) {
      const e = makeEnemy(game, s.type, s.x, s.y, s.opts)
      game.enemies.push(e)
      game.spawns.splice(i, 1)
      event(game, 'spawn', { x: e.x, y: e.y, type: e.type, id: e.id })
    }
  }
}

function updateCore(game, dt) {
  const c = game.core
  if (!c.alive) return
  c.spin += dt * (c.shielded ? 0.8 : 2.4)
  if (c.flash > 0) c.flash -= dt
  if (game.phase === 'waves' && c.fire) {
    c.cd -= dt
    if (c.cd <= 0) {
      c.cd = c.fire.every * game.tier.rate
      runAttack(game, c, c.fire)
    }
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

function solidPush(p, x, y, r) {
  const dx = p.x - x
  const dy = p.y - y
  const min = p.r + r
  const d = Math.hypot(dx, dy)
  if (d >= min) return
  if (d < 1e-4) {
    p.y = y + min
    return
  }
  p.x = x + (dx / d) * min
  p.y = y + (dy / d) * min
}

function updatePlayer(game, dt, input) {
  const p = game.player
  if (!p.alive) {
    p.vx = 0
    p.vy = 0
    return
  }

  // Left stick: letting go means standing still. No inertia, no dodge roll -
  // movement is the dodge.
  const mv = input?.move || { x: 0, y: 0 }
  const len = Math.hypot(mv.x, mv.y)
  let vx = 0
  let vy = 0
  if (len > 0.01) {
    const throttle = Math.min(1, len)
    vx = (mv.x / len) * PLAYER.speed * throttle
    vy = (mv.y / len) * PLAYER.speed * throttle
  }
  if (game.pull) {
    const a = angleTo(p.x, p.y, game.pull.x, game.pull.y)
    vx += Math.cos(a) * game.pull.k
    vy += Math.sin(a) * game.pull.k
  }
  p.vx = vx
  p.vy = vy
  p.x += vx * dt
  p.y += vy * dt

  clampToArena(game, p, p.r)
  for (const b of game.blocks) if (b.alive) pushOut(p, p.r, b)
  for (const e of game.enemies) if (e.alive && e.solid && !e.phased) solidPush(p, e.x, e.y, e.r)
  if (game.core.alive) solidPush(p, game.core.x, game.core.y, game.core.r)
  const B = game.boss
  if (B && B.alive && !B.phased) solidPush(p, B.x, B.y, B.r * 0.85)
  clampToArena(game, p, p.r)

  // Right stick turns and fires at once. Let go and the angle stays put.
  const aim = input?.aim || { x: 0, y: 0, active: false }
  const aimLen = Math.hypot(aim.x, aim.y)
  p.firing = !!aim.active && aimLen > 0.2
  if (p.firing) p.angle = turnTowards(p.angle, Math.atan2(aim.y, aim.x), PLAYER.turnRate * dt)

  const canFire = game.phase === 'waves' || game.phase === 'boss' || game.phase === 'awaken'
  p.fireCd -= dt
  if (p.firing && canFire && p.fireCd <= 0) {
    p.fireCd = PLAYER.fireInterval
    p.muzzle = p.muzzle ? 0 : 1
    const side = p.muzzle ? 1 : -1
    const fx = Math.cos(p.angle)
    const fy = Math.sin(p.angle)
    game.shots.push({
      x: p.x + fx * p.r * 1.3 - fy * 0.13 * side,
      y: p.y + fy * p.r * 1.3 + fx * 0.13 * side,
      vx: fx * PLAYER.shotSpeed,
      vy: fy * PLAYER.shotSpeed,
      r: PLAYER.shotRadius,
      life: PLAYER.shotLife,
    })
    game.stats.shots += 1
    event(game, 'shot', { x: p.x, y: p.y })
  }

  if (p.invuln > 0) p.invuln -= dt
}

// ---------------------------------------------------------------------------
// Player shots
// ---------------------------------------------------------------------------

function updateShots(game, dt) {
  const shots = game.shots
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]
    s.x += s.vx * dt
    s.y += s.vy * dt
    s.life -= dt
    if (s.life <= 0 || !insideArena(game, s.x, s.y, 0.3) || hitShot(game, s)) {
      shots[i] = shots[shots.length - 1]
      shots.pop()
    }
  }
}

// The order matters: orange bullets first (shooting them down is the point),
// then mines, blocks, enemies, the boss, the core. Returns true if consumed.
function hitShot(game, s) {
  const bullets = game.bullets
  for (let j = bullets.length - 1; j >= 0; j--) {
    const b = bullets[j]
    if (b.kind !== 'hot') continue
    if (circleCircle(s.x, s.y, s.r, b.x, b.y, b.r)) {
      bullets[j] = bullets[bullets.length - 1]
      bullets.pop()
      event(game, 'pop', { x: b.x, y: b.y })
      return true
    }
  }

  for (const h of game.hazards) {
    if (h.type === 'mine' && !h.dead && circleCircle(s.x, s.y, s.r, h.x, h.y, h.r + 0.06)) {
      h.dead = true
      event(game, 'mineShot', { x: h.x, y: h.y })
      return true
    }
  }

  for (const b of game.blocks) {
    if (!b.alive || !circleRect(s.x, s.y, s.r, b)) continue
    if (b.kind === 'crate') {
      b.hp -= 1
      b.flash = 0.1
      if (b.hp <= 0) breakBlock(game, b, false)
      else event(game, 'blockHit', { x: s.x, y: s.y })
    } else {
      event(game, 'spark', { x: s.x, y: s.y })
    }
    return true
  }

  // The impact point is taken a little behind the shot, so the armour check
  // sees which side it came from.
  const ix = s.x - s.vx * 0.012
  const iy = s.y - s.vy * 0.012

  for (const e of game.enemies) {
    if (!e.alive || e.phased) continue
    if (circleCircle(s.x, s.y, s.r, e.x, e.y, e.r)) {
      damageEnemy(game, e, 1, ix, iy)
      return true
    }
  }

  const B = game.boss
  if (B && B.alive && !B.phased) {
    for (const part of B.parts) {
      if (!part.alive || part.phased) continue
      if (circleCircle(s.x, s.y, s.r, part.x, part.y, part.r)) {
        if (part.decoy) destroyDecoy(game, B, part)
        else event(game, 'deflect', { x: s.x, y: s.y })
        return true
      }
    }
    if (circleCircle(s.x, s.y, s.r, B.x, B.y, B.r)) {
      damageBoss(game, B, 1, ix, iy)
      return true
    }
  }

  const c = game.core
  if (c.alive && circleCircle(s.x, s.y, s.r, c.x, c.y, c.r * 1.25)) {
    c.flash = 0.08
    event(game, 'shieldHit', { x: s.x, y: s.y })
    return true
  }
  return false
}

function breakBlock(game, b, expired) {
  b.alive = false
  event(game, 'blockBreak', { x: b.cx, y: b.cy, w: b.w, h: b.h, id: b.id, temp: b.temp })
  // An ice pillar that runs out of time shatters into shards; one you shoot
  // apart first does not.
  if (expired && b.shatter) ring(game, b.cx, b.cy, b.shatter, 3.2, 'cold', rand(0, TAU), 0.5)
}

function updateBlocks(game, dt) {
  let prune = false
  for (const b of game.blocks) {
    if (b.flash > 0) b.flash -= dt
    if (b.temp && b.alive) {
      b.life -= dt
      if (b.life <= 0) breakBlock(game, b, true)
    }
    if (b.temp && !b.alive) prune = true
  }
  if (prune) game.blocks = game.blocks.filter((b) => b.alive || !b.temp)
}

// ---------------------------------------------------------------------------
// Enemy bullets
// ---------------------------------------------------------------------------

function updateBullets(game, dt) {
  const p = game.player
  const list = game.bullets
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i]
    b.age += dt
    let remove = b.life > 0 && b.age >= b.life

    if (!remove) {
      if (b.homingT > 0) {
        b.homingT -= dt
        b.a = turnTowards(b.a, angleTo(b.x, b.y, p.x, p.y), b.homing * dt)
      }
      if (b.curve) b.a += b.curve * dt
      if (b.accel) b.s = clamp(b.s + b.accel * dt, b.minS, b.maxS)
      b.x += Math.cos(b.a) * b.s * dt
      b.y += Math.sin(b.a) * b.s * dt
      remove = !insideArena(game, b.x, b.y, 0.6)
    }

    if (!remove) {
      for (const bl of game.blocks) {
        if (bl.alive && circleRect(b.x, b.y, b.r * 0.8, bl)) {
          remove = true
          break
        }
      }
    }

    // While invulnerable, bullets pass through instead of being eaten.
    if (!remove && p.alive && circleCircle(b.x, b.y, b.r, p.x, p.y, p.r)) {
      remove = damagePlayer(game, b.x, b.y)
    }

    if (remove) {
      list[i] = list[list.length - 1]
      list.pop()
    }
  }
}

// ---------------------------------------------------------------------------
// Hazards: beams, mortar shells, mines, shockwaves
// ---------------------------------------------------------------------------

function updateHazards(game, dt) {
  const list = game.hazards
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i]
    let done = false
    if (h.type === 'beam') done = updateBeam(game, h, dt)
    else if (h.type === 'mortar') done = updateMortar(game, h, dt)
    else if (h.type === 'mine') done = updateMine(game, h, dt)
    else if (h.type === 'shock') done = updateShock(game, h, dt)
    if (done) list.splice(i, 1)
  }
}

function beamLength(game, h) {
  const maxLen = Math.hypot(game.W, game.D)
  const ox = h.x + Math.cos(h.a) * h.offset
  const oy = h.y + Math.sin(h.a) * h.offset
  return h.offset + rayLength(game, ox, oy, h.a, maxLen, h.pierce)
}

function updateBeam(game, h, dt) {
  if (h.owner) {
    if (h.owner.alive === false) return true
    h.x = h.owner.x
    h.y = h.owner.y
  }
  if (h.warn > 0) {
    h.warn -= dt
    h.len = beamLength(game, h)
    if (h.warn <= 0) event(game, 'beamFire', { x: h.x, y: h.y, line: !!h.line })
    return false
  }
  h.active -= dt
  if (h.spin) h.a += h.spin * dt
  h.len = beamLength(game, h)
  if (h.active <= 0) return true

  const p = game.player
  if (!p.alive) return false
  const ox = h.x + Math.cos(h.a) * h.offset
  const oy = h.y + Math.sin(h.a) * h.offset
  const ex = h.x + Math.cos(h.a) * h.len
  const ey = h.y + Math.sin(h.a) * h.len
  if (distToSegment(p.x, p.y, ox, oy, ex, ey) < h.width / 2 + p.r) {
    // Take the hit from the nearest point on the beam, so the right side breaks.
    const dx = ex - ox
    const dy = ey - oy
    const l2 = dx * dx + dy * dy || 1
    const t = clamp(((p.x - ox) * dx + (p.y - oy) * dy) / l2, 0, 1)
    const nx = ox + dx * t
    const ny = oy + dy * t
    const away = dist(p.x, p.y, nx, ny) < 0.01
    damagePlayer(game, away ? ox : nx, away ? oy : ny)
  }
  return false
}

function updateMortar(game, h, dt) {
  h.t += dt
  if (h.t < h.flight) return false
  const p = game.player
  if (p.alive && dist(p.x, p.y, h.x, h.y) < h.blast + p.r * 0.5) damagePlayer(game, h.x, h.y)
  if (h.n) ring(game, h.x, h.y, h.n, 3.2, 'hot', rand(0, TAU), 0.2)
  game.shake = Math.max(game.shake, 0.22)
  event(game, 'boom', { x: h.x, y: h.y, r: h.blast })
  return true
}

function updateMine(game, h, dt) {
  if (h.dead) return true
  h.fuse -= dt
  const p = game.player
  if (p.alive && circleCircle(p.x, p.y, p.r, h.x, h.y, h.r)) {
    damagePlayer(game, h.x, h.y)
    explodeMine(game, h)
    return true
  }
  if (h.fuse <= 0) {
    explodeMine(game, h)
    return true
  }
  return false
}

function explodeMine(game, h) {
  ring(game, h.x, h.y, h.n, 3.4, 'mix', rand(0, TAU), 0.2)
  event(game, 'boom', { x: h.x, y: h.y, r: 0.7, small: true })
}

function updateShock(game, h, dt) {
  h.r += h.speed * dt
  const p = game.player
  if (!h.hit && p.alive) {
    const d = dist(p.x, p.y, h.x, h.y)
    if (Math.abs(d - h.r) < h.width / 2 + p.r) {
      const a = angleTo(h.x, h.y, p.x, p.y)
      // The ship must fit through the gap, not just its centre.
      const margin = p.r / Math.max(d, 0.5)
      const inGap = h.gaps.some((g) => Math.abs(normalizeAngle(a - g)) < h.gapW / 2 - margin)
      const covered = rayLength(game, h.x, h.y, a, d) < d - p.r
      if (!inGap && !covered && damagePlayer(game, h.x, h.y)) h.hit = true
    }
  }
  return h.r >= h.maxR
}

// ---------------------------------------------------------------------------
// Crowd control
// ---------------------------------------------------------------------------

// Several chasers with the same target would otherwise merge into one blob.
function separate(game) {
  const list = game.enemies
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (!a.alive || a.solid || a.phased) continue
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]
      if (!b.alive || b.solid || b.phased) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const min = a.r + b.r + 0.1
      const d2 = dx * dx + dy * dy
      if (d2 >= min * min || d2 < 1e-8) continue
      const d = Math.sqrt(d2)
      const push = (min - d) / 2
      const nx = dx / d
      const ny = dy / d
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
    }
  }
}

// ---------------------------------------------------------------------------
// Debug helpers (used by the dev tools and the balance simulation)
// ---------------------------------------------------------------------------

export function debugClearWave(game) {
  for (const e of game.enemies) if (e.alive) killEnemy(game, e, true)
  game.enemies = []
  game.spawns.length = 0
}

export function debugSkipToBoss(game) {
  debugClearWave(game)
  if (game.phase === 'intro') setPhase(game, 'waves')
  game.waveIndex = game.waveCount - 1
  game.clearedWave = game.waveIndex
  game.waveDelay = 0
}
