$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutRoot = Join-Path $Root "output\doc\软件填写内容1_v2_5.6图稿_黑白简洁"
$VisioDir = Join-Path $OutRoot "visio"
$PngDir = Join-Path $OutRoot "png"
New-Item -ItemType Directory -Path $VisioDir -Force | Out-Null
New-Item -ItemType Directory -Path $PngDir -Force | Out-Null

function Set-CellFormula($shape, [string]$cell, [string]$formula) {
  try { $shape.CellsU($cell).FormulaU = $formula } catch {}
}

function Style-Shape($shape, [string]$fill, [string]$line, [int]$fontSize = 12, [string]$fontColor = "RGB(0, 0, 0)") {
  Set-CellFormula $shape "FillForegnd" "RGB(255, 255, 255)"
  Set-CellFormula $shape "LineColor" "RGB(0, 0, 0)"
  Set-CellFormula $shape "LineWeight" "0.9 pt"
  Set-CellFormula $shape "Rounding" "0 in"
  Set-CellFormula $shape "Char.Size" "$fontSize pt"
  Set-CellFormula $shape "Char.Color" "RGB(0, 0, 0)"
  Set-CellFormula $shape "Char.Font" 'FONT("SimSun")'
  Set-CellFormula $shape "Para.HorzAlign" "1"
  Set-CellFormula $shape "VerticalAlign" "1"
}

function Add-Box($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [string]$fill = "RGB(248,251,253)", [string]$line = "RGB(207,219,231)", [int]$fontSize = 12) {
  $s = $page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $s.Text = $text
  Style-Shape $s $fill $line $fontSize
  return $s
}

function Add-Oval($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [string]$fill = "RGB(255,255,255)", [string]$line = "RGB(159,189,214)", [int]$fontSize = 12) {
  $s = $page.DrawOval($x, $y, $x + $w, $y + $h)
  $s.Text = $text
  Style-Shape $s $fill $line $fontSize
  return $s
}

function Add-Text($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [int]$size = 18, [string]$color = "RGB(15,23,42)", [int]$bold = 1) {
  $s = $page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $s.Text = $text
  Set-CellFormula $s "FillPattern" "0"
  Set-CellFormula $s "LinePattern" "0"
  Set-CellFormula $s "Char.Size" "$size pt"
  Set-CellFormula $s "Char.Color" "RGB(0, 0, 0)"
  Set-CellFormula $s "Char.Font" 'FONT("SimSun")'
  Set-CellFormula $s "Char.Style" "$bold"
  Set-CellFormula $s "Para.HorzAlign" "1"
  Set-CellFormula $s "VerticalAlign" "1"
  return $s
}

function Add-Line($page, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [string]$color = "RGB(49,95,143)", [bool]$dashed = $false) {
  $line = $page.DrawLine($x1, $y1, $x2, $y2)
  Set-CellFormula $line "LineColor" "RGB(0, 0, 0)"
  Set-CellFormula $line "LineWeight" "0.9 pt"
  Set-CellFormula $line "EndArrow" "13"
  if ($dashed) { Set-CellFormula $line "LinePattern" "2" }
  return $line
}

function Setup-Page($doc, [string]$name, [string]$title, [string]$subtitle) {
  $page = $doc.Pages.Item(1)
  $page.Name = $name
  $page.PageSheet.CellsU("PageWidth").FormulaU = "16 in"
  $page.PageSheet.CellsU("PageHeight").FormulaU = "9 in"
  return $page
}

function Save-Diagram($visio, [string]$key, [string]$title, [string]$subtitle, [scriptblock]$drawBlock) {
  $doc = $visio.Documents.Add("")
  try {
    $page = Setup-Page $doc $title $title $subtitle
    & $drawBlock $page
    $vsdxPath = Join-Path $VisioDir "$key.vsdx"
    $pngPath = Join-Path $PngDir "$key.png"
    if (Test-Path $vsdxPath) { Remove-Item $vsdxPath -Force }
    if (Test-Path $pngPath) { Remove-Item $pngPath -Force }
    $doc.SaveAs($vsdxPath)
    $page.Export($pngPath)
    Write-Output "OK $key"
  } finally {
    $doc.Close()
  }
}

