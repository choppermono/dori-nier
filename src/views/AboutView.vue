<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="about">
    <div class="inner">
      <header class="rule">
        <span class="label">NieR · Hacking</span>
        <span class="line"></span>
        <span class="label">About</span>
      </header>

      <h1>Hacking</h1>

      <p>
        A remake of the hacking minigame from NieR: Automata, rebuilt in 3D for the browser. Top-down, twin-stick,
        made for thumbs first and keyboards second.
      </p>
      <p>
        The left stick moves, the right stick turns and fires at once. They are independent - running left while
        shooting right is the whole point. There is no dodge roll; moving is the dodge.
      </p>
      <p>
        Your ship is a diamond of four segments. Every hit breaks the one facing it, and the hitbox shrinks with it.
        You read your state off your own ship, not a bar in the corner.
      </p>
      <p>
        Ten sectors, each its own world. Three waves in each, then the core wakes up as that sector's guardian.
        Fourteen kinds of hostiles, ten guardians, and every sector a little faster and meaner than the last.
      </p>
      <p class="dim">
        Vue 3 and Vite, three.js for the arena with its own game loop, sound synthesised in the browser. Mechanics
        rebuilt, every model and effect drawn from scratch. Not affiliated with Square Enix or PlatinumGames.
      </p>

      <RouterLink to="/" class="back">Back to the game</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.about {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: calc(2rem + env(safe-area-inset-top)) 1.2rem calc(2rem + env(safe-area-inset-bottom));
  color: var(--bone);
  overflow-y: auto;
  height: 100%;
}

.inner {
  width: min(36rem, 100%);
  border: 1px solid var(--line-strong);
  background: var(--panel);
  padding: 1.8rem 1.6rem;
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
  margin: 0 0 1.2rem;
  font-family: var(--display);
  font-weight: 300;
  font-size: clamp(1.8rem, 7vw, 2.6rem);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

p {
  margin: 0 0 1rem;
  font-family: var(--body);
  line-height: 1.65;
  font-size: 0.95rem;
  color: var(--bone-dim);
}

p.dim {
  color: var(--bone-mute);
  font-size: 0.85rem;
}

.back {
  display: inline-block;
  margin-top: 0.6rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bone-dim);
  text-decoration: none;
  border-bottom: 1px solid var(--line-strong);
  padding-bottom: 3px;
  transition:
    color var(--fast) var(--ease),
    border-color var(--fast) var(--ease);
}

.back:hover,
.back:focus-visible {
  color: var(--bone);
  border-bottom-color: var(--bone);
}
</style>
