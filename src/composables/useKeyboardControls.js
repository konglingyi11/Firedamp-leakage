import { onBeforeUnmount } from 'vue'
import * as THREE from 'three'

const DEFAULT_KEYS = {
  w: false,
  a: false,
  s: false,
  d: false,
  q: false,
  e: false,
  shift: false,
  f4: false,
}

const CAMERA_MOVE_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e'])

export function useKeyboardControls(options = {}) {
  const {
    getCamera,
    getControls,
    moveSpeed = 0.5,
    fastMoveSpeed = 1.5,
    shouldHandleKey = null,
    onSpecialKey = null,
  } = options

  const keysPressed = { ...DEFAULT_KEYS }

  function getCameraMoveAxes() {
    const camera = getCamera?.()
    if (!camera) {
      return { direction: new THREE.Vector3(), right: new THREE.Vector3() }
    }

    const direction = new THREE.Vector3()
    camera.getWorldDirection(direction)
    direction.z = 0
    direction.normalize()

    const right = new THREE.Vector3()
    right.crossVectors(direction, camera.up).normalize()

    return { direction, right }
  }

  function shouldHandleCameraKeyboard(event) {
    if (typeof shouldHandleKey === 'function') {
      return shouldHandleKey(event)
    }
    const target = event.target
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return false
    }
    return true
  }

  function onKeyDown(event) {
    if (!shouldHandleCameraKeyboard(event)) return

    if (event.key === 'Shift') {
      keysPressed.shift = true
    }

    const key = event.key.toLowerCase()

    if (typeof onSpecialKey === 'function') {
      const handled = onSpecialKey(key, event)
      if (handled) return
    }

    if (keysPressed.hasOwnProperty(key)) {
      keysPressed[key] = true
      if (CAMERA_MOVE_KEYS.has(key)) {
        event.preventDefault()
      }
    }
  }

  function onKeyUp(event) {
    if (event.key === 'Shift') {
      keysPressed.shift = false
    }

    const key = event.key.toLowerCase()
    if (keysPressed.hasOwnProperty(key)) {
      keysPressed[key] = false
    }
  }

  function updateCameraFromKeyboard() {
    const camera = getCamera?.()
    const controls = getControls?.()
    if (!camera || !controls) return

    const hasKeyPressed = Object.values(keysPressed).some((v) => v)
    if (!hasKeyPressed) return

    const { direction, right } = getCameraMoveAxes()

    const isFast = keysPressed.shift
    const speed = isFast ? fastMoveSpeed : moveSpeed

    const moveVector = new THREE.Vector3()

    if (keysPressed.w) {
      moveVector.add(direction.clone().multiplyScalar(speed))
    }
    if (keysPressed.s) {
      moveVector.add(direction.clone().multiplyScalar(-speed))
    }
    if (keysPressed.a) {
      moveVector.add(right.clone().multiplyScalar(-speed))
    }
    if (keysPressed.d) {
      moveVector.add(right.clone().multiplyScalar(speed))
    }
    if (keysPressed.q) {
      moveVector.add(camera.up.clone().multiplyScalar(speed))
    }
    if (keysPressed.e) {
      moveVector.add(camera.up.clone().multiplyScalar(-speed))
    }

    if (moveVector.lengthSq() > 0) {
      camera.position.add(moveVector)
      controls.target.add(moveVector)
      controls.update()
    }
  }

  function attachListeners() {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
  }

  function detachListeners() {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }

  onBeforeUnmount(() => {
    detachListeners()
  })

  return {
    keysPressed,
    CAMERA_MOVE_KEYS,
    updateCameraFromKeyboard,
    attachListeners,
    detachListeners,
    getCameraMoveAxes,
  }
}
