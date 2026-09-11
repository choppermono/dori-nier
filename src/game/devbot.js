// A test pilot for development: aims at the nearest threat, shoots orange
// bullets out of the air, and picks each move by checking where the bullets
// will be over the next 0.4 s. Only loaded by dev builds (GameCanvas.vue).

function blockedLine(g, ax, ay, bx, by) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 0.2)
  for (let i = 1; i < n; i++) {
    const x = ax + ((bx - ax) * i) / n
    const y = ay + ((by - ay) * i) / n
    for (const b of g.blocks) {
      if (b.alive && x > b.x - 0.1 && x < b.x + b.w + 0.1 && y > b.y - 0.1 && y < b.y + b.h + 0.1) return b
    }
  }
  return null
}

function pickTarget(g) {
  const p = g.player
  if (g.boss && g.boss.alive && !g.boss.phased) return g.boss
  let best = null
  let score = Infinity
  for (const e of g.enemies) {
    if (!e.alive || e.phased) continue
    let d = Math.hypot(e.x - p.x, e.y - p.y)
    if (e.def.ability === 'shield') d -= 6
    if (e.shielded) d += 20
    if (blockedLine(g, p.x, p.y, e.x, e.y)) d += 8
    if (d < score) {
      score = d
      best = e
    }
  }
  return best
}

function goalFor(g, target) {
  const p = g.player
  const clampX = (x) => Math.max(-g.W / 2 + 1, Math.min(g.W / 2 - 1, x))
  const clampY = (y) => Math.max(-g.D / 2 + 1, Math.min(g.D / 2 - 1, y))
  if (!target) return { x: 0, y: g.D * 0.2 }
  const B = g.boss
  if (target.armored || (B && target === B && B.id === 'colossus')) {
    const a = target.angle
    const opts = [1, -1].map((s) => ({
      x: clampX(target.x - Math.sin(a) * 4 * s - Math.cos(a) * 1.5),
      y: clampY(target.y + Math.cos(a) * 4 * s - Math.sin(a) * 1.5),
    }))
    opts.sort((u, v) => Math.hypot(u.x - p.x, u.y - p.y) - Math.hypot(v.x - p.x, v.y - p.y))
    return opts[0]
  }
  const dx = p.x - target.x
  const dy = p.y - target.y
  const d = Math.hypot(dx, dy) || 1
  let gx = target.x + (dx / d) * 5
  let gy = target.y + (dy / d) * 5
  if (blockedLine(g, p.x, p.y, target.x, target.y)) {
    gx += (-dy / d) * 3
    gy += (dx / d) * 3
  }
  return { x: clampX(gx), y: clampY(gy) }
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const l2 = vx * vx + vy * vy || 1
  const u = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2))
  return Math.hypot(px - (ax + vx * u), py - (ay + vy * u))
}

const TAU = Math.PI * 2
const wrap = (a) => ((a % TAU) + TAU) % TAU

// Telegraphed dangers a player reads off the floor: charge lines and the
// wedge a sweeping beam is about to cover.
function telegraphCost(g, px, py) {
  const p = g.player
  let cost = 0
  for (const e of g.enemies) {
    if (e.type !== 'ram' || (e.state.mode !== 'windup' && e.state.mode !== 'dash')) continue
    const a = e.state.a
    if (segDist(px, py, e.x, e.y, e.x + Math.cos(a) * 9, e.y + Math.sin(a) * 9) < e.r + p.r + 0.4) cost += 20
  }
  const B = g.boss
  if (B && B.alive && (B.state.cm === 'windup' || B.state.cm === 'dash')) {
    const a = B.state.ca
    if (segDist(px, py, B.x, B.y, B.x + Math.cos(a) * 16, B.y + Math.sin(a) * 16) < B.r + p.r + 0.5) cost += 30
  }
  for (const h of g.hazards) {
    if (h.type !== 'beam' || !h.spin) continue
    const arc = h.warn > 0 ? h.spin * h.activeMax : h.spin * h.active
    const ang = Math.atan2(py - h.y, px - h.x)
    const rel = arc >= 0 ? wrap(ang - h.a) : wrap(h.a - ang)
    if (rel <= Math.abs(arc) + 0.08 && Math.hypot(px - h.x, py - h.y) < h.len) cost += 18
  }
  return cost
}

