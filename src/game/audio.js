// Sound effects, synthesised in the browser - no audio files to download.
// Browsers only allow sound after a tap or key press, so unlock() is called on
// the first input. Every sound is throttled: forty kills in one frame must not
// become forty stacked explosions.

const KEY = 'dori.muted'

export function createAudio() {
  let ctx = null
  let master = null
  let noiseBuf = null
  let muted = false
  const last = {}

  try {
    muted = localStorage.getItem(KEY) === '1'
  } catch {
    // no storage: default to sound on
  }

  function ensure() {
    if (ctx) return ctx
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.knee.value = 10
    comp.ratio.value = 5
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.5
    master.connect(comp)
    comp.connect(ctx.destination)
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    return ctx
  }

  function unlock() {
    const c = ensure()
    if (c && c.state === 'suspended') c.resume()
  }

  function ready() {
    return ctx && !muted && ctx.state === 'running'
  }

  function throttle(key, gap) {
    const now = ctx.currentTime
    if (last[key] !== undefined && now - last[key] < gap) return false
    last[key] = now
    return true
  }

  function tone({ type = 'square', f0, f1, dur, vol, attack = 0.004, when = 0 }) {
    const t = ctx.currentTime + when
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g)
    g.connect(master)
    o.start(t)
    o.stop(t + dur + 0.03)
  }

  function noise({ dur, vol, f0 = 2000, f1, q = 0.8, type = 'lowpass', when = 0 }) {
    const t = ctx.currentTime + when
    const s = ctx.createBufferSource()
    s.buffer = noiseBuf
    s.loop = true
    const fl = ctx.createBiquadFilter()
    fl.type = type
    fl.frequency.setValueAtTime(f0, t)
    if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur)
    fl.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(vol, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(fl)
    fl.connect(g)
    g.connect(master)
    s.start(t, Math.random() * 0.5)
    s.stop(t + dur + 0.03)
  }

  const SOUNDS = {
    shot() {
      if (throttle('shot', 0.075)) tone({ type: 'square', f0: 900, f1: 540, dur: 0.045, vol: 0.035 })
    },
    enemyShot() {
      if (throttle('eshot', 0.11)) tone({ type: 'triangle', f0: 340, f1: 190, dur: 0.08, vol: 0.035 })
    },
    pop() {
      if (throttle('pop', 0.04)) tone({ type: 'sine', f0: 1500, f1: 650, dur: 0.06, vol: 0.05 })
    },
    hit() {
      if (throttle('hit', 0.05)) tone({ type: 'square', f0: 260, f1: 170, dur: 0.035, vol: 0.03 })
    },
    deflect() {
      if (throttle('defl', 0.07)) tone({ type: 'triangle', f0: 2400, f1: 1900, dur: 0.05, vol: 0.03 })
    },
    kill(ev) {
      if (!throttle('kill', 0.045) || ev.silent) return
      noise({ dur: 0.34, vol: 0.22, f0: 3200, f1: 180 })
      tone({ type: 'sawtooth', f0: 230, f1: 48, dur: 0.28, vol: 0.09 })
    },
    playerHit() {
      noise({ dur: 0.4, vol: 0.35, f0: 1600, f1: 90 })
      tone({ type: 'square', f0: 150, f1: 40, dur: 0.34, vol: 0.16 })
    },
    playerDown() {
      noise({ dur: 1.3, vol: 0.45, f0: 2200, f1: 50 })
      tone({ type: 'sawtooth', f0: 320, f1: 28, dur: 1.3, vol: 0.16 })
    },
    spawnWarn() {
      if (throttle('warn', 0.14)) tone({ type: 'sine', f0: 620, f1: 940, dur: 0.12, vol: 0.03 })
    },
    spawn() {
      if (throttle('spawn', 0.09)) tone({ type: 'triangle', f0: 210, f1: 420, dur: 0.12, vol: 0.04 })
    },
    beamWarn() {
      if (throttle('bwarn', 0.25)) tone({ type: 'sawtooth', f0: 140, f1: 620, dur: 0.95, vol: 0.035, attack: 0.2 })
    },
    beamFire() {
      if (!throttle('bfire', 0.12)) return
      noise({ dur: 0.35, vol: 0.16, f0: 5200, f1: 700, type: 'bandpass', q: 2 })
      tone({ type: 'sawtooth', f0: 95, f1: 60, dur: 0.3, vol: 0.09 })
    },
    mortarLaunch() {
      if (!throttle('mlaunch', 0.12)) return
      tone({ type: 'sine', f0: 190, f1: 90, dur: 0.14, vol: 0.1 })
      tone({ type: 'sine', f0: 1300, f1: 420, dur: 1.1, vol: 0.018, when: 0.08 })
    },
    boom(ev) {
      if (!throttle('boom', 0.06)) return
      noise({ dur: ev.small ? 0.28 : 0.55, vol: ev.small ? 0.16 : 0.32, f0: 1900, f1: 80 })
      tone({ type: 'sine', f0: 120, f1: 36, dur: 0.45, vol: 0.2 })
    },
    mineDrop() {
      if (!throttle('mdrop', 0.25)) return
      tone({ type: 'square', f0: 520, dur: 0.05, vol: 0.022 })
      tone({ type: 'square', f0: 720, dur: 0.05, vol: 0.022, when: 0.08 })
    },
    mineShot() {
      tone({ type: 'sine', f0: 1700, f1: 420, dur: 0.12, vol: 0.05 })
    },
    blockBreak() {
      noise({ dur: 0.35, vol: 0.2, f0: 2600, f1: 300, type: 'bandpass', q: 1.4 })
    },
    shieldHit() {
      if (throttle('shield', 0.08)) tone({ type: 'sine', f0: 1900, f1: 1550, dur: 0.06, vol: 0.02 })
    },
    wave() {
      ;[0, 0.12, 0.24].forEach((w, i) => tone({ type: 'triangle', f0: 440 * (1 + i * 0.26), dur: 0.2, vol: 0.05, when: w }))
    },
    waveClear() {
      tone({ type: 'sine', f0: 660, f1: 990, dur: 0.3, vol: 0.06 })
    },
    awaken() {
      tone({ type: 'sawtooth', f0: 55, f1: 220, dur: 3, vol: 0.09, attack: 0.4 })
      tone({ type: 'sawtooth', f0: 82, f1: 330, dur: 3, vol: 0.06, attack: 0.4 })
      for (let i = 0; i < 6; i++) tone({ type: 'square', f0: i % 2 ? 660 : 880, dur: 0.16, vol: 0.04, when: 0.2 + i * 0.36 })
    },
    shieldBreak() {
      noise({ dur: 1, vol: 0.4, f0: 7000, f1: 500, type: 'highpass', q: 0.5 })
      for (let i = 0; i < 6; i++) tone({ type: 'sine', f0: 1800 + Math.random() * 2400, dur: 0.4, vol: 0.03, when: i * 0.05 })
    },
    bossSpawn() {
      noise({ dur: 1.2, vol: 0.4, f0: 1200, f1: 60 })
      tone({ type: 'sine', f0: 60, f1: 30, dur: 1.2, vol: 0.3 })
    },
    bossPhase() {
      tone({ type: 'sawtooth', f0: 120, f1: 480, dur: 0.6, vol: 0.08 })
      noise({ dur: 0.5, vol: 0.2, f0: 3000, f1: 300 })
    },
    bossDown() {
      noise({ dur: 2.6, vol: 0.55, f0: 2600, f1: 40 })
      tone({ type: 'sine', f0: 80, f1: 20, dur: 2.2, vol: 0.35 })
      tone({ type: 'sawtooth', f0: 400, f1: 60, dur: 1.6, vol: 0.08 })
    },
    levelClear() {
      ;[523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.5, vol: 0.06, when: i * 0.12 }))
    },
    levelLost() {
      ;[392, 330, 262, 196].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.45, vol: 0.05, when: i * 0.16 }))
    },
    heal() {
      tone({ type: 'sine', f0: 520, f1: 1040, dur: 0.4, vol: 0.06 })
    },
    charge() {
      if (throttle('charge', 0.2)) tone({ type: 'sawtooth', f0: 100, f1: 420, dur: 0.75, vol: 0.045, attack: 0.1 })
    },
    slam() {
      noise({ dur: 0.4, vol: 0.26, f0: 900, f1: 70 })
      tone({ type: 'sine', f0: 72, f1: 34, dur: 0.4, vol: 0.24 })
    },
    blinkOut() {
      if (throttle('blink', 0.1)) tone({ type: 'sine', f0: 900, f1: 200, dur: 0.25, vol: 0.035 })
    },
    blinkIn() {
      if (throttle('blink2', 0.1)) tone({ type: 'sine', f0: 200, f1: 900, dur: 0.25, vol: 0.035 })
    },
    summon() {
      tone({ type: 'triangle', f0: 180, f1: 360, dur: 0.5, vol: 0.05 })
    },
    pillar() {
      if (!throttle('pillar', 0.1)) return
      noise({ dur: 0.3, vol: 0.12, f0: 6000, f1: 1500, type: 'highpass' })
      tone({ type: 'sine', f0: 2200, dur: 0.3, vol: 0.02 })
    },
    shock() {
      tone({ type: 'sine', f0: 95, f1: 38, dur: 0.5, vol: 0.2 })
      noise({ dur: 0.5, vol: 0.18, f0: 600, f1: 80 })
    },
  }

  return {
    unlock,
    playAll(events) {
      if (!ready()) return
      for (const ev of events) SOUNDS[ev.type]?.(ev)
    },
    ui() {
      if (ready()) tone({ type: 'triangle', f0: 720, f1: 900, dur: 0.06, vol: 0.035 })
    },
    get muted() {
      return muted
    },
    setMuted(m) {
      muted = !!m
      try {
        localStorage.setItem(KEY, muted ? '1' : '0')
      } catch {
        // fine
      }
      if (master) master.gain.value = muted ? 0 : 0.5
      if (!muted) unlock()
    },
    dispose() {
      ctx?.close()
      ctx = null
    },
  }
}
