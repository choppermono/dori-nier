import { LEVEL_COUNT } from './levels.js'

// Progress lives only in this browser. Reached sectors on the phone don't
// show up on the PC, and clearing site data wipes them. For a game without
// accounts that is fine - but it is a deliberate choice.
//
// Every access is wrapped: in private mode or with site data blocked,
// localStorage throws instead of just being empty.

const KEY = 'dori.progress.v2'

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data.highest !== 'number') return null
    return data
  } catch {
    return null
  }
}

function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // No storage: the game carries on, it just forgets.
  }
}

export function loadProgress() {
  const data = read()
  return {
    highest: data ? Math.max(0, Math.min(data.highest, LEVEL_COUNT - 1)) : 0,
    cleared: Array.isArray(data?.cleared) ? data.cleared.filter((i) => i >= 0 && i < LEVEL_COUNT) : [],
    best: data && typeof data.best === 'object' && data.best ? data.best : {},
  }
}

// Returns true when this was a new best time for the sector.
export function rememberCleared(index, time) {
  const p = loadProgress()
  const cleared = p.cleared.includes(index) ? p.cleared : [...p.cleared, index]
  const best = { ...p.best }
  const prev = best[index]
  const record = typeof prev !== 'number' || time < prev
  if (record) best[index] = Math.round(time * 10) / 10
  write({ highest: Math.max(p.highest, Math.min(index + 1, LEVEL_COUNT - 1)), cleared, best })
  return record
}

export function resetProgress() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // fine
  }
}
