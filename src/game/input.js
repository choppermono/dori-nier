// Every way to steer the ship, merged into one { move, aim } per frame:
//
//   touch    two thumbs: left half of the screen moves, right half aims + fires.
//            Each finger is tracked by its pointerId, so the sticks never
//            overwrite each other.
//   keyboard WASD moves, arrow keys aim + fire.
//   mouse    the ship aims at the cursor, holding the button fires.
//   gamepad  left stick moves, right stick aims + fires.
//
// Whatever was used last wins, so a touchscreen laptop can switch freely.

const STICK_RADIUS = 60
const DEADZONE = 0.22

function emptyStick() {
  return { active: false, pointerId: null, originX: 0, originY: 0, knobX: 0, knobY: 0, radius: STICK_RADIUS, vx: 0, vy: 0 }
}

function updateStick(stick, x, y) {
  const dx = x - stick.originX
  const dy = y - stick.originY
  const d = Math.hypot(dx, dy)
  if (d > stick.radius) {
    stick.knobX = stick.originX + (dx / d) * stick.radius
    stick.knobY = stick.originY + (dy / d) * stick.radius
    stick.vx = dx / d
    stick.vy = dy / d
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

export function createInput(el, { toWorld, getPlayer }) {
  const sticks = { move: emptyStick(), aim: emptyStick() }
  const keys = new Set()
  const mouse = { x: 0, y: 0, inside: false, down: false }
  let mode = 'keys' // keys | touch | pad
  let padAim = { x: 0, y: -1 }

  const local = (e) => {
    const r = el.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e) {
    const p = local(e)
    if (e.pointerType === 'mouse') {
      mode = 'keys'
      mouse.down = e.button === 0 ? true : mouse.down
      mouse.x = p.x
      mouse.y = p.y
      mouse.inside = true
      return
    }
    mode = 'touch'
    // The stick appears where the thumb lands, not at a fixed spot.
    const stick = p.x < el.clientWidth / 2 ? sticks.move : sticks.aim
    if (stick.active) return
    stick.active = true
    stick.pointerId = e.pointerId
    stick.originX = p.x
    stick.originY = p.y
    stick.knobX = p.x
    stick.knobY = p.y
    stick.vx = 0
    stick.vy = 0
    el.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }

  function onPointerMove(e) {
    const p = local(e)
    if (e.pointerType === 'mouse') {
      mouse.x = p.x
      mouse.y = p.y
      mouse.inside = true
      if (mode !== 'keys' && (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)) mode = 'keys'
      return
    }
    for (const s of [sticks.move, sticks.aim]) {
      if (s.active && s.pointerId === e.pointerId) updateStick(s, p.x, p.y)
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) mouse.down = false
      return
    }
    for (const s of [sticks.move, sticks.aim]) if (s.pointerId === e.pointerId) releaseStick(s)
  }

  function onKeyDown(e) {
    const k = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k)
      mode = 'keys'
      if (k.startsWith('arrow')) e.preventDefault()
    }
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

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('contextmenu', onContextMenu)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  function readPad() {
    const pads = navigator.getGamepads?.() || []
    for (const pad of pads) {
      if (!pad || !pad.connected) continue
      const ax = pad.axes
      const mx = Math.abs(ax[0]) > DEADZONE ? ax[0] : 0
      const my = Math.abs(ax[1]) > DEADZONE ? ax[1] : 0
      const rx = Math.abs(ax[2] ?? 0) > DEADZONE ? ax[2] : 0
      const ry = Math.abs(ax[3] ?? 0) > DEADZONE ? ax[3] : 0
      const trigger = pad.buttons[7]?.pressed || pad.buttons[5]?.pressed
      const aimLen = Math.hypot(rx, ry)
      if (aimLen > 0.3) padAim = { x: rx / aimLen, y: ry / aimLen }
      const used = mx || my || aimLen > 0.3 || trigger
      if (used) mode = 'pad'
      if (mode !== 'pad') return null
      return {
        move: { x: mx, y: my },
        aim: { x: padAim.x, y: padAim.y, active: aimLen > 0.3 || !!trigger },
      }
    }
    return null
  }

  return {
    sticks,
    get mode() {
      return mode
    },

    read() {
      const pad = readPad()
      if (pad) return pad

      if (mode === 'touch') {
        return {
          move: { x: sticks.move.vx, y: sticks.move.vy },
          aim: { x: sticks.aim.vx, y: sticks.aim.vy, active: sticks.aim.active },
        }
      }

      const move = { x: 0, y: 0 }
      if (keys.has('a')) move.x -= 1
      if (keys.has('d')) move.x += 1
      if (keys.has('w')) move.y -= 1
      if (keys.has('s')) move.y += 1
      const ml = Math.hypot(move.x, move.y)
      if (ml > 0) {
        move.x /= ml
        move.y /= ml
      }

      const aim = { x: 0, y: 0, active: false }
      let kx = 0
      let ky = 0
      if (keys.has('arrowleft')) kx -= 1
      if (keys.has('arrowright')) kx += 1
      if (keys.has('arrowup')) ky -= 1
      if (keys.has('arrowdown')) ky += 1
      if (kx || ky) {
        const l = Math.hypot(kx, ky)
        aim.x = kx / l
        aim.y = ky / l
        aim.active = true
      } else if (mouse.inside) {
        const p = getPlayer()
        const w = p && toWorld(mouse.x, mouse.y)
        if (w) {
          const dx = w.x - p.x
          const dy = w.y - p.y
          const l = Math.hypot(dx, dy)
          if (l > 0.05) {
            aim.x = dx / l
            aim.y = dy / l
            aim.active = mouse.down
          }
        }
      }
      return { move, aim }
    },

    reset() {
      onBlur()
    },

    destroy() {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    },
  }
}
