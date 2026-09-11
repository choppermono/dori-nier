import { ENEMIES } from './enemies.js'
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
import { ENEMY_PATTERNS, event, mine } from './patterns.js'
import { damagePlayer } from './combat.js'

// How every enemy moves and when it fires. One function per behaviour; the
// type data in enemies.js picks which one.

export function makeEnemy(game, type, x, y, opts = {}) {
  const def = ENEMIES[type]
  if (!def) throw new Error(`Unknown enemy type: ${type}`)
  const hp = Math.max(1, Math.round(def.hp * game.tier.hp))
  const p = game.player
  const e = {
    id: game.nextId++,
    type,
    def,
    x,
    y,
    r: def.r,
    hp,
    maxHp: hp,
    angle: angleTo(x, y, p.x, p.y),
    alive: true,
    flash: 0,
    t: 0,
    pattern: opts.pattern !== undefined ? opts.pattern : def.pattern,
    cd: rand(0.8, 1.6),
    abilityCd: rand(0.8, 1.6),
    armored: !!(def.armored || opts.armored),
    shielded: false,
    shieldedBy: null,
    phased: false,
    visible: true,
    contact: !!def.contact,
    solid: !!def.solid,
    vx: 0,
    vy: 0,
    state: {},
  }
  initState(game, e, opts)
  return e
}

function initState(game, e, opts) {
  const s = e.state
  switch (e.def.behavior) {
    case 'hunter':
      s.strafe = Math.random() < 0.5 ? -1 : 1
      s.strafeT = rand(1.4, 2.8)
      break
    case 'charger':
      s.mode = 'idle'
      s.t = rand(1.1, 1.9)
      break
    case 'orbit': {
      const c = orbitCenter(game)
      s.radius = opts.orbit ?? e.def.orbit
      s.a = angleTo(c.x, c.y, e.x, e.y)
      s.dir = Math.random() < 0.5 ? -1 : 1
      break
    }
    case 'drift':
      s.spinDir = Math.random() < 0.5 ? -1 : 1
      s.retarget = 0
      break
    case 'wander':
      s.retarget = 0
      break
    case 'blink':
      s.mode = 'shown'
      s.t = 2.2
      s.fireAt = 1.7
      s.fired = false
      break
    case 'swarm':
      s.phase = rand(0, TAU)
      break
  }
}

function orbitCenter(game) {
  if (game.boss && game.boss.alive) return game.boss
  if (game.core && game.core.alive) return game.core
  return { x: 0, y: -game.D * 0.2 }
}

function aim(game, e) {
  return angleTo(e.x, e.y, game.player.x, game.player.y)
}

function face(e, a, dt) {
  e.angle = turnTowards(e.angle, a, e.def.turn * dt)
}

// Moving enemies are stopped by blocks and the arena edge like the player.
// Pressed flat against cover they would stay there forever, so an enemy that
// barely moves for a moment picks a side and steps around.
function move(game, e, vx, vy, dt, detour = true) {
  const s = e.state
  if (detour && s.detourT > 0) {
    s.detourT -= dt
    const sp = Math.hypot(vx, vy)
    if (sp > 0.01) {
      const px = (-vy / sp) * s.detour
      const py = (vx / sp) * s.detour
      vx = vx * 0.25 + px * sp
      vy = vy * 0.25 + py * sp
    }
  }

  const ox = e.x
  const oy = e.y
  e.vx = vx
  e.vy = vy
  e.x += vx * dt
  e.y += vy * dt
  clampToArena(game, e, e.r)
  for (const b of game.blocks) if (b.alive) pushOut(e, e.r, b)

  const want = Math.hypot(vx, vy) * dt
  if (detour && want > 1e-4) {
    if (Math.hypot(e.x - ox, e.y - oy) < want * 0.35) {
      s.stuckT = (s.stuckT || 0) + dt
      if (s.stuckT > 0.35 && !(s.detourT > 0)) {
        s.detour = Math.random() < 0.5 ? -1 : 1
        s.detourT = 0.9
        s.stuckT = 0
      }
    } else {
      s.stuckT = 0
    }
  }
}

function pickSpot(game, e, minFromPlayer, maxFromPlayer = 99) {
  const p = game.player
  for (let i = 0; i < 12; i++) {
    const x = rand(-game.W / 2 + 1.2, game.W / 2 - 1.2)
    const y = rand(-game.D / 2 + 1.2, game.D / 2 - 1.2)
    const d = dist(x, y, p.x, p.y)
    if (d < minFromPlayer || d > maxFromPlayer) continue
    if (game.blocks.some((b) => b.alive && circleRect(x, y, e.r + 0.3, b))) continue
    return { x, y }
  }
  return { x: rand(-game.W / 3, game.W / 3), y: rand(-game.D / 3, 0) }
}

