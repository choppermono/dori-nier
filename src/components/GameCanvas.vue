<script setup>
import { onMounted, onBeforeUnmount, ref, shallowRef, computed } from 'vue'
import { createGame, update, resize, isShielded, enemiesLeft, waveLabel } from '@/game/engine.js'
import { render } from '@/game/render.js'
import { createInput } from '@/game/input.js'
import { LEVELS, LEVEL_COUNT } from '@/game/levels.js'
import { loadProgress, rememberReached, rememberCleared } from '@/game/progress.js'

// Die Grenze zwischen Vue und Spiel: Vue verwaltet Menue und Anzeige, alles innerhalb
// des Canvas laeuft ueber requestAnimationFrame und ruehrt die Reaktivitaet nicht an.
// Der Spielzustand liegt bewusst in shallowRef - Vue soll ihn nicht durchdringen.

const canvasEl = ref(null)
const game = shallowRef(null)

const screen = ref('menu') // menu | playing | levelclear | complete | lost
const highest = ref(0)
const cleared = ref([])
const levelIndex = ref(0)

const levelName = ref('')
const levelSub = ref('')
const timeLeft = ref(0)
const wave = ref('')
const foes = ref(0)
const shielded = ref(true)
const lossReason = ref('')

let ctx = null
let input = null
let frameId = null
let lastTime = 0
let observer = null

// Nach einer Niederlage geht es ein Level zurueck - aber das hoechste je erreichte
// Level bleibt gespeichert. Der Rueckwurf gilt fuer den Durchgang, nicht fuer den
// Fortschritt.
const fallbackLevel = computed(() => Math.max(0, levelIndex.value - 1))

const levelList = computed(() =>
  LEVELS.map((l, i) => ({
    index: i,
    name: l.name,
    subtitle: l.subtitle,
    waves: l.waves.length,
    unlocked: i <= highest.value,
    done: cleared.value.includes(i),
  })),
)

function refreshProgress() {
  const p = loadProgress()
  highest.value = p.highest
  cleared.value = p.cleared
}

function syncHud() {
  const g = game.value
  if (!g) return
  timeLeft.value = Math.ceil(g.timeLeft)
  wave.value = waveLabel(g)
  foes.value = enemiesLeft(g)
  shielded.value = isShielded(g)

  if (g.status === 'levelclear' && screen.value === 'playing') {
    rememberCleared(g.levelIndex)
    refreshProgress()
    screen.value = g.levelIndex >= LEVEL_COUNT - 1 ? 'complete' : 'levelclear'
  } else if (g.status === 'lost' && screen.value === 'playing') {
    lossReason.value = g.lossReason
    screen.value = 'lost'
  }
}

function canvasSize() {
  const rect = canvasEl.value.getBoundingClientRect()
  return {
    w: Math.max(2, Math.round(rect.width)),
    h: Math.max(2, Math.round(rect.height)),
  }
}

function fitCanvas() {
  const canvas = canvasEl.value
  if (!canvas) return
  const { w, h } = canvasSize()

  // Auf Bildschirmen mit hoher Pixeldichte wird der Puffer groesser gezeichnet und
  // anschliessend heruntergerechnet, sonst sehen die duennen Linien matschig aus.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (!game.value) game.value = createGame(0, w, h)
  else resize(game.value, w, h)
  syncHud()
}

function loop(now) {
  frameId = requestAnimationFrame(loop)
  const g = game.value
  if (!g || !ctx) return

  // Nach einem Tabwechsel kann der Abstand sehr gross sein. Deckeln, sonst springen
  // Kugeln in einem Bild durch die halbe Arena und Kollisionen werden verpasst.
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0)
  lastTime = now

  if (g.status === 'running') update(g, dt, input.read())
  render(ctx, g, input.sticks)
  syncHud()
}

function startLevel(i) {
  const { w, h } = canvasSize()
  const g = createGame(i, w, h)
  g.status = 'running'
  game.value = g
  levelIndex.value = i
  levelName.value = g.levelName
  levelSub.value = g.levelSubtitle
  rememberReached(i)
  refreshProgress()
  input.reset()
  lastTime = performance.now()
  screen.value = 'playing'
  syncHud()
}

function toMenu() {
  refreshProgress()
  screen.value = 'menu'
}

onMounted(() => {
  const canvas = canvasEl.value
  input = createInput(canvas, () => ({
    x: game.value ? game.value.player.x : 0,
    y: game.value ? game.value.player.y : 0,
  }))

  refreshProgress()
  fitCanvas()

  observer = new ResizeObserver(() => fitCanvas())
  observer.observe(canvas)

  lastTime = performance.now()
  frameId = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  if (frameId) cancelAnimationFrame(frameId)
  observer?.disconnect()
  input?.destroy()
})
</script>

