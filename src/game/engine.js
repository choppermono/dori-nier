import { TUNING, PALETTE } from './config.js'
import { buildLevel, spawnEnemy } from './level.js'
import { LEVELS } from './levels.js'

// Reine Spiellogik. Kein Vue, kein DOM, kein Canvas - diese Datei weiss nur, wie sich
// der Zustand von einem Bild zum naechsten veraendert. Genau deshalb laesst sie sich
// ohne Browser testen.

// ---------------------------------------------------------------------------
// Geometrie
// ---------------------------------------------------------------------------

function circleRect(cx, cy, r, rect) {
  const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w))
  const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h))
  const dx = cx - nx
  const dy = cy - ny
  return dx * dx + dy * dy <= r * r
}

function circleCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx
  const dy = ay - by
  const rr = ar + br
  return dx * dx + dy * dy <= rr * rr
}

function pushOut(obj, r, rect) {
  const nx = Math.max(rect.x, Math.min(obj.x, rect.x + rect.w))
  const ny = Math.max(rect.y, Math.min(obj.y, rect.y + rect.h))
  const dx = obj.x - nx
  const dy = obj.y - ny
  const distSq = dx * dx + dy * dy
  if (distSq > r * r) return

  if (distSq > 0.0001) {
    const dist = Math.sqrt(distSq)
    obj.x = nx + (dx / dist) * r
    obj.y = ny + (dy / dist) * r
    return
  }

  const left = Math.abs(obj.x - rect.x)
  const right = Math.abs(rect.x + rect.w - obj.x)
  const top = Math.abs(obj.y - rect.y)
  const bottom = Math.abs(rect.y + rect.h - obj.y)
  const min = Math.min(left, right, top, bottom)
  if (min === left) obj.x = rect.x - r
  else if (min === right) obj.x = rect.x + rect.w + r
  else if (min === top) obj.y = rect.y - r
  else obj.y = rect.y + rect.h + r
}

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2
  while (a < -Math.PI) a += Math.PI * 2
  return a
}

// Kuerzester Weg von einem Winkel zum anderen, damit die Drehung nicht den langen
// Bogen nimmt, wenn sie ueber die Naht bei PI laeuft.
function angleTowards(current, target, maxStep) {
  const diff = normalizeAngle(target - current)
  if (Math.abs(diff) <= maxStep) return target
  return current + Math.sign(diff) * maxStep
}

