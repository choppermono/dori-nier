<script setup>
import { onMounted, onBeforeUnmount, ref, shallowRef } from 'vue'
import { createGame, update, resize, isShielded, remainingTargets } from '@/game/engine.js'
import { render } from '@/game/render.js'
import { createInput } from '@/game/input.js'

// Die Grenze zwischen Vue und Spiel: Vue verwaltet Menue und Anzeige, alles innerhalb
// des Canvas laeuft ueber requestAnimationFrame und ruehrt die Reaktivitaet nicht an.
// Der Spielzustand liegt bewusst in shallowRef - Vue soll ihn nicht durchdringen.

const canvasEl = ref(null)
const game = shallowRef(null)

const status = ref('ready')
const hp = ref(0)
const maxHp = ref(0)
const timeLeft = ref(0)
const targetsLeft = ref(0)
const shielded = ref(true)

let ctx = null
let input = null
let frameId = null
let lastTime = 0
let observer = null

function syncHud() {
  const g = game.value
  if (!g) return
  status.value = g.status
  hp.value = g.player.hp
  maxHp.value = g.player.maxHp
  timeLeft.value = Math.ceil(g.timeLeft)
  targetsLeft.value = remainingTargets(g)
  shielded.value = isShielded(g)
}

function fitCanvas() {
  const canvas = canvasEl.value
  if (!canvas) return

  const rect = canvas.getBoundingClientRect()
  const cssW = Math.max(2, Math.round(rect.width))
  const cssH = Math.max(2, Math.round(rect.height))

  // Auf Bildschirmen mit hoher Pixeldichte wird der Puffer groesser gezeichnet und
  // anschliessend heruntergerechnet, sonst sehen die duennen Linien matschig aus.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)

  ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  if (!game.value) {
    game.value = createGame(cssW, cssH)
  } else {
    resize(game.value, cssW, cssH)
  }
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

  if (g.status === 'running') {
    update(g, dt, input.read())
  }

  render(ctx, g, input.sticks)
  syncHud()
}

function startRound() {
  const canvas = canvasEl.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  game.value = createGame(Math.max(2, Math.round(rect.width)), Math.max(2, Math.round(rect.height)))
  game.value.status = 'running'
  input.reset()
  lastTime = performance.now()
  syncHud()
}

onMounted(() => {
  const canvas = canvasEl.value
  input = createInput(canvas, () => ({
    x: game.value ? game.value.player.x : 0,
    y: game.value ? game.value.player.y : 0,
  }))

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

    <div v-if="status === 'running'" class="hud">
      <div class="hud-left">
        <span class="label">Integrität</span>
        <span class="pips">
          <i v-for="n in maxHp" :key="n" :class="{ lost: n > hp }"></i>
        </span>
      </div>
      <div class="hud-right">
        <span class="label">Zeit</span>
        <span class="value" :class="{ urgent: timeLeft <= 10 }">{{ timeLeft }}</span>
      </div>
      <div class="hud-note">
        <template v-if="shielded">Kern abgeschirmt — {{ targetsLeft }} Ziele offen</template>
        <template v-else>Kern offen</template>
      </div>
    </div>

    <div v-if="status !== 'running'" class="overlay">
      <div class="panel">
        <template v-if="status === 'ready'">
          <h1>Hacking</h1>
          <p class="lead">
            Linker Daumen bewegt. Rechter Daumen dreht und feuert — loslassen heisst
            Feuer aus, der Winkel bleibt stehen. Ausweichen gibt es nicht.
          </p>
          <ul class="rules">
            <li><b class="orange">Orange</b> Kugeln lassen sich abschiessen.</li>
            <li><b class="purple">Violette</b> nicht — nur ausweichen.</li>
            <li>Massive Blöcke sind Deckung, Umrisse sind zerstörbar.</li>
            <li>Der Kern ist abgeschirmt, bis alles andere weg ist.</li>
          </ul>
          <p class="desktop-hint">Am PC: WASD bewegt, Maus zielt, Maustaste halten feuert.</p>
        </template>

        <template v-else-if="status === 'won'">
          <h1 class="won">Hack erfolgreich</h1>
          <p class="lead">Kern zerstört mit {{ timeLeft }} Sekunden Rest.</p>
        </template>

        <template v-else>
          <h1 class="lost">Hack fehlgeschlagen</h1>
          <p class="lead">
            {{ hp === 0 ? 'Integrität aufgebraucht.' : 'Zeit abgelaufen.' }}
          </p>
        </template>

        <button class="start" @click="startRound">
          {{ status === 'ready' ? 'Start' : 'Nochmal' }}
        </button>
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
  background: #100f0d;
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

.hud {
  position: absolute;
  inset: 0 0 auto 0;
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.7rem 0.9rem;
  pointer-events: none;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #dcd8c0;
}

.hud-left,
.hud-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.hud-right {
  margin-left: auto;
}

.label {
  opacity: 0.55;
}

.pips {
  display: flex;
  gap: 4px;
}

.pips i {
  width: 12px;
  height: 5px;
  background: #dcd8c0;
}

.pips i.lost {
  background: rgba(220, 216, 192, 0.22);
}

.value {
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
}

.value.urgent {
  color: #c1443a;
}

.hud-note {
  position: absolute;
  top: 2.2rem;
  left: 0;
  right: 0;
  text-align: center;
  opacity: 0.5;
  font-size: 0.66rem;
}

.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1.2rem;
  background: rgba(16, 15, 13, 0.9);
}

.panel {
  width: min(30rem, 100%);
  max-height: 100%;
  overflow-y: auto;
  border: 1px solid rgba(220, 216, 192, 0.28);
  padding: 1.5rem 1.4rem;
  color: #dcd8c0;
}

h1 {
  margin: 0 0 0.7rem;
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

h1.won {
  color: #dcd8c0;
}

h1.lost {
  color: #c1443a;
}

.lead {
  margin: 0 0 1rem;
  line-height: 1.55;
  font-size: 0.9rem;
  opacity: 0.85;
}

.rules {
  margin: 0 0 1rem;
  padding-left: 1.1rem;
  font-size: 0.84rem;
  line-height: 1.7;
  opacity: 0.8;
}

.rules b {
  font-weight: 600;
}

.orange {
  color: #e8a33d;
}

.purple {
  color: #a87bd1;
}

.desktop-hint {
  margin: 0 0 1.2rem;
  font-size: 0.75rem;
  opacity: 0.5;
}

.start {
  width: 100%;
  padding: 0.85rem 1rem;
  background: #dcd8c0;
  color: #100f0d;
  border: 0;
  font: inherit;
  font-size: 0.85rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  cursor: pointer;
}

.start:hover,
.start:focus-visible {
  background: #fff;
}

@media (max-width: 420px) {
  .panel {
    padding: 1.1rem 1rem;
  }
  h1 {
    font-size: 1.2rem;
  }
}
</style>
