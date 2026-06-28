$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VisioDir = Join-Path $Root "docs\visio"
$PreviewDir = Join-Path $Root "docs\visio-preview"
New-Item -ItemType Directory -Path $VisioDir -Force | Out-Null
New-Item -ItemType Directory -Path $PreviewDir -Force | Out-Null

function Set-CellFormula($shape, [string]$cell, [string]$formula) {
  try { $shape.CellsU($cell).FormulaU = $formula } catch {}
}

function Style-Shape($shape, [string]$fill, [string]$line, [int]$fontSize = 12, [string]$fontColor = "RGB(30, 41, 59)") {
  Set-CellFormula $shape "FillForegnd" $fill
  Set-CellFormula $shape "LineColor" $line
  Set-CellFormula $shape "LineWeight" "1.2 pt"
  Set-CellFormula $shape "Rounding" "0.08 in"
  Set-CellFormula $shape "Char.Size" "$fontSize pt"
  Set-CellFormula $shape "Char.Color" $fontColor
  Set-CellFormula $shape "Char.Font" 'FONT("Microsoft YaHei")'
  Set-CellFormula $shape "Para.HorzAlign" "1"
  Set-CellFormula $shape "VerticalAlign" "1"
}

function Add-Box($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [string]$fill = "RGB(248, 251, 253)", [string]$line = "RGB(207, 219, 231)", [int]$fontSize = 12) {
  $shape = $page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $shape.Text = $text
  Style-Shape $shape $fill $line $fontSize
  return $shape
}

function Add-Oval($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [string]$fill = "RGB(255, 255, 255)", [string]$line = "RGB(159, 189, 214)", [int]$fontSize = 12) {
  $shape = $page.DrawOval($x, $y, $x + $w, $y + $h)
  $shape.Text = $text
  Style-Shape $shape $fill $line $fontSize
  return $shape
}

function Add-Text($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [int]$size = 16, [string]$color = "RGB(15, 23, 42)", [int]$bold = 1) {
  $shape = $page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $shape.Text = $text
  Set-CellFormula $shape "FillPattern" "0"
  Set-CellFormula $shape "LinePattern" "0"
  Set-CellFormula $shape "Char.Size" "$size pt"
  Set-CellFormula $shape "Char.Color" $color
  Set-CellFormula $shape "Char.Font" 'FONT("Microsoft YaHei")'
  Set-CellFormula $shape "Char.Style" "$bold"
  Set-CellFormula $shape "Para.HorzAlign" "1"
  Set-CellFormula $shape "VerticalAlign" "1"
  return $shape
}

function Add-Line($page, [double]$x1, [double]$y1, [double]$x2, [double]$y2, [string]$color = "RGB(49, 95, 143)", [bool]$dashed = $false) {
  $line = $page.DrawLine($x1, $y1, $x2, $y2)
  Set-CellFormula $line "LineColor" $color
  Set-CellFormula $line "LineWeight" "1.4 pt"
  Set-CellFormula $line "EndArrow" "13"
  if ($dashed) { Set-CellFormula $line "LinePattern" "2" }
  return $line
}

function Setup-Page($doc, [string]$name, [string]$title, [string]$subtitle) {
  $page = $doc.Pages.Item(1)
  $page.Name = $name
  $page.PageSheet.CellsU("PageWidth").FormulaU = "16 in"
  $page.PageSheet.CellsU("PageHeight").FormulaU = "9 in"
  Add-Box $page 0.35 0.35 15.3 8.3 "" "RGB(255, 255, 255)" "RGB(216, 226, 236)" 1 | Out-Null
  Add-Text $page 0.8 8.05 14.4 0.42 $title 22 | Out-Null
  Add-Text $page 0.8 7.72 14.4 0.26 $subtitle 10 "RGB(100, 116, 139)" 0 | Out-Null
  Add-Line $page 0.8 7.48 15.2 7.48 "RGB(216, 226, 236)" | Out-Null
  return $page
}