<template>
  <div class="stage">
    <canvas ref="canvasEl" class="surface"></canvas>

    <div v-if="screen === 'playing'" class="hud">
      <div class="hud-row">
        <span class="tag">{{ String(levelIndex + 1).padStart(2, '0') }}</span>
        <span class="name">{{ levelName }}</span>
        <span class="spacer"></span>
        <span class="tag">Zeit</span>
        <span class="num" :class="{ urgent: timeLeft <= 10 }">{{ timeLeft }}</span>
      </div>
      <div class="hud-note">
        <template v-if="shielded">Welle {{ wave }} — {{ foes }} Gegner</template>
        <template v-else>Kern offen</template>
      </div>
    </div>

    <div v-if="screen !== 'playing'" class="overlay">
      <div class="panel">
        <!-- Levelauswahl im Stil der ACCESS POINTS auf der Startseite -->
        <template v-if="screen === 'menu'">
          <header class="rule">
            <span class="tag">Hacking</span>
            <span class="line"></span>
            <span class="tag">{{ LEVEL_COUNT }} Sektoren</span>
          </header>
          <h1>Zugriffs&shy;punkte</h1>

          <ul class="levels">
            <li v-for="l in levelList" :key="l.index">
              <button class="level" :disabled="!l.unlocked" @click="startLevel(l.index)">
                <span class="idx">{{ String(l.index + 1).padStart(2, '0') }}</span>
                <span class="body">
                  <span class="ltitle">{{ l.name }}</span>
                  <span class="lsub">{{ l.subtitle }}</span>
                  <span class="lmeta">{{ l.waves }} Wellen</span>
                </span>
                <span class="state">
                  <template v-if="!l.unlocked">gesperrt</template>
                  <template v-else-if="l.done">geschafft</template>
                  <template v-else>offen</template>
                </span>
              </button>
            </li>
          </ul>

          <details class="how">
            <summary>Steuerung und Regeln</summary>
            <p>
              Linker Daumen bewegt. Rechter Daumen dreht und feuert zugleich — loslassen
              heisst Feuer aus, der Winkel bleibt stehen. Ausweichen gibt es nicht.
            </p>
            <ul>
              <li><b class="orange">Orange</b> Kugeln lassen sich abschiessen.</li>
              <li><b class="purple">Violette</b> nicht — nur ausweichen.</li>
              <li>Massive Blöcke sind Deckung, Umrisse sind zerstörbar und freiwillig.</li>
              <li>Der Kern öffnet sich, wenn alle Gegner tot sind.</li>
              <li>Vier Segmente. Jeder Treffer bricht eines ab, dafür wirst du kleiner.</li>
            </ul>
            <p class="dim">Am PC: WASD bewegt, Maus zielt, Maustaste halten feuert.</p>
          </details>
        </template>

        <template v-else-if="screen === 'levelclear'">
          <header class="rule">
            <span class="tag">Sektor {{ String(levelIndex + 1).padStart(2, '0') }}</span>
            <span class="line"></span>
            <span class="tag">geräumt</span>
          </header>
          <h1>Hack erfolgreich</h1>
          <p class="lead">{{ levelName }} — {{ timeLeft }} Sekunden übrig.</p>
          <button class="go" @click="startLevel(levelIndex + 1)">Weiter zu Sektor {{ String(levelIndex + 2).padStart(2, '0') }}</button>
          <button class="ghost" @click="toMenu">Zur Übersicht</button>
        </template>

        <template v-else-if="screen === 'complete'">
          <header class="rule">
            <span class="tag">Alle Sektoren</span>
            <span class="line"></span>
            <span class="tag">geräumt</span>
          </header>
          <h1>System offen</h1>
          <p class="lead">Alle {{ LEVEL_COUNT }} Sektoren durchgespielt.</p>
          <button class="go" @click="toMenu">Zur Übersicht</button>
        </template>

        <template v-else>
          <header class="rule">
            <span class="tag">Sektor {{ String(levelIndex + 1).padStart(2, '0') }}</span>
            <span class="line"></span>
            <span class="tag alarm">Verbindung verloren</span>
          </header>
          <h1 class="lost">Hack fehlgeschlagen</h1>
          <p class="lead">
            {{ lossReason === 'zeit' ? 'Zeit abgelaufen.' : 'Alle Segmente verloren.' }}
          </p>
          <p class="lead dim" v-if="levelIndex > 0">
            Ein Sektor zurück. Dein höchster erreichter Sektor bleibt gespeichert.
          </p>
          <button class="go" @click="startLevel(fallbackLevel)">
            Weiter in Sektor {{ String(fallbackLevel + 1).padStart(2, '0') }}
          </button>
          <button class="ghost" @click="toMenu">Zur Übersicht</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--void);
}

