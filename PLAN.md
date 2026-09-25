# Raycast 插件化方案：窗口面板（raycast-window-panel）

> 把 `~/.hammerspoon` 的窗口操作面板（Ctrl+Cmd+H）转化为独立的 Raycast 扩展。
> 独立仓库：`~/Documents/Projects/tools/macOS/raycast-window-panel`
> 状态：**已确认决策，待实施（P0 开始）**

## 一、目标与背景

原版是基于 Hammerspoon 的窗口操作面板，使用 `Ctrl+Cmd+H` 唤起，支持搜索、键盘/鼠标执行窗口排布和布局记忆。它依赖一份**自编译的魔改版 Hammerspoon**（为 WebView 增加原生键盘事件回调与强制聚焦，`dc76bbd` 提交），维护成本高。

本插件目标是**全功能平替**：把同样的窗口排布、模板记忆、布局快照能力搬进 Raycast，剥离对魔改 Hammerspoon 的依赖，并获得两个增强能力（restore-app 可选 App、manage-memories 全量记忆管理）。

## 二、现状盘点（要移植的功能）

| 原功能 | 说明 | 对应数据/逻辑 |
| --- | --- | --- |
| 当前窗口布局 | 12 种单窗口布局（铺满/留缝/居中 76%/半屏/1/4），只动当前窗口 | `single-layout.lua` |
| 自动排布 | 按模板排当前屏幕「弹性窗口」；记忆窗口豁免（原位不动、不参与计数）；Enter 按上次样式；子菜单支持模板搜索/网格导航/预览 | `layoutTemplates` + `arrangeContext`/`arrangeWithTemplate` |
| 我的布局（快照） | 保存当前弹性窗口摆放为纯槽位；重放按窗口顺序简单套用；连按两次 Delete 两步确认删除 | `snapshot` 字段 + 两步确认态 |
| 重放当前 App | 按 bundleID 恢复该 App 全部已记忆窗口 | `findWindow` 匹配链 |
| 记忆当前窗口 | 保存窗口位置+大小（记忆即规则：既是重放数据，也是自动排布的豁免名单） | `windows` 表 |
| 解除当前记忆 | 删除该窗口的记忆 | `windows` 表 |
| 重载配置 | 热重载 init.lua | —（Raycast 无对应物，**删除**） |

数据模型 v2（`window-layouts.json`）：

```json
{
  "windows": {
    "com.apple.Terminal|zsh — 80×24": {
      "id": 12345, "bundleID": "com.apple.Terminal", "title": "zsh — 80×24",
      "frame": { "x": 0, "y": 39, "w": 900, "h": 600 }
    }
  },
  "snapshot": {
    "savedAt": 1788372000, "count": 2,
    "frames": [ { "x": 0, "y": 39, "w": 1440, "h": 900 } ]
  }
}
```

要点：`windows` 每条 = 位置+大小（重放数据 + 排布豁免规则）；`snapshot` = 纯槽位（不记录 app 身份，按窗口顺序套用）。匹配优先级：CGWindowID（会话内）→ bundleID+标题 → 同 bundleID 首个窗口。

## 三、已确认的关键决策

| 项 | 决定 | 理由 |
| --- | --- | --- |
| 位置 | 独立仓库 `~/Documents/Projects/tools/macOS/raycast-window-panel`（不入 raycast-monorepo） | 用户选择；标准 Raycast 扩展布局 |
| 窗口后端 | **AppleScript（osascript + System Events）为主**——用户无 Raycast Pro；原生 `WindowManagement` API 保留在代码中，有 Pro 时 `environment.canAccess()` 自动启用 | 零依赖、开箱即用；薄适配层可随时切换 |
| 数据文件 | **独立**：`~/Library/Application Support/raycast-window-panel/window-layouts.json`（偏好可改路径，schema 沿用 v2） | 用户选择；配一次性「从 Hammerspoon 导入」命令 |
| 范围 | 全功能平替 + 2 个增强命令 | 用户选择 |

## 四、架构设计

