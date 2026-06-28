<template>
  <div class="gas-leak-demo">
    <div ref="hostRef" class="scene-host" />

    <div class="controls">
      <h3>瓦斯泄漏 Demo</h3>

      <div class="process-actions">
        <button @click="startProcess">启动流程</button>
        <button @click="resetProcess">重置流程</button>
      </div>

      <div class="mode-switch">
        <label>
          <input v-model="mode" type="radio" value="raymarch" />
          Raymarch 体渲染
        </label>
        <label>
          <input v-model="mode" type="radio" value="particle" />
          粒子 + 灾害编排（可触发）
        </label>
      </div>

      <div v-if="mode === 'raymarch'" class="actions">
        <button @click="handleStartRaymarchLeak">手动补气</button>
        <button @click="handleResetRaymarch">重置瓦斯</button>
      </div>

      <div v-if="mode === 'particle'" class="actions">
        <button @click="startLeak">开始泄漏</button>
        <button @click="requestIgnition">手动点火</button>
        <button @click="triggerExplosion">直接爆炸</button>
        <button @click="resetSimulation">重置</button>
      </div>

      <div v-if="stateText" class="state">{{ stateText }}</div>
      <div class="hint">
        左键旋转 · 右键平移 · 滚轮缩放
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import * as THREE from 'three'
import {
  getScene,
  releaseScene,
  addFrameCallback,
  removeFrameCallback,
} from '@/utils/sceneManager.js'
import { buildMiningScene, updateCoalFall } from '@/components/gasLeakDemo/buildScene.js'
import { createTunnelRaymarchGas, updateRaymarchGas, startRaymarchLeak, resetRaymarchGas } from '@/components/gasLeakDemo/raymarchGas.js'
import { createParticleGasSystem, updateParticleGas, disposeParticleGas } from '@/components/gasLeakDemo/particleGas.js'
import { CoalFlameEffect } from '@/components/gasLeakDemo/flameEffect.js'
import { TunnelProcessController } from '@/components/gasLeakDemo/tunnelProcess.js'

const hostRef = ref(null)
const mode = ref('raymarch')
const stateText = ref('')

let sceneInstance = null
let scene = null
let camera = null
let renderer = null
let demoGroup = null
let raymarchMesh = null
let particleSystem = null
let flameEffect = null
let tunnelProcess = null
let lastElapsed = 0
let prevKeyLightShadow = false
const prevShakeOffset = new THREE.Vector3()

// 递归释放 group 及其所有子级的几何与材质（修复嵌套 group 资源泄漏）
function disposeObjectRecursive(root) {
  root.traverse((child) => {
    child.geometry?.dispose?.()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.filter(Boolean).forEach((m) => m.dispose?.())
  })
}

function setupScene() {
  sceneInstance = getScene(hostRef.value)
  scene = sceneInstance.scene
  camera = sceneInstance.camera
  renderer = sceneInstance.renderer

  // 设置背景与雾：入口方向较亮，模拟外部自然光
  scene.background = new THREE.Color('#c8d4e0')
  scene.fog = new THREE.Fog('#c8d4e0', 25, 140)

  // 压暗全局环境光，凸显矿灯局部照明与爆炸效果
  if (sceneInstance.lights?.ambient) sceneInstance.lights.ambient.intensity = 0.12
  if (sceneInstance.lights?.hemisphere) sceneInstance.lights.hemisphere.intensity = 0.18
  // 关闭主平行光阴影：阴影相机为室外大场景配置，对巷道内部无贡献却每帧重渲阴影图
  if (sceneInstance.lights?.key) {
    prevKeyLightShadow = sceneInstance.lights.key.castShadow
    sceneInstance.lights.key.castShadow = false
  }

  // 相机初始位置：在巷道内工作面一侧，面向采煤机与采空区
  camera.position.set(-30, 1.6, 3.5)
  camera.lookAt(8, 1.2, 0)
  if (sceneInstance.controls) {
    sceneInstance.controls.target.set(8, 1.2, 0)
    sceneInstance.controls.update()
  }

  demoGroup = new THREE.Group()
  demoGroup.name = 'gasLeakDemoGroup'
  sceneInstance.groups.root.add(demoGroup)

  const {
    sceneGroup,
    coalPieces,
    crackPositions,
    crackCenters,
    ignitionPosition,
    collisionMeshes,
    tunnelParams,
    machineGroup,
    drums,
    rockInstanced,
    rocks,
    coalUnitGeo,
    coalMat,
  } = buildMiningScene()
  demoGroup.add(sceneGroup)

  // 煤堆自燃火焰（从场景一开始就存在，作为点火源）
  flameEffect = new CoalFlameEffect({
    position: ignitionPosition,
    scene: demoGroup,
    intensity: 1.0,
    count: 100,
  })

  // 初始模式：raymarch（只用裂缝中心，减少 shader 循环开销）
  raymarchMesh = createTunnelRaymarchGas(crackCenters, tunnelParams)
  demoGroup.add(raymarchMesh)
  // 不再自动开始泄漏：由 TunnelProcessController 在采煤+填充完成后触发

  // 预创建粒子系统（先不激活，点击"开始泄漏"后才显示烟雾）
  particleSystem = createParticleGasSystem(crackPositions, collisionMeshes, demoGroup, {
    ignitionPosition,
  })
  particleSystem.smokeSystem.mesh.visible = false

  // 巷道采煤工艺流程控制器：采煤机左右截割 → 碎石填充 → 瓦斯渗出
  tunnelProcess = new TunnelProcessController({
    drums,
    machineGroup,
    rockInstanced,
    rocks,
    coalUnitGeo,
    coalMat,
    sceneGroup: demoGroup,
    onPhaseChange: handlePhaseChange,
  })

  addFrameCallback(tick)
}

