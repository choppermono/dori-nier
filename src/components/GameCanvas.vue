<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { createGame, debugClearWave, debugSkipToBoss, drainEvents, enemiesLeft, LEVEL_COUNT, update } from '@/game/engine.js'
import { LEVELS } from '@/game/levels.js'
import { THEMES } from '@/game/themes.js'
import { bossPhaseMarks } from '@/game/bosses.js'
import { createInput } from '@/game/input.js'
import { createAudio } from '@/game/audio.js'
import { loadProgress, rememberCleared, resetProgress } from '@/game/progress.js'
import GameHud from './GameHud.vue'
import SectorMenu from './SectorMenu.vue'

// The border between Vue and the game: Vue owns menus, panels and the HUD;
// everything inside the canvas runs on requestAnimationFrame and never
// touches reactivity. The game object is a plain variable on purpose.

const stageEl = ref(null)
const glEl = ref(null)
const uiEl = ref(null)

const screen = ref('menu') // menu | playing | paused | won | lost | complete
const progress = reactive(loadProgress())
const selected = ref(progress.highest)
const muted = ref(false)
const failed = ref(false)
const result = ref(null)
const banner = ref(null)
const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

const hud = reactive({
  index: 1,
  count: LEVEL_COUNT,
  name: '',
  world: '',
  wave: 1,
  waves: 3,
  waveDone: false,
  phase: 'intro',
  time: 0,
  segMask: 15,
  hitPulse: 0,
  foes: 0,
  boss: null,
})

let renderer = null
let input = null
let audio = null
let game = null
let frameId = 0
let last = 0
let observer = null
let bannerTimer = 0
let previewTimer = 0

const sectorIndex = computed(() => (screen.value === 'menu' ? selected.value : hud.index - 1))
const accent = computed(() => THEMES[LEVELS[sectorIndex.value]?.theme]?.ui ?? '#e0574f')
const lightWorld = computed(() => !!THEMES[LEVELS[sectorIndex.value]?.theme]?.light2)