```text
commands/*.tsx (UI: List + Navigation + Alert + Toast)
      │
src/engine.ts         排布/记忆/快照业务（移植 init.lua 逻辑）
src/templates.ts      模板注册表 + 12 单窗规格 + 默认/上次/MRU 排序
src/geometry.ts       纯几何函数：splitH / splitV / tiled / slotFrames / cascadeFrames
src/storage.ts        JSON 原子写（tmp+rename）+ Raycast LocalStorage（MRU/上次样式）
src/windows.ts        Provider 接口：目标窗口 / 桌面窗口枚举 / setBounds / 屏幕区域
src/provider-applescript.ts   osascript System Events（主后端）
src/provider-native.ts        WindowManagement API（Pro 时自动启用，未来）
src/preview.tsx       模板预览缩略（次要优先级）
tests/geometry.test.ts golden 回归（从 Lua 采样帧，保证几何一致）
```

### 分层原则

1. **纯 TS 核心零依赖**：geometry / templates / storage / engine 不 import 任何 Raycast API（便于 vitest 测试与 golden 回归）；
2. **Provider 薄适配层**：`windows.ts` 定义统一接口，两个后端实现同样的语义；运行时自动选择；
3. **几何 1:1 移植**：`layoutTemplates` 注册表（`minN/maxN/order/keywords/fn` 纯函数）+ 12 单窗规格按原样平移，新增模板 = 追加一条记录。

### Provider 接口

```ts
interface TargetWindow {
  id: string;            // 进程 unix id + 窗口索引（稳定句柄）
  appName: string;
  bundleId: string;
  title: string;
  bounds: { x: number; y: number; w: number; h: number };
  fullScreen: boolean;   // AXFullScreen → 排布前提示先退出（与原版一致）
  positionable: boolean;
  resizable: boolean;    // 受应用最小窗口尺寸限制，与原版一致
}
interface WindowProvider {
  getActiveWindow(): Promise<TargetWindow>;       // 唤起前的目标窗口
  listWindowsOnActiveDesktop(): Promise<TargetWindow[]>; // 弹性/记忆窗口枚举
  getScreenRegion(w: TargetWindow): Promise<Region>;     // 目标屏幕区域（w×h 原版用全屏 frame）
  setBounds(w: TargetWindow, frame: Frame): Promise<void>;
}
```

### 关键移植点

- **目标窗口**：`frontmost application process` + 其 front window（Raycast 面板不夺取前台 App 焦点，P0 spike 实证）；
- **窗口中转**：Standard 窗口过滤用 `AXSubrole == "AXStandardWindow"`；原生全屏检测用 `AXFullScreen`；
- **排布 z 序近似**：焦点窗第一位，其余按「前台 App 优先 → 窗口列表序」（AppleScript 拿不到 CGWindowList 真 z 序，v1 接受近似，P5 用 swift helper 补齐）；
- **屏幕区域**：目标窗口 bounds 锚定 + 主屏原点启发式（多屏精度问题记录在案，P5 解决）；
- **原子写**：先写 `.tmp` 再 rename，避免写中断破坏数据（沿用原版）；
- **两步删除快照**：Alert 确认弹窗（替代原版连按两次 Delete）；
- **MRU/上次样式**：Raycast `LocalStorage`，key 语义对应原 `hs.settings` 的 `windowPanel.arrangeTemplate.N` / `arrangeRecent` / `singleRecent` / `memoryTargetEnabled`。

## 五、命令设计

| 命令 | mode | 对应原功能 | 说明 |
| --- | --- | --- | --- |
| `window-panel` | view | 原面板 6 项 | 主菜单：当前窗口布局 / 自动排布 / 重放当前 App / 记忆 / 解除记忆 |
| `window-layout` | view | 当前窗口布局子菜单 | 12 布局直接选，搜索即滤，Enter 套用 |
| `arrange` | view | 自动排布子菜单 | 模板选择器：按当前弹性窗口数过滤，含「保存/重放我的布局」，MRU 置前 |
| `arrange-last` | no-view | 原主列表 Enter | 一键按上次样式排布（无记忆则默认：1 全屏/2 重叠/3+ 叠放） |
| `restore-app` | view | 重放当前 App（**增强**） | 列出所有有记忆的 App 供选择，不再限于当前 App |
| `save-window` | no-view | 记忆当前窗口 | Toast 反馈；受「记录到此 App」开关控制 |
| `forget-window` | no-view | 解除当前记忆 | Toast 反馈 |
| `manage-memories` | view | —（**增强**） | 全量记忆列表：搜索、单条重放/删除 |
| `import-from-hammerspoon` | no-view | —（可选） | 一次性导入 `~/.hammerspoon/window-layouts.json` |