function tick(elapsed) {
  const delta = elapsed - lastElapsed
  lastElapsed = elapsed

  // 撤回上一帧添加的摄像机抖动偏移，避免 OrbitControls 以抖动后的位置为基准导致漂移
  if (camera && prevShakeOffset.lengthSq() > 0) {
    camera.position.sub(prevShakeOffset)
    prevShakeOffset.set(0, 0, 0)
  }

  // 巷道工艺流程（采煤 → 填充 → 瓦斯）
  if (tunnelProcess) {
    tunnelProcess.update(Math.min(delta, 0.05))
  }

  // 落煤动画（环境煤尘）
  if (demoGroup) {
    const sceneGroup = demoGroup.getObjectByName('miningScene')
    if (sceneGroup) {
      const coalPieces = []
      sceneGroup.traverse((child) => {
        if (child.userData?.fallSpeed) coalPieces.push(child)
      })
      updateCoalFall(coalPieces, Math.min(delta, 0.05))
    }
  }

  if (mode.value === 'raymarch' && raymarchMesh) {
    updateRaymarchGas(raymarchMesh, elapsed, Math.min(delta, 0.05))
    if (raymarchMesh.userData?.leakActive) {
      const t = raymarchMesh.material.uniforms.uLeakTime?.value || 0
      stateText.value = `${tunnelProcess?.getPhaseText() || ''} | 瓦斯扩散 ${t.toFixed(1)}s`
    } else {
      stateText.value = tunnelProcess?.getPhaseText() || ''
    }
  }

  if (mode.value === 'particle' && particleSystem) {
    updateParticleGas(particleSystem, elapsed, Math.min(delta, 0.05))
    // 只有进入泄漏/点火/爆炸阶段后才显示烟雾
    const stage = particleSystem.controller.currentStage
    particleSystem.smokeSystem.mesh.visible = stage !== 'idle'
    const state = particleSystem.controller.getState()
    const phaseText = tunnelProcess?.getPhaseText() || ''
    stateText.value = stage !== 'idle'
      ? `${phaseText} | ${particleSystem.controller.getProcessStageText()} | 甲烷：${state.methanePercent.toFixed(2)}%`
      : phaseText
  }

  // 更新煤堆自燃火焰
  if (flameEffect) {
    flameEffect.update(Math.min(delta, 0.05), elapsed)
  }

  // 爆炸特效更新 + 摄像机抖动
  if (particleSystem?.explosionEffect) {
    particleSystem.explosionEffect.update(Math.min(delta, 0.05))
    const shake = particleSystem.explosionEffect.getShakeOffset()
    if (camera && shake.lengthSq() > 0) {
      camera.position.add(shake)
      prevShakeOffset.copy(shake)
    }
  }
}

function switchMode(newMode) {
  if (!raymarchMesh || !particleSystem) return
  if (newMode === 'raymarch') {
    raymarchMesh.visible = true
    particleSystem.smokeSystem.mesh.visible = false
    particleSystem.controller.reset()
    particleSystem.explosionEffect?.reset()
    // 切到 raymarch 时不自动开始泄漏，仅当流程已进入 leaking 阶段才恢复
    resetRaymarchGas(raymarchMesh)
    if (tunnelProcess?.phase === 'leaking') {
      startRaymarchLeak(raymarchMesh)
    }
    stateText.value = tunnelProcess?.getPhaseText() || ''
  } else {
    raymarchMesh.visible = false
    // 粒子烟雾是否显示由 controller 阶段决定
    particleSystem.smokeSystem.mesh.visible = particleSystem.controller.currentStage !== 'idle'
  }
}

