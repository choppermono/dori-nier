import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  SRGBColorSpace,
} from 'three'

// Small shared pieces for the renderer: easing, colours brighter than white
// (so bloom picks them up), the soft glow sprite, and the material set every
// model in a world is built from.

export const ease = {
  inCubic: (t) => t * t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
}

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

// A colour pushed past 1.0. With tone mapping after bloom, only these glow.
export function hdr(hex, k = 1) {
  return new Color(hex).multiplyScalar(k)
}

export function makeGlowTexture(size = 128) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.12)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

// Frees geometries and materials under an object, skipping anything marked
// shared (cached geometry, the world's material set).
export function disposeTree(root) {
  root.traverse((obj) => {
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose()
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : []
    for (const m of mats) {
      if (m.userData.shared) continue
      for (const v of Object.values(m)) if (v && v.isTexture && !v.userData.shared) v.dispose()
      m.dispose()
    }
  })
}

// Every material an actor in one world uses. Built once per world and shared,
// so a hundred enemies cost a handful of materials.
export function themeMaterials(theme, glowTex) {
  const light = !!theme.light2
  const glowBlend = light ? NormalBlending : AdditiveBlending

  const hullColor = new Color(theme.enemy.hull)
  const plate = hullColor.clone().lerp(new Color('#8c8a86'), light ? 0.15 : 0.35)

  const m = {
    enemyHull: new MeshStandardMaterial({ color: hullColor, roughness: 0.38, metalness: 0.6, flatShading: true }),
    enemyPlate: new MeshStandardMaterial({ color: plate, roughness: 0.28, metalness: 0.85, flatShading: true, side: DoubleSide }),
    enemyTrim: new MeshStandardMaterial({
      color: theme.enemy.trim,
      emissive: theme.enemy.trim,
      emissiveIntensity: 1.7,
      roughness: 0.35,
      flatShading: true,
    }),
    enemyGlow: new MeshBasicMaterial({ color: hdr(theme.enemy.trim, 1.7), toneMapped: false }),
    enemyEdge: new LineBasicMaterial({ color: hdr(theme.enemy.trim, 1.15), toneMapped: false, transparent: true, opacity: 0.9 }),
    enemyGhost: new MeshStandardMaterial({
      color: hullColor,
      emissive: theme.enemy.trim,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.45,
      flatShading: true,
      depthWrite: false,
    }),
    shieldBubble: new MeshBasicMaterial({
      color: hdr(theme.enemy.trim, 1.2),
      transparent: true,
      opacity: light ? 0.35 : 0.22,
      wireframe: true,
      toneMapped: false,
      depthWrite: false,
    }),
    flash: new MeshBasicMaterial({ color: hdr('#ffffff', 1.6), toneMapped: false }),

    playerHull: new MeshStandardMaterial({
      color: theme.player.hull,
      roughness: 0.3,
      metalness: 0.2,
      flatShading: true,
      emissive: theme.player.hull,
      emissiveIntensity: light ? 0 : 0.14,
    }),
    playerTrim: new MeshBasicMaterial({ color: hdr(theme.player.trim, light ? 1 : 1.7), toneMapped: false }),
    playerEdge: new LineBasicMaterial({ color: light ? '#9a978f' : '#101010', transparent: true, opacity: 0.85 }),

    accentGlow: new MeshBasicMaterial({ color: hdr(theme.floor.accent, 1.6), toneMapped: false }),
    accentEdge: new LineBasicMaterial({ color: hdr(theme.floor.accent, 1.25), toneMapped: false, transparent: true, opacity: 0.9 }),

    glowEnemy: new MeshBasicMaterial({
      map: glowTex,
      color: hdr(theme.enemy.trim, light ? 0.9 : 1.4),
      transparent: true,
      opacity: light ? 0.35 : 0.55,
      blending: glowBlend,
      depthWrite: false,
      toneMapped: false,
    }),
    glowPlayer: new MeshBasicMaterial({
      map: glowTex,
      color: hdr(theme.player.trim, light ? 0.5 : 1.2),
      transparent: true,
      opacity: light ? 0.25 : 0.4,
      blending: glowBlend,
      depthWrite: false,
      toneMapped: false,
    }),
    glowAccent: new MeshBasicMaterial({
      map: glowTex,
      color: hdr(theme.floor.accent, light ? 0.9 : 1.5),
      transparent: true,
      opacity: light ? 0.3 : 0.5,
      blending: glowBlend,
      depthWrite: false,
      toneMapped: false,
    }),

    block: new MeshStandardMaterial({ color: theme.block.color, roughness: 0.62, metalness: 0.08, flatShading: true }),
    blockGloss: new MeshStandardMaterial({ color: theme.block.color, roughness: 0.18, metalness: 0.75, flatShading: true }),
    blockIce: new MeshStandardMaterial({
      color: theme.block.color,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
      emissive: theme.block.color,
      emissiveIntensity: 0.25,
      flatShading: true,
    }),
    blockEdge: new LineBasicMaterial({ color: theme.block.edge, transparent: true, opacity: 0.85 }),
    blockEdgeGlow: new LineBasicMaterial({ color: hdr(theme.block.edge, 1.35), toneMapped: false, transparent: true, opacity: 0.95 }),
    blockGlow: new MeshBasicMaterial({ color: hdr(theme.block.edge, 1.6), toneMapped: false }),
    crateFill: new MeshStandardMaterial({
      color: theme.floor.accent,
      emissive: theme.floor.accent,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: light ? 0.28 : 0.16,
      depthWrite: false,
      side: DoubleSide,
    }),
    crateCore: new MeshStandardMaterial({
      color: theme.floor.accent,
      emissive: theme.floor.accent,
      emissiveIntensity: 1.2,
      roughness: 0.4,
      flatShading: true,
    }),

    wall: new MeshStandardMaterial({ color: theme.wall.color, roughness: 0.55, metalness: 0.2, flatShading: true }),
    wallTrim: new MeshBasicMaterial({ color: hdr(theme.wall.trim, light ? 0.8 : 1.5), toneMapped: false }),

    // The reach of a Warden's shield, drawn on the floor.
    fieldRing: new MeshBasicMaterial({
      color: hdr(theme.enemy.trim, light ? 0.8 : 1.2),
      transparent: true,
      opacity: light ? 0.3 : 0.2,
      blending: glowBlend,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    }),
    coreBubble: new MeshBasicMaterial({
      color: hdr(theme.floor.accent, light ? 0.9 : 1.1),
      transparent: true,
      opacity: light ? 0.3 : 0.13,
      wireframe: true,
      depthWrite: false,
      toneMapped: false,
    }),
  }

  const list = Object.values(m)
  for (const mat of list) mat.userData.shared = true
  m.all = list
  m.light = light
  m.glowBlend = glowBlend
  // Extra materials a model needs only once per world, created on first use.
  m.extra = (key, make) => {
    if (!m[key]) {
      const mat = make()
      mat.userData.shared = true
      m[key] = mat
      list.push(mat)
    }
    return m[key]
  }
  m.dispose = () => list.forEach((mat) => mat.dispose())
  return m
}