const BEHAVIORS = {
  static(game, e, dt) {
    face(e, aim(game, e), dt)
    e.vx = 0
    e.vy = 0
  },

  // Holds a preferred distance and circles, flipping direction now and then.
  hunter(game, e, dt) {
    const p = game.player
    const s = e.state
    const dx = p.x - e.x
    const dy = p.y - e.y
    const d = Math.hypot(dx, dy) || 1
    s.strafeT -= dt
    if (s.strafeT <= 0) {
      s.strafe = -s.strafe
      s.strafeT = rand(1.6, 3.2)
    }
    const radial = clamp((d - e.def.standoff) / 1.6, -1, 1)
    const nx = dx / d
    const ny = dy / d
    const sp = e.def.speed
    move(game, e, (nx * radial - ny * s.strafe * 0.75) * sp, (ny * radial + nx * s.strafe * 0.75) * sp, dt)
    face(e, Math.atan2(dy, dx), dt)
  },

  // Creeps closer, locks a direction (telegraphed), dashes, recovers.
  charger(game, e, dt) {
    const s = e.state
    const def = e.def
    s.t -= dt
    switch (s.mode) {
      case 'idle': {
        face(e, aim(game, e), dt)
        move(game, e, Math.cos(e.angle) * def.speed, Math.sin(e.angle) * def.speed, dt)
        if (s.t <= 0) {
          s.mode = 'windup'
          s.t = 0.8
          s.a = aim(game, e)
          e.angle = s.a
          event(game, 'charge', { x: e.x, y: e.y, id: e.id })
        }
        break
      }
      case 'windup':
        e.vx = 0
        e.vy = 0
        if (s.t <= 0) {
          s.mode = 'dash'
          s.t = 0.75
        }
        break
      case 'dash': {
        const bx = e.x
        const by = e.y
        move(game, e, Math.cos(s.a) * def.dash, Math.sin(s.a) * def.dash, dt, false)
        const moved = Math.hypot(e.x - bx, e.y - by)
        const blocked = moved < def.dash * dt * 0.5
        if (s.t <= 0 || blocked) {
          s.mode = 'recover'
          s.t = 1.0
          if (blocked) {
            game.shake = Math.max(game.shake, 0.18)
            event(game, 'slam', { x: e.x, y: e.y, small: true })
          }
        }
        break
      }
      default:
        e.vx = 0
        e.vy = 0
        face(e, aim(game, e), dt)
        if (s.t <= 0) {
          s.mode = 'idle'
          s.t = rand(1.3, 2.2)
        }
    }
  },

  // Eases onto a circle around the core (or the boss) instead of jumping there.
  orbit(game, e, dt) {
    const s = e.state
    const c = orbitCenter(game)
    s.a += (e.def.speed / s.radius) * s.dir * dt
    const tx = c.x + Math.cos(s.a) * s.radius
    const ty = c.y + Math.sin(s.a) * s.radius
    const k = 1 - Math.exp(-dt * 2.4)
    const nx = e.x + (tx - e.x) * k
    const ny = e.y + (ty - e.y) * k
    move(game, e, (nx - e.x) / dt, (ny - e.y) / dt, dt)
    face(e, aim(game, e), dt)
  },

  // Slow wander while its own facing spins - the spiral comes from that spin.
  drift(game, e, dt) {
    const s = e.state
    s.retarget -= dt
    if (s.tx === undefined || s.retarget <= 0 || dist(e.x, e.y, s.tx, s.ty) < 0.5) {
      const spot = pickSpot(game, e, 3.5)
      s.tx = spot.x
      s.ty = spot.y
      s.retarget = rand(3, 5)
    }
    const a = angleTo(e.x, e.y, s.tx, s.ty)
    move(game, e, Math.cos(a) * e.def.speed, Math.sin(a) * e.def.speed, dt)
    e.angle += e.def.spin * s.spinDir * dt
  },

  // Heads for the player along its own facing, so a slow turner can be outrun
  // and flanked.
  chase(game, e, dt) {
    face(e, aim(game, e), dt)
    move(game, e, Math.cos(e.angle) * e.def.speed, Math.sin(e.angle) * e.def.speed, dt)
  },

  tank(game, e, dt) {
    BEHAVIORS.chase(game, e, dt)
  },

  wander(game, e, dt) {
    const s = e.state
    s.retarget -= dt
    if (s.tx === undefined || s.retarget <= 0 || dist(e.x, e.y, s.tx, s.ty) < 0.6) {
      const spot = pickSpot(game, e, 3)
      s.tx = spot.x
      s.ty = spot.y
      s.retarget = rand(2.5, 4.5)
    }
    const a = angleTo(e.x, e.y, s.tx, s.ty)
    move(game, e, Math.cos(a) * e.def.speed, Math.sin(a) * e.def.speed, dt)
    face(e, aim(game, e), dt)
  },

  // Visible, fades out (untouchable), reappears elsewhere with a warning, bursts.
  blink(game, e, dt) {
    const s = e.state
    s.t -= dt
    face(e, aim(game, e), dt)
    e.vx = 0
    e.vy = 0
    switch (s.mode) {
      case 'shown':
        e.phased = false
        e.visible = true
        if (!s.fired && s.t <= s.fireAt) {
          s.fired = true
          if (canFire(game) && e.pattern) {
            ENEMY_PATTERNS[e.pattern].fire(game, e)
            event(game, 'enemyShot', { x: e.x, y: e.y })
          }
        }
        if (s.t <= 0) {
          s.mode = 'out'
          s.t = 0.4
          e.phased = true
          event(game, 'blinkOut', { x: e.x, y: e.y })
        }
        break
      case 'out':
        if (s.t <= 0) {
          s.mode = 'hidden'
          s.t = 0.3
          e.visible = false
        }
        break
      case 'hidden':
        if (s.t <= 0) {
          const spot = pickSpot(game, e, 3.6, 7.5)
          e.x = spot.x
          e.y = spot.y
          s.mode = 'in'
          s.t = 0.55
          e.visible = true
          event(game, 'blinkIn', { x: e.x, y: e.y })
        }
        break
      default:
        if (s.t <= 0) {
          s.mode = 'shown'
          s.t = 2.3
          s.fireAt = 2.05
          s.fired = false
        }
    }
  },

  // Packs that weave on their way in.
  swarm(game, e, dt) {
    const s = e.state
    const a = aim(game, e) + Math.sin(e.t * 3.2 + s.phase) * 0.85
    e.angle = turnTowards(e.angle, a, e.def.turn * dt)
    move(game, e, Math.cos(e.angle) * e.def.speed, Math.sin(e.angle) * e.def.speed, dt)
  },
}