function smartMove(g, target) {
  const p = g.player
  const goal = goalFor(g, target)
  const sp = 7.4
  let best = [0, 0]
  let bestCost = Infinity
  for (let k = -1; k < 12; k++) {
    const dx = k < 0 ? 0 : Math.cos((k / 12) * Math.PI * 2)
    const dy = k < 0 ? 0 : Math.sin((k / 12) * Math.PI * 2)
    let cost = 0
    for (let step = 1; step <= 4; step++) {
      const t = step * 0.1
      const px = p.x + dx * sp * t
      const py = p.y + dy * sp * t
      for (const b of g.bullets) {
        const d = Math.hypot(px - (b.x + Math.cos(b.a) * b.s * t), py - (b.y + Math.sin(b.a) * b.s * t)) - (b.r + p.r)
        if (d < 0.5) cost += ((0.5 - d) * 12) / step
      }
      for (const h of g.hazards) {
        if (h.type === 'beam' && (h.warn < 0.45 || h.active > 0)) {
          const ex = h.x + Math.cos(h.a) * h.len
          const ey = h.y + Math.sin(h.a) * h.len
          const vx = ex - h.x
          const vy = ey - h.y
          const l2 = vx * vx + vy * vy || 1
          const u = Math.max(0, Math.min(1, ((px - h.x) * vx + (py - h.y) * vy) / l2))
          if (Math.hypot(px - (h.x + vx * u), py - (h.y + vy * u)) < h.width / 2 + p.r + 0.35) cost += 25
        } else if (h.type === 'mortar' && h.flight - h.t < 0.7) {
          if (Math.hypot(px - h.x, py - h.y) < h.blast + 0.35) cost += 25
        } else if (h.type === 'mine' && Math.hypot(px - h.x, py - h.y) < 1) {
          cost += 10
        } else if (h.type === 'shock') {
          const d = Math.hypot(px - h.x, py - h.y)
          if (Math.abs(d - (h.r + h.speed * t)) < h.width / 2 + p.r + 0.2) {
            const a = Math.atan2(py - h.y, px - h.x)
            const safe = h.gaps.some((gg) => Math.abs(Math.atan2(Math.sin(a - gg), Math.cos(a - gg))) < h.gapW / 2 - 0.12)
            if (!safe) cost += 14
          }
        }
      }
      for (const e of g.enemies) {
        if (!e.alive || !(e.contact || e.solid)) continue
        const d = Math.hypot(px - e.x, py - e.y) - e.r - p.r
        if (d < 0.8) cost += (0.8 - d) * 8
      }
      const B = g.boss
      if (B && B.alive && !B.phased) {
        const d = Math.hypot(px - B.x, py - B.y) - B.r - p.r
        if (d < 1.2) cost += (1.2 - d) * 10
        for (const part of B.parts) {
          if (!part.alive || !part.solidHit) continue
          const dd = Math.hypot(px - part.x, py - part.y) - part.r - p.r
          if (dd < 0.8) cost += (0.8 - dd) * 10
        }
      }
    }
    const fx = p.x + dx * sp * 0.4
    const fy = p.y + dy * sp * 0.4
    cost += telegraphCost(g, fx, fy)
    cost += Math.hypot(fx - goal.x, fy - goal.y) * 0.3
    if (Math.abs(fx) > g.W / 2 - 0.8 || Math.abs(fy) > g.D / 2 - 0.8) cost += 1.5
    if (cost < bestCost) {
      bestCost = cost
      best = [dx, dy]
    }
  }
  return { x: best[0], y: best[1] }
}

export function botInput(g) {
  const p = g.player
  const target = pickTarget(g)
  let aim = { x: 0, y: 0, active: false }
  if (target) aim = { x: target.x - p.x, y: target.y - p.y, active: true }
  let threatD = 2.2
  for (const b of g.bullets) {
    if (b.kind !== 'hot') continue
    const dx = p.x - b.x
    const dy = p.y - b.y
    const d = Math.hypot(dx, dy)
    if (d < threatD && dx * Math.cos(b.a) + dy * Math.sin(b.a) > 0) {
      threatD = d
      aim = { x: b.x - p.x, y: b.y - p.y, active: true }
    }
  }
  return { move: smartMove(g, target), aim }
}
