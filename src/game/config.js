// Farben und Kennzahlen an einem Ort. Wer das Spiel abstimmen will, aendert hier.
// Die Palette ist uebernommen aus PersonalSite/src/style.css, damit Seite und Spiel
// wie dasselbe Produkt aussehen.

export const PALETTE = {
  // Flaechen: warmes Anthrazit, nie reines Schwarz
  void: '#100f0d',
  ash: '#16150f',
  panel: '#1c1b14',
  panelSolid: '#221f18',

  // Tinte: das NieR-Pergament
  bone: '#dcd8c0',
  boneDim: '#a9a48a',
  boneMute: '#8f8a73',

  line: 'rgba(220, 216, 192, 0.2)',
  lineStrong: 'rgba(220, 216, 192, 0.42)',
  lineFaint: 'rgba(220, 216, 192, 0.09)',

  // Signalrot
  sigText: '#e0574f',
  sigFill: '#bc3f3c',

  // Bedrohungen bleiben laut. Die ruhige Palette gilt fuer Rahmen und Menue,
  // nicht fuer Dinge, die einen toeten.
  bulletOrange: '#e8a33d',
  bulletPurple: '#b47fdd',
  hunter: '#e8a33d',
  charger: '#e0574f',
}

export const TUNING = {
  player: {
    radius: 15,
    speed: 310, // war 260; angehoben, weil ab Level 03 Gegner verfolgen
    segments: 4,
    invulnSeconds: 1.1,
    fireInterval: 0.11,
    bulletSpeed: 640,
    bulletRadius: 3.5,
    turnRate: 14,
    // Trefferflaeche schrumpft mit jedem verlorenen Segment
    radiusBySegmentsLost: [1, 0.85, 0.7, 0.55],
  },

  bullet: {
    radius: 6,
    homingTurnRate: 1.6,
    homingLifetime: 5,
  },

  beam: {
    warnSeconds: 0.9,
    activeSeconds: 0.22,
    width: 7,
  },

  wave: {
    // Vorwarnung, bevor ein Gegner erscheint. Startwert - falls es zwischen den
    // Wellen nach Leerlauf aussieht, diese Zahl senken.
    spawnWarnSeconds: 2,
    pauseBetweenWaves: 0.6,
  },

  core: {
    radius: 34,
    spinRate: 0.9,
    bulletSpeed: 155,
    arms: 3,
    fireInterval: 0.45,
  },
}

// Ein Gegnertyp beschreibt Verhalten, nicht Aussehen. Tempo als Anteil der
// Spielergeschwindigkeit - kein Gegner ist im Normalzustand so schnell wie der Spieler.
export const ENEMY_TYPES = {
  turret: {
    label: 'Turm',
    radius: 17,
    hp: 3,
    speedFactor: 0,
    contactDamage: false,
    solid: true,
    turnRate: 8,
  },
  hunter: {
    label: 'Jaeger',
    radius: 15,
    hp: 3,
    speedFactor: 0.6,
    standoff: 0.32, // Wunschabstand als Anteil der kurzen Bildschirmseite
    contactDamage: true,
    solid: false,
    turnRate: 8,
  },
  charger: {
    label: 'Stuermer',
    radius: 16,
    hp: 4,
    speedFactor: 0.4,
    chargeSpeedFactor: 1.3, // nur im angekuendigten Sturm, dafuer geradeaus
    chargeWindup: 0.85,
    chargeDuration: 0.85,
    chargeCooldown: 1.6,
    contactDamage: true,
    solid: false,
    turnRate: 6,
  },
  orbiter: {
    label: 'Kreiser',
    radius: 14,
    hp: 2,
    speedFactor: 0.45,
    contactDamage: false,
    solid: true,
    turnRate: 8,
  },
}

// Feuermuster. Ein Gegner hat eines davon statt nur "schiesst".
export const FIRE_PATTERNS = {
  single: { interval: 1.5, speed: 190, kind: 'orange' },
  spread: { interval: 1.9, speed: 180, kind: 'orange', count: 3, arc: 0.5 },
  burst: { interval: 2.2, speed: 210, kind: 'orange', shots: 3, gap: 0.12 },
  ring: { interval: 2.8, speed: 150, kind: 'orange', count: 10 },
  homing: { interval: 2.6, speed: 120, kind: 'purple', homing: true },
  beam: { interval: 3.2 },
  none: { interval: Infinity },
}

// Zeichenfaktor: auf kleinen Bildschirmen wird alles etwas kleiner, damit die Arena
// nicht zugestellt ist. Bezugsgroesse ist die kuerzere Bildschirmseite.
export function scaleFor(width, height) {
  const shortSide = Math.min(width, height)
  return Math.max(0.62, Math.min(1.15, shortSide / 620))
}