.surface {
  display: block;
  width: 100%;
  height: 100%;
  /* Ohne das scrollt und zoomt die Seite, sobald zwei Daumen aufsetzen. */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}

/* --- HUD ---------------------------------------------------------------- */

.hud {
  position: absolute;
  inset: 0 0 auto 0;
  padding: calc(0.7rem + env(safe-area-inset-top)) calc(0.9rem + env(safe-area-inset-right))
    0 calc(0.9rem + env(safe-area-inset-left));
  pointer-events: none;
  color: var(--bone);
}

.hud-row {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
}

.spacer {
  flex: 1;
}

.tag {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bone-mute);
}

.tag.alarm {
  color: var(--sig-text);
}

.name {
  font-family: var(--display);
  font-size: 1.05rem;
  letter-spacing: 0.12em;
}

.num {
  font-family: var(--mono);
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
}

.num.urgent {
  color: var(--sig-text);
}

.hud-note {
  margin-top: 0.2rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--bone-mute);
}

/* --- Overlay ------------------------------------------------------------ */

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: calc(1rem + env(safe-area-inset-top)) 1rem calc(1rem + env(safe-area-inset-bottom));
  background: rgba(16, 15, 13, 0.93);
  overflow-y: auto;
}

.panel {
  width: min(32rem, 100%);
  border: 1px solid var(--line-strong);
  background: var(--panel);
  padding: 1.4rem 1.3rem;
  color: var(--bone);
}

.rule {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  margin-bottom: 1.1rem;
}

.rule .line {
  flex: 1;
  height: 1px;
  background: var(--line);
}

h1 {
  margin: 0 0 1rem;
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(1.5rem, 6vw, 2.1rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1.1;
}

h1.lost {
  color: var(--sig-text);
}

.lead {
  margin: 0 0 0.9rem;
  font-family: var(--body);
  line-height: 1.6;
  font-size: 0.9rem;
  color: var(--bone-dim);
}

.dim {
  color: var(--bone-mute);
  font-size: 0.82rem;
}

/* --- Levelliste --------------------------------------------------------- */

.levels {
  list-style: none;
  margin: 0 0 1.1rem;
  padding: 0;
  display: grid;
  gap: 6px;
}

.level {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.7rem 0.8rem;
  background: var(--panel-solid);
  border: 1px solid var(--line);
  color: var(--bone);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 140ms var(--ease), color 140ms var(--ease);
}

.level:hover:not(:disabled),
.level:focus-visible:not(:disabled) {
  /* Auswahl invertiert auf Knochenweiss, wie im NieR-Menue und auf der Startseite. */
  background: var(--bone);
  color: var(--void);
}

.level:hover:not(:disabled) .lsub,
.level:hover:not(:disabled) .lmeta,
.level:hover:not(:disabled) .idx,
.level:hover:not(:disabled) .state {
  color: var(--void);
}

.level:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.idx {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--bone-mute);
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.ltitle {
  font-family: var(--display);
  font-size: 1.1rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.lsub {
  font-family: var(--body);
  font-size: 0.8rem;
  color: var(--bone-dim);
}

.lmeta {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.12em;
  color: var(--bone-mute);
}

.state {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--bone-mute);
  white-space: nowrap;
}

/* --- Knoepfe ------------------------------------------------------------ */

.go,
.ghost {
  width: 100%;
  padding: 0.8rem 1rem;
  font-family: var(--mono);
  font-size: 0.74rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid var(--line-strong);
}

.go {
  background: var(--bone);
  color: var(--void);
  border-color: var(--bone);
}

.go:hover,
.go:focus-visible {
  background: #fff;
}

.ghost {
  margin-top: 6px;
  background: transparent;
  color: var(--bone-dim);
}

.ghost:hover,
.ghost:focus-visible {
  color: var(--bone);
  border-color: var(--bone-dim);
}

/* --- Aufklappbare Regeln ------------------------------------------------ */

.how {
  border-top: 1px solid var(--line);
  padding-top: 0.8rem;
  font-family: var(--body);
  font-size: 0.84rem;
  color: var(--bone-dim);
}

.how summary {
  font-family: var(--mono);
  font-size: 0.64rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bone-mute);
  cursor: pointer;
}

.how p {
  margin: 0.7rem 0;
  line-height: 1.6;
}

.how ul {
  margin: 0.6rem 0;
  padding-left: 1.1rem;
  line-height: 1.7;
}

.orange {
  color: var(--bullet-orange);
}

.purple {
  color: var(--bullet-purple);
}

@media (max-width: 420px) {
  .panel {
    padding: 1.1rem 0.95rem;
  }
  .ltitle {
    font-size: 1rem;
  }
}
</style>
