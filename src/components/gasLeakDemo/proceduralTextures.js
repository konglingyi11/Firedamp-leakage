import * as THREE from 'three'

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { canvas, ctx: canvas.getContext('2d') }
}

function makeTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

/**
 * 程序化石壁/混凝土纹理（带噪点和裂缝）
 */
export function createWallTexture() {
  const { canvas, ctx } = createCanvas(512, 512)
  ctx.fillStyle = '#555555'
  ctx.fillRect(0, 0, 512, 512)

  // 基础噪点
  for (let i = 0; i < 60000; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const gray = 60 + Math.random() * 60
    ctx.fillStyle = `rgba(${gray},${gray},${gray},0.15)`
    ctx.fillRect(x, y, 2, 2)
  }

  // 裂缝
  ctx.strokeStyle = 'rgba(30,30,30,0.25)'
  ctx.lineWidth = 1
  for (let i = 0; i < 30; i++) {
    ctx.beginPath()
    let x = Math.random() * 512
    let y = Math.random() * 512
    ctx.moveTo(x, y)
    for (let j = 0; j < 8; j++) {
      x += (Math.random() - 0.5) * 60
      y += (Math.random() - 0.5) * 60
      ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  return makeTexture(canvas)
}

/**
 * 程序化岩石纹理（灰褐色调，带颗粒感）
 */
export function createRockTexture() {
  const { canvas, ctx } = createCanvas(512, 512)
  ctx.fillStyle = '#6b6862'
  ctx.fillRect(0, 0, 512, 512)

  // 大面积色斑
  for (let i = 0; i < 120; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = 20 + Math.random() * 60
    const gray = 80 + Math.random() * 70
    ctx.fillStyle = `rgba(${gray * 0.9},${gray * 0.88},${gray * 0.82},0.25)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 颗粒噪点
  for (let i = 0; i < 80000; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const v = 70 + Math.random() * 80
    ctx.fillStyle = `rgba(${v},${v * 0.96},${v * 0.90},0.2)`
    ctx.fillRect(x, y, 2, 2)
  }

  return makeTexture(canvas)
}

/**
 * 程序化粗糙度贴图（岩石：高粗糙度，金属：低粗糙度）
 */
export function createRoughnessTexture(baseValue = 200) {
  const { canvas, ctx } = createCanvas(256, 256)
  ctx.fillStyle = `rgb(${baseValue},${baseValue},${baseValue})`
  ctx.fillRect(0, 0, 256, 256)

  for (let i = 0; i < 15000; i++) {
    const x = Math.random() * 256
    const y = Math.random() * 256
    const v = Math.max(0, Math.min(255, baseValue + (Math.random() - 0.5) * 80))
    ctx.fillStyle = `rgba(${v},${v},${v},0.3)`
    ctx.fillRect(x, y, 2, 2)
  }

  return makeTexture(canvas)
}

/**
 * 金属/生锈纹理，用于采煤机
 */
export function createMetalTexture() {
  const { canvas, ctx } = createCanvas(512, 512)
  ctx.fillStyle = '#8a8a8a'
  ctx.fillRect(0, 0, 512, 512)

  // 划痕
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const len = 20 + Math.random() * 80
    const angle = Math.random() * Math.PI
    ctx.strokeStyle = `rgba(${120 + Math.random() * 60},${120 + Math.random() * 60},${120 + Math.random() * 60},0.25)`
    ctx.lineWidth = 1 + Math.random() * 2
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }

  // 锈斑
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 512
    const y = Math.random() * 512
    const r = 10 + Math.random() * 30
    ctx.fillStyle = `rgba(${140 + Math.random() * 40},${90 + Math.random() * 30},${40 + Math.random() * 30},0.2)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  return makeTexture(canvas)
}

/**
 * 输送带纹理
 */
export function createBeltTexture() {
  const { canvas, ctx } = createCanvas(256, 64)
  ctx.fillStyle = '#1a1a1a'
  ctx.fillRect(0, 0, 256, 64)

  for (let i = 0; i < 256; i += 8) {
    ctx.fillStyle = `rgba(40,40,40,0.5)`
    ctx.fillRect(i, 0, 4, 64)
  }

  const texture = makeTexture(canvas)
  texture.repeat.set(8, 1)
  return texture
}
