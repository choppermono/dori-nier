// Numbers that shape how the game feels, in one place. Everything is in world
// units: the arena is a fixed size (see ARENA), so nothing here depends on the
// screen. Change a value here, not in the logic.

// Two arena shapes so a phone held upright gets an upright arena. Sideways
// screens are wide and the camera tilts, so the landscape arena is wide too.
export const ARENA = {
  landscape: { w: 26, d: 13 },
  portrait: { w: 14, d: 22 },
}

export const PLAYER = {
  radius: 0.3,
  speed: 7.4,
  turnRate: 16,
  fireInterval: 0.085,
  shotSpeed: 27,
  shotRadius: 0.12,
  shotLife: 1.15,
  invuln: 1.25,
  // The hitbox shrinks with every lost segment: less ship, less to hit.
  radiusBySegmentsLost: [1, 0.88, 0.76, 0.64],
}

export const BULLET = {
  hotRadius: 0.17,
  coldRadius: 0.19,
  max: 900,
}

export const TIMING = {
  intro: 1.6,
  spawnWarn: 1.2,
  spawnStagger: 0.16,
  wavePause: 1.1,
  awaken: 3.4,
  clearDelay: 2.8,
  deathDelay: 1.9,
  bossPhaseInvuln: 0.9,
}

// Colours that must read the same in every world. Orange can be shot down,
// black cannot - the one rule from the original, so it never changes.
export const SIGNAL = {
  hot: '#ff9a2e',
  cold: '#0b0b0d',
  coldRing: '#ffffff',
}

// Difficulty rises with every sector: faster bullets, shorter gaps between
// volleys, tougher enemies. Level 1 starts where the old level 3 was.
export function tierFor(levelIndex) {
  const t = Math.max(0, Math.min(1, levelIndex / 9))
  return {
    t,
    speed: 1 + 0.3 * t,
    rate: 1 - 0.27 * t,
    hp: 1 + 0.5 * t,
  }
}
