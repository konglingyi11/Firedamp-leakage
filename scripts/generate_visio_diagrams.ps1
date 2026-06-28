$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$OutRoot = Join-Path $Root "output\doc\软件填写内容_图稿"
$VisioDir = Join-Path $OutRoot "visio"
$PngDir = Join-Path $OutRoot "png"
New-Item -ItemType Directory -Path $VisioDir -Force | Out-Null
New-Item -ItemType Directory -Path $PngDir -Force | Out-Null

$diagrams = @(
  @{ Key="system_boundary"; Title="系统边界图"; Type="flow"; Nodes=@("Web 控制端","后端 API 服务","Fluent Worker","数据存储服务"); Note="交互、调度、计算、存储分层。" },
  @{ Key="user_roles"; Title="用户角色用例图"; Type="hub"; Center="软件系统"; Nodes=@("救援指挥人员","地质勘探人员","系统管理员","任务/结果查看","模型/参数配置","节点/系统维护"); Note="角色职责围绕任务、模型、结果和运维划分。" },
  @{ Key="scenarios"; Title="应用场景图"; Type="three"; Nodes=@("灾后救援","地质勘探","训练演练"); Note="三类场景覆盖救援分析、空间评估和训练复盘。" },
  @{ Key="function_modules"; Title="功能模块图"; Type="grid"; Nodes=@("模型管理","任务管理","参数配置","数据可视化","时间轴控制","色带管理","监测点管理","Worker 管理"); Note="围绕仿真任务全流程组织功能。" },
  @{ Key="performance"; Title="性能指标图"; Type="metrics"; Nodes=@("首屏 <=3s","API <=2s","多用户访问","多 Worker 并发","百万级网格","多核并行"); Note="数值需由测试报告和部署配置支撑。" },
  @{ Key="data_flow"; Title="数据流图"; Type="flow"; Nodes=@("模型文件","仿真任务","Fluent 结果","后处理数据","Web 可视化","日志/监控"); Note="从输入模型到结果展示和过程记录。" },
  @{ Key="api_interfaces"; Title="API 接口图"; Type="grid"; Nodes=@("Worker API","Task API","Model API","ColorMap API","PostProcessing API","Health API","CSV/Volume API"); Note="接口数量以最终接口清单为准。" },
  @{ Key="security"; Title="安全架构图"; Type="stack"; Nodes=@("HTTPS 传输加密","Bearer Token 认证","角色权限控制","输入与文件校验","审计日志追踪"); Note="安全能力需与后端和部署范围核对。" },
  @{ Key="reliability"; Title="可靠性设计图"; Type="flow"; Nodes=@("心跳检测","状态监控","异常识别","任务恢复/重试","数据备份","用户提示"); Note="故障处理与数据保护共同保障可靠性。" },
  @{ Key="runtime_env"; Title="部署环境图"; Type="flow"; Nodes=@("现代浏览器","前端静态资源","API 服务环境","Fluent Worker 服务器","数据库/文件存储"); Note="运行环境需按最终部署口径统一。" },
  @{ Key="acceptance"; Title="验收测试流程图"; Type="flow"; Nodes=@("功能验证","接口测试","可视化核验","代码评审","测试覆盖检查","验收结论"); Note="验收指标应与测试报告一致。" },
  @{ Key="design_overview"; Title="总体设计思路图"; Type="flow"; Nodes=@("需求分析","架构设计","模块划分","接口设计","实现与测试","交付验收"); Note="从需求到交付的设计闭环。" },
  @{ Key="bs_architecture"; Title="B/S 架构图"; Type="flow"; Nodes=@("浏览器","Web 单页应用","RESTful API","Fluent Worker","数据存储"); Note="浏览器、服务端和计算节点分层协作。" },
  @{ Key="frontend_stack"; Title="前端技术栈图"; Type="hub"; Center="Vue 3 SPA"; Nodes=@("Vite 7","Pinia 3","Element Plus","ECharts","Three.js","VTK.js","Axios"); Note="前端围绕交互、状态和可视化技术组合。" },
  @{ Key="backend_stack"; Title="后端技术栈图"; Type="hub"; Center="API 服务"; Nodes=@("任务调度","Worker 管理","数据库/文件存储","Ansys Fluent","HTTP/HTTPS","JSON"); Note="后端负责调度、存储、通信和计算协同。" },
  @{ Key="components"; Title="组件关系图"; Type="stack"; Nodes=@("HomeView 主界面","业务组件","组合式函数","Pinia Store","API 模块","工具函数"); Note="按界面、业务、状态和工具分层。" },
  @{ Key="state_flow"; Title="数据流设计图"; Type="flow"; Nodes=@("用户操作","组件事件","API 请求","Store/状态","响应式更新","界面展示"); Note="单向数据流驱动界面更新。" },
  @{ Key="visualization_layers"; Title="可视化分层架构图"; Type="stack"; Nodes=@("Fluent 结果提取层","格式转换与压缩层","时间步数据组织层","Web 渲染展示层","色带/时间轴交互层"); Note="数据提取、处理、组织、渲染和交互分层。" },
  @{ Key="worker_schedule"; Title="Worker 调度算法流程图"; Type="flow"; Nodes=@("接收任务","读取 Worker 状态","资源评分","选择节点","启动仿真","监控/故障处理"); Note="资源状态决定任务分配和故障处理。" },
  @{ Key="principle"; Title="系统工作原理图"; Type="flow"; Nodes=@("用户配置任务","API 服务调度","Worker 调用 Fluent","生成后处理数据","Web 展示结果"); Note="配置、调度、计算、后处理和展示闭环。" },
  @{ Key="frontend_framework"; Title="前端框架图"; Type="stack"; Nodes=@("视图层","组件层","API 层","状态层","工具层","组合式函数"); Note="前端分层降低耦合。" },
  @{ Key="backend_modules"; Title="后端服务模块图"; Type="grid"; Nodes=@("Worker 管理","任务调度","模型管理","后处理服务","色带管理","健康检查","CSV/Volume 转换"); Note="服务模块按业务职责划分。" },
  @{ Key="worker_modules"; Title="Fluent Worker 模块图"; Type="grid"; Nodes=@("任务执行引擎","资源监控模块","心跳维护模块","后处理生成模块","文件管理模块"); Note="Worker 节点内部模块。" },
  @{ Key="business_sequence"; Title="业务流程时序图"; Type="flow"; Nodes=@("创建任务","选择/上传模型","配置参数","分配 Worker","Fluent 仿真","结果展示"); Note="任务从创建到结果展示的完整路径。" },
  @{ Key="deployment_architecture"; Title="部署架构图"; Type="flow"; Nodes=@("Web/CDN","负载均衡","API 服务实例","Worker 集群","数据库/文件存储"); Note="支持分布式部署和横向扩展。" }
)

