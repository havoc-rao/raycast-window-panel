# Raycast Window Panel

把 Hammerspoon 窗口操作面板（Ctrl+Cmd+H）平替为 Raycast 扩展：窗口排布、布局模板、布局记忆与整屏快照，全部在 Raycast 中完成，不再依赖自编译的魔改版 Hammerspoon。

## 功能一览

| 命令 | 模式 | 说明 |
| --- | --- | --- |
| 窗口操作面板 | view | 主菜单：当前窗口布局 / 自动排布 / 重放当前 App / 记忆 / 解除记忆 / 记忆设置 |
| 当前窗口布局 | view | 12 种单窗布局（铺满 / 留缝 / 居中 76% / 半屏 / 1/4 屏），只动当前窗口 |
| 自动排布 | view | 模板选择器：按当前弹性窗口数过滤模板（最近用过置前），含保存 / 重放 / 两步删除「我的布局」 |
| 按上次样式排布 | no-view | 一键按当前窗口数的上次样式排布（无记忆则默认：1 全屏 / 2 重叠 / 3+ 叠放） |
| 记忆当前窗口 | no-view | 保存窗口位置+大小，既是重放数据，也是自动排布的豁免名单 |
| 解除当前记忆 | no-view | 删除当前窗口的记忆记录 |
| 重放 App | view | 列出所有有记忆的 App（增强版），重放其全部已记忆窗口 |
| 管理记忆 | view | 全量记忆列表：搜索、单条重放 / 删除 |
| 从 Hammerspoon 导入 | no-view | 一次性导入 `~/.hammerspoon/window-layouts.json` 到本扩展数据文件 |

## 安装

### 本机日常使用（非开发调试）

在仓库目录执行：

```sh
npm install
npx ray build        # 本机构建（默认 -e dev）；不要加 -e dist
```

首次使用时，打开 Raycast，搜索并执行 `Import Extension`，选择本仓库目录（包含 `package.json` 的目录，不是 `dist`）：

```text
~/Documents/Projects/tools/macOS/raycast-window-panel
```

这里的「安装」是从源码导入到本机，不等于发布到 Raycast Store。日常使用不需要让 `ray develop` 一直运行；更新源码后，重新运行 `npm install && npx ray build`。