// 流程阶段变更回调：进入 leaking 时激活对应模式的瓦斯系统
function handlePhaseChange(phase) {
  if (phase === 'leaking') {
    if (mode.value === 'raymarch' && raymarchMesh) {
      startRaymarchLeak(raymarchMesh)
    } else if (mode.value === 'particle' && particleSystem) {
      particleSystem.controller.start()
      particleSystem.smokeSystem.mesh.visible = true
    }
  } else if (phase === 'idle') {
    // 重置时关闭瓦斯
    if (raymarchMesh) resetRaymarchGas(raymarchMesh)
    if (particleSystem) {
      particleSystem.controller.reset()
      particleSystem.explosionEffect?.reset()
      particleSystem.smokeSystem.mesh.visible = false
    }
  }
}

function startProcess() {
  if (!tunnelProcess) return
  // 重置瓦斯状态，确保流程从头开始
  if (raymarchMesh) resetRaymarchGas(raymarchMesh)
  if (particleSystem) {
    particleSystem.controller.reset()
    particleSystem.explosionEffect?.reset()
    particleSystem.smokeSystem.mesh.visible = false
  }
  tunnelProcess.start()
}

function resetProcess() {
  if (!tunnelProcess) return
  tunnelProcess.reset()
  stateText.value = tunnelProcess.getPhaseText()
}

function startLeak() {
  if (mode.value !== 'particle' || !particleSystem) return
  particleSystem.controller.start()
  particleSystem.smokeSystem.mesh.visible = true
}

function handleStartRaymarchLeak() {
  if (mode.value !== 'raymarch' || !raymarchMesh) return
  startRaymarchLeak(raymarchMesh)
}

function handleResetRaymarch() {
  if (!raymarchMesh) return
  resetRaymarchGas(raymarchMesh)
  stateText.value = ''
}

function requestIgnition() {
  if (mode.value !== 'particle') return
  particleSystem.controller.requestManualIgnition()
}

function triggerExplosion() {
  if (mode.value !== 'particle') return
  particleSystem.controller.start()
  setTimeout(() => particleSystem.controller.ignite(), 800)
}

function resetSimulation() {
  if (!particleSystem) return
  particleSystem.controller.reset()
  particleSystem.explosionEffect?.reset()
  particleSystem.smokeSystem.mesh.visible = false
  stateText.value = ''
}

watch(mode, switchMode)

onMounted(() => {
  setupScene()
})

onBeforeUnmount(() => {
  removeFrameCallback(tick)
  if (tunnelProcess) {
    tunnelProcess.dispose()
    tunnelProcess = null
  }
  if (particleSystem) {
    disposeParticleGas(particleSystem)
    particleSystem = null
  }
  if (flameEffect) {
    flameEffect.dispose()
    flameEffect = null
  }
  if (demoGroup) {
    disposeObjectRecursive(demoGroup)
    demoGroup.parent?.remove(demoGroup)
    demoGroup = null
  }
  // 恢复全局环境光强度
  if (sceneInstance) {
    if (sceneInstance.lights?.ambient) sceneInstance.lights.ambient.intensity = 0.45
    if (sceneInstance.lights?.hemisphere) sceneInstance.lights.hemisphere.intensity = 0.65
    if (sceneInstance.lights?.key) sceneInstance.lights.key.castShadow = prevKeyLightShadow
    releaseScene()
    sceneInstance = null
    scene = null
    camera = null
    renderer = null
  }
})
</script>

<style scoped>
.gas-leak-demo {
  width: 100vw;
  height: 100vh;
  position: relative;
  overflow: hidden;
  background: #0a0f16;
}

.scene-host {
  width: 100%;
  height: 100%;
}

.controls {
  position: absolute;
  top: 16px;
  left: 16px;
  width: 320px;
  padding: 16px;
  border-radius: 8px;
  background: rgba(12, 18, 28, 0.88);
  border: 1px solid rgba(100, 180, 255, 0.2);
  color: #e6f0ff;
  font-size: 14px;
  backdrop-filter: blur(4px);
}

.controls h3 {
  margin: 0 0 12px;
  font-size: 16px;
  color: #7dd3fc;
}

.mode-switch {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.mode-switch label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.actions button {
  padding: 6px 12px;
  border: none;
  border-radius: 4px;
  background: #0ea5e9;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
}

.actions button:hover {
  background: #0284c7;
}

.actions button:active {
  background: #0369a1;
}

.process-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.process-actions button {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 4px;
  background: #f59e0b;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}

.process-actions button:hover {
  background: #d97706;
}

.process-actions button:nth-child(2) {
  background: #64748b;
}

.process-actions button:nth-child(2):hover {
  background: #475569;
}

.state {
  margin-bottom: 8px;
  padding: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  font-family: monospace;
  font-size: 12px;
  color: #a7f3d0;
}

.hint {
  font-size: 12px;
  color: #94a3b8;
}
</style>
