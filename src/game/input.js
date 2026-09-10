// Zwei Daumen gleichzeitig: jeder Finger wird ueber seine pointerId verfolgt, damit die
// beiden Sticks sich nicht gegenseitig ueberschreiben. Das ist der Teil, der bei
// Touch-Steuerungen am haeufigsten schiefgeht.

const STICK_RADIUS = 58

function emptyStick() {
  return {
    active: false,
    pointerId: null,
    originX: 0,
    originY: 0,
    knobX: 0,
    knobY: 0,
    radius: STICK_RADIUS,
    vx: 0,
    vy: 0,
  }
}

function updateStick(stick, x, y) {
  const dx = x - stick.originX
  const dy = y - stick.originY
  const dist = Math.hypot(dx, dy)

  if (dist > stick.radius) {
    // Knopf bleibt am Rand kleben, der Richtungsvektor bleibt auf Laenge 1.
    stick.knobX = stick.originX + (dx / dist) * stick.radius
    stick.knobY = stick.originY + (dy / dist) * stick.radius
    stick.vx = dx / dist
    stick.vy = dy / dist
  } else {
    stick.knobX = x
    stick.knobY = y
    stick.vx = dx / stick.radius
    stick.vy = dy / stick.radius
  }
}

function releaseStick(stick) {
  stick.active = false
  stick.pointerId = null
  stick.vx = 0
  stick.vy = 0
}

export function createInput(canvas, getPlayerPos) {
  const sticks = { move: emptyStick(), aim: emptyStick() }
  const keys = new Set()
  const mouse = { x: 0, y: 0, inside: false, down: false }
  let usingTouch = false

  const localPoint = (e) => {
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse') {
      mouse.down = true
      const p = localPoint(e)
      mouse.x = p.x
      mouse.y = p.y
      mouse.inside = true
      return
    }

    usingTouch = true
    const p = localPoint(e)
    const leftHalf = p.x < canvas.clientWidth / 2
    // Linke Bildschirmhaelfte steuert die Bewegung, rechte das Zielen. Der Stick
    // entsteht dort, wo der Daumen aufsetzt - nicht an einer festen Stelle.
    const stick = leftHalf ? sticks.move : sticks.aim
    if (stick.active) return

    stick.active = true
    stick.pointerId = e.pointerId
    stick.originX = p.x
    stick.originY = p.y
    stick.knobX = p.x
    stick.knobY = p.y
    stick.vx = 0
    stick.vy = 0
    canvas.setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e) {
    const p = localPoint(e)

    if (e.pointerType === 'mouse') {
      mouse.x = p.x
      mouse.y = p.y
      mouse.inside = true
      return
    }

    for (const stick of [sticks.move, sticks.aim]) {
      if (stick.active && stick.pointerId === e.pointerId) {
        updateStick(stick, p.x, p.y)
      }
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'mouse') {
      mouse.down = false
      return
    }
    for (const stick of [sticks.move, sticks.aim]) {
      if (stick.pointerId === e.pointerId) releaseStick(stick)
    }
  }

  function onKeyDown(e) {
    keys.add(e.key.toLowerCase())
  }
  function onKeyUp(e) {
    keys.delete(e.key.toLowerCase())
  }
  function onBlur() {
    keys.clear()
    mouse.down = false
    releaseStick(sticks.move)
    releaseStick(sticks.aim)
  }
  function onLeave() {
    mouse.inside = false
  }
  function onContextMenu(e) {
    e.preventDefault()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onLeave)
  canvas.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  return {
    sticks,

    // Wird einmal pro Bild gelesen und in den Zustand gefuettert.
    read() {
      const move = { x: sticks.move.vx, y: sticks.move.vy }
      const aim = { x: sticks.aim.vx, y: sticks.aim.vy, active: sticks.aim.active }

      if (!usingTouch) {
        // Tastatur und Maus am PC, damit man ohne Handy testen kann.
        let kx = 0
        let ky = 0
        if (keys.has('a') || keys.has('arrowleft')) kx -= 1
        if (keys.has('d') || keys.has('arrowright')) kx += 1
        if (keys.has('w') || keys.has('arrowup')) ky -= 1
        if (keys.has('s') || keys.has('arrowdown')) ky += 1
        if (kx !== 0 || ky !== 0) {
          const len = Math.hypot(kx, ky)
          move.x = kx / len
          move.y = ky / len
        }

        if (mouse.down && mouse.inside) {
          const p = getPlayerPos()
          const dx = mouse.x - p.x
          const dy = mouse.y - p.y
          const len = Math.hypot(dx, dy)
          if (len > 1) {
            aim.x = dx / len
            aim.y = dy / len
            aim.active = true
          }
        }
      }

      return { move, aim }
    },

    reset() {
      onBlur()
    },

    destroy() {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}