// Wie weit kommt ein Strahl, bevor ihn ein Block aufhaelt? Schrittweise geprueft -
// genau genug fuer die Darstellung und fuer den Treffertest, und billig.
function rayLength(game, x, y, angle, maxLen) {
  const step = 9
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  for (let t = 0; t < maxLen; t += step) {
    const px = x + cos * t
    const py = y + sin * t
    if (px < 0 || py < 0 || px > game.width || py > game.height) return t
    for (const b of game.blocks) {
      if (b.alive && circleRect(px, py, 2, b)) return t
    }
  }
  return maxLen
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

// ---------------------------------------------------------------------------
// Spielerzustand
// ---------------------------------------------------------------------------

// Welches Segment liegt in Richtung eines Treffers? 0 vorne, 1 rechts, 2 hinten,
// 3 links - jeweils relativ zur Blickrichtung, weil die Raute mitdreht.
export function segmentFromDirection(worldAngle, playerAngle) {
  const local = normalizeAngle(worldAngle - playerAngle)
  const idx = Math.round(local / (Math.PI / 2))
  return ((idx % 4) + 4) % 4
}

export function playerRadius(game) {
  const lost = game.player.segments.filter((alive) => !alive).length
  const factors = TUNING.player.radiusBySegmentsLost
  const f = factors[Math.min(lost, factors.length - 1)]
  return game.player.baseRadius * f
}

export function segmentsLeft(game) {
  return game.player.segments.filter(Boolean).length
}

function damagePlayer(game, fromX, fromY) {
  const p = game.player
  if (p.invuln > 0) return

  const worldAngle = Math.atan2(fromY - p.y, fromX - p.x)
  let idx = segmentFromDirection(worldAngle, p.angle)

  // Ist das Segment schon weg, bricht das naechstgelegene noch vorhandene.
  if (!p.segments[idx]) {
    const order = [1, -1, 2]
    for (const off of order) {
      const alt = (((idx + off) % 4) + 4) % 4
      if (p.segments[alt]) {
        idx = alt
        break
      }
    }
  }
  if (!p.segments[idx]) return

  p.segments[idx] = false
  p.lastBrokenSegment = idx
  p.breakFlash = 0.4
  p.invuln = TUNING.player.invulnSeconds
  p.radius = playerRadius(game)
  game.shake = 0.3

  if (segmentsLeft(game) === 0) {
    game.status = 'lost'
    game.lossReason = 'zerstoert'
  }
}

// ---------------------------------------------------------------------------
// Aufbau
// ---------------------------------------------------------------------------

export function createGame(levelIndex, width, height) {
  const def = LEVELS[Math.max(0, Math.min(levelIndex, LEVELS.length - 1))]
  const built = buildLevel(def, width, height)
  const cfg = TUNING.player
  const baseRadius = cfg.radius * built.scale

  const game = {
    status: 'ready', // ready | running | levelclear | complete | lost
    lossReason: '',
    levelIndex,
    levelName: built.name,
    levelSubtitle: built.subtitle,
    width,
    height,
    scale: built.scale,
    timeLimit: def.timeLimit,
    timeLeft: def.timeLimit,
    shake: 0,

    player: {
      x: width / 2,
      y: height * 0.86,
      angle: -Math.PI / 2,
      baseRadius,
      radius: baseRadius,
      segments: [true, true, true, true],
      lastBrokenSegment: -1,
      breakFlash: 0,
      invuln: 0,
      fireCooldown: 0,
      firing: false,
    },

    bullets: [],
    enemyBullets: [],
    enemies: [],
    pendingSpawns: [],
    sparks: [],

    blocks: built.blocks,
    cores: built.cores,
    waves: built.waves,
    coreFiresDuringWaves: built.coreFiresDuringWaves,
    waveIndex: -1,
    waveGap: 0,
    wavesDone: false,
  }

  startWave(game, 0)
  return game
}

function startWave(game, index) {
  game.waveIndex = index
  const wave = game.waves[index]
  if (!wave) {
    game.wavesDone = true
    return
  }
  for (const spec of wave) {
    game.pendingSpawns.push({
      spec,
      x: spec.x,
      y: spec.y,
      radius: spec.radius,
      timer: TUNING.wave.spawnWarnSeconds,
    })
  }
}

export function isShielded(game) {
  return !game.wavesDone
}

export function enemiesLeft(game) {
  return game.enemies.length + game.pendingSpawns.length
}

export function waveLabel(game) {
  return `${Math.min(game.waveIndex + 1, game.waves.length)} / ${game.waves.length}`
}

// ---------------------------------------------------------------------------
// Groessenaenderung
// ---------------------------------------------------------------------------

export function resize(game, width, height) {
  if (width < 2 || height < 2) return
  const fx = width / game.width
  const fy = height / game.height
  if (Math.abs(fx - 1) < 0.001 && Math.abs(fy - 1) < 0.001) return
  const f = Math.min(fx, fy)

  const move = (o) => {
    o.x *= fx
    o.y *= fy
  }

  move(game.player)
  game.player.baseRadius *= f
  game.player.radius = playerRadius(game)

  for (const b of game.bullets.concat(game.enemyBullets)) {
    move(b)
    b.vx *= fx
    b.vy *= fy
    b.radius *= f
  }
  for (const b of game.blocks) {
    b.x *= fx
    b.y *= fy
    b.w *= fx
    b.h *= fy
  }
  for (const c of game.cores) {
    move(c)
    c.radius *= f
  }
  for (const e of game.enemies) {
    move(e)
    e.radius *= f
    e.speed *= f
    e.chargeSpeed *= f
    e.standoff *= f
    e.orbitRadius *= f
  }
  for (const s of game.pendingSpawns) {
    move(s)
    s.radius *= f
  }
  for (const wave of game.waves) {
    for (const spec of wave) {
      spec.x *= fx
      spec.y *= fy
      spec.radius *= f
      spec.speed *= f
      spec.chargeSpeed *= f
      spec.standoff *= f
      spec.orbitRadius *= f
    }
  }
  for (const s of game.sparks) move(s)

  game.scale *= f
  game.width = width
  game.height = height
}

// ---------------------------------------------------------------------------
// Effekte
// ---------------------------------------------------------------------------

function burst(game, x, y, color, count = 8) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = (60 + Math.random() * 150) * game.scale
    game.sparks.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.35 + Math.random() * 0.25,
      maxLife: 0.6,
      color,
    })
  }
}

// ---------------------------------------------------------------------------
// Feuermuster
// ---------------------------------------------------------------------------

