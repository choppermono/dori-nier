<script setup>
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { LEVELS } from '@/game/levels.js'
import { THEMES } from '@/game/themes.js'
import { BOSSES } from '@/game/bosses.js'
import { ENEMIES, ENEMY_ORDER } from '@/game/enemies.js'

const props = defineProps({
  progress: { type: Object, required: true },
  selected: { type: Number, required: true },
  muted: { type: Boolean, default: false },
  touch: { type: Boolean, default: false },
})
const emit = defineEmits(['select', 'start', 'mute', 'reset'])

const tab = ref('sectors')
const resetArmed = ref(false)

const pad = (n) => String(n).padStart(2, '0')
function fmt(s) {
  if (typeof s !== 'number') return ''
  const m = Math.floor(s / 60)
  return `${pad(m)}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

const sectors = computed(() =>
  LEVELS.map((l, i) => ({
    i,
    name: l.name,
    subtitle: l.subtitle,
    world: THEMES[l.theme].name,
    accent: THEMES[l.theme].ui,
    boss: BOSSES[l.boss],
    unlocked: i <= props.progress.highest,
    cleared: props.progress.cleared.includes(i),
    best: props.progress.best[i],
  })),
)
const current = computed(() => sectors.value[props.selected] ?? sectors.value[0])
const breached = computed(() => props.progress.cleared.length)

// Where each enemy first shows up, for the field guide.
const firstSeen = computed(() => {
  const seen = {}
  LEVELS.forEach((l, i) => {
    for (const spec of l.waves.flat()) if (seen[spec.type] === undefined) seen[spec.type] = i
  })
  if (seen.splitter !== undefined && seen.shard === undefined) seen.shard = seen.splitter
  return seen
})
const guide = computed(() =>
  ENEMY_ORDER.map((key) => ({ key, ...ENEMIES[key], first: firstSeen.value[key], known: (firstSeen.value[key] ?? 99) <= props.progress.highest })),
)

function pick(s) {
  if (!s.unlocked) return
  if (s.i === props.selected) emit('start', s.i)
  else emit('select', s.i)
}

function onReset() {
  if (!resetArmed.value) {
    resetArmed.value = true
    setTimeout(() => (resetArmed.value = false), 3000)
    return
  }
  resetArmed.value = false
  emit('reset')
}
</script>

<template>
  <div class="menu" :style="{ '--a': current.accent }">
    <section class="panel">
      <header>
        <div class="rule">
          <span class="label">NieR · Hacking</span>
          <span class="line"></span>
          <span class="label">{{ breached }} / {{ sectors.length }} breached</span>
        </div>
        <h1>Access points</h1>
        <nav class="tabs" role="tablist" aria-label="Menu">
          <button type="button" role="tab" :aria-selected="tab === 'sectors'" @click="tab = 'sectors'">Sectors</button>
          <button type="button" role="tab" :aria-selected="tab === 'guide'" @click="tab = 'guide'">Field guide</button>
          <button type="button" role="tab" :aria-selected="tab === 'controls'" @click="tab = 'controls'">Controls</button>
        </nav>
      </header>

      <div v-if="tab === 'sectors'" class="scroll" role="tabpanel">
        <ul class="sectors">
          <li v-for="s in sectors" :key="s.i">
            <button
              type="button"
              class="sector"
              :class="{ selected: s.i === selected, locked: !s.unlocked, cleared: s.cleared }"
              :style="{ '--a': s.accent }"
              :disabled="!s.unlocked"
              :aria-label="s.unlocked ? `Sector ${s.i + 1}, ${s.name}. ${s.cleared ? 'Cleared' : 'Open'}` : `Sector ${s.i + 1}, locked`"
              @mouseenter="s.unlocked && emit('select', s.i)"
              @focus="s.unlocked && emit('select', s.i)"
              @click="pick(s)"
            >
              <span class="idx">{{ pad(s.i + 1) }}</span>
              <span class="swatch" aria-hidden="true"></span>
              <span class="body">
                <span class="name">{{ s.unlocked ? s.name : 'Locked' }}</span>
                <span class="meta">{{ s.world }}<template v-if="s.unlocked"> · {{ s.boss.name }}</template></span>
              </span>
              <span class="state">
                <template v-if="s.cleared">{{ fmt(s.best) || 'Cleared' }}</template>
                <template v-else-if="s.unlocked">Open</template>
                <svg v-else viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2h1v7H3V7zm2 0h4V5a2 2 0 0 0-4 0z" /></svg>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <div v-else-if="tab === 'guide'" class="scroll guide" role="tabpanel">
        <h3 class="label">Read the bullets</h3>
        <ul class="legend">
          <li><i class="orb hot"></i><span><b>Orange</b> shots can be shot down.</span></li>
          <li><i class="orb cold"></i><span><b>Black</b> ringed shots cannot. Dodge them.</span></li>
          <li><i class="dash"></i><span>A dashed line is a beam or a charge about to fire along it.</span></li>
          <li><i class="circle"></i><span>A filling circle is where a shell lands.</span></li>
          <li><i class="blink"></i><span>Blinking mines burst when the fuse runs out. One shot defuses them.</span></li>
        </ul>
        <h3 class="label">Hostiles</h3>
        <ul class="foes">
          <li v-for="f in guide" :key="f.key" :class="{ unknown: !f.known }">
            <span class="foe-name">{{ f.known ? f.name : 'Unknown' }}</span>
            <span class="foe-first label">{{ f.first !== undefined ? `Sector ${pad(f.first + 1)}` : '' }}</span>
            <span class="foe-blurb">{{ f.known ? f.blurb : 'Reach the sector where it appears to log it.' }}</span>
          </li>
        </ul>
      </div>

      <div v-else class="scroll controls" role="tabpanel">
        <div class="ctl">
          <h3 class="label">Touch</h3>
          <p>Left thumb moves, right thumb aims and fires. The sticks appear wherever your thumbs land.</p>
        </div>
        <div class="ctl">
          <h3 class="label">Keyboard + mouse</h3>
          <p><kbd>W A S D</kbd> move. Aim with the mouse and hold the button to fire, or aim and fire with <kbd>&larr; &uarr; &rarr; &darr;</kbd>. <kbd>Esc</kbd> pauses.</p>
        </div>
        <div class="ctl">
          <h3 class="label">Gamepad</h3>
          <p>Left stick moves, right stick aims and fires.</p>
        </div>
        <div class="ctl">
          <h3 class="label">Rules</h3>
          <p>Your ship has four segments. A hit breaks the one facing it, and you shrink. Clear three waves, then the core awakens as the sector's guardian. Beat it to breach the sector. One segment is restored when a guardian appears.</p>
        </div>
        <button type="button" class="reset" @click="onReset">{{ resetArmed ? 'Tap again to erase progress' : 'Reset progress' }}</button>
      </div>

      <footer>
        <button type="button" class="foot" @click="emit('mute')">Sound: {{ muted ? 'off' : 'on' }}</button>
        <RouterLink to="/about" class="foot">About</RouterLink>
        <a class="foot" href="https://halldor.ch" rel="noopener">halldor.ch</a>
      </footer>
    </section>

    <aside class="detail" aria-live="polite">
      <span class="label">Sector {{ pad(current.i + 1) }} · {{ current.world }}</span>
      <h2>{{ current.name }}</h2>
      <p class="sub">{{ current.subtitle }}</p>
      <div class="guardian">
        <span class="label">Guardian</span>
        <strong>{{ current.unlocked ? current.boss.name : '???' }}</strong>
        <em v-if="current.unlocked">{{ current.boss.title }}</em>
      </div>
      <button type="button" class="engage" :disabled="!current.unlocked" @click="emit('start', current.i)">
        <span class="fill" aria-hidden="true"></span>
        <span class="mark" aria-hidden="true"></span>
        <span>{{ current.cleared ? 'Engage again' : 'Engage' }}</span>
        <span class="meta">{{ current.cleared && current.best ? `Best ${fmt(current.best)}` : '3 waves + guardian' }}</span>
      </button>
    </aside>
  </div>
</template>

<style scoped>
.menu {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: grid;
  grid-template-columns: minmax(340px, 460px) 1fr;
  align-items: stretch;
  gap: var(--s-4);
  padding: calc(clamp(14px, 2.4vw, 32px) + env(safe-area-inset-top)) calc(clamp(14px, 2.4vw, 32px) + env(safe-area-inset-right))
    calc(clamp(14px, 2.4vw, 32px) + env(safe-area-inset-bottom)) calc(clamp(14px, 2.4vw, 32px) + env(safe-area-inset-left));
  pointer-events: none;
  background: linear-gradient(90deg, rgba(16, 15, 13, 0.82) 0%, rgba(16, 15, 13, 0.55) 34%, rgba(16, 15, 13, 0) 60%);
}

.panel,
.detail {
  pointer-events: auto;
}

.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  color: var(--bone);
}

.rule {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.rule .line {
  flex: 1;
  height: 1px;
  background: var(--line);
}

h1 {
  margin: 0 0 14px;
  font-family: var(--display);
  font-weight: 300;
  font-size: clamp(2rem, 4vw, 2.8rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  line-height: 1;
}

.tabs {
  display: flex;
  gap: 2px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.tabs button {
  flex: 1;
  min-height: 40px;
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  color: var(--bone-mute);
  font: 400 0.66rem/1 var(--mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
}

.tabs button[aria-selected='true'] {
  color: var(--bone);
  border-bottom-color: var(--a);
}

.tabs button:hover {
  color: var(--bone);
}

.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}

/* ---------- sectors ---------- */

.sectors {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.sector {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: rgba(22, 21, 15, 0.72);
  border: 1px solid var(--line);
  color: var(--bone);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--fast) var(--ease),
    border-color var(--fast) var(--ease),
    color var(--fast) var(--ease);
}

.sector .idx {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--bone-mute);
  width: 1.6em;
}

.swatch {
  width: 4px;
  align-self: stretch;
  background: var(--a);
  opacity: 0.55;
}

.body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.name {
  font-family: var(--display);
  font-size: 1.12rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.meta {
  font-family: var(--body);
  font-size: 0.78rem;
  color: var(--bone-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.state {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--bone-mute);
  white-space: nowrap;
}

.state svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.sector.cleared .state {
  color: var(--a);
}

.sector.selected,
.sector:not(:disabled):hover {
  background: var(--bone);
  color: var(--void);
  border-color: var(--bone);
}

.sector.selected .idx,
.sector.selected .meta,
.sector.selected .state,
.sector:not(:disabled):hover .idx,
.sector:not(:disabled):hover .meta,
.sector:not(:disabled):hover .state {
  color: var(--void);
}

.sector.selected .swatch {
  opacity: 1;
}

.sector.locked {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ---------- guide ---------- */

.guide h3,
.controls h3 {
  margin: 8px 0 10px;
}

.legend,
.foes {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  display: grid;
  gap: 8px;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.86rem;
  color: var(--bone-dim);
}

.legend b {
  color: var(--bone);
  font-weight: 500;
}

.legend i {
  flex: none;
  display: block;
  width: 22px;
  height: 22px;
}

.orb {
  border-radius: 50%;
}

.orb.hot {
  background: radial-gradient(circle, #fff3dc 0 20%, #ff9a2e 45%, rgba(255, 154, 46, 0) 72%);
}

.orb.cold {
  background: #0b0b0d;
  box-shadow: 0 0 0 3px #fff;
  transform: scale(0.62);
}

.dash {
  height: 2px !important;
  background: repeating-linear-gradient(90deg, var(--sig-text) 0 5px, transparent 5px 9px);
}

.circle {
  border: 2px solid #ff9a2e;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 154, 46, 0.35) 0 45%, transparent 46%);
}

.blink {
  border-radius: 50%;
  background: var(--sig-text);
  transform: scale(0.5);
  animation: blink 0.6s steps(2) infinite;
}

@keyframes blink {
  50% {
    opacity: 0.2;
  }
}

.foes li {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 2px 12px;
  padding: 10px 12px;
  background: rgba(22, 21, 15, 0.72);
  border: 1px solid var(--line);
}

.foe-name {
  font-family: var(--display);
  font-size: 1.05rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.foe-blurb {
  grid-column: 1 / -1;
  font-size: 0.82rem;
  line-height: 1.5;
  color: var(--bone-dim);
}

.foes li.unknown {
  opacity: 0.5;
}

/* ---------- controls ---------- */

.ctl p {
  margin: 0 0 14px;
  font-size: 0.88rem;
  line-height: 1.65;
  color: var(--bone-dim);
}

.reset {
  margin-top: 8px;
  background: none;
  border: 1px solid var(--line);
  padding: 10px 14px;
  color: var(--bone-mute);
  font: 400 0.64rem/1 var(--mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
}

.reset:hover,
.reset:focus-visible {
  color: var(--sig-text);
  border-color: var(--sig-fill);
}

footer {
  display: flex;
  gap: 18px;
  padding-top: 12px;
  margin-top: 8px;
  border-top: 1px solid var(--line);
}

.foot {
  background: none;
  border: 0;
  padding: 4px 0;
  color: var(--bone-mute);
  font: 400 0.64rem/1 var(--mono);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-decoration: none;
  cursor: pointer;
}

.foot:hover,
.foot:focus-visible {
  color: var(--bone);
}

/* ---------- detail ---------- */

.detail {
  align-self: end;
  justify-self: end;
  width: min(420px, 100%);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px 24px;
  background: rgba(16, 15, 13, 0.7);
  border: 1px solid var(--line-strong);
  backdrop-filter: blur(4px);
  color: var(--bone);
}

.detail h2 {
  margin: 0;
  font-family: var(--display);
  font-weight: 300;
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  letter-spacing: 0.2em;
  text-transform: uppercase;
  line-height: 1;
}

.detail .sub {
  margin: 0;
  color: var(--bone-dim);
  font-size: 0.95rem;
}

.guardian {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.guardian strong {
  font-family: var(--display);
  font-weight: 400;
  font-size: 1.3rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--a);
}

.guardian em {
  font-size: 0.85rem;
  color: var(--bone-dim);
}

/* The command line that fills with bone, as on halldor.ch. */
.engage {
  --c: 10px;
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 54px;
  margin-top: 6px;
  padding: 0 18px;
  font: 500 0.78rem/1 var(--mono);
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--bone);
  background:
    repeating-linear-gradient(-45deg, rgba(220, 216, 192, 0.05) 0 6px, transparent 6px 12px),
    rgba(16, 15, 13, 0.7);
  border: 0;
  box-shadow: inset 0 0 0 1px var(--line-strong);
  clip-path: polygon(var(--c) 0, 100% 0, 100% calc(100% - var(--c)), calc(100% - var(--c)) 100%, 0 100%, 0 var(--c));
  cursor: pointer;
  overflow: hidden;
}

.engage > :not(.fill) {
  position: relative;
}

.engage .fill {
  position: absolute;
  inset: 0;
  background: var(--bone);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 420ms var(--ease);
}

.engage .mark {
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid var(--a);
}

.engage .meta {
  margin-left: auto;
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  color: var(--bone-mute);
}

.engage:hover:not(:disabled),
.engage:focus-visible {
  color: var(--void);
  outline: none;
}

.engage:hover:not(:disabled) .fill,
.engage:focus-visible .fill {
  transform: scaleX(1);
}

.engage:hover:not(:disabled) .meta,
.engage:focus-visible .meta {
  color: rgba(16, 15, 13, 0.65);
}

.engage:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

@media (max-width: 860px) {
  .menu {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr auto;
    gap: 12px;
    background: linear-gradient(0deg, rgba(16, 15, 13, 0.92) 0%, rgba(16, 15, 13, 0.7) 55%, rgba(16, 15, 13, 0.25) 100%);
  }

  .panel {
    grid-row: 1;
    /* Leave a window at the top for the 3D preview of the chosen sector. */
    padding-top: 16vh;
  }

  .detail {
    grid-row: 2;
    width: 100%;
    padding: 16px 18px;
  }

  .detail h2 {
    font-size: 2rem;
  }

  .detail .sub,
  .guardian em {
    display: none;
  }
}

@media (max-height: 560px) and (max-width: 1000px) {
  .menu {
    grid-template-columns: minmax(300px, 1fr) minmax(260px, 340px);
    grid-template-rows: none;
  }
  .panel {
    padding-top: 0;
  }
  h1 {
    font-size: 1.6rem;
  }
}
</style>