function Set-CellFormula($shape, [string]$cell, [string]$formula) {
  try { $shape.CellsU($cell).FormulaU = $formula } catch {}
}

function Style-Shape($shape, [string]$fill, [string]$line, [int]$fontSize = 13, [string]$fontColor = "RGB(15, 23, 42)") {
  Set-CellFormula $shape "FillForegnd" $fill
  Set-CellFormula $shape "LineColor" $line
  Set-CellFormula $shape "LineWeight" "1.25 pt"
  Set-CellFormula $shape "Rounding" "0.12 in"
  Set-CellFormula $shape "Char.Size" "$fontSize pt"
  Set-CellFormula $shape "Char.Color" $fontColor
  Set-CellFormula $shape "Char.Font" 'FONT("Microsoft YaHei")'
  Set-CellFormula $shape "Para.HorzAlign" "1"
  Set-CellFormula $shape "VerticalAlign" "1"
}

function Add-Box($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [string]$fill = "RGB(239, 246, 255)", [string]$line = "RGB(37, 99, 235)", [int]$fontSize = 13) {
  $shape = $page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $shape.Text = $text
  Style-Shape $shape $fill $line $fontSize
  return $shape
}

function Add-Text($page, [double]$x, [double]$y, [double]$w, [double]$h, [string]$text, [int]$size = 20, [string]$color = "RGB(15, 23, 42)") {
  $shape = $page.DrawRectangle($x, $y, $x + $w, $y + $h)
  $shape.Text = $text
  Set-CellFormula $shape "FillPattern" "0"
  Set-CellFormula $shape "LinePattern" "0"
  Set-CellFormula $shape "Char.Size" "$size pt"
  Set-CellFormula $shape "Char.Color" $color
  Set-CellFormula $shape "Char.Font" 'FONT("Microsoft YaHei")'
  Set-CellFormula $shape "Char.Style" "1"
  Set-CellFormula $shape "Para.HorzAlign" "1"
  Set-CellFormula $shape "VerticalAlign" "1"
  return $shape
}

