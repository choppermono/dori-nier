// Farben und Kennzahlen an einem Ort. Wer das Spiel abstimmen will, aendert hier.

export const PALETTE = {
  background: '#100F0D',
  line: '#DCD8C0',
  lineDim: 'rgba(220, 216, 192, 0.35)',
  lineFaint: 'rgba(220, 216, 192, 0.14)',
  player: '#DCD8C0',
  playerShot: '#DCD8C0',
  cover: 'rgba(220, 216, 192, 0.9)',
  block: 'rgba(220, 216, 192, 0.55)',
  turret: '#DCD8C0',
  core: '#DCD8C0',
  danger: '#C1443A',
  bulletOrange: '#E8A33D',
  bulletPurple: '#A87BD1',
}

export const TUNING = {
  roundSeconds: 60,

  player: {
    radius: 13,
    speed: 260, // Pixel pro Sekunde
    maxHp: 5,
    invulnSeconds: 1.1,
    fireInterval: 0.11,
    bulletSpeed: 620,
    bulletRadius: 3.5,
    turnRate: 14, // Radiant pro Sekunde; hoch heisst fast sofort
  },

  turret: {
    radius: 17,
    hp: 3,
    fireInterval: 1.5,
    bulletSpeed: 190,
    aimJitter: 0.22,
  },

  core: {
    radius: 34,
    hp: 12,
    fireInterval: 0.42,
    bulletSpeed: 150,
    spinRate: 0.9,
    arms: 3,
  },

  bullet: {
    radius: 6,
  },
}

// Zeichenfaktor: Auf kleinen Bildschirmen wird alles etwas kleiner, damit die Arena
// nicht zugestellt ist. Bezugsgroesse ist die kuerzere Bildschirmseite.
export function scaleFor(width, height) {
  const shortSide = Math.min(width, height)
  return Math.max(0.62, Math.min(1.15, shortSide / 620))
}
