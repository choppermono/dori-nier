// Die fuenf Level als Daten. Ein neues Level ist ein Eintrag in dieser Liste und
// sonst nichts - genau dafuer wurde level.js umgebaut.
//
// Alle Positionen sind Anteile der Arenaflaeche (0 bis 1), damit dasselbe Layout
// hochkant wie quer funktioniert.
//
// Ein Level ist eine Liste von WELLEN. Der Kern oeffnet sich, wenn alle Gegner tot
// sind - Bloecke spielen dafuer keine Rolle, die sind freiwillig.

export const LEVELS = [
  {
    name: 'Zugang',
    subtitle: 'Erstkontakt',
    timeLimit: 60,
    coreFiresDuringWaves: false,
    blocks: [
      { fx: 0.2, fy: 0.3, fw: 0.11, fh: 0.035, type: 'cover' },
      { fx: 0.69, fy: 0.3, fw: 0.11, fh: 0.035, type: 'cover' },
      { fx: 0.2, fy: 0.665, fw: 0.11, fh: 0.035, type: 'cover' },
      { fx: 0.69, fy: 0.665, fw: 0.11, fh: 0.035, type: 'cover' },
      { fx: 0.44, fy: 0.2, fw: 0.12, fh: 0.03, type: 'destructible' },
      { fx: 0.44, fy: 0.77, fw: 0.12, fh: 0.03, type: 'destructible' },
    ],
    cores: [{ fx: 0.5, fy: 0.5, hp: 10, pattern: 'none' }],
    waves: [
      [
        { type: 'turret', fx: 0.18, fy: 0.2, pattern: 'single' },
        { type: 'turret', fx: 0.82, fy: 0.2, pattern: 'single' },
      ],
      [
        { type: 'turret', fx: 0.16, fy: 0.78, pattern: 'single' },
        { type: 'turret', fx: 0.84, fy: 0.78, pattern: 'single' },
        { type: 'turret', fx: 0.5, fy: 0.14, pattern: 'single' },
      ],
    ],
  },

  {
    name: 'Firewall',
    subtitle: 'Der Kern wehrt sich',
    timeLimit: 75,
    coreFiresDuringWaves: false,
    blocks: [
      { fx: 0.14, fy: 0.44, fw: 0.035, fh: 0.13, type: 'cover' },
      { fx: 0.825, fy: 0.44, fw: 0.035, fh: 0.13, type: 'cover' },
      { fx: 0.42, fy: 0.24, fw: 0.16, fh: 0.03, type: 'cover' },
      { fx: 0.42, fy: 0.73, fw: 0.16, fh: 0.03, type: 'cover' },
      { fx: 0.25, fy: 0.6, fw: 0.03, fh: 0.11, type: 'destructible' },
      { fx: 0.72, fy: 0.6, fw: 0.03, fh: 0.11, type: 'destructible' },
      { fx: 0.25, fy: 0.29, fw: 0.03, fh: 0.11, type: 'destructible' },
      { fx: 0.72, fy: 0.29, fw: 0.03, fh: 0.11, type: 'destructible' },
    ],
    cores: [{ fx: 0.5, fy: 0.5, hp: 12, pattern: 'rotating' }],
    waves: [
      [
        { type: 'turret', fx: 0.2, fy: 0.17, pattern: 'single' },
        { type: 'turret', fx: 0.8, fy: 0.17, pattern: 'single' },
        { type: 'turret', fx: 0.5, fy: 0.86, pattern: 'single' },
      ],
      [
        { type: 'turret', fx: 0.17, fy: 0.72, pattern: 'spread' },
        { type: 'turret', fx: 0.83, fy: 0.72, pattern: 'spread' },
        { type: 'turret', fx: 0.5, fy: 0.13, pattern: 'single' },
      ],
    ],
  },

  {
    name: 'Verfolgung',
    subtitle: 'Etwas bewegt sich',
    timeLimit: 95,
    coreFiresDuringWaves: true,
    blocks: [
      { fx: 0.12, fy: 0.2, fw: 0.14, fh: 0.032, type: 'cover' },
      { fx: 0.74, fy: 0.2, fw: 0.14, fh: 0.032, type: 'cover' },
      { fx: 0.12, fy: 0.77, fw: 0.14, fh: 0.032, type: 'cover' },
      { fx: 0.74, fy: 0.77, fw: 0.14, fh: 0.032, type: 'cover' },
      { fx: 0.485, fy: 0.15, fw: 0.03, fh: 0.13, type: 'destructible' },
      { fx: 0.485, fy: 0.72, fw: 0.03, fh: 0.13, type: 'destructible' },
    ],
    cores: [{ fx: 0.5, fy: 0.5, hp: 14, pattern: 'rotating' }],
    waves: [
      [
        { type: 'turret', fx: 0.18, fy: 0.5, pattern: 'burst' },
        { type: 'turret', fx: 0.82, fy: 0.5, pattern: 'burst' },
      ],
      [
        { type: 'hunter', fx: 0.2, fy: 0.16, pattern: 'single' },
        { type: 'hunter', fx: 0.8, fy: 0.16, pattern: 'single' },
      ],
      [
        { type: 'hunter', fx: 0.5, fy: 0.12, pattern: 'single' },
        { type: 'hunter', fx: 0.2, fy: 0.84, pattern: 'single' },
        { type: 'turret', fx: 0.8, fy: 0.84, pattern: 'spread' },
      ],
    ],
  },

  {
    name: 'Bollwerk',
    subtitle: 'Zwei Kerne, und etwas rennt',
    timeLimit: 115,
    coreFiresDuringWaves: true,
    blocks: [
      { fx: 0.46, fy: 0.1, fw: 0.08, fh: 0.03, type: 'cover' },
      { fx: 0.46, fy: 0.87, fw: 0.08, fh: 0.03, type: 'cover' },
      { fx: 0.1, fy: 0.485, fw: 0.07, fh: 0.03, type: 'cover' },
      { fx: 0.83, fy: 0.485, fw: 0.07, fh: 0.03, type: 'cover' },
      { fx: 0.28, fy: 0.28, fw: 0.03, fh: 0.1, type: 'destructible' },
      { fx: 0.69, fy: 0.28, fw: 0.03, fh: 0.1, type: 'destructible' },
      { fx: 0.28, fy: 0.62, fw: 0.03, fh: 0.1, type: 'destructible' },
      { fx: 0.69, fy: 0.62, fw: 0.03, fh: 0.1, type: 'destructible' },
    ],
    cores: [
      { fx: 0.33, fy: 0.5, hp: 9, pattern: 'rotating' },
      { fx: 0.67, fy: 0.5, hp: 9, pattern: 'rotating' },
    ],
    waves: [
      [
        { type: 'charger', fx: 0.15, fy: 0.15 },
        { type: 'charger', fx: 0.85, fy: 0.85 },
      ],
      [
        { type: 'orbiter', fx: 0.5, fy: 0.22, pattern: 'single', orbit: 0.2 },
        { type: 'orbiter', fx: 0.5, fy: 0.78, pattern: 'single', orbit: 0.2 },
        { type: 'orbiter', fx: 0.22, fy: 0.5, pattern: 'single', orbit: 0.26 },
      ],
      [
        { type: 'charger', fx: 0.3, fy: 0.09 },
        { type: 'charger', fx: 0.7, fy: 0.91 },
        { type: 'turret', fx: 0.12, fy: 0.3, pattern: 'burst' },
        { type: 'turret', fx: 0.88, fy: 0.7, pattern: 'burst' },
      ],
    ],
  },

  {
    name: 'Kernschmelze',
    subtitle: 'Alles auf einmal',
    timeLimit: 140,
    coreFiresDuringWaves: true,
    blocks: [
      { fx: 0.22, fy: 0.22, fw: 0.1, fh: 0.03, type: 'cover' },
      { fx: 0.68, fy: 0.22, fw: 0.1, fh: 0.03, type: 'cover' },
      { fx: 0.22, fy: 0.75, fw: 0.1, fh: 0.03, type: 'cover' },
      { fx: 0.68, fy: 0.75, fw: 0.1, fh: 0.03, type: 'cover' },
      { fx: 0.485, fy: 0.3, fw: 0.03, fh: 0.1, type: 'destructible' },
      { fx: 0.485, fy: 0.6, fw: 0.03, fh: 0.1, type: 'destructible' },
      { fx: 0.3, fy: 0.485, fw: 0.1, fh: 0.03, type: 'destructible' },
      { fx: 0.6, fy: 0.485, fw: 0.1, fh: 0.03, type: 'destructible' },
    ],
    cores: [
      { fx: 0.5, fy: 0.17, hp: 8, pattern: 'rotating' },
      { fx: 0.18, fy: 0.62, hp: 8, pattern: 'rotating' },
      { fx: 0.82, fy: 0.62, hp: 8, pattern: 'rotating' },
    ],
    waves: [
      [
        { type: 'turret', fx: 0.14, fy: 0.14, pattern: 'beam' },
        { type: 'turret', fx: 0.86, fy: 0.14, pattern: 'beam' },
      ],
      [
        { type: 'hunter', fx: 0.2, fy: 0.5, pattern: 'homing' },
        { type: 'hunter', fx: 0.8, fy: 0.5, pattern: 'homing' },
        { type: 'turret', fx: 0.5, fy: 0.12, pattern: 'ring' },
      ],
      [
        { type: 'turret', fx: 0.25, fy: 0.3, pattern: 'spread', armored: true },
        { type: 'turret', fx: 0.75, fy: 0.3, pattern: 'spread', armored: true },
        { type: 'charger', fx: 0.5, fy: 0.9 },
      ],
      [
        { type: 'charger', fx: 0.12, fy: 0.12 },
        { type: 'charger', fx: 0.88, fy: 0.12 },
        { type: 'hunter', fx: 0.5, fy: 0.88, pattern: 'homing' },
        { type: 'turret', fx: 0.5, fy: 0.5, pattern: 'ring', armored: true },
      ],
    ],
  },
]

export const LEVEL_COUNT = LEVELS.length
