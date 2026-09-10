import { PALETTE, TUNING } from './config.js'
import { isShielded } from './engine.js'

// Alles Zeichnen an einem Ort. Diese Datei aendert den Zustand nie, sie liest ihn nur.
//
// Palette aus PersonalSite: ruhiges Pergament auf warmem Anthrazit. Die Ruhe gilt
// fuer Rahmen, Gitter und Deckung - Kugeln, Verfolger und der offene Kern bleiben
// laut, sonst stirbt man an Dingen, die man nicht sehen konnte.

function grid(ctx, w, h, scale) {
  const step = 48 * scale
  ctx.save()
  ctx.strokeStyle = PALETTE.lineFaint
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = step; x < w; x += step) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = step; y < h; y += step) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
  ctx.restore()
}

// Eckklammern wie auf der Startseite.
function brackets(ctx, w, h, scale) {
  const len = 26 * scale
  const pad = 8 * scale
  ctx.save()
  ctx.strokeStyle = PALETTE.lineStrong
  ctx.lineWidth = 1.6 * scale
  const corners = [
    [pad, pad, 1, 1],
    [w - pad, pad, -1, 1],
    [pad, h - pad, 1, -1],
    [w - pad, h - pad, -1, -1],
  ]
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath()
    ctx.moveTo(x + sx * len, y)
    ctx.lineTo(x, y)
    ctx.lineTo(x, y + sy * len)
    ctx.stroke()
  }
  ctx.restore()
}

function blocks(ctx, list, scale) {
  for (const b of list) {
    if (!b.alive) continue
    ctx.save()
    if (b.type === 'cover') {
      ctx.fillStyle = PALETTE.boneDim
      ctx.fillRect(b.x, b.y, b.w, b.h)
    } else {
      ctx.strokeStyle = PALETTE.lineStrong
      ctx.lineWidth = Math.max(1.4, b.hp * 1.5) * scale
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    }
    ctx.restore()
  }
}

