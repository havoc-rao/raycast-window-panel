# Electron 窗口目标与单窗操作延迟

## 用户反馈

- 调整窗口大小响应慢。
- 选中部分窗口后找不到对应目标，具体包括 Electron 启动的 DeepSeek Harness 本体。

## 已确认的旧实现问题

`src/provider-applescript.ts` 的 `getActiveWindow()` 原先先枚举所有可见应用窗口，再查询前台进程名，按 `appName` 匹配并取第一个标准窗口：

- 单窗操作被所有其他应用的 AX 响应耗时拖累。
- 多个 Electron 应用可能进程同名，名字不是唯一身份。本机只读查询确认同时存在名为 Electron 的进程，bundle ID 分别为 `com.tencent.codebuddycn` 和 `com.github.Electron`。这不代表前者就是 Harness；取证时用户可能已切换前台。
- 第一个枚举窗口未必是焦点窗口；只接受 AXStandardWindow 也可能漏掉合法的已聚焦非标准窗口。
- 前台是 Raycast 时取任意其他应用首窗的兜底不安全。

## 修复方向

使用 Raycast `getFrontmostApplication()` 确定唤起前 App，再按 bundle ID 定位 System Events 进程；没有 bundle ID 时才尝试精确名称。应用身份有歧义时不猜测。只在目标进程内读取 AXFocusedWindow / AXMainWindow，映射回实际窗口索引，不全局扫描，也不任意选择其他 App。

当前安装的 Raycast API 的 Application 类型没有 PID 字段，不要假设存在 processId。

后台窗口列表的标准窗口过滤与已聚焦目标窗口的接受策略应区分，不应为了兼容 Electron 无条件放宽所有后台窗口。

## 相关屏幕缺陷

旧屏幕解析用所有字段 > 0 判断有效性，会拒绝主屏的 (0,0) 和副屏负坐标，退回硬编码 2560×1440。AppKit 原点方向与 AX 不同，还需要以主屏顶部转换 Y 轴。该错误会造成布局位置/尺寸异常，不等于焦点识别问题。

## 实机验证新增发现（尚待修复）

首次 bundle ID 定向查找方案通过 102 项测试和 osacompile，已构建到安装目录，但随后只读实机验证暴露更深层问题：`application processes whose bundle identifier is "com.github.Electron"` 返回的对象在循环内取属性，实际读出另一同名 Electron 进程的 PID 11228，并在 `AXFocusedWindow` 报 -1728，错误引用显示 `application process "Electron"`。这说明 System Events 的进程对象引用可能退化为按名字解析，不能把 bundle ID 筛选本身当作已可靠定位。后续只读实验验证：先批量读取 `unix id of (application processes whose bundle identifier is ...)`，再用 `set p to a reference to (first application process whose unix id is targetPid)`，能正确返回 Harness 的 PID 73245 和 bundle ID `com.github.Electron`，没有串到 11228。JXA 的 NSWorkspace PID + System Events whose PID 也能正确读取身份。

但接下来读取窗口数量时报 `-25211：osascript 不允许辅助访问`。这是诊断执行环境的 AX 授权限制，不能推断 Raycast 自身未授权。尚未实测 AXFocusedWindow、窗口相等性比较或移动窗口成功；需在 Raycast 内复测。读、写、置顶都必须避免把 PID 定位的对象固化成 name-based specifier。

## 最终本轮交付验证

- 实现批量取 PID + 延迟 PID 引用，覆盖目标读取、写 bounds 和 raise；读取焦点映射为索引后重新用 PID + index 引用读取属性。
- 最终回归测试共 104 项通过，TypeScript 检查及 diff 格式检查通过；目标读取、写 bounds 和 raise 三段生成 AppleScript 均经 osacompile 语法检查通过（仅编译，未执行窗口写入）。
- `npm run build` 经权限审批成功写入 Raycast 扩展目录。
- 未执行实机移动窗口，尚待用户在 Raycast 内针对 Harness 验证。性能只确认减少全局枚举路径，没有可报告的实测提速数值。

## 性能小优化（第二轮，已完成）

用户确认目标识别修复后仍慢，先做低风险小优化，不换后端：

- 移除成功路径无条件 `sleep(250)`：`ensurePanelClosed()` 关闭面板后立即写入；写入失败时才延迟 300ms 重试一次（保留 1500ms 最近关闭启发式，避免多窗排布重复关面板）。
- 屏幕信息每实例缓存 1 秒（TTL 从成功读取完成时起算），in-flight 请求去重，所有返回防御性克隆；失败/被拒/主屏无效的读取走 2560×1440 兜底且不缓存。
- 不缓存任何窗口信息（索引易失效，防止错窗）。
- 命令层加入分段计时日志 `src/timing.ts`（console.debug，不记录窗口标题）：`single.target / single.screen / single.write`、`arrange.target / arrange.screen / arrange.write[i]`，用于定位剩余延迟占比。
- 最终 114 项测试通过（provider 39 项新增 fake-timer 覆盖：成功无定时器、重试 300ms 且最多 2 次、缓存 TTL/去重/克隆/失败不缓存/实例隔离），tsc 与 diff check 通过，`npm run build` 已部署。
- 单窗布局路径现在的调用链：目标识别（1 次 osascript）→ 屏幕（可能命中缓存，0 次）→ 关面板（无等待）→ 写窗口（1 次 osascript）。剩余主要开销 = 2 次 osascript 进程启动 + System Events 对目标应用的 AX 往返 + 应用自身响应。

## 性能与验证边界

去除全局枚举和固定等待只减少固定开销，不能据此声称已实测提速；剩余延迟中应用自身 AX 响应和 osascript 启动仍占大头。分段时间日志能区分是脚本启动、System Events 还是 Harness 自身慢，但需在开发模式（`ray develop` 终端）下才能看到 console.debug。

窗口句柄仍是 PID + 索引，并非稳定 AX 标识，目标解析到写入期间窗口列表变化的风险尚未根除。

Mock 测试用于验证路由、解析和错误处理；AppleScript 还需 osacompile 语法验证，最终必须在 Raycast 中选中 Harness 实测。不在未确认前记录“Electron 漏检已解决”或具体提速倍数。也不要在用户未明确同意的情况下用诊断脚本移动其窗口。

长期方案（未实施）：原生 Swift helper 直接调 AX API，可省去 osascript 进程启动与 System Events 中转；需要评估辅助功能授权、打包方式与应用兼容性。