function pushBullet(game, x, y, angle, speed, kind, homing) {
  game.enemyBullets.push({
    x,
    y,
    vx: Math.cos(angle) * speed * game.scale,
    vy: Math.sin(angle) * speed * game.scale,
    radius: TUNING.bullet.radius * game.scale,
    kind,
    homing: !!homing,
    life: homing ? TUNING.bullet.homingLifetime : 0,
  })
}

function fire(game, e, aimAngle) {
  const p = e.pattern
  const originX = e.x + Math.cos(aimAngle) * e.radius
  const originY = e.y + Math.sin(aimAngle) * e.radius

  switch (e.patternName) {
    case 'single':
      pushBullet(game, originX, originY, aimAngle, p.speed, p.kind)
      break

    case 'spread': {
      const half = p.arc / 2
      for (let i = 0; i < p.count; i++) {
        const t = p.count === 1 ? 0.5 : i / (p.count - 1)
        pushBullet(game, originX, originY, aimAngle - half + p.arc * t, p.speed, p.kind)
      }
      break
    }

    case 'burst':
      // Erster Schuss sofort, die restlichen ueber burstLeft nachgereicht.
      pushBullet(game, originX, originY, aimAngle, p.speed, p.kind)
      e.burstLeft = p.shots - 1
      e.burstTimer = p.gap
      break

    case 'ring':
      for (let i = 0; i < p.count; i++) {
        const a = (i / p.count) * Math.PI * 2
        pushBullet(game, e.x + Math.cos(a) * e.radius, e.y + Math.sin(a) * e.radius, a, p.speed, p.kind)
      }
      break

    case 'homing':
      pushBullet(game, originX, originY, aimAngle, p.speed, p.kind, true)
      break

    case 'beam':
      // Erst ankuendigen, dann treffen. Ohne Vorwarnung waere es ein Hinterhalt.
      e.beamWarn = TUNING.beam.warnSeconds
      e.beamAngle = aimAngle
      break

    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Gegnerbewegung
// ---------------------------------------------------------------------------

function steerHunter(e, game, dt) {
  const p = game.player
  const dx = p.x - e.x
  const dy = p.y - e.y
  const dist = Math.hypot(dx, dy) || 1

  // Wunschabstand: naeher kommen wenn zu weit, zurueckweichen wenn zu nah.
  // Ein Jaeger, der stumpf hineinrennt, klebt am Spieler und nimmt ihm jede
  // Ausweichmoeglichkeit.
  const diff = dist - e.standoff
  const dir = Math.abs(diff) < e.radius ? 0 : Math.sign(diff)
  e.x += (dx / dist) * dir * e.speed * dt
  e.y += (dy / dist) * dir * e.speed * dt
}

function steerCharger(e, game, dt) {
  const p = game.player
  e.chargeTimer -= dt

  switch (e.chargeState) {
    case 'idle': {
      const dx = p.x - e.x
      const dy = p.y - e.y
      const dist = Math.hypot(dx, dy) || 1
      e.x += (dx / dist) * e.speed * dt
      e.y += (dy / dist) * e.speed * dt
      if (e.chargeTimer <= 0) {
        e.chargeState = 'windup'
        e.chargeTimer = 0.85
        e.chargeDx = dx / dist
        e.chargeDy = dy / dist
      }
      break
    }
    case 'windup': {
      // Richtung ist gesperrt und wird angezeigt. Ausgewichen wird seitlich.
      if (e.chargeTimer <= 0) {
        e.chargeState = 'charging'
        e.chargeTimer = 0.85
      }
      break
    }
    case 'charging': {
      e.x += e.chargeDx * e.chargeSpeed * dt
      e.y += e.chargeDy * e.chargeSpeed * dt
      if (e.chargeTimer <= 0) {
        e.chargeState = 'recover'
        e.chargeTimer = 1.6
      }
      break
    }
    default: {
      if (e.chargeTimer <= 0) {
        e.chargeState = 'idle'
        e.chargeTimer = 1.2 + Math.random()
      }
      break
    }
  }
}

function steerOrbiter(e, game, dt) {
  const target = game.cores.find((c) => c.alive) || {
    x: game.width / 2,
    y: game.height / 2,
  }
  const r = e.orbitRadius || Math.min(game.width, game.height) * 0.22
  e.orbitAngle += (e.speed / Math.max(r, 1)) * dt
  e.x = target.x + Math.cos(e.orbitAngle) * r
  e.y = target.y + Math.sin(e.orbitAngle) * r
}

// Mehrere Verfolger mit demselben Ziel sammeln sich sonst auf einem Punkt und
// werden zu einem einzigen dicken Gegner.
function separate(game) {
  const movers = game.enemies.filter((e) => e.alive && !e.solid)
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i]
      const b = movers[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const min = a.radius + b.radius + 6
      const distSq = dx * dx + dy * dy
      if (distSq >= min * min || distSq < 0.0001) continue
      const dist = Math.sqrt(distSq)
      const push = (min - dist) / 2
      const nx = dx / dist
      const ny = dy / dist
      a.x -= nx * push
      a.y -= ny * push
      b.x += nx * push
      b.y += ny * push
    }
  }
}