> `npx ray build -e dist` 用于验证分发构建，不是本机安装命令；`npx ray develop` 用于开发调试和自动重载。CLI 用法见 [Raycast 官方文档](https://developers.raycast.com/information/developer-tools/cli)。

### 权限与快捷键

1. 按上面的步骤完成本机导入。
2. 打开任意命令，若被系统拦截，请到 **系统设置 → 隐私与安全性** 给 Raycast 授权：
   - **辅助功能**（Accessibility）：窗口枚举 / 读取与移动的必需权限（windowkit 原生后端与 AppleScript 兜底共用同一授权）；
   - **自动化 → System Events**：允许 Raycast 控制 System Events（AppleScript 兜底路径使用，首次操作时系统会弹窗询问）。
3. 可选：给「按上次样式排布」等高频命令在 Raycast 中分配快捷键（命令右键 → Add Hotkey），替代原 Ctrl+Cmd+H。

> 首次使用新版本后，第一次执行命令会触发 windowkit 的原生后端编译（约 1–3 秒，仅一次；产物缓存于 `~/Library/Caches/raycast-window-panel/`），之后每次窗口操作都是毫秒级。编译失败或无 swift 环境时自动回落 AppleScript 后端，功能不受影响。

> 实测说明：窗口位置/大小的写入**不需要**屏幕录制权限（System Events + 辅助功能即可，本机对照实验验证）；屏幕录制仅用于 CGWindowList 的窗口名显示，本扩展未依赖。
>
> 行为说明：执行窗口移动/排布时，扩展会**先关闭 Raycast 面板**再写入窗口（`closeMainWindow()`，与原版 Hammerspoon「关面板→回焦→执行」的交互一致；多窗排布只关一次），随后以 Toast/HUD 反馈结果。成功路径不额外等待；写入偶发失败会延迟约 300ms 重试一次，仍失败（-10000 或窗口已失效）则给出对应提示。屏幕信息在命令内缓存约 1 秒，避免重复查询。

## 偏好项

| 名称 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| 布局数据文件路径 | textfield | `~/Library/Application Support/raycast-window-panel/window-layouts.json` | 记忆/快照数据文件（~ 自动展开），独立于 Hammerspoon |
| 记录到此 App | checkbox | 开 | 关闭后「记忆当前窗口」不写盘 |

## 数据与迁移

- 数据文件 schema 沿用原版 v2：`windows`（bundleID|标题 → 位置+大小，既是重放数据也是自动排布豁免名单）+ `snapshot`（纯槽位快照，按窗口顺序套用）。
- 与 Hammerspoon 的数据文件相互独立；首次使用可运行「从 Hammerspoon 导入」做一次性迁移（同键覆盖合并，快照替换）。

## 常用配置

- 排列参数见 `src/geometry.ts`：`EDGE_TWO`（两窗露条宽度，默认 60）、`GAP`（分屏缝宽，默认 4）。
- 新增排布模板 = 在 `src/templates.ts` 的 `layoutTemplates` 追加一条记录（`minN/maxN/order/keywords/fn` 纯几何函数），无需改 UI/引擎。

## 开发

```sh
npm install            # 安装依赖（@raycast/api、vitest、typescript 等）
npm test               # vitest：几何 golden 回归 + 模板/存储/引擎单测
npx ray build          # 本机构建，供导入 Raycast 后日常使用（见「安装」）
npx ray build -e dist  # 类型检查 + 分发构建验证（npm run build），不是本机安装
npx ray develop        # 注册进 Raycast 开发调试，监听源码变化（npm run dev）
```

## 架构

```text
commands/*.tsx (List UI + Toast/Alert)
   └─ src/actions.ts        业务编排（目标解析 → 引擎计划 → provider 执行 → 持久化/MRU）
        ├─ src/engine.ts    排布/记忆/快照业务（移植 init.lua：豁免划分、模板套用、匹配链）
        ├─ src/templates.ts 模板注册表（15 排布模板 + 2 特殊项 + 12 单窗规格 + MRU 排序）
        ├─ src/geometry.ts  纯几何（splitH/splitV/tiled/slotFrames/cascadeFrames/clampFrame）
        ├─ src/storage.ts   数据文件原子写（tmp+rename）+ LocalStorage 语义（MRU/上次样式/开关）
        ├─ src/panel-close.ts  写路径前置「关面板」语义（两后端共用 + 1.5s 去重记忆）
        ├─ src/provider-windowkit.ts  主后端：常驻 swift helper（Hammerspoon 同构）
        │     ├─ assets/windowkit.swift  原生 AX + NSWorkspace + NSScreen，stdio 换行 JSON 协议
        │     └─ 首次使用 swiftc 自动编译缓存（~/Library/Caches/raycast-window-panel/），失败回落 ↓
        └─ src/provider-applescript.ts  兜底后端：System Events（目标 App 身份 + AXFocusedWindow /
                                          AXMainWindow，句柄 = unix id + 窗口索引，AXFullScreen 拦截）
```

- 主后端 windowkit：扩展启动时 spawn 一个常驻 swift 进程，窗口枚举/读写/屏幕全部为进程内原生 API 调用（单次操作 ~1–5ms，与 Hammerspoon 同构），消除 osascript 每次 ~125ms 的进程开销；辅助功能未授权 / 无 swiftc / 编译失败 / 进程崩溃时自动回落 AppleScript 后端；
- 目标窗口：通过 Raycast 获取唤起前的 App，优先按 bundle ID 定位进程，定向读取 `AXFocusedWindow` / `AXMainWindow`；不再扫描所有 App 后按名字取第一个窗口（多个 Electron 进程可能同名）。无法可靠确定目标时不猜测其他 App 的窗口；
- 排布 z 序近似：焦点优先 + 前台 App 优先（v1）；CGWindowList 精确 z 序为后续增强；
- 已知限制：受应用最小窗口尺寸限制（与原版一致）；后端无法移动部分应用拒绝 AX 写入的窗口时会给出提示。

## 相关文档

- [PLAN.md](./PLAN.md)（已确认的实施方案）
- [SPIKE.md](./SPIKE.md)（P0 探针与写窗口定案取证）
- [BLOCKERS.md](./BLOCKERS.md)（阻塞与遗留事项）