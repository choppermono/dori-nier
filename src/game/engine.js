import { TUNING } from './config.js'
import { buildLevel } from './level.js'

// Reine Spiellogik. Kein Vue, kein DOM, kein Canvas - diese Datei weiss nur, wie sich
// der Zustand von einem Bild zum naechsten veraendert.

function circleRect(cx, cy, r, rect) {
  const nearestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w))
  const nearestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h))
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy <= r * r
}

function circleCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx
  const dy = ay - by
  const rr = ar + br
  return dx * dx + dy * dy <= rr * rr
}

// Schiebt einen Kreis aus einem Rechteck heraus, ueber die kuerzeste Achse.
function pushOut(circle, r, rect) {
  const nearestX = Math.max(rect.x, Math.min(circle.x, rect.x + rect.w))
  const nearestY = Math.max(rect.y, Math.min(circle.y, rect.y + rect.h))
  const dx = circle.x - nearestX
  const dy = circle.y - nearestY
  const distSq = dx * dx + dy * dy

  if (distSq > r * r) return

  if (distSq > 0.0001) {
    const dist = Math.sqrt(distSq)
    circle.x = nearestX + (dx / dist) * r
    circle.y = nearestY + (dy / dist) * r
    return
  }

  // Mittelpunkt liegt im Rechteck: ueber die naechstgelegene Kante hinausschieben.
  const left = Math.abs(circle.x - rect.x)
  const right = Math.abs(rect.x + rect.w - circle.x)
  const top = Math.abs(circle.y - rect.y)
  const bottom = Math.abs(rect.y + rect.h - circle.y)
  const min = Math.min(left, right, top, bottom)

  if (min === left) circle.x = rect.x - r
  else if (min === right) circle.x = rect.x + rect.w + r
  else if (min === top) circle.y = rect.y - r
  else circle.y = rect.y + rect.h + r
}

// Kuerzester Weg von einem Winkel zum anderen, damit die Drehung nicht den langen
// Bogen nimmt, wenn sie ueber die Naht bei PI laeuft.
function angleTowards(current, target, maxStep) {
  let diff = target - current
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  if (Math.abs(diff) <= maxStep) return target
  return current + Math.sign(diff) * maxStep
}

export function createGame(width, height) {
  const level = buildLevel(width, height)
  const p = TUNING.player

  return {
    status: 'ready', // ready | running | won | lost
    width,
    height,
    timeLeft: TUNING.roundSeconds,
    shake: 0,
    player: {
      x: width / 2,
      y: height * 0.86,
      angle: -Math.PI / 2,
      radius: p.radius * level.scale,
      hp: p.maxHp,
      maxHp: p.maxHp,
      invuln: 0,
      fireCooldown: 0,
      firing: false,
    },
    bullets: [],
    enemyBullets: [],
    level,
  }
}

// Fenster gedreht oder Groesse geaendert: alles proportional mitziehen, statt die Runde
// neu zu starten. Positionen sind Anteile der Flaeche, also reicht ein Faktor je Achse.
export function resize(game, width, height) {
  if (width < 2 || height < 2) return
  const fx = width / game.width
  const fy = height / game.height
  if (Math.abs(fx - 1) < 0.001 && Math.abs(fy - 1) < 0.001) return

  const f = Math.min(fx, fy) // fuer Radien und Geschwindigkeiten
  const scalePoint = (o) => {
    o.x *= fx
    o.y *= fy
  }

  scalePoint(game.player)
  game.player.radius *= f

  for (const b of game.bullets) {
    scalePoint(b)
    b.vx *= fx
    b.vy *= fy
    b.radius *= f
  }
  for (const b of game.enemyBullets) {
    scalePoint(b)
    b.vx *= fx
    b.vy *= fy
    b.radius *= f
  }
  for (const b of game.level.blocks) {
    b.x *= fx
    b.y *= fy
    b.w *= fx
    b.h *= fy
  }
  for (const t of game.level.turrets) {
    scalePoint(t)
    t.radius *= f
  }
  scalePoint(game.level.core)
  game.level.core.radius *= f
  game.level.scale *= f

  game.width = width
  game.height = height
}

export function isShielded(game) {
  const blocksLeft = game.level.blocks.some((b) => b.type === 'destructible' && b.alive)
  const turretsLeft = game.level.turrets.some((t) => t.alive)
  return blocksLeft || turretsLeft
}

export function remainingTargets(game) {
  const blocks = game.level.blocks.filter((b) => b.type === 'destructible' && b.alive).length
  const turrets = game.level.turrets.filter((t) => t.alive).length
  return blocks + turrets
}

function damagePlayer(game) {
  if (game.player.invuln > 0) return
  game.player.hp -= 1
  game.player.invuln = TUNING.player.invulnSeconds
  game.shake = 0.28
  if (game.player.hp <= 0) {
    game.player.hp = 0
    game.status = 'lost'
  }
}

