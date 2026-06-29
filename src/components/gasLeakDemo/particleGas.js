import * as THREE from 'three'
import { SmokeSystem } from '@/utils/smokeSystem.js'
import {
  GasAccidentController,
  GasVisualAdapter,
  resolveSettings,
  ACCIDENT_SCENARIO_PRESET,
  triggerScreenFlash,
} from '@/utils/gasAccident'
import { ExplosionEffect } from '@/components/gasLeakDemo/explosionEffect.js'

/**
 * 创建更像“瓦斯”而非普通烟雾的粒子贴图：中心亮、边缘淡、带一点絮状。
 */
function createGasTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const cx = size / 2

  ctx.clearRect(0, 0, size, size)

  // 中心亮核（使用 source-over 确保 alpha 正确累加）
  const base = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx)
  base.addColorStop(0, 'rgba(255,255,255,0.55)')
  base.addColorStop(0.18, 'rgba(255,255,255,0.38)')
  base.addColorStop(0.42, 'rgba(255,255,255,0.18)')
  base.addColorStop(0.72, 'rgba(255,255,255,0.06)')
  base.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)

  // 叠加絮状细节
  ctx.globalCompositeOperation = 'source-over'
  for (let b = 0; b < 12; b++) {
    const bx = cx + (Math.random() - 0.5) * size * 0.45
    const by = cx + (Math.random() - 0.5) * size * 0.45
    const br = size * (0.16 + Math.random() * 0.24)
    const alpha = 0.10 + Math.random() * 0.12
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br)
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`)
    grad.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.4})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(bx, by, br, 0, Math.PI * 2)
    ctx.fill()
  }

  // 轻微噪点，避免边缘过于平滑
  const imageData = ctx.getImageData(0, 0, size, size)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 4) continue
    const n = (Math.random() - 0.5) * 14
    data[i] = Math.max(0, Math.min(255, data[i] + n))
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + n))
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + n))
  }
  ctx.putImageData(imageData, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.needsUpdate = true
  return texture
}

export function createParticleGasSystem(crackPositions, collisionMeshes, parentGroup, options = {}) {
  const texture = createGasTexture()

  // 以所有缝隙的平均位置作为 emitter 中心
  const center = new THREE.Vector3()
  crackPositions.forEach((p) => center.add(p))
  center.divideScalar(Math.max(1, crackPositions.length))

  // 每个缝隙对应一个表面种子，方向：主要朝巷道入口（-X）并向上渗出
  const surfaceSeeds = crackPositions.map((p, idx) => {
    const angle = (idx / Math.max(1, crackPositions.length)) * Math.PI * 2
    return {
      x: p.x + (Math.random() - 0.5) * 0.12,
      y: p.y + (Math.random() - 0.5) * 0.12,
      z: p.z + (Math.random() - 0.5) * 0.12,
      // 朝入口 -X 为主，略带向上和 Z 向扩散
      nx: -0.72 + (Math.random() - 0.5) * 0.22,
      ny: 0.42 + Math.random() * 0.28,
      nz: Math.sin(angle) * 0.25 + (Math.random() - 0.5) * 0.18,
    }
  })

  // 速度场：让瓦斯整体向巷道入口快速漂移并明显上升
  const velocityField = {
    worldScale: 10,
    strength: 1.2,
    stride: 2,
    sample: (pos) => {
      // pos 是归一化场坐标 (x,y,z)
      // 高度越高浮力越强，瓦斯在上部积聚更显著
      // SmokeSystem 内部语义：vy = 向上轴（世界 Z），vx/vz = 水平轴
      return {
        vx: -0.55 + pos[1] * 0.15,
        vy: 0.25 + pos[0] * 0.10 + Math.max(0.0, pos[1]) * 0.15,
        vz: Math.sin(pos[0] * 3.0) * 0.08,
        speed: 1.0,
      }
    },
  }

  const smokeSystem = new SmokeSystem(
    1400,
    texture,
    parentGroup,
    {
      // Demo 场景同样使用 Z 轴竖直向上
      upAxis: [0, 0, 1],
      size: 3.6,
      speed: 1.05,
      range: 1.0,
      swirl: 1.1,
      density: 1.65,
      maxLifetime: 16,
      emitter: {
        position: [center.x, center.y, center.z],
        radius: 1.0,
        heightJitter: 0.25,
        surfaceSeeds,
      },
      color: {
        scatter: [0.82, 0.92, 0.86],
        absorb: [0.42, 0.62, 0.52],
        particle: [0.72, 0.86, 0.78],
      },
      collision: {
        meshes: collisionMeshes,
        radius: 0.10,
        probeDistance: 0.16,
        maxCandidates: 14,
        restitution: 0.04,
        slide: 0.88,
        stride: 3,
        blockNormalVelocity: true,
      },
      velocityField,
    },
  )

  const ignitionPosition = options.ignitionPosition
    ? options.ignitionPosition.clone()
    : new THREE.Vector3(-5.5, 0.5, 0)

  // 3D 爆炸特效（火球 + 冲击波 + 闪光灯 + 余烬 + 烟柱 + 摄像机抖动）
  const explosionEffect = new ExplosionEffect({
    position: ignitionPosition,
    scene: parentGroup,
    cameraShakeIntensity: 0.75,
    cameraShakeDuration: 2.0,
  })

  const settings = resolveSettings({
    ...ACCIDENT_SCENARIO_PRESET,
    gasColor: '#7ecfb0',
    gasOpacity: 0.38,
    gasDiffuseOpacity: 0.18,
    gasJetSpeed: 0.55,
    gasParticleCount: 1200,
    leakRatePercent: 0.42,
    ventilationScenario: 'weak',
    // 自动点火：瓦斯积聚到爆炸范围后，在煤堆火焰处自燃爆炸
    allowTimedIgnition: true,
    ignitionDelay: 22,
    minIgnitionDelay: 8,
    sparkDuration: 1.4,
    explosionIntensity: 1.4,
    manualIgnitionWindow: 20,
  })

  // 改用叠加混合，让瓦斯在暗巷道中更醒目
  smokeSystem.material.blending = THREE.AdditiveBlending

  const visualAdapter = new GasVisualAdapter({
    visuals: [{
      smoke: smokeSystem,
      diffuseSmoke: smokeSystem,
      setConcentration(v) {
        smokeSystem.setRuntimeParams({ density: 1.2 + v * 1.8 })
      },
      setColor(c) {},
      setDensity(v) {
        smokeSystem.setRuntimeParams({ density: v })
      },
      setSparking() {},
      applyVisualOverrides() {},
    }],
    getSettings: () => settings,
  })

  const sources = crackPositions.slice(0, 6).map((p) => ({
    position: p.clone(),
    type: 'goaf',
    emissionFactor: 1.0,
    height: p.y,
  }))

  const controller = new GasAccidentController({
    settings,
    sources,
    visualAdapter,
    ignitionSourceProvider: () => {
      // 点火源：煤堆自燃火焰位置
      return ignitionPosition
    },
    on: {
      stageChange(stage) {
        console.log('[瓦斯灾害] 阶段:', stage)
      },
      safetyAlarm(level, alarm) {
        console.log('[瓦斯灾害] 报警:', level, alarm.text)
      },
      ignition({ index }) {
        console.log('[瓦斯灾害] 点火源:', index)
      },
      explosion({ intensity }) {
        console.log('[瓦斯灾害] 爆炸强度:', intensity)
        triggerScreenFlash({ intensity, durationMs: 180, fadeMs: 420 })
        explosionEffect.trigger({ position: ignitionPosition, intensity })
      },
      secondaryBlast({ ready, reason }) {
        console.log('[瓦斯灾害] 二次爆炸:', ready, reason)
      },
    },
  })

  controller.setSparkScene(parentGroup)

  return { smokeSystem, controller, settings, explosionEffect }
}

export function updateParticleGas({ smokeSystem, controller }, elapsed, delta) {
  if (smokeSystem) {
    smokeSystem.uniforms.uTime.value = elapsed
    smokeSystem.update(elapsed, Math.min(delta, 0.05))
  }
  if (controller && controller.currentStage !== 'idle') {
    controller.update(delta)
  }
}

export function disposeParticleGas({ smokeSystem, controller, explosionEffect }) {
  smokeSystem?.mesh?.geometry?.dispose()
  smokeSystem?.mesh?.material?.dispose()
  if (smokeSystem?.mesh?.parent) smokeSystem.mesh.parent.remove(smokeSystem.mesh)
  controller?.reset()
  explosionEffect?.dispose()
}
