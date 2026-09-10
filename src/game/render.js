import { PALETTE, TUNING } from './config.js'
import { isShielded } from './engine.js'

// Alles Zeichnen an einem Ort. Diese Datei aendert den Spielzustand nie, sie liest ihn nur.

function drawGrid(ctx, w, h, scale) {
  const step = 46 * scale
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

function drawBlocks(ctx, blocks, scale) {
  for (const b of blocks) {
    if (!b.alive) continue
    ctx.save()
    if (b.type === 'cover') {
      // Deckung: massiv gezeichnet, damit sofort klar ist, dass nichts durchkommt.
      ctx.fillStyle = PALETTE.cover
      ctx.fillRect(b.x, b.y, b.w, b.h)
    } else {
      // Zerstoerbar: nur Umriss, Strichstaerke zeigt die Restlebenspunkte.
      ctx.strokeStyle = PALETTE.block
      ctx.lineWidth = Math.max(1.5, b.hp * 1.6) * scale
      ctx.strokeRect(b.x, b.y, b.w, b.h)
    }
    ctx.restore()
  }
}

function drawTurret(ctx, t, scale) {
  ctx.save()
  ctx.translate(t.x, t.y)
  ctx.strokeStyle = PALETTE.turret
  ctx.lineWidth = 2 * scale

  // Gehaeuse als Raute
  ctx.beginPath()
  ctx.moveTo(0, -t.radius)
  ctx.lineTo(t.radius, 0)
  ctx.lineTo(0, t.radius)
  ctx.lineTo(-t.radius, 0)
  ctx.closePath()
  ctx.stroke()

  // Schadensmarkierung: je weniger Leben, desto voller der Kern
  const fill = 1 - t.hp / t.maxHp
  if (fill > 0) {
    ctx.fillStyle = PALETTE.danger
    ctx.globalAlpha = 0.25 + fill * 0.5
    ctx.beginPath()
    ctx.arc(0, 0, t.radius * 0.42, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }

  // Lauf zeigt auf den Spieler
  ctx.rotate(t.angle)
  ctx.beginPath()
  ctx.moveTo(t.radius * 0.5, 0)
  ctx.lineTo(t.radius * 1.5, 0)
  ctx.stroke()
  ctx.restore()
}

function drawCore(ctx, core, shielded, scale) {
  ctx.save()
  ctx.translate(core.x, core.y)

  if (shielded) {
    // Schild: gestrichelter Ring. Solange er da ist, richtet Feuer nichts aus.
    ctx.strokeStyle = PALETTE.lineDim
    ctx.lineWidth = 2 * scale
    ctx.setLineDash([7 * scale, 7 * scale])
    ctx.beginPath()
    ctx.arc(0, 0, core.radius * 1.5, 0, Math.PI * 2)
    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.strokeStyle = shielded ? PALETTE.lineDim : PALETTE.danger
  ctx.lineWidth = 2.5 * scale
  ctx.beginPath()
  ctx.arc(0, 0, core.radius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.rotate(core.spin)
  ctx.strokeStyle = shielded ? PALETTE.lineDim : PALETTE.core
  ctx.lineWidth = 2 * scale
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI * 2) / 3
    const r = core.radius * 0.62
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r)
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.stroke()

  // Lebensbalken des Kerns, sobald er verwundbar ist
  if (!shielded) {
    ctx.rotate(-core.spin)
    const frac = Math.max(0, core.hp / core.maxHp)
    const barW = core.radius * 2
    ctx.fillStyle = PALETTE.danger
    ctx.fillRect(-barW / 2, core.radius + 10 * scale, barW * frac, 3 * scale)
    ctx.strokeStyle = PALETTE.lineDim
    ctx.lineWidth = 1
    ctx.strokeRect(-barW / 2, core.radius + 10 * scale, barW, 3 * scale)
  }

  ctx.restore()
}

function drawPlayer(ctx, p, scale) {
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)

  // Nach einem Treffer blinkt das Dreieck, solange es unverwundbar ist.
  if (p.invuln > 0 && Math.floor(p.invuln * 14) % 2 === 0) {
    ctx.globalAlpha = 0.3
  }

  ctx.strokeStyle = PALETTE.player
  ctx.fillStyle = PALETTE.background
  ctx.lineWidth = 2.2 * scale
  ctx.beginPath()
  ctx.moveTo(p.radius * 1.35, 0)
  ctx.lineTo(-p.radius * 0.85, -p.radius * 0.9)
  ctx.lineTo(-p.radius * 0.4, 0)
  ctx.lineTo(-p.radius * 0.85, p.radius * 0.9)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.restore()
}

function drawBullets(ctx, game, scale) {
  ctx.save()
  ctx.fillStyle = PALETTE.playerShot
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
    // Violette Kugeln bekommen einen Ring: nicht abschiessbar, nur ausweichbar.
    if (!orange) {
      ctx.strokeStyle = PALETTE.line
      ctx.lineWidth = 1.4 * scale
      ctx.beginPath()
      ctx.arc(b.x, b.y, b.radius + 2.5 * scale, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawStick(ctx, stick, scale) {
  if (!stick.active) return
  ctx.save()
  ctx.strokeStyle = PALETTE.lineDim
  ctx.lineWidth = 1.6 * scale

  ctx.beginPath()
  ctx.arc(stick.originX, stick.originY, stick.radius, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = PALETTE.lineDim
  ctx.beginPath()
  ctx.arc(stick.knobX, stick.knobY, stick.radius * 0.34, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawScanlines(ctx, w, h) {
  ctx.save()
  ctx.fillStyle = 'rgba(0, 0, 0, 0.16)'
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1)
  }
  ctx.restore()
}

export function render(ctx, game, sticks) {
  const { width: w, height: h } = game
  const scale = game.level.scale

  ctx.save()

  // Bildschirmruckeln bei Treffern
  if (game.shake > 0) {
    const mag = game.shake * 12
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag)
  }

  ctx.fillStyle = PALETTE.background
  ctx.fillRect(-20, -20, w + 40, h + 40)

  drawGrid(ctx, w, h, scale)

  // Arenarahmen
  ctx.strokeStyle = PALETTE.lineDim
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  drawCore(ctx, game.level.core, isShielded(game), scale)
  drawBlocks(ctx, game.level.blocks, scale)
  for (const t of game.level.turrets) {
    if (t.alive) drawTurret(ctx, t, scale)
  }
  drawBullets(ctx, game, scale)
  drawPlayer(ctx, game.player, scale)

  ctx.restore()

  drawStick(ctx, sticks.move, scale)
  drawStick(ctx, sticks.aim, scale)
  drawScanlines(ctx, w, h)
}

export const HUD_MAX_HP = TUNING.player.maxHp
