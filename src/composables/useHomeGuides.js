import { nextTick, ref } from 'vue'
import { ElMessage } from 'element-plus'

const TASK_GUIDE_STORAGE_KEY = 'task_manage_tour_done_v1'
const VIZ_GUIDE_STORAGE_KEY = 'viz_tour_done_v1'
const STATS_GUIDE_STORAGE_KEY = 'stats_tour_done_v1'

function resolveGuideTarget(selector) {
  const el = document.querySelector(selector)
  if (!el) {
    console.warn(`[Guide] Target not found: ${selector}, falling back to body`)
  }
  return el || document.body
}

const guideContentStyle = {
  width: '23rem',
}

const guideDialogContentStyle = {
  width: '19rem',
}

const taskGuideSteps = [
  {
    title: '第一步：模型选择',
    description: '先在模型选择界面选择一个模型。',
    placement: 'bottom',
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.model-guide-header'),
  },
  {
    title: '第二步：选择模型卡片',
    description: '点击模型卡片后，可以继续创建任务。',
    placement: 'right',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.model-card--guide-first'),
  },
  {
    title: '第三步：创建任务',
    description: '选中模型后，点击这里创建一个新的任务。',
    placement: 'top',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.create-task-btn'),
  },
  {
    title: '第四步：参数设置',
    description:
      '创建任务后，会进入参数设置页，在这里确认环境参数和预生成配置。',
    placement: 'right',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.parameter-settings'),
  },
  {
    title: '第五步：开始分析',
    description: '参数确认后，点击开始分析，任务会进入执行流程。',
    placement: 'top',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.task-guide-start-analysis'),
  },
  {
    title: '第六步：任务管理入口',
    description: '这里是任务管理入口，后续随时可返回查看任务状态。',
    placement: 'bottom',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.nav-btn-tasks'),
  },
  {
    title: '第七步：任务列表',
    description: '在任务列表中查看状态、选择当前任务，或打开任务详情。',
    placement: 'right',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.task-list-container'),
  },
  {
    title: '第八步：任务卡片',
    description: '每个任务卡片都会显示名称、状态、时间和当前进度。',
    placement: 'right',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.task-item--guide-first'),
  },
  {
    title: '第九步：启动任务',
    description: '未开始或已停止的任务，可以在这里直接开始或重新启动。',
    placement: 'right',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '完成' },
    target: () => resolveGuideTarget('.task-run-btn--guide-first'),
  },
]

const vizGuideSteps = [
  {
    title: '第一步：进入可视化',
    description: '在左侧导航栏点击「可视化操作」进入可视化设置页面。',
    placement: 'right',
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.nav-btn-visualization'),
  },
  {
    title: '第二步：选择可视化类型',
    description:
      '选择要显示的可视化类型：云图（二维颜色渐变）、矢量图（二维箭头流场）、体渲染（三维体积显示）或流线图（三维流动轨迹）。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.viz-guide-type-cards'),
  },
  {
    title: '第三步：选择切片平面（2D）',
    description:
      '对于二维可视化，选择切片平面：XY（水平平面）、XZ（正面平面）或 YZ（侧面平面）。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.viz-guide-plane-cards'),
  },
  {
    title: '第四步：设置平面坐标',
    description: '调整切片平面的坐标位置，精确控制要显示的截面位置。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.viz-guide-coordinate'),
  },
  {
    title: '第五步：显示设置',
    description:
      '配置显示参数，包括色图方案、画质预设、数值范围等。不同可视化类型有不同的专属设置。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.viz-guide-display-settings'),
  },
  {
    title: '第六步：预览信息',
    description:
      '查看当前可视化配置的预览信息，包括可视化类型、切片平面、坐标位置和数值范围。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.viz-guide-preview-info'),
  },
  {
    title: '第七步：应用设置',
    description: '配置完成后，点击「应用设置」按钮生成可视化结果。',
    placement: 'top',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.viz-guide-apply-btn'),
  },
  {
    title: '第八步：时间轴控制',
    description:
      '使用时间轴可以播放、暂停动画，或拖动滑块查看不同时间步的可视化结果。',
    placement: 'top',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '完成' },
    target: () => document.body,
  },
]