const pad = (n) => String(n).padStart(2, '0')
function fmt(s) {
  if (typeof s !== 'number') return '--:--.-'
  const m = Math.floor(s / 60)
  return `${pad(m)}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

function stageAspect() {
  const r = stageEl.value.getBoundingClientRect()
  return r.width / Math.max(1, r.height)
}

// Space the HUD rows take, so the camera frames the arena between them.
function applyInsets() {
  if (!renderer) return
  const r = stageEl.value.getBoundingClientRect()
  if (screen.value === 'menu') {
    renderer.setInsets(8, 8)
    return
  }
  // On a short screen the HUD rows would eat a third of the height; cap them.
  const small = r.width < 640
  renderer.setInsets(Math.round(Math.min(small ? 70 : 84, r.height * 0.13)), Math.round(Math.min(small ? 58 : 70, r.height * 0.11)))
}

function showPreview(i) {
  game = createGame(i, stageAspect(), { preview: true })
}

function selectSector(i) {
  if (i === selected.value) return
  selected.value = i
  clearTimeout(previewTimer)
  // Building a world takes a moment; wait until the pointer settles.
  previewTimer = setTimeout(() => {
    if (screen.value === 'menu') showPreview(selected.value)
  }, 120)
}

function showBanner(b, ms) {
  banner.value = { ...b, id: performance.now() }
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => (banner.value = null), ms)
}

function startSector(i) {
  if (i > progress.highest) return
  audio?.unlock()
  audio?.ui()
  selected.value = i
  const def = LEVELS[i]
  game = createGame(i, stageAspect(), { reduced })
  Object.assign(hud, {
    index: i + 1,
    name: def.name,
    world: THEMES[def.theme].name,
    wave: 1,
    waves: def.waves.length,
    waveDone: false,
    phase: 'intro',
    time: 0,
    segMask: 15,
    hitPulse: 0,
    foes: 0,
    boss: null,
  })
  result.value = null
  input?.reset()
  screen.value = 'playing'
  applyInsets()
  last = performance.now()
  showBanner({ kind: 'sector', index: i + 1, title: def.name, sub: def.subtitle, world: THEMES[def.theme].name }, 2300)
}

function toMenu() {
  audio?.ui()
  screen.value = 'menu'
  banner.value = null
  Object.assign(progress, loadProgress())
  if (selected.value > progress.highest) selected.value = progress.highest
  showPreview(selected.value)
  applyInsets()
}

function pause() {
  if (screen.value !== 'playing') return
  screen.value = 'paused'
  input?.reset()
  audio?.ui()
}

function resume() {
  if (screen.value !== 'paused') return
  screen.value = 'playing'
  last = performance.now()
  audio?.ui()
}

function toggleMute() {
  audio?.setMuted(!muted.value)
  muted.value = !!audio?.muted
}

function onReset() {
  resetProgress()
  Object.assign(progress, loadProgress())
  selected.value = 0
  showPreview(0)
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function syncHud() {
  const g = game
  if (!g || g.phase === 'preview') return
  hud.phase = g.phase
  hud.wave = Math.max(1, g.waveIndex + 1)
  hud.waveDone = g.waveIndex >= 0 && g.clearedWave >= g.waveIndex
  hud.time = Math.floor(g.time * 10) / 10
  let mask = 0
  g.player.segments.forEach((s, i) => {
    if (s) mask |= 1 << i
  })
  hud.segMask = mask
  hud.foes = enemiesLeft(g)
  const B = g.boss
  if (B) {
    const frac = Math.max(0, Math.round((B.hp / B.maxHp) * 1000) / 1000)
    if (!hud.boss) hud.boss = { name: B.name, title: B.def.title, frac, marks: bossPhaseMarks(B.id), phase: B.phase }
    else {
      hud.boss.frac = frac
      hud.boss.phase = B.phase
    }
  } else if (hud.boss) {
    hud.boss = null
  }
}

function onEvents(events) {
  for (const ev of events) {
    if (ev.type === 'wave') showBanner({ kind: 'wave', index: ev.index + 1, total: ev.total }, 1700)
    else if (ev.type === 'waveClear' && ev.index + 1 < ev.total) showBanner({ kind: 'cleared' }, 900)
    else if (ev.type === 'awaken') showBanner({ kind: 'warning', title: ev.name, sub: ev.title }, 3400)
    else if (ev.type === 'bossPhase') showBanner({ kind: 'phase', index: ev.index + 1, sub: 'The guardian changes' }, 1400)
    else if (ev.type === 'playerHit') hud.hitPulse += 1
  }
}

function checkEnd() {
  if (screen.value !== 'playing' || !game) return
  if (game.status === 'won') {
    const record = rememberCleared(game.levelIndex, game.time)
    Object.assign(progress, loadProgress())
    result.value = {
      index: game.levelIndex,
      time: game.time,
      damage: game.stats.damage,
      kills: game.stats.kills,
      record,
      best: progress.best[game.levelIndex],
    }
    screen.value = game.levelIndex >= LEVEL_COUNT - 1 ? 'complete' : 'won'
  } else if (game.status === 'lost') {
    const B = game.boss
    result.value = {
      index: game.levelIndex,
      time: game.time,
      kills: game.stats.kills,
      reached: B ? `${B.name} at ${Math.max(1, Math.round((B.hp / B.maxHp) * 100))}%` : `Wave ${Math.max(1, game.waveIndex + 1)} of ${game.waveCount}`,
    }
    screen.value = 'lost'
  }
}

function drawSticks() {
  const c = uiEl.value
  if (!c) return
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  if (screen.value !== 'playing' || !input || input.mode !== 'touch') return
  const dpr = c.width / Math.max(1, c.clientWidth)
  ctx.save()
  ctx.scale(dpr, dpr)
  for (const s of [input.sticks.move, input.sticks.aim]) {
    if (!s.active) continue
    ctx.strokeStyle = 'rgba(220, 216, 192, 0.35)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(s.originX, s.originY, s.radius, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = 'rgba(220, 216, 192, 0.28)'
    ctx.beginPath()
    ctx.arc(s.knobX, s.knobY, s.radius * 0.36, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

// Dev builds only: a bot can take the controls for testing.
let autopilot = null

function loop(now) {
  frameId = requestAnimationFrame(loop)
  const dt = Math.min(0.1, (now - last) / 1000 || 0)
  last = now
  tick(dt)
}

function tick(dt) {
  if (!game || !renderer) return

  let events = null
  if (screen.value === 'playing') {
    update(game, dt, autopilot ? autopilot(game) : input.read())
    events = drainEvents(game)
    if (events.length) {
      audio.playAll(events)
      onEvents(events)
    }
  }
  renderer.frame(game, dt, events, { paused: screen.value === 'paused' })
  drawSticks()
  syncHud()
  checkEnd()
}

function fit() {
  const el = stageEl.value
  if (!el || !renderer) return
  const r = el.getBoundingClientRect()
  renderer.setSize(r.width, r.height)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  uiEl.value.width = Math.round(r.width * dpr)
  uiEl.value.height = Math.round(r.height * dpr)
  applyInsets()
  // Turning the phone in the menu flips the preview arena too.
  if (screen.value === 'menu' && game && game.portrait !== stageAspect() < 0.95) showPreview(selected.value)
  // Resizing clears the canvas; draw straight away instead of leaving a blank frame.
  if (game) renderer.frame(game, 0, null, { paused: true })
}

function onKey(e) {
  if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
    if (screen.value === 'playing') {
      e.preventDefault()
      pause()
    } else if (screen.value === 'paused') {
      e.preventDefault()
      resume()
    }
  }
}

function onVisibility() {
  if (document.hidden) pause()
}

function onFirstInput() {
  audio?.unlock()
}

onMounted(async () => {
  audio = createAudio()
  muted.value = audio.muted
  try {
    const { createRenderer } = await import('@/game/render3d/index.js')
    renderer = createRenderer(glEl.value, { reduced })
  } catch (err) {
    console.error('3D renderer unavailable', err)
    failed.value = true
    return
  }
  input = createInput(glEl.value, {
    toWorld: (x, y) => renderer.screenToWorld(x, y),
    getPlayer: () => (game ? game.player : null),
  })
  observer = new ResizeObserver(fit)
  observer.observe(stageEl.value)
  fit()
  showPreview(selected.value)
  last = performance.now()
  frameId = requestAnimationFrame(loop)

  window.addEventListener('keydown', onKey)
  window.addEventListener('pointerdown', onFirstInput, { once: true })
  window.addEventListener('keydown', onFirstInput, { once: true })
  document.addEventListener('visibilitychange', onVisibility)

  if (import.meta.env.DEV) {
    const bot = await import('@/game/devbot.js')
    window.__dori = {
      // Advance the loop by hand - for testing where the tab gets no frames.
      step: (sec = 1, fps = 60) => {
        for (let i = 0; i < sec * fps; i++) tick(1 / fps)
        return game && { phase: game.phase, wave: game.waveIndex + 1, time: +game.time.toFixed(1), status: game.status, screen: screen.value }
      },
      autopilot: (on = true) => {
        autopilot = on ? bot.botInput : null
      },
      start: (i) => startSector(i),
      unlockAll: () => {
        progress.highest = LEVEL_COUNT - 1
      },
      boss: () => game && debugSkipToBoss(game),
      clearWave: () => game && debugClearWave(game),
      god: (on = true) => game && (game.god = on),
      game: () => game,
      r: () => renderer,
    }
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frameId)
  clearTimeout(bannerTimer)
  clearTimeout(previewTimer)
  observer?.disconnect()
  input?.destroy()
  renderer?.dispose()
  audio?.dispose()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', onFirstInput)
  window.removeEventListener('keydown', onFirstInput)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div ref="stageEl" class="stage" :class="{ 'is-light': lightWorld }" :style="{ '--accent': accent }">
    <canvas
      ref="glEl"
      class="surface"
      :aria-label="screen === 'playing' ? 'Hacking arena. Move with W A S D, aim and fire with the arrow keys or the mouse. Escape pauses.' : 'Sector preview'"
      role="img"
    ></canvas>
    <canvas ref="uiEl" class="sticks" aria-hidden="true"></canvas>
    <div class="scanlines" aria-hidden="true"></div>

    <div v-if="failed" class="overlay">
      <div class="panel">
        <span class="label">Connection refused</span>
        <h2>This browser can't run the arena</h2>
        <p class="lead">The game needs WebGL 2. Try a current version of Chrome, Safari, Firefox or Edge, or turn on hardware acceleration.</p>
      </div>
    </div>

    <SectorMenu
      v-if="screen === 'menu' && !failed"
      :progress="progress"
      :selected="selected"
      :muted="muted"
      :touch="coarse"
      @select="selectSector"
      @start="startSector"
      @mute="toggleMute"
      @reset="onReset"
    />

    <GameHud
      v-if="screen === 'playing' || screen === 'paused'"
      :hud="hud"
      :banner="banner"
      :muted="muted"
      :touch="coarse"
      @pause="pause"
      @mute="toggleMute"
    />

    <Transition name="panel">
      <div v-if="screen === 'paused'" class="overlay" @click.self="resume">
        <div class="panel" role="dialog" aria-modal="true" aria-labelledby="pause-title">
          <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
          <span class="label">Sector {{ pad(hud.index) }} · {{ hud.name }}</span>
          <h2 id="pause-title">Paused</h2>
          <div class="actions">
            <button type="button" class="btn solid" autofocus @click="resume">Resume</button>
            <button type="button" class="btn" @click="startSector(hud.index - 1)">Restart sector</button>
            <button type="button" class="btn" @click="toMenu">Sectors</button>
          </div>
          <button type="button" class="link" @click="toggleMute">Sound: {{ muted ? 'off' : 'on' }}</button>
        </div>
      </div>
    </Transition>

    <Transition name="panel">
      <div v-if="(screen === 'won' || screen === 'complete') && result" class="overlay">
        <div class="panel" role="dialog" aria-modal="true" aria-labelledby="won-title">
          <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
          <span class="label accent">{{ screen === 'complete' ? 'All sectors breached' : `Sector ${pad(result.index + 1)} breached` }}</span>
          <h2 id="won-title">{{ screen === 'complete' ? 'System open' : 'Hacking complete' }}</h2>
          <p v-if="result.record" class="record">New best time</p>
          <dl class="stats">
            <div><dt class="label">Time</dt><dd>{{ fmt(result.time) }}</dd></div>
            <div><dt class="label">Best</dt><dd>{{ fmt(result.best) }}</dd></div>
            <div><dt class="label">Hits taken</dt><dd>{{ result.damage }}</dd></div>
            <div><dt class="label">Kills</dt><dd>{{ result.kills }}</dd></div>
          </dl>
          <p v-if="screen === 'complete'" class="lead">Ten sectors, ten guardians. The core is yours.</p>
          <div class="actions">
            <button v-if="screen === 'won'" type="button" class="btn solid" autofocus @click="startSector(result.index + 1)">
              Next: sector {{ pad(result.index + 2) }}
            </button>
            <button type="button" class="btn" @click="startSector(result.index)">Replay</button>
            <button type="button" class="btn" @click="toMenu">Sectors</button>
          </div>
        </div>
      </div>
    </Transition>

    <Transition name="panel">
      <div v-if="screen === 'lost' && result" class="overlay">
        <div class="panel" role="dialog" aria-modal="true" aria-labelledby="lost-title">
          <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
          <span class="label warn">Connection severed</span>
          <h2 id="lost-title" class="warn">Hacking failed</h2>
          <dl class="stats three">
            <div><dt class="label">Reached</dt><dd>{{ result.reached }}</dd></div>
            <div><dt class="label">Time</dt><dd>{{ fmt(result.time) }}</dd></div>
            <div><dt class="label">Kills</dt><dd>{{ result.kills }}</dd></div>
          </dl>
          <div class="actions">
            <button type="button" class="btn solid" autofocus @click="startSector(result.index)">Retry</button>
            <button type="button" class="btn" @click="toMenu">Sectors</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--void);
  --accent: #e0574f;
}

.surface,
.sticks {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.surface {
  /* Without this the page scrolls and zooms as soon as two thumbs land. */
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  outline: none;
}

.sticks {
  pointer-events: none;
}

.scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(0, 0, 0, 0.12) 0 1px, transparent 1px 3px);
  mix-blend-mode: multiply;
  opacity: 0.55;
}

.is-light .scanlines {
  opacity: 0.25;
}

/* ---------- panels ---------- */

.overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  padding: calc(16px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));
  background: radial-gradient(ellipse at center, rgba(16, 15, 13, 0.55), rgba(16, 15, 13, 0.88));
  backdrop-filter: blur(3px);
}

.panel {
  position: relative;
  width: min(520px, 100%);
  padding: clamp(24px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  text-align: center;
  background: rgba(16, 15, 13, 0.9);
  border: 1px solid var(--line-strong);
  color: var(--bone);
}

.corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 0 solid var(--bone);
}
.corner.tl { top: -1px; left: -1px; border-top-width: 2px; border-left-width: 2px; }
.corner.tr { top: -1px; right: -1px; border-top-width: 2px; border-right-width: 2px; }
.corner.bl { bottom: -1px; left: -1px; border-bottom-width: 2px; border-left-width: 2px; }
.corner.br { bottom: -1px; right: -1px; border-bottom-width: 2px; border-right-width: 2px; }

h2 {
  margin: 0;
  font-family: var(--display);
  font-weight: 300;
  font-size: clamp(2rem, 6vw, 3rem);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  line-height: 1.05;
  margin-right: -0.18em;
  text-wrap: balance;
}

.warn {
  color: var(--sig-text);
}

.accent {
  color: var(--accent);
}

.record {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
}

.lead {
  margin: 0;
  font-family: var(--body);
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--bone-dim);
  max-width: 34ch;
}

.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--s-3);
  width: 100%;
  margin: var(--s-1) 0;
  padding: var(--s-3) 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.stats.three {
  grid-template-columns: 1.4fr 1fr 1fr;
}

.stats div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.stats dd {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.95rem;
  font-variant-numeric: tabular-nums;
  color: var(--bone);
  overflow-wrap: anywhere;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s-2);
  width: 100%;
}

.btn {
  flex: 1 1 150px;
  min-height: 48px;
  padding: 0 18px;
  font: 500 0.75rem/1 var(--mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--bone);
  background: transparent;
  border: 1px solid var(--line-strong);
  cursor: pointer;
  transition:
    background-color var(--fast) var(--ease),
    color var(--fast) var(--ease),
    border-color var(--fast) var(--ease);
}

.btn.solid {
  background: var(--bone);
  color: var(--void);
  border-color: var(--bone);
}

.btn:hover,
.btn:focus-visible {
  background: var(--bone);
  color: var(--void);
  border-color: var(--bone);
}

.btn.solid:hover,
.btn.solid:focus-visible {
  background: transparent;
  color: var(--bone);
}

.link {
  background: none;
  border: 0;
  padding: 6px;
  font: 400 0.68rem/1 var(--mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--bone-mute);
  cursor: pointer;
}

.link:hover,
.link:focus-visible {
  color: var(--bone);
}

.panel-enter-active {
  animation: panelIn 420ms var(--ease) both;
}
.panel-leave-active {
  animation: panelIn 180ms var(--ease) reverse both;
}

@keyframes panelIn {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 560px) {
  .stats {
    grid-template-columns: repeat(2, 1fr);
  }
  .stats.three {
    grid-template-columns: 1fr 1fr;
  }
  .stats.three div:first-child {
    grid-column: 1 / -1;
  }
}
</style>