function Save-VisioDocument($visio, [string]$fileName, [scriptblock]$drawBlock) {
  $doc = $visio.Documents.Add("")
  try {
    & $drawBlock $doc
    $vsdxPath = Join-Path $VisioDir $fileName
    if (Test-Path $vsdxPath) { Remove-Item $vsdxPath -Force }
    $doc.SaveAs($vsdxPath)
    $pngPath = Join-Path $PreviewDir ($fileName -replace "\.vsdx$", ".png")
    if (Test-Path $pngPath) { Remove-Item $pngPath -Force }
    $doc.Pages.Item(1).Export($pngPath)
    Write-Output "OK $vsdxPath"
  } finally {
    $doc.Close()
  }
}

function Draw-BsArchitecture($doc) {
  $page = Setup-Page $doc "B/S三层计算架构图" "B/S 三层计算架构图" "浏览器交互层、服务器调度层与 Worker 计算节点层的任务闭环关系"
  $lanes = @(
    @{ X=0.8; Title="1. 浏览器交互层"; Sub="Browser / Vue 3"; Fill="RGB(234, 243, 251)"; Line="RGB(159, 189, 214)"; Items=@("用户操作与任务配置", "前端可视化模块", "统一 API 客户端", "浏览器本地数据处理") },
    @{ X=5.85; Title="2. 服务器调度层"; Sub="Server / API / 调度"; Fill="RGB(237, 248, 242)"; Line="RGB(169, 201, 185)"; Items=@("REST API 服务", "任务调度与状态同步", "后处理与预生成管理", "静态结果与数据服务") },
    @{ X=10.9; Title="3. Worker 计算节点层"; Sub="Worker Node / Fluent"; Fill="RGB(243, 240, 248)"; Line="RGB(194, 181, 212)"; Items=@("Worker Agent", "Fluent 仿真计算", "后处理任务执行", "计算结果存储与回传") }
  )
  foreach ($lane in $lanes) {
    Add-Box $page $lane.X 1.4 4.1 5.75 " " "RGB(255,255,255)" "RGB(207, 219, 231)" 1 | Out-Null
    Add-Box $page $lane.X 6.35 4.1 0.8 "$($lane.Title)`n$($lane.Sub)" $lane.Fill $lane.Line 15 | Out-Null
    $y = 5.45
    foreach ($item in $lane.Items) {
      Add-Box $page ($lane.X + 0.35) $y 3.4 0.62 $item "RGB(251,253,255)" "RGB(216,226,236)" 11 | Out-Null
      $y -= 0.92
    }
  }
  Add-Line $page 4.9 4.85 5.85 4.85 | Out-Null
  Add-Text $page 5.0 5.05 0.75 0.22 "HTTP" 8 "RGB(66, 84, 102)" | Out-Null
  Add-Line $page 9.95 4.55 10.9 4.55 "RGB(63, 125, 98)" | Out-Null
  Add-Text $page 10.1 4.75 0.65 0.22 "调度" 8 "RGB(66, 84, 102)" | Out-Null
  Add-Line $page 10.9 5.35 9.95 5.35 "RGB(100, 116, 139)" $true | Out-Null
  Add-Text $page 10.1 5.55 0.65 0.22 "心跳" 8 "RGB(66, 84, 102)" | Out-Null
  Add-Line $page 10.9 2.45 9.95 2.45 "RGB(100, 116, 139)" | Out-Null
  Add-Text $page 10.12 2.65 0.65 0.22 "回写" 8 "RGB(66, 84, 102)" | Out-Null
  Add-Box $page 0.95 0.62 14.1 0.48 "核心流程：浏览器提交任务与可视化请求 → 服务器进行任务调度与状态管理 → Worker 节点执行仿真和后处理 → 结果文件回写服务器 → 浏览器加载结果并完成可视化展示。" "RGB(248,251,253)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-OverallDesignFlow($doc) {
  $page = Setup-Page $doc "总体设计思路图" "总体设计思路图" "从需求分析、架构建模到系统实现与验证反馈的完整设计流程"
  $steps = @(
    @{ T="需求分析"; S="业务场景 / 用户流程 / 仿真与可视化需求" },
    @{ T="总体架构设计"; S="B/S 三层结构 / 职责边界 / 调度链路" },
    @{ T="功能模块设计"; S="任务管理 / Worker 管理 / 后处理 / 可视化" },
    @{ T="接口与数据设计"; S="REST API / 状态数据 / 结果索引 / 格式约定" },
    @{ T="系统实现"; S="Vue 前端 / API 服务 / Worker 计算 / 结果展示" }
  )
  $x = 0.8
  foreach ($step in $steps) {
    Add-Box $page $x 3.7 2.45 2.25 "$($step.T)`n`n$($step.S)" "RGB(248,251,253)" "RGB(180,204,224)" 12 | Out-Null
    if ($x -gt 0.8) { Add-Line $page ($x - 0.35) 4.82 $x 4.82 | Out-Null }
    $x += 2.95
  }
  Add-Box $page 6.0 2.25 4.0 0.78 "测试验证与迭代优化`n功能测试、接口联调、数据正确性检查、性能与稳定性优化" "RGB(251,253,255)" "RGB(213,224,234)" 12 | Out-Null
  Add-Line $page 12.35 3.7 10.0 2.85 | Out-Null
  Add-Line $page 6.0 2.55 2.0 3.7 "RGB(100,116,139)" $true | Out-Null
  Add-Box $page 1.0 0.7 14.0 0.62 "设计原则：需求驱动、模块解耦、接口规范、数据闭环、可验证实现；面向 B/S 架构、Worker 计算调度与多源后处理数据展示。" "RGB(244,248,251)" "RGB(216,226,236)" 10 | Out-Null
}