const statsGuideSteps = [
  {
    title: '第一步：进入数据统计',
    description:
      '先在「任务列表」选中当前任务，再点击顶部导航栏「数据统计」打开侧栏。',
    placement: 'bottom',
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.nav-btn-statistics'),
  },
  {
    title: '第二步：数据源与监测点',
    description:
      '在「数据源」中新增、编辑或删除监测点，选择目标点并确认坐标；需要时可开启「使用预生成数据」，点击「应用」后同步到场景。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-monitoring-point'),
  },
  {
    title: '第三步：选择气体变量',
    description:
      '在「选择气体」中多选参与统计的气体，并按需为不同气体设置颜色；右侧环境参数会同步显示对应浓度。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-gas-selector'),
  },
  {
    title: '第四步：环境参数读数',
    description:
      '通过「查看时刻」切换物理时间，查看温度、湿度、气压、风速、电磁波衰减率/强度及已选气体浓度；气体较多时可以展开列表查看。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-realtime-data'),
  },
  {
    title: '第五步：全屏统计图表',
    description:
      '点击「全屏图表」打开数据统计总览，再筛选监测点、气体与曲线时间区间，查看气体趋势、电磁波、环境参数、热力图等多类图表。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-overview-charts'),
  },
  {
    title: '第六步：微动识别面板',
    description:
      '右侧「微动识别」展示生命目标概况、手势分类与微动波形；切换目标可联动场景聚焦。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-micro-panel'),
  },
  {
    title: '第七步：识别概览',
    description:
      '查看目标数量、危急目标数与平均置信度，了解当前任务下的微动识别总体情况。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-micro-overview'),
  },
  {
    title: '第八步：手势识别',
    description:
      '基于微动特征展示挥手、摆手、握拳等手势概率，高亮项为当前判定结果。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '继续' },
    target: () => resolveGuideTarget('.stats-guide-micro-gesture'),
  },
  {
    title: '第九步：微动信号波形',
    description:
      '查看微动幅值与功率谱密度曲线，结合波形参数理解雷达回波中的微动特征。',
    placement: 'left',
    prevButtonProps: { children: '上一步' },
    nextButtonProps: { children: '完成' },
    target: () => resolveGuideTarget('.stats-guide-micro-waveform'),
  },
]

