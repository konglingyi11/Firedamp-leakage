$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$SourceDocx = Join-Path $Root "软件填写内容1_v2.docx"
$OutDir = Join-Path $Root "output\doc"
$VisioDir = Join-Path $OutDir "软件填写内容1_v2_5.6图稿_黑白简洁\visio"
$OutputDocx = Join-Path $OutDir "软件填写内容1_v2_5.6.1-5.6.3_Visio内嵌黑白简洁版.docx"

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
if (Test-Path $OutputDocx) { Remove-Item $OutputDocx -Force }
Copy-Item -LiteralPath $SourceDocx -Destination $OutputDocx -Force

$items = @(
  @{ Placeholder = "【图片占位：总体设计思路图 - 展示从需求分析到系统实现的总体设计流程】"; File = "overall-design-flow.vsdx" },
  @{ Placeholder = "【图片占位：B/S架构图 - 展示浏览器-服务器-Worker节点的三层架构关系】"; File = "bs-architecture.vsdx" },
  @{ Placeholder = "【图片占位：前端技术栈图 - 展示Vue 3、Pinia、Element Plus等技术组件的关系】"; File = "frontend-tech-stack.vsdx" },
  @{ Placeholder = "【图片占位：后端技术栈图 - 展示Node.js、Fluent、数据库等技术组件的关系】"; File = "backend-tech-stack.vsdx" },
  @{ Placeholder = "【图片占位：组件关系图 - 展示26个前端组件的层次结构和调用关系】"; File = "component-relation.vsdx" },
  @{ Placeholder = "【图片占位：数据流图 - 展示数据从API到Store到UI组件的流转路径】"; File = "data-flow-api-store-ui.vsdx" },
  @{ Placeholder = "【图片占位：可视化分层架构图 - 展示数据层、处理层、展示层的三层可视化架构】"; File = "visualization-layers.vsdx" },
  @{ Placeholder = "【图片占位：Worker调度算法流程图 - 展示任务分配、资源检查、故障切换的算法流程】"; File = "worker-schedule-flow.vsdx" },
  @{ Placeholder = "【图片占位：系统工作原理图 - 展示三层架构的工作机制和通信方式】"; File = "system-principle.vsdx" },
  @{ Placeholder = "【图片占位：前端框架图 - 展示视图层、组件层、API层、状态层的层次结构】"; File = "frontend-framework.vsdx" },
  @{ Placeholder = "【图片占位：后端服务模块图 - 展示6大服务模块的功能划分和调用关系】"; File = "backend-service-modules.vsdx" },
  @{ Placeholder = "【图片占位：Fluent Worker模块图 - 展示Worker节点内部5大功能模块的关系】"; File = "fluent-worker-modules.vsdx" },
  @{ Placeholder = "【图片占位：业务流程时序图 - 展示从创建任务到结果展示的完整时序流程】"; File = "business-sequence.vsdx" },
  @{ Placeholder = "【图片占位：部署架构图 - 展示前端、API服务、Worker节点、数据库的分布式部署方案】"; File = "deployment-architecture.vsdx" }
)

$wdCollapseStart = 1
$wdReplaceNone = 0
$msoFalse = 0

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0

try {
  $doc = $word.Documents.Open($OutputDocx)
  $inserted = 0
  $missing = New-Object System.Collections.Generic.List[string]

  foreach ($item in $items) {
    $vsdxPath = Join-Path $VisioDir $item.File
    if (-not (Test-Path $vsdxPath)) {
      $missing.Add("missing file: $($item.File)") | Out-Null
      continue
    }

    $range = $doc.Content
    $find = $range.Find
    $find.ClearFormatting()
    $find.Text = $item.Placeholder
    $find.Forward = $true
    $find.Wrap = 0
    $found = $find.Execute()
    if (-not $found) {
      $missing.Add("placeholder not found: $($item.Placeholder)") | Out-Null
      continue
    }

    $range.Text = ""
    $range.Collapse($wdCollapseStart)
    $range.ParagraphFormat.Alignment = 1
    $ole = $doc.InlineShapes.AddOLEObject(
      "Visio.Drawing.16",
      $vsdxPath,
      $false,
      $false,
      [Type]::Missing,
      [Type]::Missing,
      [Type]::Missing,
      $range
    )
    $ole.LockAspectRatio = $true
    $ole.Width = 425
    $inserted += 1
  }

  $doc.Save()
  $doc.Close($false)
  Write-Output "OUTPUT $OutputDocx"
  Write-Output "INSERTED $inserted"
  if ($missing.Count -gt 0) {
    Write-Output "MISSING $($missing.Count)"
    foreach ($m in $missing) { Write-Output $m }
  }
} finally {
  $word.Quit()
}