### 交互语义对照

| 原版 | Raycast 版 |
| --- | --- |
| 打字过滤搜索 | List 原生搜索 |
| 模板子菜单 → 网格 + Esc 返回 | Navigation push，Esc 天然返回上级 |
| 数字键 1-9/0 快捷执行 | 不映射（List 自带索引） |
| 连按两次 Delete 删快照 | Alert 确认弹窗 |
| 面板顶部目标 App/Logo/PID/尺寸 | List header 或 Detail 展示（App 名/图标/标题/记忆数/是否已有记忆） |

## 六、偏好项

| 名称 | 类型 | 默认 |
| --- | --- | --- |
| `layoutsPath` | textfield | `~/Library/Application Support/raycast-window-panel/window-layouts.json` |
| `memoryTargetEnabled` | checkbox | true（记录到此 App 开关，控制 save-window 是否写盘） |

## 七、实施阶段

- **P0** 仓库脚手架（package.json / raycast-env.d.ts / tsconfig，`ray develop` 跑通）+ **关键 spike**：验证 Raycast 面板打开时 `frontmost` 语义、System Events 窗口枚举与 bounds 读写。先写 30 行 osascript 探针脚本实测；
- **P1** 纯 TS 核心：types / geometry / templates / storage / engine + vitest golden 回归（从 Lua 采样 5 组样本帧）；
- **P2** AppleScript provider + 布局命令（window-layout / arrange / arrange-last / window-panel 主菜单）；
- **P3** 记忆命令（save / forget / restore-app / manage-memories）+ 快照三步曲（保存/重放/两步删除）+ 偏好 + import-from-hammerspoon；
- **P4** 打磨：toast/错误态（无权限、无焦点窗口、全屏拦截）、图标、README、与 Hammerspoon 版并行实测；
- **P5**（可选，按需）`swiftc` 小助手 `windowkit`（本机 Swift 6.4 可用，首次自动编译并缓存）：精确 CGWindowList z 序 + 各屏 bounds，排布保真度对齐原版；无 swift 环境自动回落 AppleScript。

## 八、风险与应对

| 风险 | 应对 |
| --- | --- |
| 无 Raycast Pro | AppleScript 后端为主；原生 API 代码保留，将来有 Pro 自动启用（`environment.canAccess`） |
| Raycast 面板打开时 `frontmost` 语义不确定 | P0 spike 实证；备选：spawn 时 NSWorkspace 探针 / 记录上一次外部焦点 |
| AppleScript 无真 z 序 / 多屏区域不精确 | v1 近似（焦点优先 + App 优先序）；P5 swift helper 精确化 |
| 权限 | 需给 Raycast 授予辅助功能权限（System Events 读写窗口的硬性要求，与 Raycast 自带窗口管理同一授权） |
| API 行为细节（window id 稳定性、fullscreen 检测） | P2 真实环境验证 |
| 应用最小窗口尺寸限制 | 与原版一致：实际结果受应用限制，不额外处理 |
| 数据分叉（与 Hammerspoon 各写各的） | 用户已确认独立文件；import 命令做一次性迁移 |

## 九、参考文档

- [Raycast Window Management API（需 Pro）](https://developers.raycast.com/api-reference/window-management.md)
- [Raycast Window Management 核心功能](https://www.raycast.com/core-features/window-management)
- 原版逻辑：`~/.hammerspoon/init.lua`、`~/.hammerspoon/single-layout.lua`、`~/.hammerspoon/README.md`