function Add-Line($page, [double]$x1, [double]$y1, [double]$x2, [double]$y2) {
  $line = $page.DrawLine($x1, $y1, $x2, $y2)
  Set-CellFormula $line "LineColor" "RGB(100, 116, 139)"
  Set-CellFormula $line "LineWeight" "1.4 pt"
  Set-CellFormula $line "EndArrow" "13"
  return $line
}

function Init-Page($doc, [string]$title, [bool]$first) {
  if ($first) {
    $page = $doc.Pages.Item(1)
  } else {
    $page = $doc.Pages.Add()
  }
  $page.Name = $title
  $page.PageSheet.CellsU("PageWidth").FormulaU = "11 in"
  $page.PageSheet.CellsU("PageHeight").FormulaU = "3.65 in"
  Add-Box $page 0.18 0.18 10.64 3.28 "" "RGB(255, 255, 255)" "RGB(203, 213, 225)" 1 | Out-Null
  Add-Text $page 0.55 3.05 9.9 0.34 $title 17 | Out-Null
  return $page
}

function Draw-Flow($page, $nodes, [string]$note) {
  $count = $nodes.Count
  $w = if ($count -ge 6) { 1.38 } else { 1.62 }
  $h = 0.78
  $gap = (9.85 - ($count * $w)) / [Math]::Max(1, $count - 1)
  $x = 0.58
  $y = 1.62
  $boxes = @()
  for ($i = 0; $i -lt $count; $i++) {
    $boxes += Add-Box $page $x $y $w $h $nodes[$i] "RGB(236, 254, 255)" "RGB(8, 145, 178)" 12
    if ($i -gt 0) {
      $prev = $boxes[$i - 1]
      Add-Line $page ($prev.CellsU("PinX").ResultIU + $w / 2) ($y + $h / 2) $x ($y + $h / 2) | Out-Null
    }
    $x += $w + $gap
  }
  Add-Text $page 1.0 0.28 9.0 0.28 $note 9 "RGB(71, 85, 105)" | Out-Null
}

function Draw-Grid($page, $nodes, [string]$note) {
  $cols = if ($nodes.Count -gt 6) { 4 } else { 3 }
  $w = 2.0
  $h = 0.58
  $gapX = 0.35
  $gapY = 0.36
  $totalW = $cols * $w + ($cols - 1) * $gapX
  $startX = (11 - $totalW) / 2
  $startY = 2.56
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $row = [Math]::Floor($i / $cols)
    $col = $i % $cols
    Add-Box $page ($startX + $col * ($w + $gapX)) ($startY - $row * ($h + $gapY)) $w $h $nodes[$i] "RGB(240, 253, 244)" "RGB(22, 163, 74)" 12 | Out-Null
  }
  Add-Text $page 1.0 0.28 9.0 0.28 $note 9 "RGB(71, 85, 105)" | Out-Null
}

function Draw-Stack($page, $nodes, [string]$note) {
  $fills = @("RGB(239, 246, 255)","RGB(236, 254, 255)","RGB(240, 253, 244)","RGB(255, 247, 237)","RGB(254, 242, 242)","RGB(245, 243, 255)")
  $lines = @("RGB(37, 99, 235)","RGB(8, 145, 178)","RGB(22, 163, 74)","RGB(234, 88, 12)","RGB(220, 38, 38)","RGB(124, 58, 237)")
  $x = 2.1
  $w = 6.8
  $h = 0.42
  $startY = 2.78
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $y = $startY - $i * 0.47
    Add-Box $page $x $y $w $h $nodes[$i] $fills[$i % $fills.Count] $lines[$i % $lines.Count] 12 | Out-Null
    if ($i -gt 0) {
      Add-Line $page 5.5 ($y + 0.47) 5.5 ($y + $h) | Out-Null
    }
  }
  Add-Text $page 1.0 0.28 9.0 0.28 $note 9 "RGB(71, 85, 105)" | Out-Null
}

