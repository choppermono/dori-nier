<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="about">
    <div class="inner">
      <header class="rule">
        <span class="tag">Dori</span>
        <span class="line"></span>
        <span class="tag">Über</span>
      </header>

      <h1>Hacking</h1>

      <p>
        Ein Nachbau des Hacking-Minispiels aus NieR Automata. Top-down, zwei virtuelle
        Joysticks, gebaut für den Daumen und nicht für die Tastatur.
      </p>
      <p>
        Linker Stick bewegt, rechter Stick dreht und feuert zugleich. Beide sind
        voneinander unabhängig — nach links laufen und dabei nach rechts schiessen ist
        der ganze Punkt. Ausweichen gibt es nicht, Bewegung ist das Ausweichen.
      </p>
      <p>
        Der Spieler ist eine Raute aus vier Segmenten. Jeder Treffer bricht eines ab,
        auf der Seite, aus der er kam — dafür wird die Trefferfläche kleiner. Man liest
        seinen Zustand am eigenen Schiff ab, nicht in der Ecke.
      </p>
      <p>
        Fünf Sektoren mit mehreren Wellen. Der Kern öffnet sich, wenn alle Gegner tot
        sind. Vier Gegnertypen, sechs Feuermuster, und keiner davon ist im Normalzustand
        so schnell wie du.
      </p>
      <p class="dim">
        Vue 3 und Vite, die Arena ist ein Canvas mit eigener Spielschleife. Mechaniken
        nachgebaut, alle Grafik selbst gezeichnet.
      </p>

      <RouterLink to="/" class="back">Zurück zum Spiel</RouterLink>
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
}

.inner {
  width: min(34rem, 100%);
  border: 1px solid var(--line-strong);
  background: var(--panel);
  padding: 1.6rem 1.4rem;
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

.tag {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bone-mute);
}

h1 {
  margin: 0 0 1.2rem;
  font-family: var(--display);
  font-weight: 400;
  font-size: clamp(1.6rem, 7vw, 2.2rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

p {
  margin: 0 0 1rem;
  font-family: var(--body);
  line-height: 1.65;
  font-size: 0.9rem;
  color: var(--bone-dim);
}

p.dim {
  color: var(--bone-mute);
  font-size: 0.82rem;
}

.back {
  display: inline-block;
  margin-top: 0.6rem;
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--bone-dim);
  text-decoration: none;
  border-bottom: 1px solid var(--line-strong);
  padding-bottom: 3px;
  transition: color 140ms var(--ease), border-color 140ms var(--ease);
}

.back:hover,
.back:focus-visible {
  color: var(--bone);
  border-bottom-color: var(--bone);
}
</style>
