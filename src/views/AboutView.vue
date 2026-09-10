<script setup>
import { RouterLink } from 'vue-router'
</script>

<template>
  <main class="about">
    <div class="inner">
      <h1>Über</h1>
      <p>
        Ein Nachbau des Hacking-Minispiels aus NieR Automata. Top-down, zwei virtuelle
        Joysticks, gebaut für den Daumen und nicht für die Tastatur.
      </p>
      <p>
        Linker Stick bewegt, rechter Stick dreht und feuert zugleich. Beide sind
        voneinander unabhängig - nach links laufen und dabei nach rechts schiessen ist
        der ganze Punkt. Ausweichen gibt es nicht, Bewegung ist das Ausweichen.
      </p>
      <p>
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
  padding: 2rem 1.2rem;
  color: #dcd8c0;
}

.inner {
  width: min(34rem, 100%);
}

h1 {
  margin: 0 0 1.2rem;
  font-size: 1.4rem;
  font-weight: 400;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

p {
  margin: 0 0 1rem;
  line-height: 1.65;
  opacity: 0.82;
}

.back {
  display: inline-block;
  margin-top: 0.8rem;
  color: #dcd8c0;
  text-decoration: none;
  border-bottom: 1px solid rgba(220, 216, 192, 0.4);
  padding-bottom: 2px;
  letter-spacing: 0.08em;
}

.back:hover {
  border-bottom-color: #dcd8c0;
}
</style>
