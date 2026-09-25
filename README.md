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

1. 打开 Raycast → `Import Extension…`（Extensions → `+` → Import Extension），选择本目录：
   ```
   ~/Documents/Projects/tools/macOS/raycast-window-panel
   ```
   或开发模式：在仓库目录运行 `npm install && npx ray develop`。
2. 打开任意命令，若被系统拦截，请到 **系统设置 → 隐私与安全性** 给 Raycast 授权：
   - **辅助功能**（Accessibility）：窗口枚举 / 读取与移动的必需权限；
   - **自动化 → System Events**：允许 Raycast 控制 System Events（首次操作时系统会弹窗询问）。
3. 可选：给「按上次样式排布」等高频命令在 Raycast 中分配快捷键（命令右键 → Add Hotkey），替代原 Ctrl+Cmd+H。

> 实测说明：窗口位置/大小的写入**不需要**屏幕录制权限（System Events + 辅助功能即可，本机对照实验验证）；屏幕录制仅用于 CGWindowList 的窗口名显示，本扩展未依赖。
>
> 行为说明：执行窗口移动/排布时，扩展会**先关闭 Raycast 面板**再写入窗口（`closeMainWindow()` + 短暂等待，与原版 Hammerspoon「关面板→回焦→执行」的交互一致；多窗排布只关一次），随后以 Toast/HUD 反馈结果。写入失败（-10000 或窗口已失效）会给出对应提示。

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
npm install          # 安装依赖（@raycast/api、vitest、typescript 等）
npm test             # vitest：几何 golden 回归 + 模板/存储/引擎单测
npx ray build -e dist   # 类型检查 + 构建
npx ray develop      # 注册进 Raycast 开发调试
```

## 架构

```text
commands/*.tsx (List UI + Toast/Alert)
   └─ src/actions.ts        业务编排（目标解析 → 引擎计划 → provider 执行 → 持久化/MRU）
        ├─ src/engine.ts    排布/记忆/快照业务（移植 init.lua：豁免划分、模板套用、匹配链）
        ├─ src/templates.ts 模板注册表（15 排布模板 + 2 特殊项 + 12 单窗规格 + MRU 排序）
        ├─ src/geometry.ts  纯几何（splitH/splitV/tiled/slotFrames/cascadeFrames/clampFrame）
        ├─ src/storage.ts   数据文件原子写（tmp+rename）+ LocalStorage 语义（MRU/上次样式/开关）
        └─ src/provider-applescript.ts  System Events 后端（目标窗口 frontmost+front window，
                                           句柄 = unix id + 窗口索引，AXSubrole 标准过滤，AXFullScreen 拦截）
```

- 目标窗口：Raycast 面板打开时 System Events `frontmost` 仍返回唤起前的 App（已实测），`window 1` 即目标窗口；
- 排布 z 序近似：焦点优先 + 前台 App 优先（v1）；P5 计划用 swift helper（CGWindowList 精确 z 序 + 多屏 bounds，扩展内 spawn 已实测 AX 可信）精化；
- 已知限制：受应用最小窗口尺寸限制（与原版一致）；AppleScript 后端无法移动部分应用拒绝 AX 写入的窗口时会给出提示。

## 相关文档

- [PLAN.md](./PLAN.md)（已确认的实施方案）
- [SPIKE.md](./SPIKE.md)（P0 探针与写窗口定案取证）
- [BLOCKERS.md](./BLOCKERS.md)（阻塞与遗留事项）