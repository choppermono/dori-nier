<script setup>
import { computed } from 'vue'

const props = defineProps({
  hud: { type: Object, required: true },
  banner: { type: Object, default: null },
  muted: { type: Boolean, default: false },
  touch: { type: Boolean, default: false },
})
const emit = defineEmits(['pause', 'mute'])

const pad = (n) => String(n).padStart(2, '0')

const time = computed(() => {
  const s = props.hud.time
  const m = Math.floor(s / 60)
  return `${pad(m)}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
})

// The ship in the HUD, front pointing up: four kites, lit while intact.
const KITES = [
  '0,0 -0.525,-0.75 0,-1.5 0.525,-0.75',
  '0,0 0.525,-0.75 1.05,0 0.525,0.525',
  '0,0 0.525,0.525 0,1.05 -0.525,0.525',
  '0,0 -0.525,0.525 -1.05,0 -0.525,-0.75',
]
const segments = computed(() => KITES.map((points, i) => ({ points, alive: !!(props.hud.segMask & (1 << i)) })))
const intact = computed(() => segments.value.filter((s) => s.alive).length)

// What a screen reader hears.
const live = computed(() => {
  const b = props.banner
  if (!b) return ''
  if (b.kind === 'sector') return `Sector ${b.index}: ${b.title}.`
  if (b.kind === 'wave') return `Wave ${b.index} of ${b.total}.`
  if (b.kind === 'cleared') return 'Wave cleared.'
  if (b.kind === 'phase') return `Guardian phase ${b.index}.`
  if (b.kind === 'warning') return `Warning. The core has awakened: ${b.title}.`
  return b.title || ''
})
</script>

<template>
  <div class="hud" :class="{ 'has-boss': !!hud.boss }">
    <p class="sr-only" aria-live="polite">{{ live }}</p>
    <div :key="hud.hitPulse" class="damage" :class="{ on: hud.hitPulse > 0 }" aria-hidden="true"></div>

    <header class="row top">
      <div class="block">
        <span class="label">Sector {{ pad(hud.index) }} <span class="of">/ {{ pad(hud.count) }}</span></span>
        <span class="name">{{ hud.name }}</span>
      </div>

      <div v-if="!hud.boss" class="waves" aria-label="Waves">
        <span class="label">Wave {{ hud.wave }} / {{ hud.waves }}</span>
        <span class="pips">
          <i
            v-for="n in hud.waves"
            :key="n"
            :class="{ done: n < hud.wave || (n === hud.wave && hud.waveDone), live: n === hud.wave && !hud.waveDone }"
          ></i>
          <i class="core" :class="{ live: hud.phase === 'awaken' }"></i>
        </span>
      </div>

      <div v-else class="boss" role="img" :aria-label="`${hud.boss.name}, ${Math.round(hud.boss.frac * 100)} percent`">
        <div class="boss-head">
          <span class="label warn">Guardian</span>
          <strong>{{ hud.boss.name }}</strong>
        </div>
        <div class="bar">
          <span class="fill" :style="{ transform: `scaleX(${hud.boss.frac})` }"></span>
          <i v-for="m in hud.boss.marks" :key="m" class="tick" :style="{ left: `${m * 100}%` }"></i>
        </div>
      </div>

      <div class="block end">
        <span class="label">Time</span>
        <span class="num">{{ time }}</span>
      </div>
    </header>

    <Transition name="banner">
      <div v-if="banner && banner.kind === 'sector'" :key="banner.id" class="banner sector" aria-hidden="true">
        <span class="label">Sector {{ pad(banner.index) }} · {{ banner.world }}</span>
        <strong>{{ banner.title }}</strong>
        <span class="rule"></span>
        <span class="sub">{{ banner.sub }}</span>
      </div>
      <div v-else-if="banner && banner.kind === 'wave'" :key="banner.id" class="banner wave" aria-hidden="true">
        <span class="line"></span>
        <span class="wave-body">
          <span class="label">Incoming</span>
          <strong>Wave {{ banner.index }}<span class="of">/{{ banner.total }}</span></strong>
        </span>
        <span class="line"></span>
      </div>
      <div v-else-if="banner && banner.kind === 'cleared'" :key="banner.id" class="banner cleared" aria-hidden="true">
        <span class="tick"></span>
        <strong>Wave cleared</strong>
        <span class="tick"></span>
      </div>
      <div v-else-if="banner && banner.kind === 'phase'" :key="banner.id" class="banner phase" aria-hidden="true">
        <span class="sliver"></span>
        <strong>Phase {{ banner.index }}</strong>
        <span class="label">{{ banner.sub }}</span>
      </div>
      <div v-else-if="banner && banner.kind === 'warning'" :key="banner.id" class="warning" aria-hidden="true">
        <div class="tape top"><span v-for="n in 8" :key="n">Warning · core awakening ·&nbsp;</span></div>
        <div class="warning-body">
          <span class="label warn">Guardian detected · +1 segment restored</span>
          <strong>{{ banner.title }}</strong>
          <span class="sub">{{ banner.sub }}</span>
        </div>
        <div class="tape bottom"><span v-for="n in 8" :key="n">Warning · core awakening ·&nbsp;</span></div>
      </div>
    </Transition>

    <footer class="row bottom">
      <div class="block integrity">
        <span class="label">Integrity</span>
        <svg class="ship" viewBox="-1.25 -1.7 2.5 2.95" role="img" :aria-label="`${intact} of 4 segments`">
          <polygon v-for="(s, i) in segments" :key="i" :points="s.points" :class="{ lost: !s.alive }" />
        </svg>
      </div>

      <p v-if="!touch" class="hint label">
        <span><kbd>W A S D</kbd> move</span>
        <span><kbd>Mouse</kbd> or <kbd>&larr;&uarr;&rarr;&darr;</kbd> aim + fire</span>
        <span>Orange shots can be shot down</span>
      </p>

      <div class="controls">
        <button type="button" class="icon" :aria-label="muted ? 'Turn sound on' : 'Turn sound off'" @click="emit('mute')">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 9h4l5-4v14l-5-4H4z" />
            <path v-if="!muted" d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" />
            <path v-else d="M17 9l5 6M22 9l-5 6" fill="none" />
          </svg>
        </button>
        <button type="button" class="icon" aria-label="Pause" @click="emit('pause')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3v14H7zM14 5h3v14h-3z" /></svg>
        </button>
      </div>
    </footer>

    <div v-if="touch && hud.phase === 'intro' && hud.index === 1" class="thumbs" aria-hidden="true">
      <span>Move</span>
      <span>Aim + fire</span>
    </div>
  </div>
</template>

<style scoped>
.hud {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: calc(clamp(12px, 2.4vw, 26px) + env(safe-area-inset-top)) calc(clamp(12px, 2.6vw, 30px) + env(safe-area-inset-right))
    calc(clamp(12px, 2.4vw, 24px) + env(safe-area-inset-bottom)) calc(clamp(12px, 2.6vw, 30px) + env(safe-area-inset-left));
  color: var(--bone);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.6);
}

.row {
  display: flex;
  justify-content: space-between;
  gap: var(--s-4);
}

.row.top {
  align-items: flex-start;
}

.row.bottom {
  align-items: flex-end;
}

.block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.block.end {
  align-items: flex-end;
  text-align: right;
}

.label .of {
  color: var(--bone-mute);
}

.name {
  font-family: var(--display);
  font-size: clamp(1.2rem, 2.6vw, 1.7rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  line-height: 1;
}

.num {
  font-family: var(--mono);
  font-size: clamp(1rem, 2vw, 1.25rem);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

/* ---------- waves ---------- */

.waves {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}

.pips {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pips i {
  display: block;
  width: 26px;
  height: 6px;
  background: rgba(220, 216, 192, 0.16);
  clip-path: polygon(4px 0, 100% 0, calc(100% - 4px) 100%, 0 100%);
  transition: background-color var(--base) var(--ease);
}

.pips i.done {
  background: var(--bone);
}

.pips i.live {
  background: var(--accent);
  animation: pulse 1s ease-in-out infinite;
}

.pips i.core {
  width: 10px;
  height: 10px;
  margin-left: 4px;
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  background: rgba(220, 216, 192, 0.3);
}

@keyframes pulse {
  50% {
    opacity: 0.45;
  }
}

/* ---------- boss bar ---------- */

.boss {
  flex: 1;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.boss-head {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 12px;
}

.boss-head strong {
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(1.1rem, 2.4vw, 1.5rem);
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

.bar {
  position: relative;
  height: 6px;
  background: rgba(220, 216, 192, 0.14);
  border: 1px solid rgba(220, 216, 192, 0.25);
}

.fill {
  position: absolute;
  inset: 0;
  transform-origin: left;
  background: linear-gradient(90deg, var(--sig-fill), var(--accent));
  transition: transform 120ms linear;
}

.tick {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--bone);
}

.warn {
  color: var(--sig-text);
}

/* ---------- bottom ---------- */

.integrity {
  flex-direction: row;
  align-items: center;
  gap: 12px;
}

.ship {
  width: 34px;
  height: 40px;
  overflow: visible;
}

.ship polygon {
  fill: var(--bone);
  stroke: var(--void);
  stroke-width: 0.06;
  transition: fill var(--base) var(--ease);
}

.ship polygon.lost {
  fill: rgba(188, 63, 60, 0.25);
  stroke: var(--sig-fill);
}

.hint {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px 18px;
  margin: 0 0 4px;
  color: var(--bone-dim);
  animation: hintOut 600ms var(--ease) 8s both;
}

@keyframes hintOut {
  to {
    opacity: 0;
    visibility: hidden;
  }
}

.controls {
  display: flex;
  gap: 8px;
  pointer-events: auto;
}

.icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  padding: 0;
  background: rgba(16, 15, 13, 0.55);
  border: 1px solid var(--line-strong);
  color: var(--bone);
  cursor: pointer;
  transition:
    background-color var(--fast) var(--ease),
    color var(--fast) var(--ease);
}

.icon svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}

.icon:hover,
.icon:focus-visible {
  background: var(--bone);
  color: var(--void);
}

/* ---------- damage ---------- */

.damage {
  position: absolute;
  inset: 0;
  opacity: 0;
  box-shadow: inset 0 0 140px 30px rgba(188, 63, 60, 0.6);
}

.damage.on {
  animation: hit 560ms var(--ease) both;
}

@keyframes hit {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/* ---------- banners ---------- */

.banner {
  position: absolute;
  left: 50%;
  top: 36%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  white-space: nowrap;
}

.banner.sector strong {
  font-family: var(--display);
  font-size: clamp(2.4rem, 8vw, 5rem);
  font-weight: 300;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  line-height: 1;
  margin-right: -0.3em;
}

.banner .rule {
  display: block;
  width: 200px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}

.banner .sub {
  font-family: var(--body);
  font-size: 0.95rem;
  color: var(--bone-dim);
  letter-spacing: 0.06em;
}

.banner.wave {
  flex-direction: row;
  gap: 16px;
  top: 30%;
}

.wave-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.banner.wave strong {
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(1.4rem, 4vw, 2.2rem);
  letter-spacing: 0.3em;
  text-transform: uppercase;
  margin-right: -0.3em;
}

.banner.wave .of {
  color: var(--bone-mute);
  font-size: 0.6em;
}

.banner.wave .line {
  width: clamp(30px, 10vw, 120px);
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent));
}

.banner.wave .line:last-child {
  background: linear-gradient(90deg, var(--accent), transparent);
}

/* A short beat between waves. */
.banner.cleared {
  flex-direction: row;
  gap: 14px;
  top: 30%;
}

.banner.cleared strong {
  font-family: var(--mono);
  font-size: 0.78rem;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--bone-dim);
}

.banner.cleared .tick {
  width: 8px;
  height: 8px;
  border: 1px solid var(--accent);
  transform: rotate(45deg);
}

.banner.phase {
  top: 32%;
  gap: 6px;
}

.banner.phase .sliver {
  width: clamp(90px, 22vw, 220px);
  height: 3px;
  background: var(--sig-fill);
}

.banner.phase strong {
  font-family: var(--display);
  font-size: clamp(1.6rem, 5vw, 2.6rem);
  font-weight: 300;
  letter-spacing: 0.34em;
  text-transform: uppercase;
  color: var(--accent);
  margin-right: -0.34em;
}

.banner-enter-active {
  animation: bannerIn 520ms var(--ease) both;
}
.banner-leave-active {
  animation: bannerIn 360ms var(--ease) reverse both;
}

@keyframes bannerIn {
  from {
    opacity: 0;
    letter-spacing: 0.6em;
    filter: blur(6px);
  }
  to {
    opacity: 1;
    filter: blur(0);
  }
}

/* The NieR warning: tape across the screen, the guardian's name between. */
.warning {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-58%);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.tape {
  overflow: hidden;
  white-space: nowrap;
  padding: 6px 0;
  background: var(--sig-fill);
  color: var(--void);
  font: 500 0.72rem/1 var(--mono);
  letter-spacing: 0.4em;
  text-transform: uppercase;
  text-shadow: none;
}

.tape span {
  display: inline-block;
  animation: tape 6s linear infinite;
}

.tape.bottom span {
  animation-direction: reverse;
}

@keyframes tape {
  to {
    transform: translateX(-100%);
  }
}

.warning-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  background: linear-gradient(90deg, transparent, rgba(16, 15, 13, 0.75) 20%, rgba(16, 15, 13, 0.75) 80%, transparent);
  padding: 14px 0;
}

.warning-body strong {
  font-family: var(--display);
  font-weight: 300;
  font-size: clamp(2.4rem, 8vw, 4.6rem);
  letter-spacing: 0.26em;
  text-transform: uppercase;
  line-height: 1;
  margin-right: -0.26em;
}

.warning-body .sub {
  font-family: var(--body);
  font-style: italic;
  color: var(--bone-dim);
}

.thumbs {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 22%;
  display: flex;
  justify-content: space-around;
  animation: hintOut 500ms var(--ease) 1.2s both;
}

.thumbs span {
  width: 110px;
  height: 110px;
  display: grid;
  place-items: center;
  border: 1px dashed rgba(220, 216, 192, 0.45);
  border-radius: 50%;
  font: 400 0.62rem/1 var(--mono);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--bone-dim);
}

@media (max-width: 640px) {
  .hint {
    display: none;
  }
  .pips i {
    width: 18px;
  }
  .boss-head .label {
    display: none;
  }
}
</style>