function Draw-FlowDiagram($page, [string[]]$nodes, [string]$note) {
  $count = $nodes.Count
  $w = if ($count -ge 6) { 1.75 } else { 2.05 }
  $h = 1.05
  $gap = (14.0 - ($count * $w)) / [Math]::Max(1, $count - 1)
  $x = 1.0
  $y = 4.05
  for ($i = 0; $i -lt $count; $i++) {
    Add-Box $page $x $y $w $h $nodes[$i] "RGB(248,251,253)" "RGB(180,204,224)" 12 | Out-Null
    if ($i -gt 0) { Add-Line $page ($x - $gap + 0.05) ($y + $h / 2) $x ($y + $h / 2) | Out-Null }
    $x += $w + $gap
  }
  Add-Box $page 1.0 0.72 14.0 0.52 $note "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-GridDiagram($page, [string[]]$nodes, [string]$note) {
  $cols = 3
  $w = 3.35
  $h = 0.8
  $gapX = 0.55
  $gapY = 0.55
  $startX = 2.25
  $startY = 5.65
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $row = [Math]::Floor($i / $cols)
    $col = $i % $cols
    $fill = if ($row % 2 -eq 0) { "RGB(246,251,248)" } else { "RGB(248,251,253)" }
    $line = if ($row % 2 -eq 0) { "RGB(184,214,196)" } else { "RGB(180,204,224)" }
    Add-Box $page ($startX + $col * ($w + $gapX)) ($startY - $row * ($h + $gapY)) $w $h $nodes[$i] $fill $line 12 | Out-Null
  }
  Add-Box $page 1.0 0.72 14.0 0.52 $note "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-StackDiagram($page, [string[]]$nodes, [string]$note) {
  $x = 4.0
  $y = 6.15
  $w = 8.0
  $h = 0.62
  $fills = @("RGB(238,245,251)", "RGB(246,251,248)", "RGB(250,248,253)", "RGB(255,251,235)", "RGB(248,251,253)")
  $lines = @("RGB(159,189,214)", "RGB(184,214,196)", "RGB(210,197,223)", "RGB(225,196,128)", "RGB(207,219,231)")
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    Add-Box $page $x ($y - $i * 0.78) $w $h $nodes[$i] $fills[$i % $fills.Count] $lines[$i % $lines.Count] 12 | Out-Null
    if ($i -gt 0) { Add-Line $page 8.0 ($y - ($i - 1) * 0.78) 8.0 ($y - $i * 0.78 + $h) "RGB(100,116,139)" | Out-Null }
  }
  Add-Box $page 1.0 0.72 14.0 0.52 $note "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-HubDiagram($page, [string]$center, [string[]]$nodes, [string]$note) {
  Add-Box $page 6.45 3.65 3.1 1.0 $center "RGB(234,243,251)" "RGB(159,189,214)" 15 | Out-Null
  $cx = 8.0
  $cy = 4.15
  $rx = 5.1
  $ry = 1.75
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $angle = -[Math]::PI / 2 + $i * 2 * [Math]::PI / $nodes.Count
    $x = $cx + $rx * [Math]::Cos($angle) - 1.15
    $y = $cy + $ry * [Math]::Sin($angle) - 0.35
    Add-Line $page $cx $cy ($x + 1.15) ($y + 0.35) "RGB(100,116,139)" | Out-Null
    Add-Box $page $x $y 2.3 0.7 $nodes[$i] "RGB(248,251,253)" "RGB(207,219,231)" 11 | Out-Null
  }
  Add-Box $page 1.0 0.72 14.0 0.52 $note "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-BsArchitecture($page) {
  $lanes = @(
    @{ X=0.85; T="浏览器交互层"; S="Vue 3 / UI / 可视化"; Items=@("任务与参数配置", "前端可视化展示", "API 客户端", "本地数据处理") },
    @{ X=5.85; T="服务器调度层"; S="REST API / 调度 / 结果管理"; Items=@("REST API 服务", "任务调度与状态同步", "后处理与预生成管理", "静态结果与数据服务") },
    @{ X=10.85; T="Worker 计算节点层"; S="Fluent / 后处理执行"; Items=@("Worker Agent", "Fluent 仿真计算", "后处理任务执行", "结果存储与回传") }
  )
  foreach ($lane in $lanes) {
    Add-Box $page $lane.X 1.45 4.15 5.6 "" "RGB(255,255,255)" "RGB(207,219,231)" 1 | Out-Null
    Add-Box $page $lane.X 6.25 4.15 0.75 "$($lane.T)`n$($lane.S)" "RGB(238,245,251)" "RGB(159,189,214)" 13 | Out-Null
    $y = 5.45
    foreach ($item in $lane.Items) {
      Add-Box $page ($lane.X + 0.35) $y 3.45 0.58 $item "RGB(248,251,253)" "RGB(216,226,236)" 11 | Out-Null
      $y -= 0.88
    }
  }
  Add-Line $page 5.0 4.78 5.85 4.78 | Out-Null
  Add-Text $page 5.15 5.0 0.55 0.2 "HTTP" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 10.0 4.5 10.85 4.5 "RGB(63,125,98)" | Out-Null
  Add-Text $page 10.13 4.72 0.55 0.2 "调度" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 10.85 5.35 10.0 5.35 "RGB(100,116,139)" $true | Out-Null
  Add-Text $page 10.13 5.56 0.55 0.2 "心跳" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 10.85 2.45 10.0 2.45 "RGB(100,116,139)" | Out-Null
  Add-Text $page 10.13 2.66 0.55 0.2 "回写" 8 "RGB(66,84,102)" | Out-Null
  Add-Box $page 1.0 0.72 14.0 0.52 "核心流程：浏览器提交任务与可视化请求 → 服务器调度 Worker → Worker 执行仿真与后处理 → 结果回写服务器 → 浏览器展示结果。" "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-DataFlowDfd($page) {
  Add-Box $page 1.0 3.85 2.0 0.95 "后端 API`n模型 / 任务 / Worker / 后处理" "RGB(238,245,251)" "RGB(159,189,214)" 12 | Out-Null
  Add-Oval $page 4.05 3.15 1.75 1.75 "P1`n获取与解析`nAxios / API模块" "RGB(255,255,255)" "RGB(159,189,214)" 11 | Out-Null
  Add-Oval $page 7.15 3.15 1.75 1.75 "P2`n状态更新`nPinia Action" "RGB(255,255,255)" "RGB(159,189,214)" 11 | Out-Null
  Add-Oval $page 10.25 3.15 1.75 1.75 "P3`n界面呈现`nHomeView / 组件" "RGB(255,255,255)" "RGB(159,189,214)" 11 | Out-Null
  Add-Box $page 13.0 3.85 2.0 0.95 "用户`n查询 / 配置 / 筛选 / 启动" "RGB(238,245,251)" "RGB(159,189,214)" 12 | Out-Null
  Add-Box $page 6.1 1.55 3.8 0.85 "D1 前端状态库`nPinia Store / Composables State" "RGB(255,255,255)" "RGB(63,125,98)" 12 | Out-Null
  Add-Box $page 6.1 5.9 3.8 0.75 "D2 本地缓存`ntoken / apiBaseUrl / 结果缓存" "RGB(255,255,255)" "RGB(63,125,98)" 12 | Out-Null
  Add-Line $page 3.0 4.33 4.05 4.02 | Out-Null
  Add-Line $page 5.8 4.02 7.15 4.02 | Out-Null
  Add-Line $page 8.9 4.02 10.25 4.02 "RGB(63,125,98)" | Out-Null
  Add-Line $page 12.0 4.02 13.0 4.25 "RGB(63,125,98)" | Out-Null
  Add-Line $page 8.03 3.15 8.03 2.4 "RGB(63,125,98)" | Out-Null
  Add-Line $page 9.9 1.97 10.65 3.15 "RGB(63,125,98)" | Out-Null
  Add-Line $page 5.0 4.9 6.1 6.18 "RGB(100,116,139)" $true | Out-Null
  Add-Line $page 9.1 5.9 8.55 4.75 "RGB(100,116,139)" $true | Out-Null
  Add-Line $page 14.0 3.85 5.0 3.15 "RGB(100,116,139)" $true | Out-Null
  Add-Text $page 6.2 0.88 5.0 0.25 "用户操作流：筛选条件、时间步选择、任务启动、节点刷新" 9 "RGB(66,84,102)" | Out-Null
  Add-Box $page 1.0 6.45 3.8 0.55 "DFD 符号：矩形=外部实体；圆形=处理过程；双线矩形=数据存储；箭头=数据流。" "RGB(248,251,253)" "RGB(216,226,236)" 9 | Out-Null
}

