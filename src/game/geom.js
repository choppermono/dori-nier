// Small geometry helpers shared by the engine, the enemies and the bosses.
// Blocks are axis-aligned rectangles: x/y is the min corner, w/h the size.

export const TAU = Math.PI * 2

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

export function rand(lo, hi) {
  return lo + Math.random() * (hi - lo)
}

export function normalizeAngle(a) {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

// Shortest turn from one angle towards another, capped at maxStep.
export function turnTowards(current, target, maxStep) {
  const diff = normalizeAngle(target - current)
  if (Math.abs(diff) <= maxStep) return target
  return current + Math.sign(diff) * maxStep
}

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax)
}

export function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay)
}

export function circleCircle(ax, ay, ar, bx, by, br) {
  const dx = ax - bx
  const dy = ay - by
  const rr = ar + br
  return dx * dx + dy * dy <= rr * rr
}

export function circleRect(cx, cy, r, b) {
  const nx = clamp(cx, b.x, b.x + b.w)
  const ny = clamp(cy, b.y, b.y + b.h)
  const dx = cx - nx
  const dy = cy - ny
  return dx * dx + dy * dy <= r * r
}

// Moves a circle out of a rectangle along the shortest way.
export function pushOut(obj, r, b) {
  const nx = clamp(obj.x, b.x, b.x + b.w)
  const ny = clamp(obj.y, b.y, b.y + b.h)
  const dx = obj.x - nx
  const dy = obj.y - ny
  const d2 = dx * dx + dy * dy
  if (d2 > r * r) return false

  if (d2 > 1e-8) {
    const d = Math.sqrt(d2)
    obj.x = nx + (dx / d) * r
    obj.y = ny + (dy / d) * r
    return true
  }

  // Centre inside the rectangle: leave through the nearest side.
  const left = obj.x - b.x
  const right = b.x + b.w - obj.x
  const top = obj.y - b.y
  const bottom = b.y + b.h - obj.y
  const m = Math.min(left, right, top, bottom)
  if (m === left) obj.x = b.x - r
  else if (m === right) obj.x = b.x + b.w + r
  else if (m === top) obj.y = b.y - r
  else obj.y = b.y + b.h + r
  return true
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = clamp(t, 0, 1)
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t))
}

export function insideArena(game, x, y, margin = 0) {
  return Math.abs(x) <= game.W / 2 + margin && Math.abs(y) <= game.D / 2 + margin
}

export function clampToArena(game, obj, r) {
  obj.x = clamp(obj.x, -game.W / 2 + r, game.W / 2 - r)
  obj.y = clamp(obj.y, -game.D / 2 + r, game.D / 2 - r)
}

// How far a ray travels before a block or the arena edge stops it. Stepped,
// which is exact enough for beams and cheap.
export function rayLength(game, x, y, a, maxLen, pierce = false) {
  const step = 0.12
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  for (let t = 0; t < maxLen; t += step) {
    const px = x + cos * t
    const py = y + sin * t
    if (!insideArena(game, px, py, 0.05)) return t
    if (pierce) continue
    for (const b of game.blocks) {
      if (b.alive && circleRect(px, py, 0.04, b)) return t
    }
  }
  return maxLen
}

// Pushes an object out of every block, a few passes for corners.
export function nudgeOutOfBlocks(game, obj, r) {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const b of game.blocks) {
      if (b.alive && pushOut(obj, r + 0.05, b)) moved = true
    }
    if (!moved) break
  }
}
