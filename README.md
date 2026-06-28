# 掩埋空间生命识别系统 (Buried Space Life Identification System)

## 1. 项目简介

基于 **Vue 3** 与 **Unreal Engine 5 像素流（Pixel Streaming）** 的前端控制台：面向灾后救援、地质勘探等场景，提供掩埋空间环境仿真、数据后处理结果展示，以及与 UE 场景的实时联动（云图、矢量图、体渲染、流线图等）。

Web 端负责任务与参数管理、Worker 调度、可视化配置；三维画面由 UE 渲染，经 WebRTC 像素流传回浏览器。

---

## 2. 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Vue 3（Composition API）、Vue Router 4 |
| 构建 | Vite 7 |
| 状态 | Pinia 3 |
| UI | Element Plus 2（暗色主题 + 中文语言包） |
| 网络 | Axios（见 `src/utils/request.js`） |
| 图表 | ECharts 6 |
| 像素流 | Epic Pixel Streaming Frontend（`@epicgames-ps/lib-pixelstreamingfrontend-ue5.6` 等）；页面内通过 **peer-stream** Web Component（`public/peer-stream.js`）与信令/WebRTC 对接 |

---

## 3. 功能概览

- **主控制台 (`HomeView`)**：模型选择、任务列表、参数设置、数据统计、分析结果、时间轴与可视化选项。
- **像素流播放 (`PixelStreamingPlayer`)**：与 UE 建立连接后，通过数据通道下发 JSON 消息（如 `update2DContourParams`、`update2DVectorParams`、`animationUpdate`、`resetLevel` 等，与 UE 蓝图约定一致）。
- **后处理与预览**：对接后处理接口（云图/矢量图/体数据等），与底部时间轴、图层展示联动；发给 UE 的 2D 时间步数组当前有长度上限（与 UE 侧能力对齐，见代码常量 `MAX_2D_TIME_STEPS_FOR_UE`）。
- **页面生命周期**：在整页刷新、关闭标签或离开页面时，会尝试向 UE 发送 `resetLevel`，便于场景复位（受浏览器卸载时机与连接状态影响，不保证 100% 送达）。

更细的 **Fluent / Worker / Task / Model** 接口说明见 [`src/api/README.md`](src/api/README.md)。后处理相关封装见 `src/api/postProcessing.js`。

---

## 4. 目录结构（摘要）

```
pixel_test/
├── public/
│   └── peer-stream.js          # 浏览器端像素流 SDK（构建产物或同步自 peer-stream）
├── peer-stream/                # 信令服务与原版 peer-stream 源码/文档
│   ├── signal.js               # Node 信令服务器入口
│   ├── signal.json             # 信令配置示例
│   └── README-zh.md            # 像素流与 signal 使用说明（中文）
├── src/
│   ├── api/                    # 后端 API（task、worker、model、postProcessing 等）
│   ├── assets/
│   ├── components/             # 业务组件（任务列表、参数设置、时间轴、可视化面板等）
│   ├── router/
│   ├── stores/
│   ├── utils/request.js        # Axios 实例、拦截器、VITE_API_BASE_URL
│   ├── views/HomeView.vue      # 主界面
│   ├── App.vue
│   ├── main.js
│   ├── style.css
│   └── theme.css
├── .env.development            # 本地环境变量示例（勿提交敏感信息）
├── .env.production
├── vite.config.js              # @ -> src
└── package.json
```

路由入口：`/` → `HomeView`；`/svg-test` → SVG 测试页。

---

## 5. 环境变量

| 变量 | 说明 |
|------|------|
| `VITE_API_BASE_URL` | 后端 API 根地址；未设置时 axios 默认使用 `/api`（需自行配置开发代理或网关） |
| `VITE_DEV_API_PROXY_TARGET` | 可选，仅开发服务器代理使用；不设置时使用 `VITE_API_BASE_URL` |
| `VITE_PIXEL_STREAMING_SIGNAL_URL` | UE Pixel Streaming 信令 WebSocket 地址，例如 `ws://host:port/` |
| `VITE_SVG_TEST_URL` | 可选，仅开发测试页使用的 SVG 示例地址 |
| `VITE_VOLUME_WORKER_TEST_CSV_URL` | 可选，仅开发测试脚本使用的 CSV 示例地址 |

开发示例见仓库内 `.env.development`（请按实际后端地址修改）。

---

## 6. 运行指南

**环境建议**：Node.js **18+**（推荐 **20+**，与 Vite 7 工具链兼容）。

```bash
# 安装依赖
npm install

# 开发（默认端口以 Vite 控制台为准，也可指定端口）
npm run dev
# 示例：npx vite --port=4000

# 生产构建
npm run build

# 本地预览构建结果
npm run preview
```

---

## 7. 像素流与信令（UE 联调）

1. **UE**：使用 Pixel Streaming 插件，启动时带上信令地址，例如  
   `-PixelStreamingURL="ws://<信令主机>:<端口>"`（具体以 UE 项目配置为准）。
2. **信令服务器**：可使用本仓库 `peer-stream/signal.js`（配合 `signal.json`），在 `peer-stream` 目录执行：
   ```bash
   cd peer-stream
   node signal.js
   ```
3. **前端**：`PixelStreamingPlayer` 会加载 `public/peer-stream.js` 并连接信令；**信令地址、端口、路径需与部署环境一致**（可在组件或环境变量中配置，以当前代码为准）。

更多参数（`one2one`、STUN、`auth` 等）见 [`peer-stream/README-zh.md`](peer-stream/README-zh.md)。

---

## 8. 设计说明（UI）

整体为暗色科技风：CSS 变量主题、玻璃拟态与光效、对 Element Plus 控件的样式覆盖；主布局支持侧栏与可视化面板的折叠与联动。

---

## 9. 许可证与说明

- 本项目 `package.json` 中标记为 `private`，部署与开源策略以团队约定为准。
- `peer-stream` 子目录遵循其原有说明与许可；企业版等信息见其 README。