function Draw-ComponentRelation($page) {
  Add-Box $page 6.15 5.95 3.7 0.7 "HomeView 主界面容器" "RGB(234,243,251)" "RGB(159,189,214)" 14 | Out-Null
  $left = @("ModelGrid / ModelSelection", "TaskList", "ParameterSettings", "WorkerSelectDialog")
  $right = @("ThreeVisualizationCanvas", "TimelineControl", "VisualizationSettings", "DataStatistics / AnalysisResults")
  for ($i=0; $i -lt 4; $i++) {
    Add-Box $page 1.1 (5.7 - $i*0.9) 3.1 0.52 $left[$i] "RGB(248,251,253)" "RGB(207,219,231)" 11 | Out-Null
    Add-Line $page 4.2 (5.96 - $i*0.9) 6.15 6.3 | Out-Null
    Add-Box $page 11.8 (5.7 - $i*0.9) 3.1 0.52 $right[$i] "RGB(246,251,248)" "RGB(184,214,196)" 11 | Out-Null
    Add-Line $page 9.85 6.3 11.8 (5.96 - $i*0.9) "RGB(63,125,98)" | Out-Null
  }
  Add-Box $page 5.1 2.0 2.5 0.62 "Pinia Store" "RGB(250,248,253)" "RGB(210,197,223)" 12 | Out-Null
  Add-Box $page 8.4 2.0 2.5 0.62 "API Modules" "RGB(250,248,253)" "RGB(210,197,223)" 12 | Out-Null
  Add-Line $page 7.6 2.3 8.4 2.3 "RGB(100,116,139)" | Out-Null
  Add-Line $page 6.35 5.95 6.35 2.62 "RGB(100,116,139)" $true | Out-Null
  Add-Line $page 8.65 5.95 9.65 2.62 "RGB(100,116,139)" $true | Out-Null
  Add-Box $page 1.0 0.72 14.0 0.52 "组件关系：主界面聚合业务组件；组件通过 Props/Events 交互，共享状态进入 Pinia，远程数据经 API Modules 流入。" "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

$visio = New-Object -ComObject Visio.Application
$visio.Visible = $false

try {
  Save-Diagram $visio "overall-design-flow" "总体设计思路图" "从需求分析到系统实现的总体设计流程" { param($p) Draw-FlowDiagram $p @("需求分析", "总体架构设计", "功能模块设计", "接口与数据设计", "系统实现", "测试验证") "需求驱动设计闭环：需求分析 → 架构设计 → 模块与接口设计 → 系统实现 → 测试验证与迭代优化。" }
  Save-Diagram $visio "bs-architecture" "B/S 架构图" "浏览器、服务器、Worker 节点的三层架构关系" { param($p) Draw-BsArchitecture $p }
  Save-Diagram $visio "frontend-tech-stack" "前端技术栈图" "Vue 3、Pinia、Element Plus 等前端技术组件关系" { param($p) Draw-HubDiagram $p "Vue 3 SPA" @("Vite", "Vue Router", "Pinia", "Element Plus", "Axios", "Three.js", "ECharts", "vtk.js / Cesium") "前端围绕 Vue 3 应用核心组织路由、状态、UI、数据通信、三维渲染和工程化构建。" }
  Save-Diagram $visio "backend-tech-stack" "后端技术栈图" "Node.js、Fluent、数据库等技术组件关系" { param($p) Draw-HubDiagram $p "后端 API 服务" @("Node.js HTTP 服务", "RESTful API", "JSON 数据交换", "数据库", "文件存储", "Ansys Fluent", "Worker 心跳", "任务调度") "后端承担接口接入、任务调度、数据存储、计算协同和 Worker 资源管理。" }
  Save-Diagram $visio "component-relation" "组件关系图" "前端核心组件层次结构和调用关系" { param($p) Draw-ComponentRelation $p }
  Save-Diagram $visio "data-flow-api-store-ui" "数据流图（DFD）" "采用软件工程 DFD 表示法展示 API、Store、UI 之间的数据流" { param($p) Draw-DataFlowDfd $p }
  Save-Diagram $visio "visualization-layers" "可视化分层架构图" "数据层、处理层、展示层的三层可视化架构" { param($p) Draw-StackDiagram $p @("展示层：三维视图、图表统计、时间轴交互", "交互层：图层叠加、视角控制、剖面切割", "处理层：格式转换、坐标变换、数据压缩", "数据层：云图、矢量图、体数据、流线数据", "源数据层：Fluent 结果文件与后处理输入") "可视化子系统按数据获取、预处理、交互控制和展示渲染分层组织。" }
  Save-Diagram $visio "worker-schedule-flow" "Worker 调度算法流程图" "任务分配、资源检查、故障切换的调度流程" { param($p) Draw-FlowDiagram $p @("接收任务", "读取 Worker 状态", "资源评分", "选择节点", "启动仿真", "进度监控", "故障切换") "调度算法依据心跳、CPU、内存、磁盘与 Fluent 线程资源进行节点选择，并在异常时触发迁移或重试。" }
  Save-Diagram $visio "system-principle" "系统工作原理图" "三层架构的工作机制和通信方式" { param($p) Draw-FlowDiagram $p @("用户配置任务", "Web 控制台提交", "API 服务调度", "Worker 调用 Fluent", "生成后处理数据", "Web 展示结果") "系统以 Web 控制台、后端 API 服务、Fluent Worker 节点组成闭环，完成任务配置、调度、计算和结果展示。" }
  Save-Diagram $visio "frontend-framework" "前端框架图" "视图层、组件层、API 层、状态层的层次结构" { param($p) Draw-StackDiagram $p @("视图层：HomeView 与路由页面", "组件层：业务组件与通用控件", "状态层：Pinia Store 与组合式状态", "API 层：Worker / Task / Model / PostProcessing", "工具层：请求封装、格式化、颜色与时间步工具") "前端按照视图、组件、状态、API 和工具函数分层，降低耦合并提升复用能力。" }
  Save-Diagram $visio "backend-service-modules" "后端服务模块图" "6 大服务模块的功能划分和调用关系" { param($p) Draw-GridDiagram $p @("Worker 管理服务", "任务调度服务", "模型管理服务", "后处理服务", "色带管理服务", "健康检查服务") "后端服务围绕计算节点、仿真任务、模型资源、可视化结果、色带配置和运行健康状态组织。" }
  Save-Diagram $visio "fluent-worker-modules" "Fluent Worker 模块图" "Worker 节点内部 5 大功能模块关系" { param($p) Draw-GridDiagram $p @("任务执行引擎", "资源监控模块", "心跳维护模块", "后处理生成模块", "文件管理模块") "Worker 节点内部完成任务接收、Fluent 求解、资源监控、心跳上报、结果生成和文件生命周期管理。" }
  Save-Diagram $visio "business-sequence" "业务流程时序图" "从创建任务到结果展示的完整时序流程" { param($p) Draw-FlowDiagram $p @("创建任务", "选择模型", "配置参数", "分配 Worker", "Fluent 仿真", "后处理生成", "结果展示") "业务流程覆盖从用户创建仿真任务到前端加载后处理结果并进行可视化展示的完整链路。" }
  Save-Diagram $visio "deployment-architecture" "部署架构图" "前端、API 服务、Worker 节点、数据库的分布式部署方案" { param($p) Draw-FlowDiagram $p @("浏览器客户端", "Web 静态资源", "负载均衡 / 网关", "API 服务集群", "Worker 计算集群", "数据库 / 文件存储") "部署架构支持前端静态化、API 无状态扩展、Worker 横向扩容和结构化/非结构化数据分层存储。" }
} finally {
  $visio.Quit()
}
