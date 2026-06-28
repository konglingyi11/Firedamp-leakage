import * as THREE from 'three'
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { gasNameMap } from '@/constants/gasVariables'
import { formatBoundaryTemperatureKelvinDisplay } from '@/utils/boundaryTemperature.js'

const BOUNDARY_TYPE_LABELS = {
  'velocity-inlet': '速度入口',
  'pressure-outlet': '压力出口',
  'mass-flow-inlet': '质量流量入口',
  wall: '壁面',
  symmetry: '对称边界',
  outlet: '出口',
  inlet: '入口',
}

const RADAR_MATERIAL_PRESETS = [
  { name: '木板', er: '2.2', sigma: '0.01' },
  { name: '砖墙', er: '4.5', sigma: '0.05' },
  { name: '混凝土', er: '7.0', sigma: '0.015' },
  { name: '金属物', er: '∞', sigma: '＞10⁶' },
]

export function createInfoPopups({
  getScene,
  ensureCss2dRenderer,
  addFrameCallback,
  removeFrameCallback,
  getModelMeshMaterialName,
  getGeometryMeshSelectionName,
  findBoundaryConditionForMesh,
  hideGeometryMesh,
  clearGeometryModelSelection,
  getRadarMaterialBindings,
  getShowRadarMaterialInfo,
}) {
  // 信息弹窗状态变量
  let personInfoCSS2DObject = null
  /** 人物信息锚点所跟随的 GLTF 根（标签挂 scene，每帧用此模型几何刷新世界坐标） */
  let personInfoAnchorTargetModel = null
  let geometryInfoCSS2DObject = null
  let geometryInfoAnchorTargetMesh = null

  // 复用的临时对象，避免每帧分配
  const personInfoBoxScratch = new THREE.Box3()
  const personInfoMeshBoxScratch = new THREE.Box3()
  const personInfoSizeScratch = new THREE.Vector3()
  const personInfoCenterScratch = new THREE.Vector3()
  const geometryInfoBoxScratch = new THREE.Box3()
  const geometryInfoSizeScratch = new THREE.Vector3()
  const geometryInfoCenterScratch = new THREE.Vector3()

  function formatPersonInfoCoords(info) {
    const x = Number(info?.x)
    const y = Number(info?.y)
    const z = Number(info?.z)
    if ([x, y, z].every(Number.isFinite)) {
      return `${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}`
    }
    return ''
  }

  function disposePersonInfoPopup() {
    removeFrameCallback(syncPersonInfoPopupAnchorFrame)
    personInfoAnchorTargetModel = null
    if (!personInfoCSS2DObject) return
    personInfoCSS2DObject.removeFromParent()
    const el = personInfoCSS2DObject.element
    el?.parentNode?.removeChild(el)
    personInfoCSS2DObject = null
  }

  function computePersonModelMeshWorldBox(model, targetBox) {
    targetBox.makeEmpty()
    let filled = false
    model.updateMatrixWorld(true)
    model.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      personInfoMeshBoxScratch.setFromObject(o)
      if (!filled) {
        targetBox.copy(personInfoMeshBoxScratch)
        filled = true
      } else {
        targetBox.union(personInfoMeshBoxScratch)
      }
    })
    if (!filled) {
      targetBox.setFromObject(model)
    }
    return targetBox
  }

  function personInfoPopupLiftWorld(box) {
    const size = box.getSize(personInfoSizeScratch)
    const verticalExtent = Math.max(size.x, size.y, size.z, 1e-6)
    return verticalExtent * 0.34 + 0.08
  }

  function applyPersonInfoLabelWorldPosition(label, model) {
    if (!label || !model || !getScene()) return
    computePersonModelMeshWorldBox(model, personInfoBoxScratch)
    const lift = personInfoPopupLiftWorld(personInfoBoxScratch)
    const boxCenter = personInfoBoxScratch.getCenter(personInfoCenterScratch)
    label.position.set(
      boxCenter.x,
      personInfoBoxScratch.max.y + lift,
      boxCenter.z,
    )
  }

  function syncPersonInfoPopupAnchorFrame() {
    if (!personInfoCSS2DObject || !personInfoAnchorTargetModel) return
    applyPersonInfoLabelWorldPosition(
      personInfoCSS2DObject,
      personInfoAnchorTargetModel,
    )
  }

  function createPersonInfoPopup(model, info) {
    disposePersonInfoPopup()
    if (!model || !info) return
    ensureCss2dRenderer()
    const scene = getScene()
    if (!scene) return

    const root = document.createElement('div')
    root.className = 'person-scan-info-popup'
    root.style.pointerEvents = 'auto'

    const header = document.createElement('div')
    header.className = 'person-scan-info-popup__header'

    const title = document.createElement('span')
    title.className = 'person-scan-info-popup__name'
    title.textContent = info.name || '监测目标'

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'person-scan-info-popup__close'
    closeBtn.setAttribute('aria-label', '关闭')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      disposePersonInfoPopup()
    })

    header.appendChild(title)
    header.appendChild(closeBtn)

    const body = document.createElement('div')
    body.className = 'person-scan-info-popup__body'

    const loc =
      (typeof info.location === 'string' && info.location.trim()) ||
      formatPersonInfoCoords(info)
    const rows = [
      ['位置', loc || null],
      ['状态', info.status],
      ['心率', info.heartRate != null ? `${info.heartRate} bpm` : null],
      ['呼吸', info.breathRate != null ? `${info.breathRate} bpm` : null],
      ['置信度', info.confidence != null ? `${info.confidence}%` : null],
    ]
    for (const [k, v] of rows) {
      if (v == null || v === '') continue
      const row = document.createElement('div')
      row.className = 'person-scan-info-popup__row'
      const dt = document.createElement('span')
      dt.className = 'person-scan-info-popup__k'
      dt.textContent = k
      const dd = document.createElement('span')
      dd.className = 'person-scan-info-popup__v'
      dd.textContent = String(v)
      row.appendChild(dt)
      row.appendChild(dd)
      body.appendChild(row)
    }

    root.appendChild(header)
    root.appendChild(body)

    const label = new CSS2DObject(root)
    label.name = '__personScanInfoLabel'
    // 锚定在 DOM 底边中点：世界坐标落在目标上方，弹窗继续向上延展，避免挡住识别目标。
    label.center.set(0.5, 1)

    // 标签挂在 scene 上并按帧刷新世界坐标，避免父节点矩阵/层级导致与 WebGL 投影不一致（绕视野转动时错位）
    personInfoAnchorTargetModel = model
    applyPersonInfoLabelWorldPosition(label, model)
    scene.add(label)
    addFrameCallback(syncPersonInfoPopupAnchorFrame)
    personInfoCSS2DObject = label
  }

  function formatBoundaryTypeLabel(type) {
    const raw = String(type || '').trim()
    return BOUNDARY_TYPE_LABELS[raw] || raw
  }

  function formatSpeciesFractionName(key) {
    const raw = String(key || '').trim()
    const normalized = raw.toLowerCase().replace(/^mass_fraction_of_/, '')
    const gasInfo = gasNameMap[`Mass_fraction_of_${normalized}`]
    if (gasInfo) return `${gasInfo.zh} (${gasInfo.en})`
    return raw
  }

  function formatBoundaryNumber(value) {
    const number = Number(value)
    if (!Number.isFinite(number)) return String(value)
    if (number === 0) return '0'
    if (Math.abs(number) < 0.000001) return number.toExponential(2)
    return String(Number(number.toPrecision(6)))
  }

  function formatSpeciesFractions(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const entries = Object.entries(value)
      .map(([key, fraction]) => ({
        key,
        name: formatSpeciesFractionName(key),
        value: Number(fraction),
      }))
      .filter((item) => Number.isFinite(item.value))
    const activeItems = entries
      .filter((item) => item.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    return {
      kind: 'speciesFractions',
      items: activeItems.map((item) => ({
        ...item,
        displayValue: formatBoundaryNumber(item.value),
      })),
      zeroCount: entries.length - activeItems.length,
    }
  }

  function formatBoundaryValue(key, value) {
    if (key === 'type') {
      return formatBoundaryTypeLabel(value)
    }
    if (key === 'species_fractions') {
      return formatSpeciesFractions(value)
    }
    if (key === 'temperature') {
      return formatBoundaryTemperatureKelvinDisplay(value)
    }
    if (Array.isArray(value)) return value.join(', ')
    if (value && typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  function getBoundaryFieldLabel(key) {
    const labels = {
      name: '名称',
      type: '类型',
      temperature: '温度 (°C)',
      velocity: '速度',
      pressure: '压力',
      pressure_value: '压力',
      mass_flow_rate: '质量流量',
      heat_flux: '热通量',
      species_fractions: '组分分数',
      velocity_x: 'X 方向速度',
      velocity_y: 'Y 方向速度',
      velocity_z: 'Z 方向速度',
    }
    return labels[key] || key
  }

  function buildBoundaryPopupRows(boundaryCondition) {
    if (!boundaryCondition || typeof boundaryCondition !== 'object') return []
    return Object.entries(boundaryCondition)
      .filter(([key, value]) => key !== 'name' && value != null && value !== '')
      .map(([key, value]) => ({
        key,
        label: getBoundaryFieldLabel(key),
        value: formatBoundaryValue(key, value),
      }))
  }

  function normalizeRadarMaterialToken(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^mat[_-]/, '')
  }

  function findRadarMaterialPreset(name) {
    const normalized = normalizeRadarMaterialToken(name)
    return (
      RADAR_MATERIAL_PRESETS.find(
        (item) => normalizeRadarMaterialToken(item.name) === normalized,
      ) || null
    )
  }

  function inferRadarMaterialPreset(mesh, boundaryCondition = null) {
    const text = [
      mesh?.userData?.geometrySelectionName,
      mesh?.name,
      mesh?.parent?.name,
      mesh?.geometry?.name,
      mesh?.userData?.geometryMaterialName,
      getModelMeshMaterialName(mesh),
      boundaryCondition?.type,
      boundaryCondition?.name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    if (/pressure-outlet|velocity-inlet|mass-flow-inlet|outlet|inlet|vent/.test(text)) {
      return null
    }
    if (/metal|steel|iron|金属/.test(text)) return findRadarMaterialPreset('金属物')
    if (/wood|timber|board|木/.test(text)) return findRadarMaterialPreset('木板')
    if (/brick|砖/.test(text)) return findRadarMaterialPreset('砖墙')
    if (/shell|wall|ground|concrete|outer|混凝土|墙/.test(text)) {
      return findRadarMaterialPreset('混凝土')
    }
    return null
  }

  function findRadarMaterialBindingForMesh(mesh) {
    const bindings = Array.isArray(getRadarMaterialBindings())
      ? getRadarMaterialBindings()
      : []
    if (bindings.length === 0) return null

    const candidates = [
      mesh?.userData?.geometrySelectionName,
      mesh?.name,
      mesh?.parent?.name,
      mesh?.geometry?.name,
      mesh?.userData?.geometryMaterialName,
      getModelMeshMaterialName(mesh),
    ]
      .map(normalizeRadarMaterialToken)
      .filter(Boolean)

    return (
      bindings.find((item) =>
        candidates.includes(normalizeRadarMaterialToken(item?.partName)),
      ) || null
    )
  }

  function buildRadarMaterialPopupRows(mesh) {
    if (!getShowRadarMaterialInfo() || !mesh) return []

    const boundaryCondition = findBoundaryConditionForMesh(mesh)
    const binding = findRadarMaterialBindingForMesh(mesh)
    const preset =
      findRadarMaterialPreset(binding?.materialName) ||
      inferRadarMaterialPreset(mesh, boundaryCondition)
    if (!binding && !preset) return []

    const materialName = binding?.materialName || preset.name
    const sigmaText = String(binding?.sigma || preset.sigma || '')
    return [
      {
        key: 'radar-material-source',
        label: '雷达材料',
        value: binding ? '已绑定参数' : '自动识别',
        section: true,
      },
      {
        key: 'radar-material-name',
        label: '材料',
        value: materialName,
      },
      {
        key: 'radar-material-er',
        label: '相对介电常数 εr',
        value: binding?.er || preset.er,
      },
      {
        key: 'radar-material-sigma',
        label: '电导率 σ',
        value: /s\/m|＞|∞/.test(sigmaText) ? sigmaText : `${sigmaText} S/m`,
      },
    ]
  }

  function disposeGeometryInfoPopup() {
    removeFrameCallback(syncGeometryInfoPopupAnchorFrame)
    geometryInfoAnchorTargetMesh = null
    if (!geometryInfoCSS2DObject) return
    geometryInfoCSS2DObject.removeFromParent()
    const el = geometryInfoCSS2DObject.element
    el?.parentNode?.removeChild(el)
    geometryInfoCSS2DObject = null
  }

  function applyGeometryInfoLabelWorldPosition(label, mesh) {
    if (!label || !mesh || !getScene()) return
    mesh.updateWorldMatrix(true, false)
    geometryInfoBoxScratch.setFromObject(mesh)
    const size = geometryInfoBoxScratch.getSize(geometryInfoSizeScratch)
    const lift = Math.max(size.x, size.y, size.z, 1e-6) * 0.18 + 0.03
    const center = geometryInfoBoxScratch.getCenter(geometryInfoCenterScratch)
    label.position.set(center.x, center.y, geometryInfoBoxScratch.max.z + lift)
  }

  function syncGeometryInfoPopupAnchorFrame() {
    if (!geometryInfoCSS2DObject || !geometryInfoAnchorTargetMesh) return
    applyGeometryInfoLabelWorldPosition(
      geometryInfoCSS2DObject,
      geometryInfoAnchorTargetMesh,
    )
  }

  function createGeometryInfoPopup(mesh) {
    disposeGeometryInfoPopup()
    if (!mesh) return
    ensureCss2dRenderer()
    const scene = getScene()
    if (!scene) return

    const fallbackName =
      mesh.userData.geometrySelectionName || getGeometryMeshSelectionName(mesh)
    const boundaryCondition = findBoundaryConditionForMesh(mesh)
    const titleText = boundaryCondition?.name || fallbackName || '几何面'

    const root = document.createElement('div')
    root.className = 'geometry-selection-popup'
    root.style.pointerEvents = 'auto'

    const header = document.createElement('div')
    header.className = 'geometry-selection-popup__header'

    const title = document.createElement('span')
    title.className = 'geometry-selection-popup__name'
    title.textContent = titleText

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'geometry-selection-popup__close'
    closeBtn.setAttribute('aria-label', '关闭')
    closeBtn.textContent = '×'
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      clearGeometryModelSelection()
    })

    header.appendChild(title)
    header.appendChild(closeBtn)

    const hideBtn = document.createElement('button')
    hideBtn.type = 'button'
    hideBtn.className = 'geometry-selection-popup__hide'
    hideBtn.textContent = '隐藏'
    hideBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      hideGeometryMesh(mesh)
    })

    const body = document.createElement('div')
    body.className = 'geometry-selection-popup__body'
    const radarRows = buildRadarMaterialPopupRows(mesh)
    const rows = buildBoundaryPopupRows(boundaryCondition)
    for (const rowData of rows) {
      const { label: k, value: v } = rowData
      if (v == null || v === '') continue
      const row = document.createElement('div')
      row.className = 'geometry-selection-popup__row'
      const dt = document.createElement('span')
      dt.className = 'geometry-selection-popup__k'
      dt.textContent = k
      const dd = document.createElement('span')
      dd.className = 'geometry-selection-popup__v'
      if (v?.kind === 'speciesFractions') {
        row.classList.add('geometry-selection-popup__row--stacked')
        dd.classList.add('geometry-selection-popup__v--species')
        if (v.items.length > 0) {
          const list = document.createElement('span')
          list.className = 'geometry-selection-popup__species-list'
          v.items.forEach((item) => {
            const entry = document.createElement('span')
            entry.className = 'geometry-selection-popup__species-item'
            const name = document.createElement('span')
            name.className = 'geometry-selection-popup__species-name'
            name.textContent = item.name
            const value = document.createElement('strong')
            value.textContent = item.displayValue
            entry.appendChild(name)
            entry.appendChild(value)
            list.appendChild(entry)
          })
          dd.appendChild(list)
        } else {
          dd.textContent = '全部为 0'
        }
        if (v.zeroCount > 0 && v.items.length > 0) {
          const note = document.createElement('span')
          note.className = 'geometry-selection-popup__species-note'
          note.textContent = `其余 ${v.zeroCount} 项为 0`
          dd.appendChild(note)
        }
      } else {
        dd.textContent = String(v)
      }
      row.appendChild(dt)
      row.appendChild(dd)
      body.appendChild(row)
    }
    if (radarRows.length > 0) {
      const section = document.createElement('div')
      section.className = 'geometry-selection-popup__section'
      const sectionTitle = document.createElement('div')
      sectionTitle.className = 'geometry-selection-popup__section-title'
      sectionTitle.textContent = '雷达材料'
      section.appendChild(sectionTitle)

      radarRows.forEach((rowData) => {
        const { label: k, value: v, section: isSectionRow } = rowData
        if (v == null || v === '') return
        const row = document.createElement('div')
        row.className = 'geometry-selection-popup__row'
        if (isSectionRow) row.classList.add('geometry-selection-popup__row--section')
        const dt = document.createElement('span')
        dt.className = 'geometry-selection-popup__k'
        dt.textContent = k
        const dd = document.createElement('span')
        dd.className = 'geometry-selection-popup__v'
        dd.textContent = String(v)
        row.appendChild(dt)
        row.appendChild(dd)
        section.appendChild(row)
      })
      body.appendChild(section)
    }
    if (
      boundaryCondition &&
      rows.length === 1 &&
      rows[0]?.label === getBoundaryFieldLabel('type')
    ) {
      const row = document.createElement('div')
      row.className = 'geometry-selection-popup__empty'
      row.textContent = '暂无更多边界参数'
      body.appendChild(row)
    }
    if (rows.length === 0) {
      const row = document.createElement('div')
      row.className = 'geometry-selection-popup__empty'
      row.textContent = boundaryCondition
        ? '暂无边界条件详情'
        : '未匹配到边界条件'
      body.appendChild(row)
    }

    root.appendChild(header)
    root.appendChild(body)
    root.appendChild(hideBtn)

    const label = new CSS2DObject(root)
    label.name = '__geometrySelectionInfoLabel'
    label.center.set(0.5, 0)
    geometryInfoAnchorTargetMesh = mesh
    applyGeometryInfoLabelWorldPosition(label, mesh)
    scene.add(label)
    addFrameCallback(syncGeometryInfoPopupAnchorFrame)
    geometryInfoCSS2DObject = label
  }

  return {
    createPersonInfoPopup,
    disposePersonInfoPopup,
    createGeometryInfoPopup,
    disposeGeometryInfoPopup,
  }
}