function core(ctx, c, shielded, scale) {
  ctx.save()
  ctx.translate(c.x, c.y)

  if (shielded) {
    ctx.strokeStyle = PALETTE.line
    ctx.lineWidth = 2 * scale
    ctx.setLineDash([7 * scale, 7 * scale])
    ctx.beginPath()
    ctx.arc(0, 0, c.radius * 1.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.strokeStyle = c.hitFlash > 0 ? PALETTE.bone : shielded ? PALETTE.boneMute : PALETTE.sigText
  ctx.lineWidth = 2.6 * scale
  ctx.beginPath()
  ctx.arc(0, 0, c.radius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.save()
  ctx.rotate(c.spin)
  ctx.strokeStyle = shielded ? PALETTE.boneMute : PALETTE.bone
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3
    const r = c.radius * 0.6
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.stroke()
  ctx.restore()

  if (!shielded) {
    const frac = Math.max(0, c.hp / c.maxHp)
    const w = c.radius * 2
    ctx.fillStyle = PALETTE.sigFill
    ctx.fillRect(-w / 2, c.radius + 9 * scale, w * frac, 3 * scale)
    ctx.strokeStyle = PALETTE.line
    ctx.lineWidth = 1
    ctx.strokeRect(-w / 2, c.radius + 9 * scale, w, 3 * scale)
  }

  ctx.restore()
}

function enemy(ctx, e, scale) {
  ctx.save()
  ctx.translate(e.x, e.y)

  const hurt = e.hitFlash > 0
  let stroke = PALETTE.bone
  if (e.kind === 'hunter') stroke = PALETTE.hunter
  else if (e.kind === 'charger') stroke = PALETTE.charger
  if (hurt) stroke = '#ffffff'

  ctx.strokeStyle = stroke
  ctx.lineWidth = 2 * scale
  ctx.fillStyle = PALETTE.void

  if (e.kind === 'turret') {
    ctx.beginPath()
    ctx.moveTo(0, -e.radius)
    ctx.lineTo(e.radius, 0)
    ctx.lineTo(0, e.radius)
    ctx.lineTo(-e.radius, 0)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (e.kind === 'hunter') {
    ctx.save()
    ctx.rotate(e.angle)
    ctx.beginPath()
    ctx.moveTo(e.radius, 0)
    ctx.lineTo(-e.radius * 0.7, -e.radius * 0.8)
    ctx.lineTo(-e.radius * 0.2, 0)
    ctx.lineTo(-e.radius * 0.7, e.radius * 0.8)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  } else if (e.kind === 'charger') {
    ctx.save()
    ctx.rotate(e.angle)
    ctx.beginPath()
    ctx.moveTo(e.radius * 1.15, 0)
    ctx.lineTo(-e.radius * 0.6, -e.radius)
    ctx.lineTo(-e.radius * 0.6, e.radius)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  } else {
    ctx.beginPath()
    ctx.rect(-e.radius * 0.75, -e.radius * 0.75, e.radius * 1.5, e.radius * 1.5)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(0, 0, e.radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  // Panzerung auf der Vorderseite. Nur von hinten verwundbar - das muss man sehen.
  if (e.armored) {
    ctx.save()
    ctx.rotate(e.angle)
    ctx.strokeStyle = PALETTE.boneDim
    ctx.lineWidth = 4.5 * scale
    ctx.beginPath()
    ctx.arc(0, 0, e.radius * 1.25, -Math.PI / 2, Math.PI / 2)
    ctx.stroke()
    ctx.restore()
  }

  // Lauf
  if (e.kind === 'turret' || e.kind === 'orbiter') {
    ctx.save()
    ctx.rotate(e.angle)
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2 * scale
    ctx.beginPath()
    ctx.moveTo(e.radius * 0.5, 0)
    ctx.lineTo(e.radius * 1.5, 0)
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()

  // Sturm wird angekuendigt: Linie zeigt, wohin es gleich geht.
  if (e.kind === 'charger' && e.chargeState === 'windup') {
    const len = Math.max(e.radius * 8, 140 * scale)
    ctx.save()
    ctx.strokeStyle = PALETTE.sigFill
    ctx.lineWidth = 2 * scale
    ctx.setLineDash([6 * scale, 6 * scale])
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.moveTo(e.x, e.y)
    ctx.lineTo(e.x + e.chargeDx * len, e.y + e.chargeDy * len)
    ctx.stroke()
    ctx.restore()
  }
}

function beam(ctx, e, game, scale) {
  if (e.patternName !== 'beam') return
  const maxLen = Math.hypot(game.width, game.height)

  if (e.beamWarn > 0) {
    const len = e.beamLength || maxLen
    ctx.save()
    ctx.strokeStyle = PALETTE.sigText
    ctx.globalAlpha = 0.35 + 0.45 * (1 - e.beamWarn / TUNING.beam.warnSeconds)
    ctx.lineWidth = 1.5 * scale
    ctx.setLineDash([10 * scale, 8 * scale])
    ctx.beginPath()
    ctx.moveTo(e.x, e.y)
    ctx.lineTo(e.x + Math.cos(e.beamAngle) * len, e.y + Math.sin(e.beamAngle) * len)
    ctx.stroke()
    ctx.restore()
    return
  }

  if (e.beamActive > 0) {
    const len = e.beamLength || maxLen
    ctx.save()
    ctx.strokeStyle = PALETTE.sigText
    ctx.lineWidth = TUNING.beam.width * scale
    ctx.globalAlpha = Math.min(1, e.beamActive / TUNING.beam.activeSeconds + 0.35)
    ctx.beginPath()
    ctx.moveTo(e.x, e.y)
    ctx.lineTo(e.x + Math.cos(e.beamAngle) * len, e.y + Math.sin(e.beamAngle) * len)
    ctx.stroke()
    ctx.restore()
  }
}

// Gegner erscheinen nie ohne Vorwarnung. Erst die Markierung, dann der Gegner.
function spawnMarker(ctx, sp, scale) {
  const t = 1 - sp.timer / TUNING.wave.spawnWarnSeconds
  ctx.save()
  ctx.translate(sp.x, sp.y)
  ctx.strokeStyle = PALETTE.boneDim
  ctx.lineWidth = 1.4 * scale
  ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(t * Math.PI * 5))

  const r = sp.radius * 1.6
  const arm = r * 0.55
  for (let i = 0; i < 4; i++) {
    ctx.save()
    ctx.rotate((i * Math.PI) / 2)
    ctx.beginPath()
    ctx.moveTo(r, r - arm)
    ctx.lineTo(r, r)
    ctx.lineTo(r - arm, r)
    ctx.stroke()
    ctx.restore()
  }

  ctx.globalAlpha = 0.9
  ctx.strokeStyle = PALETTE.bone
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.55, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t)
  ctx.stroke()
  ctx.restore()
}

// Der Spieler: Raute aus vier Segmenten. Jeder Treffer bricht eines ab, und zwar
// auf der Seite, aus der er kam.
function player(ctx, game, scale) {
  const p = game.player
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)

  if (p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0) ctx.globalAlpha = 0.35

  const r = p.radius
  const tip = r * 1.45
  const side = r * 1.05

  // Segment 0 zeigt nach vorne, dann im Uhrzeigersinn.
  const points = [
    { x: tip, y: 0 },
    { x: 0, y: side },
    { x: -side, y: 0 },
    { x: 0, y: -side },
  ]

  ctx.lineWidth = 2.2 * scale
  ctx.lineJoin = 'round'

  for (let i = 0; i < 4; i++) {
    if (!p.segments[i]) continue
    const a = points[i]
    const b = points[(i + 1) % 4]
    ctx.strokeStyle = PALETTE.bone
    ctx.fillStyle = PALETTE.ash
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  // Kern und Blickrichtung bleiben immer sichtbar - sonst zielt man blind,
  // sobald das vordere Segment weg ist.
  ctx.fillStyle = PALETTE.bone
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = PALETTE.bone
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  ctx.moveTo(r * 0.3, 0)
  ctx.lineTo(r * 0.95, 0)
  ctx.stroke()

  ctx.restore()
}

function bullets(ctx, game, scale) {
  ctx.save()
  ctx.fillStyle = PALETTE.bone
  for (const b of game.bullets) {
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  for (const b of game.enemyBullets) {
    const orange = b.kind === 'orange'
    ctx.fillStyle = orange ? PALETTE.bulletOrange : PALETTE.bulletPurple
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2)
    ctx.fill()
    if (!orange) {
      // Ring heisst: nicht abschiessbar, nur ausweichbar.
      ctx.strokeStyle = PALETTE.bone
      ctx.lineWidth = 1.4 * scale
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.radius + 2.6 * scale, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function sparks(ctx, game, scale) {
  ctx.save()
  ctx.lineCap = 'round'
  for (const s of game.sparks) {
    const a = Math.max(0, s.life / s.maxLife)
    ctx.globalAlpha = a
    ctx.strokeStyle = s.color
    ctx.lineWidth = 1.8 * scale
    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(s.x - s.vx * 0.03, s.y - s.vy * 0.03)
    ctx.stroke()
  }
  ctx.restore()
}

function stick(ctx, s, scale) {
  if (!s.active) return
  ctx.save()
  ctx.strokeStyle = PALETTE.line
  ctx.lineWidth = 1.6 * scale
  ctx.beginPath()
  ctx.arc(s.originX, s.originY, s.radius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = PALETTE.line
  ctx.beginPath()
  ctx.arc(s.knobX, s.knobY, s.radius * 0.34, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function scanlines(ctx, w, h) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.14)'
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)
  ctx.restore()
}

export function render(ctx, game, sticks) {
  const { width: w, height: h } = game
  const scale = game.scale
  const shielded = isShielded(game)

  ctx.save()
  if (game.shake > 0) {
    const mag = game.shake * 13
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag)
  }

  ctx.fillStyle = PALETTE.void
  ctx.fillRect(-24, -24, w + 48, h + 48)

  grid(ctx, w, h, scale)

  ctx.strokeStyle = PALETTE.line
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
  brackets(ctx, w, h, scale)

  for (const c of game.cores) if (c.alive) core(ctx, c, shielded, scale)
  blocks(ctx, game.blocks, scale)

  for (const e of game.enemies) if (e.alive) beam(ctx, e, game, scale)
  for (const sp of game.pendingSpawns) spawnMarker(ctx, sp, scale)
  for (const e of game.enemies) if (e.alive) enemy(ctx, e, scale)

  bullets(ctx, game, scale)
  sparks(ctx, game, scale)
  player(ctx, game, scale)

  ctx.restore()

  stick(ctx, sticks.move, scale)
  stick(ctx, sticks.aim, scale)
  scanlines(ctx, w, h)
}