function Draw-FrontendTechStack($doc) {
  $page = Setup-Page $doc "前端技术栈图" "前端技术栈图" "围绕 Vue 3 应用核心组织状态管理、UI 组件、数据通信、可视化与构建工具"
  Add-Box $page 6.15 4.0 3.7 1.35 "Vue 3 应用核心`nComposition API / 组件化视图 / 响应式渲染`nApp.vue / main.js / HomeView" "RGB(234,243,251)" "RGB(159,189,214)" 15 | Out-Null
  Add-Box $page 1.2 5.2 3.4 1.55 "页面组织与状态层`nVue Router    Pinia`nComposables / Stores" "RGB(251,253,255)" "RGB(212,224,234)" 12 | Out-Null
  Add-Box $page 1.2 2.8 3.4 1.55 "界面组件层`nElement Plus`nIcons / SCSS" "RGB(251,253,255)" "RGB(212,224,234)" 12 | Out-Null
  Add-Box $page 11.35 5.2 3.4 1.55 "数据通信层`nAxios    PapaParse`nWeb Workers / API Modules" "RGB(246,251,248)" "RGB(200,223,208)" 12 | Out-Null
  Add-Box $page 11.35 2.8 3.4 1.55 "可视化渲染层`nThree.js    ECharts`nvtk.js    Cesium" "RGB(246,251,248)" "RGB(200,223,208)" 12 | Out-Null
  Add-Box $page 6.0 1.35 4.0 1.0 "构建与工程化层`nVite / Sass / Static Copy" "RGB(250,248,253)" "RGB(221,212,233)" 12 | Out-Null
  Add-Line $page 4.6 5.9 6.15 4.9 | Out-Null
  Add-Line $page 4.6 3.55 6.15 4.35 | Out-Null
  Add-Line $page 9.85 4.9 11.35 5.9 "RGB(63,125,98)" | Out-Null
  Add-Line $page 9.85 4.3 11.35 3.55 "RGB(63,125,98)" | Out-Null
  Add-Line $page 8.0 2.35 8.0 4.0 "RGB(100,116,139)" $true | Out-Null
  Add-Box $page 1.0 0.55 14.0 0.46 "技术关系：Vite 提供工程化构建；Vue 3 组织页面与组件；Router 负责切换；Pinia 维护状态；Element Plus 提供 UI；Axios 与 API 模块通信；Three.js、ECharts、vtk.js、Cesium 承担可视化。" "RGB(248,251,253)" "RGB(216,226,236)" 9 | Out-Null
}