// ---------------------------------------------------------------------------
// Hauptschleife
// ---------------------------------------------------------------------------

export function update(game, dt, input) {
  if (game.status !== 'running') return

  game.shake = Math.max(0, game.shake - dt)

  game.timeLeft -= dt
  if (game.timeLeft <= 0) {
    game.timeLeft = 0
    game.status = 'lost'
    game.lossReason = 'zeit'
    return
  }

  updatePlayer(game, dt, input)
  updateWaves(game, dt)
  updateEnemies(game, dt)
  updateCores(game, dt)
  updatePlayerBullets(game, dt)
  updateEnemyBullets(game, dt)
  updateSparks(game, dt)

  if (game.status === 'running' && game.wavesDone && game.cores.every((c) => !c.alive)) {
    game.status = 'levelclear'
  }
}

function updatePlayer(game, dt, input) {
  const p = game.player
  const cfg = TUNING.player
  const s = game.scale

  // Linker Stick: Loslassen heisst Stillstand. Keine Traegheit, kein Ausweichmanoever.
  const moveLen = Math.hypot(input.move.x, input.move.y)
  if (moveLen > 0.001) {
    const throttle = Math.min(1, moveLen)
    p.x += (input.move.x / moveLen) * cfg.speed * s * throttle * dt
    p.y += (input.move.y / moveLen) * cfg.speed * s * throttle * dt
  }

  p.x = Math.max(p.radius, Math.min(game.width - p.radius, p.x))
  p.y = Math.max(p.radius, Math.min(game.height - p.radius, p.y))

  for (const b of game.blocks) if (b.alive) pushOut(p, p.radius, b)
  for (const e of game.enemies) {
    if (!e.alive || !e.solid) continue
    const dx = p.x - e.x
    const dy = p.y - e.y
    const min = p.radius + e.radius
    const dist = Math.hypot(dx, dy)
    if (dist < min && dist > 0.001) {
      p.x = e.x + (dx / dist) * min
      p.y = e.y + (dy / dist) * min
    }
  }

  // Rechter Stick: Drehung und Feuer zugleich. Losgelassen bleibt der Winkel stehen.
  const aimLen = Math.hypot(input.aim.x, input.aim.y)
  p.firing = input.aim.active && aimLen > 0.15
  if (p.firing) {
    p.angle = angleTowards(p.angle, Math.atan2(input.aim.y, input.aim.x), cfg.turnRate * dt)
  }

  p.fireCooldown -= dt
  if (p.firing && p.fireCooldown <= 0) {
    p.fireCooldown = cfg.fireInterval
    game.bullets.push({
      x: p.x + Math.cos(p.angle) * p.radius,
      y: p.y + Math.sin(p.angle) * p.radius,
      vx: Math.cos(p.angle) * cfg.bulletSpeed * s,
      vy: Math.sin(p.angle) * cfg.bulletSpeed * s,
      radius: cfg.bulletRadius * s,
    })
  }

  if (p.invuln > 0) p.invuln -= dt
  if (p.breakFlash > 0) p.breakFlash -= dt
}

function updateWaves(game, dt) {
  for (let i = game.pendingSpawns.length - 1; i >= 0; i--) {
    const sp = game.pendingSpawns[i]
    sp.timer -= dt
    if (sp.timer <= 0) {
      game.enemies.push(spawnEnemy(sp.spec))
      game.pendingSpawns.splice(i, 1)
    }
  }

  if (game.wavesDone) return
  if (game.enemies.length > 0 || game.pendingSpawns.length > 0) return

  if (game.waveIndex >= game.waves.length - 1) {
    game.wavesDone = true
    return
  }

  game.waveGap -= dt
  if (game.waveGap <= 0) {
    game.waveGap = TUNING.wave.pauseBetweenWaves
    startWave(game, game.waveIndex + 1)
  }
}

