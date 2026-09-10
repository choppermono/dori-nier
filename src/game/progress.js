import { LEVEL_COUNT } from './levels.js'

// Fortschritt liegt nur im Browser des jeweiligen Geraets. Auf dem Handy erreichte
// Level erscheinen nicht auf dem PC, und geleerte Browserdaten loeschen sie. Fuer ein
// Spiel ohne Konto ist das in Ordnung - aber es ist eine bewusste Entscheidung.
//
// Jeder Zugriff ist eingepackt: im privaten Modus und bei blockierten Website-Daten
// wirft localStorage, statt nur leer zu sein.

const KEY = 'dori.progress.v1'

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
    // Kein Speicher verfuegbar: das Spiel laeuft weiter, nur ohne Gedaechtnis.
  }
}

export function loadProgress() {
  const data = read()
  const highest = data ? Math.max(0, Math.min(data.highest, LEVEL_COUNT - 1)) : 0
  return { highest, cleared: Array.isArray(data?.cleared) ? data.cleared : [] }
}

// Das hoechste je erreichte Level bleibt gespeichert. Eine Niederlage wirft im
// laufenden Durchgang ein Level zurueck, nicht im Fortschritt.
export function rememberReached(levelIndex) {
  const p = loadProgress()
  if (levelIndex > p.highest) {
    write({ highest: levelIndex, cleared: p.cleared })
  }
}

export function rememberCleared(levelIndex) {
  const p = loadProgress()
  const cleared = p.cleared.includes(levelIndex) ? p.cleared : [...p.cleared, levelIndex]
  write({ highest: Math.max(p.highest, Math.min(levelIndex + 1, LEVEL_COUNT - 1)), cleared })
}

export function resetProgress() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // egal
  }
}