function Draw-Hub($page, [string]$center, $nodes, [string]$note) {
  Add-Box $page 4.65 1.55 1.7 0.76 $center "RGB(238, 242, 255)" "RGB(79, 70, 229)" 13 | Out-Null
  $cx = 5.5
  $cy = 1.93
  $rX = 3.65
  $rY = 0.9
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $angle = -[Math]::PI / 2 + $i * 2 * [Math]::PI / $nodes.Count
    $x = $cx + $rX * [Math]::Cos($angle) - 0.82
    $y = $cy + $rY * [Math]::Sin($angle) - 0.34
    Add-Line $page $cx $cy ($x + 0.82) ($y + 0.34) | Out-Null
    Add-Box $page $x $y 1.64 0.68 $nodes[$i] "RGB(248, 250, 252)" "RGB(100, 116, 139)" 11 | Out-Null
  }
  Add-Text $page 1.0 0.28 9.0 0.28 $note 9 "RGB(71, 85, 105)" | Out-Null
}

function Draw-Three($page, $nodes, [string]$note) {
  $items = @(
    @("倒塌空间","气味/温度扩散","救援方案"),
    @("地下空间","结构与环境分析","可行性评估"),
    @("模拟掩埋","参数复盘","方案优化")
  )
  $xs = @(1.0, 4.35, 7.7)
  for ($i = 0; $i -lt 3; $i++) {
    Add-Box $page $xs[$i] 2.78 2.2 0.45 $nodes[$i] "RGB(238, 242, 255)" "RGB(79, 70, 229)" 13 | Out-Null
    $lastY = 2.78
    for ($j = 0; $j -lt 3; $j++) {
      $y = 2.12 - $j * 0.5
      Add-Line $page ($xs[$i] + 1.1) $lastY ($xs[$i] + 1.1) ($y + 0.38) | Out-Null
      Add-Box $page ($xs[$i] + 0.1) $y 2.0 0.38 $items[$i][$j] "RGB(248, 250, 252)" "RGB(100, 116, 139)" 10 | Out-Null
      $lastY = $y
    }
  }
  Add-Text $page 1.0 0.28 9.0 0.28 $note 9 "RGB(71, 85, 105)" | Out-Null
}

function Draw-Metrics($page, $nodes, [string]$note) {
  Add-Box $page 4.55 1.55 1.9 0.76 "性能目标" "RGB(239, 246, 255)" "RGB(37, 99, 235)" 15 | Out-Null
  $cx = 5.5
  $cy = 1.93
  $rX = 3.25
  $rY = 0.86
  for ($i = 0; $i -lt $nodes.Count; $i++) {
    $angle = -[Math]::PI / 2 + $i * 2 * [Math]::PI / $nodes.Count
    $x = $cx + $rX * [Math]::Cos($angle) - 0.7
    $y = $cy + $rY * [Math]::Sin($angle) - 0.34
    Add-Box $page $x $y 1.4 0.68 $nodes[$i] "RGB(255, 247, 237)" "RGB(234, 88, 12)" 11 | Out-Null
  }
  Add-Text $page 1.0 0.28 9.0 0.28 $note 9 "RGB(71, 85, 105)" | Out-Null
}

$visio = New-Object -ComObject Visio.Application
$visio.Visible = $false
$doc = $visio.Documents.Add("")

try {
  for ($i = 0; $i -lt $diagrams.Count; $i++) {
    $d = $diagrams[$i]
    $page = Init-Page $doc $d.Title ($i -eq 0)
    switch ($d.Type) {
      "flow" { Draw-Flow $page $d.Nodes $d.Note }
      "grid" { Draw-Grid $page $d.Nodes $d.Note }
      "stack" { Draw-Stack $page $d.Nodes $d.Note }
      "hub" { Draw-Hub $page $d.Center $d.Nodes $d.Note }
      "three" { Draw-Three $page $d.Nodes $d.Note }
      "metrics" { Draw-Metrics $page $d.Nodes $d.Note }
      default { Draw-Flow $page $d.Nodes $d.Note }
    }
    $pngPath = Join-Path $PngDir ("{0:D2}_{1}.png" -f ($i + 1), $d.Key)
    $page.Export($pngPath)
  }

  $vsdxPath = Join-Path $VisioDir "软件填写内容_全部图稿.vsdx"
  if (Test-Path $vsdxPath) { Remove-Item $vsdxPath -Force }
  $doc.SaveAs($vsdxPath)
  Write-Output "VISIO_EXPORT_OK $vsdxPath"
} finally {
  if ($doc) { $doc.Close() }
  if ($visio) { $visio.Quit() }
}