function updateEnemies(game, dt) {
  const p = game.player

  for (const e of game.enemies) {
    if (!e.alive) continue
    if (e.hitFlash > 0) e.hitFlash -= dt

    // Gepanzerte drehen sich langsam - deshalb kann man sie ueberhaupt flankieren.
    const turn = (e.armored ? 1.3 : e.turnRate) * dt
    e.angle = angleTowards(e.angle, Math.atan2(p.y - e.y, p.x - e.x), turn)

    if (e.kind === 'hunter') steerHunter(e, game, dt)
    else if (e.kind === 'charger') steerCharger(e, game, dt)
    else if (e.kind === 'orbiter') steerOrbiter(e, game, dt)

    e.x = Math.max(e.radius, Math.min(game.width - e.radius, e.x))
    e.y = Math.max(e.radius, Math.min(game.height - e.radius, e.y))

    // Beweglichen Gegnern stehen Bloecke im Weg wie dem Spieler.
    if (!e.solid) {
      for (const b of game.blocks) if (b.alive) pushOut(e, e.radius, b)
    }

    // Beruehrungsschaden: bewegliche Gegner tun weh, feste schieben nur weg.
    if (e.contactDamage && circleCircle(e.x, e.y, e.radius, p.x, p.y, p.radius)) {
      damagePlayer(game, e.x, e.y)
      if (e.kind === 'charger' && e.chargeState === 'charging') {
        e.chargeState = 'recover'
        e.chargeTimer = 1.6
      }
    }

    updateBeam(game, e, dt)

    // Nachschuesse einer Salve
    if (e.burstLeft > 0) {
      e.burstTimer -= dt
      if (e.burstTimer <= 0) {
        e.burstTimer = e.pattern.gap
        e.burstLeft -= 1
        pushBullet(
          game,
          e.x + Math.cos(e.angle) * e.radius,
          e.y + Math.sin(e.angle) * e.radius,
          e.angle,
          e.pattern.speed,
          e.pattern.kind,
        )
      }
    }

    if (e.patternName === 'none' || !Number.isFinite(e.pattern.interval)) continue
    e.cooldown -= dt
    if (e.cooldown <= 0 && e.burstLeft === 0) {
      e.cooldown = e.pattern.interval
      fire(game, e, e.angle)
    }
  }

  separate(game)
  game.enemies = game.enemies.filter((e) => e.alive)
}

function updateBeam(game, e, dt) {
  if (e.patternName !== 'beam') return

  if (e.beamWarn > 0) {
    e.beamWarn -= dt
    if (e.beamWarn <= 0) {
      e.beamActive = TUNING.beam.activeSeconds
      e.beamLength = rayLength(game, e.x, e.y, e.beamAngle, Math.hypot(game.width, game.height))
    }
    return
  }

  if (e.beamActive > 0) {
    e.beamActive -= dt
    const p = game.player
    const ex = e.x + Math.cos(e.beamAngle) * e.beamLength
    const ey = e.y + Math.sin(e.beamAngle) * e.beamLength
    const d = distToSegment(p.x, p.y, e.x, e.y, ex, ey)
    if (d < (TUNING.beam.width / 2) * game.scale + p.radius) {
      damagePlayer(game, e.x, e.y)
    }
  }
}

function updateCores(game, dt) {
  const shielded = isShielded(game)
  const mayFire = game.coreFiresDuringWaves || !shielded
  const cfg = TUNING.core

  for (const c of game.cores) {
    if (!c.alive) continue
    if (c.hitFlash > 0) c.hitFlash -= dt
    c.spin += cfg.spinRate * dt
    if (c.pattern === 'none' || !mayFire) continue

    c.cooldown -= dt
    if (c.cooldown <= 0) {
      c.cooldown = cfg.fireInterval
      for (let k = 0; k < cfg.arms; k++) {
        const a = c.spin + (k * Math.PI * 2) / cfg.arms
        pushBullet(game, c.x + Math.cos(a) * c.radius, c.y + Math.sin(a) * c.radius, a, cfg.bulletSpeed, 'purple')
      }
    }
  }
}

