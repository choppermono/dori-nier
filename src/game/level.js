import { ENEMY_TYPES, FIRE_PATTERNS, TUNING, scaleFor } from './config.js'

// Baut aus einer Leveldefinition (levels.js) die konkreten Objekte fuer eine
// bestimmte Arenagroesse. Anteile werden hier zu Pixeln, sonst passiert nichts.

export function buildLevel(def, width, height) {
  const s = scaleFor(width, height)
  const shortSide = Math.min(width, height)

  const blocks = def.blocks.map((b) => ({
    x: width * b.fx,
    y: height * b.fy,
    w: width * b.fw,
    h: height * b.fh,
    type: b.type,
    hp: b.type === 'destructible' ? 2 : Infinity,
    maxHp: b.type === 'destructible' ? 2 : Infinity,
    alive: true,
  }))

  const cores = def.cores.map((c) => ({
    x: width * c.fx,
    y: height * c.fy,
    radius: TUNING.core.radius * s,
    hp: c.hp,
    maxHp: c.hp,
    pattern: c.pattern || 'none',
    spin: Math.random() * Math.PI * 2,
    cooldown: 0.8 + Math.random() * 0.6,
    hitFlash: 0,
    alive: true,
  }))

  // Wellen bleiben Baurezepte, bis sie an der Reihe sind.
  const waves = def.waves.map((wave) =>
    wave.map((e) => makeEnemySpec(e, width, height, shortSide, s)),
  )

  return {
    name: def.name,
    subtitle: def.subtitle || '',
    coreFiresDuringWaves: !!def.coreFiresDuringWaves,
    blocks,
    cores,
    waves,
    scale: s,
  }
}

function makeEnemySpec(e, width, height, shortSide, s) {
  const type = ENEMY_TYPES[e.type]
  if (!type) throw new Error(`Unbekannter Gegnertyp: ${e.type}`)

  const patternName = e.pattern || (e.type === 'charger' ? 'none' : 'single')
  const pattern = FIRE_PATTERNS[patternName]
  if (!pattern) throw new Error(`Unbekanntes Feuermuster: ${patternName}`)

  return {
    kind: e.type,
    x: width * e.fx,
    y: height * e.fy,
    radius: type.radius * s,
    hp: type.hp,
    maxHp: type.hp,
    speed: type.speedFactor * TUNING.player.speed * s,
    chargeSpeed: (type.chargeSpeedFactor || 0) * TUNING.player.speed * s,
    standoff: (type.standoff || 0) * shortSide,
    contactDamage: type.contactDamage,
    solid: type.solid,
    turnRate: type.turnRate,
    armored: !!e.armored,
    patternName,
    pattern,
    orbitRadius: e.orbit ? shortSide * e.orbit : 0,
  }
}

// Aus einem Baurezept wird ein lebender Gegner.
export function spawnEnemy(spec) {
  return {
    ...spec,
    angle: 0,
    cooldown: 0.6 + Math.random() * 0.8,
    burstLeft: 0,
    burstTimer: 0,
    chargeState: 'idle', // idle | windup | charging | recover
    chargeTimer: 0,
    chargeDx: 0,
    chargeDy: 0,
    orbitAngle: Math.random() * Math.PI * 2,
    hitFlash: 0,
    alive: true,
  }
}
