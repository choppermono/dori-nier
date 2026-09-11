import { PLAYER } from './config.js'
import { angleTo, normalizeAngle } from './geom.js'
import { event } from './patterns.js'

// The player's ship is a diamond of four segments. A hit breaks the segment on
// the side it came from: 0 front, 1 right, 2 back, 3 left, relative to where
// the ship faces. The renderer draws each segment centred on that direction.

export function segmentFromDirection(worldAngle, playerAngle) {
  const local = normalizeAngle(worldAngle - playerAngle)
  const idx = Math.round(local / (Math.PI / 2))
  return ((idx % 4) + 4) % 4
}

export function segmentsLeft(p) {
  let n = 0
  for (const s of p.segments) if (s) n++
  return n
}

export function playerRadius(p) {
  const lost = 4 - segmentsLeft(p)
  const f = PLAYER.radiusBySegmentsLost[Math.min(lost, PLAYER.radiusBySegmentsLost.length - 1)]
  return PLAYER.radius * f
}

// Returns true when the hit landed.
export function damagePlayer(game, fromX, fromY) {
  const p = game.player
  if (!p.alive || p.invuln > 0 || game.god) return false
  if (game.phase === 'intro' || game.phase === 'clear' || game.phase === 'dead') return false

  const from = angleTo(p.x, p.y, fromX, fromY)
  let idx = segmentFromDirection(from, p.angle)

  // That side is already gone: the nearest segment still there breaks instead.
  if (!p.segments[idx]) {
    for (const off of [1, -1, 2]) {
      const alt = (((idx + off) % 4) + 4) % 4
      if (p.segments[alt]) {
        idx = alt
        break
      }
    }
  }
  if (!p.segments[idx]) return false

  p.segments[idx] = false
  p.invuln = PLAYER.invuln
  p.r = playerRadius(p)
  game.stats.damage += 1
  game.shake = Math.max(game.shake, 0.45)
  event(game, 'playerHit', { x: p.x, y: p.y, seg: idx, angle: p.angle, from })

  if (segmentsLeft(p) === 0) {
    p.alive = false
    game.phase = 'dead'
    game.phaseT = 0
    game.shake = 0.9
    if (!game.reduced) game.slow = 0.7
    event(game, 'playerDown', { x: p.x, y: p.y })
  }
  return true
}

// Restores one segment, front first. Given once per sector, when the core wakes.
export function healPlayer(game) {
  const p = game.player
  for (const i of [0, 1, 3, 2]) {
    if (!p.segments[i]) {
      p.segments[i] = true
      p.r = playerRadius(p)
      event(game, 'heal', { seg: i, x: p.x, y: p.y })
      return true
    }
  }
  return false
}