function updatePlayerBullets(game, dt) {
  for (let i = game.bullets.length - 1; i >= 0; i--) {
    const b = game.bullets[i]
    b.x += b.vx * dt
    b.y += b.vy * dt

    if (b.x < -20 || b.x > game.width + 20 || b.y < -20 || b.y > game.height + 20) {
      game.bullets.splice(i, 1)
      continue
    }

    let consumed = false

    // Orange Gegnerkugeln lassen sich abschiessen, violette nicht.
    for (let j = game.enemyBullets.length - 1; j >= 0; j--) {
      const eb = game.enemyBullets[j]
      if (eb.kind !== 'orange') continue
      if (circleCircle(b.x, b.y, b.radius, eb.x, eb.y, eb.radius)) {
        game.enemyBullets.splice(j, 1)
        burst(game, eb.x, eb.y, PALETTE.bulletOrange, 4)
        consumed = true
        break
      }
    }
    if (consumed) {
      game.bullets.splice(i, 1)
      continue
    }

    for (const block of game.blocks) {
      if (!block.alive || !circleRect(b.x, b.y, b.radius, block)) continue
      if (block.type === 'destructible') {
        block.hp -= 1
        if (block.hp <= 0) {
          block.alive = false
          burst(game, block.x + block.w / 2, block.y + block.h / 2, PALETTE.boneDim, 10)
        }
      }
      consumed = true
      break
    }
    if (consumed) {
      game.bullets.splice(i, 1)
      continue
    }

    for (const e of game.enemies) {
      if (!e.alive || !circleCircle(b.x, b.y, b.radius, e.x, e.y, e.radius)) continue

      // Gepanzerte sind nur von hinten verwundbar. Sie drehen sich langsam,
      // also ist Flankieren moeglich.
      let hurts = true
      if (e.armored) {
        const impact = Math.atan2(b.y - e.y, b.x - e.x)
        hurts = Math.abs(normalizeAngle(impact - e.angle)) > Math.PI / 2
      }

      if (hurts) {
        e.hp -= 1
        e.hitFlash = 0.12
        if (e.hp <= 0) {
          e.alive = false
          burst(game, e.x, e.y, e.kind === 'charger' ? PALETTE.charger : PALETTE.bone, 14)
        }
      } else {
        burst(game, b.x, b.y, PALETTE.boneMute, 3)
      }
      consumed = true
      break
    }
    if (consumed) {
      game.bullets.splice(i, 1)
      continue
    }

    for (const c of game.cores) {
      if (!c.alive || !circleCircle(b.x, b.y, b.radius, c.x, c.y, c.radius)) continue
      // Solange Wellen laufen, ist der Kern abgeschirmt.
      if (!isShielded(game)) {
        c.hp -= 1
        c.hitFlash = 0.1
        game.shake = Math.max(game.shake, 0.1)
        if (c.hp <= 0) {
          c.alive = false
          burst(game, c.x, c.y, PALETTE.sigText, 22)
          game.shake = 0.45
        }
      }
      consumed = true
      break
    }
    if (consumed) game.bullets.splice(i, 1)
  }
}

function updateEnemyBullets(game, dt) {
  const p = game.player
  for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
    const b = game.enemyBullets[i]

    if (b.homing) {
      b.life -= dt
      if (b.life <= 0) {
        b.homing = false
      } else {
        const speed = Math.hypot(b.vx, b.vy)
        const want = Math.atan2(p.y - b.y, p.x - b.x)
        const now = Math.atan2(b.vy, b.vx)
        const next = angleTowards(now, want, TUNING.bullet.homingTurnRate * dt)
        b.vx = Math.cos(next) * speed
        b.vy = Math.sin(next) * speed
      }
    }

    b.x += b.vx * dt
    b.y += b.vy * dt

    if (b.x < -30 || b.x > game.width + 30 || b.y < -30 || b.y > game.height + 30) {
      game.enemyBullets.splice(i, 1)
      continue
    }

    let blocked = false
    for (const block of game.blocks) {
      if (block.alive && circleRect(b.x, b.y, b.radius, block)) {
        blocked = true
        break
      }
    }
    if (blocked) {
      game.enemyBullets.splice(i, 1)
      continue
    }

    if (circleCircle(b.x, b.y, b.radius, p.x, p.y, p.radius)) {
      game.enemyBullets.splice(i, 1)
      damagePlayer(game, b.x, b.y)
    }
  }
}

function updateSparks(game, dt) {
  for (let i = game.sparks.length - 1; i >= 0; i--) {
    const s = game.sparks[i]
    s.life -= dt
    if (s.life <= 0) {
      game.sparks.splice(i, 1)
      continue
    }
    s.x += s.vx * dt
    s.y += s.vy * dt
    s.vx *= 0.92
    s.vy *= 0.92
  }
}