export function useHomeGuides({
  activeModule,
  selectedModel,
  handleNavClick,
  rightPanelCollapsed,
  showMicroMotionPanel,
}) {
  const taskGuideVisible = ref(false)
  const taskGuideCurrent = ref(0)
  const taskGuideAutoSwitching = ref(false)
  const vizGuideVisible = ref(false)
  const vizGuideCurrent = ref(0)
  const statsGuideVisible = ref(false)
  const statsGuideCurrent = ref(0)

  const isTaskGuideDone = () =>
    localStorage.getItem(TASK_GUIDE_STORAGE_KEY) === '1'
  const isVizGuideDone = () =>
    localStorage.getItem(VIZ_GUIDE_STORAGE_KEY) === '1'
  const isStatsGuideDone = () =>
    localStorage.getItem(STATS_GUIDE_STORAGE_KEY) === '1'

  const withTaskGuideNav = (module) => {
    taskGuideAutoSwitching.value = true
    try {
      handleNavClick(module)
    } finally {
      taskGuideAutoSwitching.value = false
    }
  }

  const startTaskManageGuide = async () => {
    taskGuideCurrent.value = 0
    withTaskGuideNav('model')
    await nextTick()
    await nextTick()
    taskGuideVisible.value = true
  }

  const startVizGuide = async () => {
    vizGuideCurrent.value = 0
    if (activeModule.value !== 'visualization') {
      activeModule.value = 'visualization'
      await nextTick()
      await nextTick()
    }
    vizGuideVisible.value = true
  }

  const ensureVizGuideStepReady = async (stepIndex) => {
    if (stepIndex === 0 && activeModule.value !== 'visualization') {
      activeModule.value = 'visualization'
      await nextTick()
      await nextTick()
    }
  }

  const startStatsGuide = async () => {
    statsGuideCurrent.value = 0
    if (activeModule.value !== 'statistics') {
      activeModule.value = 'statistics'
      await nextTick()
      await nextTick()
    }
    statsGuideVisible.value = true
  }

  const ensureStatsGuideStepReady = async (stepIndex) => {
    if (stepIndex === 0 && activeModule.value !== 'statistics') {
      activeModule.value = 'statistics'
      await nextTick()
      await nextTick()
    }
    if (stepIndex >= 5) {
      if (showMicroMotionPanel && !showMicroMotionPanel.value) {
        showMicroMotionPanel.value = true
        await nextTick()
        await nextTick()
      }
      if (rightPanelCollapsed?.value) {
        rightPanelCollapsed.value = false
        await nextTick()
        await nextTick()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  const ensureTaskGuideStepReady = async (stepIndex) => {
    if ((stepIndex === 1 || stepIndex === 2) && !selectedModel.value) {
      const firstModelCard = document.querySelector('.model-card--guide-first')
      if (firstModelCard instanceof HTMLElement) {
        firstModelCard.click()
        await nextTick()
        await nextTick()
        await nextTick()
      }
    }
  }

  const handleTaskGuideClose = () => {
    taskGuideVisible.value = false
  }

  const handleTaskGuideSkip = () => {
    taskGuideVisible.value = false
    localStorage.setItem(TASK_GUIDE_STORAGE_KEY, '1')
    ElMessage.info('已跳过教程，可在顶部“教程”中重新打开。')
  }

  const handleTaskGuideFinish = () => {
    taskGuideVisible.value = false
    localStorage.setItem(TASK_GUIDE_STORAGE_KEY, '1')
  }

  const handleVizGuideClose = () => {
    vizGuideVisible.value = false
  }

  const handleVizGuideSkip = () => {
    vizGuideVisible.value = false
    localStorage.setItem(VIZ_GUIDE_STORAGE_KEY, '1')
    ElMessage.info('已跳过教程，可在顶部「教程」中重新打开。')
  }

  const handleVizGuideFinish = () => {
    vizGuideVisible.value = false
    localStorage.setItem(VIZ_GUIDE_STORAGE_KEY, '1')
  }

  const handleVizGuideChange = async (current) => {
    vizGuideCurrent.value = current
    await ensureVizGuideStepReady(current)
    if (current === 7) {
      await nextTick()
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const handleStatsGuideClose = () => {
    statsGuideVisible.value = false
  }

  const handleStatsGuideSkip = () => {
    statsGuideVisible.value = false
    localStorage.setItem(STATS_GUIDE_STORAGE_KEY, '1')
    ElMessage.info('已跳过教程，可在顶部「教程」中重新打开。')
  }

  const handleStatsGuideFinish = () => {
    statsGuideVisible.value = false
    localStorage.setItem(STATS_GUIDE_STORAGE_KEY, '1')
  }

  const handleStatsGuideChange = async (current) => {
    statsGuideCurrent.value = current
    await ensureStatsGuideStepReady(current)
  }

  const handleTaskGuideChange = async (current) => {
    taskGuideCurrent.value = current
    const moduleByStep = [
      'model',
      'model',
      'model',
      'parameters',
      'parameters',
      'tasks',
      'tasks',
      'tasks',
      'tasks',
    ]
    const expectedModule = moduleByStep[current]
    if (expectedModule && activeModule.value !== expectedModule) {
      withTaskGuideNav(expectedModule)
      await nextTick()
      await nextTick()
    }
    await ensureTaskGuideStepReady(current)
    await nextTick()
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return {
    TASK_GUIDE_Z_INDEX: 12000,
    VIZ_GUIDE_Z_INDEX: 12000,
    STATS_GUIDE_Z_INDEX: 12000,
    taskGuideVisible,
    taskGuideCurrent,
    taskGuideAutoSwitching,
    vizGuideVisible,
    vizGuideCurrent,
    statsGuideVisible,
    statsGuideCurrent,
    isTaskGuideDone,
    isVizGuideDone,
    isStatsGuideDone,
    taskGuideContentStyle: guideContentStyle,
    taskGuideDialogContentStyle: guideDialogContentStyle,
    taskGuideSteps,
    vizGuideSteps,
    statsGuideSteps,
    startTaskManageGuide,
    startVizGuide,
    startStatsGuide,
    handleTaskGuideClose,
    handleTaskGuideSkip,
    handleTaskGuideFinish,
    handleVizGuideClose,
    handleVizGuideSkip,
    handleVizGuideFinish,
    handleVizGuideChange,
    handleStatsGuideClose,
    handleStatsGuideSkip,
    handleStatsGuideFinish,
    handleStatsGuideChange,
    handleTaskGuideChange,
  }
}