export function update(game, dt, input) {
  if (game.status !== 'running') return

  game.shake = Math.max(0, game.shake - dt)

  game.timeLeft -= dt
  if (game.timeLeft <= 0) {
    game.timeLeft = 0
    game.status = 'lost'
    return
  }

  const p = game.player
  const cfg = TUNING.player
  const s = game.level.scale

  // --- Linker Stick: Bewegung -------------------------------------------------
  // Loslassen heisst Stillstand. Es gibt keine Traegheit und kein Ausweichmanoever.
  const moveLen = Math.hypot(input.move.x, input.move.y)
  if (moveLen > 0.001) {
    const nx = input.move.x / moveLen
    const ny = input.move.y / moveLen
    const throttle = Math.min(1, moveLen)
    p.x += nx * cfg.speed * s * throttle * dt
    p.y += ny * cfg.speed * s * throttle * dt
  }

  // In der Arena bleiben.
  p.x = Math.max(p.radius, Math.min(game.width - p.radius, p.x))
  p.y = Math.max(p.radius, Math.min(game.height - p.radius, p.y))

  // Bloecke sind fest, solange sie stehen.
  for (const b of game.level.blocks) {
    if (b.alive) pushOut(p, p.radius, b)
  }

  // --- Rechter Stick: Drehung und Feuer ---------------------------------------
  // Losgelassen bleibt der Winkel stehen und es wird nicht geschossen.
  const aimLen = Math.hypot(input.aim.x, input.aim.y)
  p.firing = input.aim.active && aimLen > 0.15

  if (p.firing) {
    const target = Math.atan2(input.aim.y, input.aim.x)
    p.angle = angleTowards(p.angle, target, cfg.turnRate * dt)
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

  // --- Eigene Schuesse ---------------------------------------------------------
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
        consumed = true
        break
      }
    }
    if (consumed) {
      game.bullets.splice(i, 1)
      continue
    }

    for (const block of game.level.blocks) {
      if (!block.alive) continue
      if (!circleRect(b.x, b.y, b.radius, block)) continue
      if (block.type === 'destructible') {
        block.hp -= 1
        if (block.hp <= 0) block.alive = false
      }
      consumed = true
      break
    }
    if (consumed) {
      game.bullets.splice(i, 1)
      continue
    }

    for (const t of game.level.turrets) {
      if (!t.alive) continue
      if (!circleCircle(b.x, b.y, b.radius, t.x, t.y, t.radius)) continue
      t.hp -= 1
      if (t.hp <= 0) t.alive = false
      consumed = true
      break
    }
    if (consumed) {
      game.bullets.splice(i, 1)
      continue
    }

    const core = game.level.core
    if (core.alive && circleCircle(b.x, b.y, b.radius, core.x, core.y, core.radius)) {
      // Solange etwas anderes steht, ist der Kern abgeschirmt.
      if (!isShielded(game)) {
        core.hp -= 1
        game.shake = 0.12
        if (core.hp <= 0) {
          core.alive = false
          game.status = 'won'
        }
      }
      game.bullets.splice(i, 1)
    }
  }

  // --- Geschuetze --------------------------------------------------------------
  const tCfg = TUNING.turret
  for (const t of game.level.turrets) {
    if (!t.alive) continue
    t.angle = Math.atan2(p.y - t.y, p.x - t.x)
    t.cooldown -= dt
    if (t.cooldown <= 0) {
      t.cooldown = tCfg.fireInterval
      const spread = (Math.random() - 0.5) * tCfg.aimJitter
      const a = t.angle + spread
      game.enemyBullets.push({
        x: t.x + Math.cos(a) * t.radius,
        y: t.y + Math.sin(a) * t.radius,
        vx: Math.cos(a) * tCfg.bulletSpeed * s,
        vy: Math.sin(a) * tCfg.bulletSpeed * s,
        radius: TUNING.bullet.radius * s,
        kind: 'orange',
      })
    }
  }

  // --- Kern --------------------------------------------------------------------
  const core = game.level.core
  const cCfg = TUNING.core
  if (core.alive) {
    core.spin += cCfg.spinRate * dt
    core.cooldown -= dt
    if (core.cooldown <= 0) {
      core.cooldown = cCfg.fireInterval
      for (let k = 0; k < cCfg.arms; k++) {
        const a = core.spin + (k * Math.PI * 2) / cCfg.arms
        game.enemyBullets.push({
          x: core.x + Math.cos(a) * core.radius,
          y: core.y + Math.sin(a) * core.radius,
          vx: Math.cos(a) * cCfg.bulletSpeed * s,
          vy: Math.sin(a) * cCfg.bulletSpeed * s,
          radius: TUNING.bullet.radius * s,
          kind: 'purple',
        })
      }
    }
  }

  // --- Gegnerkugeln ------------------------------------------------------------
  for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
    const b = game.enemyBullets[i]
    b.x += b.vx * dt
    b.y += b.vy * dt

    if (b.x < -30 || b.x > game.width + 30 || b.y < -30 || b.y > game.height + 30) {
      game.enemyBullets.splice(i, 1)
      continue
    }

    let blocked = false
    for (const block of game.level.blocks) {
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
      damagePlayer(game)
    }
  }
}