function Draw-DataFlowDfd($doc) {
  $page = Setup-Page $doc "数据流图 DFD" "数据流图（DFD）" "采用软件工程数据流图表示法：外部实体、处理过程、数据存储与数据流"
  Add-Box $page 1.0 3.8 2.1 1.05 "后端 API`n模型 / 任务 / Worker / 后处理" "RGB(238,245,251)" "RGB(159,189,214)" 13 | Out-Null
  Add-Oval $page 4.0 3.15 1.8 1.8 "P1`n获取与解析`nAxios / API 模块" "RGB(255,255,255)" "RGB(159,189,214)" 12 | Out-Null
  Add-Oval $page 7.1 3.15 1.8 1.8 "P2`n状态更新`nPinia Action" "RGB(255,255,255)" "RGB(159,189,214)" 12 | Out-Null
  Add-Oval $page 10.2 3.15 1.8 1.8 "P3`n界面呈现`nHomeView / 组件" "RGB(255,255,255)" "RGB(159,189,214)" 12 | Out-Null
  Add-Box $page 12.9 3.8 2.1 1.05 "用户`n查询 / 配置 / 筛选 / 启动任务" "RGB(238,245,251)" "RGB(159,189,214)" 13 | Out-Null
  Add-Box $page 6.15 1.6 3.7 0.85 "D1 前端状态库`nPinia Store / Composables State" "RGB(255,255,255)" "RGB(63,125,98)" 13 | Out-Null
  Add-Box $page 6.15 5.8 3.7 0.75 "D2 本地缓存`ntoken / apiBaseUrl / 结果缓存" "RGB(255,255,255)" "RGB(63,125,98)" 13 | Out-Null
  Add-Line $page 3.1 4.33 4.0 4.05 | Out-Null
  Add-Text $page 3.05 4.55 1.15 0.2 "接口响应数据" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 5.8 4.05 7.1 4.05 | Out-Null
  Add-Text $page 6.02 4.3 1.15 0.2 "标准化业务数据" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 8.9 4.05 10.2 4.05 "RGB(63,125,98)" | Out-Null
  Add-Text $page 9.14 4.3 1.0 0.2 "响应式状态" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 12.0 4.05 12.9 4.25 "RGB(63,125,98)" | Out-Null
  Add-Text $page 12.1 4.48 0.9 0.2 "可视化结果" 8 "RGB(66,84,102)" | Out-Null
  Add-Line $page 8.0 3.15 8.0 2.45 "RGB(63,125,98)" | Out-Null
  Add-Line $page 9.85 2.02 10.65 3.15 "RGB(63,125,98)" | Out-Null
  Add-Line $page 5.0 4.95 6.15 6.15 "RGB(100,116,139)" $true | Out-Null
  Add-Line $page 9.2 5.8 8.55 4.8 "RGB(100,116,139)" $true | Out-Null
  Add-Line $page 13.95 3.8 5.0 3.15 "RGB(100,116,139)" $true | Out-Null
  Add-Text $page 6.4 0.95 4.0 0.26 "用户操作流：筛选条件、时间步选择、任务启动、节点刷新" 9 "RGB(66,84,102)" | Out-Null
  Add-Box $page 1.0 6.35 3.25 0.55 "DFD 符号：矩形=外部实体；圆形=处理过程；双线矩形=数据存储；箭头=数据流。" "RGB(248,251,253)" "RGB(216,226,236)" 9 | Out-Null
  Add-Box $page 1.2 0.55 13.6 0.45 "核心数据：任务列表、模型信息、Worker 状态、任务进度、后处理结果 URL、时间步数据、可视化配置与统计结果。" "RGB(248,251,253)" "RGB(216,226,236)" 9 | Out-Null
}

$visio = New-Object -ComObject Visio.Application
$visio.Visible = $false

try {
  Save-VisioDocument $visio "bs-architecture.vsdx" ${function:Draw-BsArchitecture}
  Save-VisioDocument $visio "overall-design-flow.vsdx" ${function:Draw-OverallDesignFlow}
  Save-VisioDocument $visio "frontend-tech-stack.vsdx" ${function:Draw-FrontendTechStack}
  Save-VisioDocument $visio "data-flow-api-store-ui.vsdx" ${function:Draw-DataFlowDfd}
} finally {
  $visio.Quit()
}
