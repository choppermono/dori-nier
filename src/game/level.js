import { TUNING, scaleFor } from './config.js'

// Baut eine Arena, die sich an die vorhandene Flaeche anpasst. Alle Positionen sind
// relativ zur Arenagroesse, damit dasselbe Layout hochkant wie quer funktioniert.
export function buildLevel(width, height) {
  const s = scaleFor(width, height)
  const cx = width / 2
  const cy = height / 2

  const core = {
    x: cx,
    y: cy,
    radius: TUNING.core.radius * s,
    hp: TUNING.core.hp,
    maxHp: TUNING.core.hp,
    spin: 0,
    cooldown: 0.8,
    alive: true,
  }

  const blocks = []
  const addBlock = (fx, fy, fw, fh, type) => {
    blocks.push({
      x: width * fx,
      y: height * fy,
      w: width * fw,
      h: height * fh,
      type,
      hp: type === 'destructible' ? 2 : Infinity,
      alive: true,
    })
  }

  // Deckung: unzerstoerbar, haelt Schuesse auf. Vier Stueck um die Mitte herum.
  addBlock(0.22, 0.3, 0.1, 0.035, 'cover')
  addBlock(0.68, 0.3, 0.1, 0.035, 'cover')
  addBlock(0.22, 0.665, 0.1, 0.035, 'cover')
  addBlock(0.68, 0.665, 0.1, 0.035, 'cover')

  // Zerstoerbar: schirmen den Kern ab, solange sie stehen.
  addBlock(0.44, 0.2, 0.12, 0.03, 'destructible')
  addBlock(0.44, 0.77, 0.12, 0.03, 'destructible')
  addBlock(0.17, 0.475, 0.03, 0.1, 'destructible')
  addBlock(0.8, 0.475, 0.03, 0.1, 'destructible')

  const turrets = [
    { fx: 0.16, fy: 0.18 },
    { fx: 0.84, fy: 0.18 },
    { fx: 0.16, fy: 0.82 },
    { fx: 0.84, fy: 0.82 },
  ].map((t) => ({
    x: width * t.fx,
    y: height * t.fy,
    radius: TUNING.turret.radius * s,
    hp: TUNING.turret.hp,
    maxHp: TUNING.turret.hp,
    cooldown: 0.6 + Math.random() * 0.9,
    angle: 0,
    alive: true,
  }))

  return { core, blocks, turrets, scale: s }
}