function canFire(game) {
  return game.phase === 'waves' || game.phase === 'boss'
}

export function updateEnemy(game, e, dt) {
  e.t += dt
  if (e.flash > 0) e.flash -= dt

  const behave = BEHAVIORS[e.def.behavior] || BEHAVIORS.static
  behave(game, e, dt)

  if (e.pattern && !e.phased) {
    const pat = ENEMY_PATTERNS[e.pattern]
    if (pat && Number.isFinite(pat.every)) {
      e.cd -= dt
      if (e.cd <= 0) {
        e.cd = pat.every * game.tier.rate
        if (canFire(game)) {
          pat.fire(game, e)
          event(game, 'enemyShot', { x: e.x, y: e.y })
        }
      }
    }
  }

  if (e.def.ability === 'mines' && canFire(game)) {
    e.abilityCd -= dt
    if (e.abilityCd <= 0) {
      e.abilityCd = e.def.abilityEvery * game.tier.rate
      mine(game, e.x, e.y, { fuse: 3.4, n: 8 })
    }
  }

  if (e.contact && !e.phased && game.player.alive) {
    const p = game.player
    if (circleCircle(e.x, e.y, e.r, p.x, p.y, p.r)) {
      if (damagePlayer(game, e.x, e.y) && e.state.mode === 'dash') {
        e.state.mode = 'recover'
        e.state.t = 1.1
      }
    }
  }
}

// Wardens protect everything within their range - except other wardens, or two
// of them would make each other immortal.
export function applyWardens(game) {
  const wardens = []
  for (const e of game.enemies) {
    if (e.alive && e.def.ability === 'shield' && !e.phased) wardens.push(e)
  }
  for (const e of game.enemies) {
    e.shielded = false
    e.shieldedBy = null
    if (!e.alive || e.def.ability === 'shield') continue
    for (const w of wardens) {
      if (dist(w.x, w.y, e.x, e.y) <= w.def.range) {
        e.shielded = true
        e.shieldedBy = w
        break
      }
    }
  }
}

// Returns 'hit', 'kill', 'deflect' or null (not hittable right now).
export function damageEnemy(game, e, dmg, fromX, fromY) {
  if (!e.alive || e.phased) return null
  if (e.shielded) {
    event(game, 'deflect', { x: fromX, y: fromY })
    return 'deflect'
  }
  if (e.armored) {
    const impact = angleTo(e.x, e.y, fromX, fromY)
    if (Math.abs(normalizeAngle(impact - e.angle)) < Math.PI / 2) {
      event(game, 'deflect', { x: fromX, y: fromY })
      return 'deflect'
    }
  }
  e.hp -= dmg
  e.flash = 0.1
  event(game, 'hit', { x: fromX, y: fromY, target: 'enemy' })
  if (e.hp <= 0) {
    killEnemy(game, e)
    return 'kill'
  }
  return 'hit'
}

export function killEnemy(game, e, silent = false) {
  if (!e.alive) return
  e.alive = false
  if (!silent) game.stats.kills += 1
  event(game, 'kill', { x: e.x, y: e.y, type: e.type, r: e.r, id: e.id, silent })

  const split = e.def.split
  if (split && !silent) {
    for (let i = 0; i < split.count; i++) {
      const a = e.angle + (i / split.count) * TAU
      const c = makeEnemy(game, split.type, e.x + Math.cos(a) * 0.45, e.y + Math.sin(a) * 0.45)
      c.angle = a
      clampToArena(game, c, c.r)
      game.enemies.push(c)
      event(game, 'spawn', { x: c.x, y: c.y, type: c.type, id: c.id, quick: true })
    }
  }
}
