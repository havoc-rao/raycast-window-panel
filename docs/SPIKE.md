# SPIKE 取证报告 · Raycast 窗口面板（P0）

> 时间：2026-09-25 15:08–15:15（本地）；机器：macOS（Apple Silicon，系统 x.y），Raycast 已装、无 Pro。
> 目的：实证 PLAN.md 中两个关键不确定点 —— (a) Raycast 面板打开时 `frontmost` 语义；(b) System Events 窗口枚举 / bounds 读写 / AXSubrole / AXFullScreen 的可靠性。探针结论直接决定 P2 实现方式。

## 0. 取证方法（真实运行，非模拟）

宿主 shell（本委派会话）**无** Automation（-10004）与 Accessibility（`AXIsProcessTrusted()=false`）权限，因此 AX 相关取证全部在**真实 Raycast 扩展进程内**完成：

1. `ray develop` 注册扩展到 `~/.config/raycast/extensions/raycast-window-panel`；
2. 通过 deep link `raycast://extensions/havoc/raycast-window-panel/spike-probe[-noview]` 自动唤起真实命令：
   - `spike-probe`（view）：面板保持打开约 2s 后执行探针（面板打开中的状态）；
   - `spike-probe-noview`（no-view）：命令执行瞬间执行探针；
3. 探针在扩展进程内调用 `osascript`（AppleScript/JXA）与自编译的 `windowkit`（swift + CGWindowList），结果增量写入 `.cache/spike/results.jsonl`（原始数据留存）。
4. 宿主侧仅做无权限依赖的取证：NSWorkspace frontmost、swift CGWindowList z 序。

## 1. 结果 (a)：面板打开时 frontmost 语义 —— **System Events frontmost 稳定返回目标 App**

三次真实运行（view ×2、no-view ×1，面板打开状态下执行），`tell application "System Events" to get name of first application process whose frontmost is true` 全部返回唤起前的目标 App（当时为 Electron 编辑器）：

| 运行 | frontmost(SystemEvents) | frontmost(NSWorkspace) |
| --- | --- | --- |
| view #1 (15:09) | **Electron**（目标 App） | Electron |
| view #2 (15:10) | **Electron**（目标 App） | Raycast |
| no-view (15:11) | **Electron**（目标 App） | Raycast/Electron（不稳定） |

宿主侧对照（view 面板打开 1.2s 时）：NSWorkspace frontmost = Electron。

**结论**：Raycast 面板是**非激活式**浮动面板（`layer=8` floating window，见 §3），不夺取前台 App 焦点；`System Events` 的 `frontmost` 在面板打开与命令执行期间都可靠地指向「唤起前的目标 App」。PLAN.md 的 P2 假设（目标窗口 = frontmost + front window）**成立**。`NSWorkspace.frontmostApplication` 结果不稳定（激活时序相关），**不作为目标解析依据**。

## 2. 结果 (b)：System Events 窗口能力 —— 读可靠，写受「屏幕录制」权限门控

扩展进程内 `AXIsProcessTrusted()=true`（Raycast 有辅助功能权限）。对前台 App（Electron）实测：

| 能力 | 结果 | 证据 |
| --- | --- | --- |
| 枚举窗口 | ✅ | `name of every window of application process` 返回全部窗口标题 |
| 读 position / size | ✅ | `{9, 145, 2178, 1289}` 等 |
| AXSubrole | ✅ | `AXStandardWindow`（标准窗口过滤可用） |
| AXFullScreen | ✅ | `false`（原生全屏检测可用） |
| **写 position / size** | ❌ `-10000` AppleEvent 处理程序失败 | 对所有被测应用一致（见下） |

写失败对照矩阵（同值写入 = 无副作用的最小区写测试，全部失败）：

| 应用 | 类型 | position 写 | size 写 |
| --- | --- | --- | --- |
| Calculator | **AppKit（苹果自家）** | FAIL | FAIL |
| CodeBuddy CN | Electron/CEF | FAIL | FAIL |
| Electron（dsh-remote） | Electron/CEF | FAIL | FAIL |

排除项：
- 不是「前端应用可写、后台不可写」：对 frontmost（Electron）写同样失败；
- 不是应用层拒绝：苹果自家 AppKit 应用（Calculator）同样失败；
- 不是 osascript 语法问题：`set position of window 1 to {当前值}` 最小写法亦失败；
- 扩展内 raw AX（`AXUIElementSetAttributeValue`）不可用：osascript 子进程 `-25201`（kAXErrorAPIDisabled，子进程不继承父进程 AX 信任）——**System Events 是唯一可行的 AX 通道**；
- CGWindowList 窗口名（kCGWindowName）在扩展内取样**全部为空** —— 无「屏幕录制」权限的已知旁证（macOS 10.15+ 属性门控）。

**结论（已被 §6/§7 定案取代，历史记录保留）**：早期曾将写失败归因于「屏幕录制」权限门控与「面板打开」状态，后续对照矩阵（§6 六变体、§7 三组 + 非前台 App 对照）证明两者均不成立 —— `-10000` 的真实机制是探针脚本自身的「内联读取写法」（`set position of window 1 to (position of window 1)`，System Events 的 set-RHS 自引用陷阱）。**当前定案：写窗口仅需 Raycast 的辅助功能 + 自动化权限（本机已具备），无需屏幕录制；生产写路径 = 字面量 + unix id 寻址（provider-applescript.ts），写入前统一 `closeMainWindow()`（防御 + 与原版「关面板→回焦→执行」UX 一致）。** CGWindowList 窗口名为空（无屏幕录制）是独立事实，仅影响窗口名显示/P5 诊断增强，不影响写路径。

## 3. 结果 (c)：z 序与 Raycast 面板位置 —— 面板 = layer 8，目标窗口在其下第一层

ccGeWindowList（swift windowkit，扩展内与宿主侧取样一致，面板打开时）：

```
layer=25 控制中心（状态栏项）
layer=24 Window Server（菜单栏）/ 截屏
layer=8  Raycast（panel，bounds 825×523 @ 1662,116）   ← Raycast 面板，浮动层
layer=0  Electron（2432×1410 @ 128,30）               ← 唤起前的目标窗口
layer=0  CodeBuddy CN（2178×1289 @ 9,145）
layer<0  通知中心（不可见）
```

- `kCGWindowLayer==0` 即标准应用窗口；Raycast 面板在 layer 8，永远排在应用窗口之上；
- **引起面板前的目标窗口 = layer-0 最上层**（此时即 Electron）——为「frontmost 若异常为 Raycast 时的兜底解析」提供依据；
- CGWindowList 的 owner PID / layer / bounds 无权限亦可读（仅窗口名需屏幕录制）——P5 swift helper 路线验证可行（windowkit 已在本机编译运行）。

## 4. 对 P2 实现的决定

1. **目标窗口**：`frontmost application process`（System Events）+ `window 1`；面板打开时可靠（§1）。防御性兜底：若 frontmost 为 Raycast → 取 CGWindowList 首个非 Raycast 的 layer-0 窗口（§3）。
2. **窗口枚举**：System Events 全可见进程窗口（一次调用批量读），标准窗口按 AXSubrole==AXStandardWindow 过滤，AXFullScreen 拦截；z 序近似 = 焦点窗第一 + 前台 App 窗口序 + 其余进程（PLAN 已批准 v1 近似）。
3. **屏幕区域**：JXA `CGDisplayBounds`/`NSScreen.screens`（已实测可读：main 2560×1440，`{origin:{x,y}, size:{width,height}}`）。
4. **写窗口**：System Events `set position/size`（待用户授予屏幕录制后生效）；失败时 toast 提示权限要求。
5. **性能**：读取类操作合并为每命令 1–2 次 osascript 调用；单次调用 60–150ms，可接受（与 Hammerspoon 原版同量级）。

## 5. 遗留风险

- 「屏幕录制」授权后写路径未能在本环境端到端复验（授权需要用户在系统设置中操作）——用户授权后应做一次实测（P4 并行实测项）。
- Raycast 面板在「用户通过热键唤起」与 deep link 唤起的行为一致性：deep link 是当前唯一自动化通道；热键唤起同样走非激活面板路径，风险低，但建议用户实装后按 README 验证一遍。
## 6. 定案（续跑轮 2026-09-25）—— -10000 根因 = 探针脚本写法，非权限、非面板状态

续跑轮按任务书做了决定性对照实验（全矩阵见下，原始记录：`.cache/spike/write-gate.jsonl`、`.cache/spike/results.jsonl`）。

### 6.1 实验与结果

| 实验 | 条件 | 结果 |
| --- | --- | --- |
| A view 面板打开 T0/T300 同值写 | `spike-write-view`，面板全程打开 | ✅ OK ×4（含按名/按 pid） |
| A view `closeMainWindow`+300ms 后写 | 同上，关面板后 | ✅ OK（按名/按 pid） |
| B no-view T0/T1s/T+close 写 | `spike-write-noview` | ✅ OK ×5 |
| D 写法矩阵（6 变体，同一条命令内） | `spike-write-matrix` | V1 内联读按名 → **-10000**；V6 内联读按 pid → 语义错误；**V2–V5（变量先读 / 字面量）→ 全部 OK** |
| C raw AX 直写（swift helper，扩展 spawn） | 面板开 + 关 | ✅ `trusted=true`，`setPosErr=0`；宿主直接运行对照：`trusted=false, -25211` |

### 6.2 结论（修正 §2 的屏幕录制假设 —— 已证伪，以下为定案）

1. **写窗口无需屏幕录制权限，也无需面板关闭**：`-10000` 只出现在探针自带的「内联读取写法」`set position of window 1 to (position of window 1)` 中（System Events/AppleScript 陷阱：set 语句 RHS 直接引用同一 window 的 getter 会失败）；改为「先读进变量」或「字面量（`{x, y}` 花括号列表）」后，面板开/关、寻址方式、目标应用均 100% 成功。
2. **生产写路径（provider-applescript.ts 现状即为定案实现）**：System Events `set position/size of window N of first application process whose unix id is PID to {x, y}/{w, h}` —— 字面量、按 unix id 寻址。该路径在真实 Raycast 内已验证成功。
3. **权限要求收敛为**：给 Raycast「辅助功能」+「自动化（控制 System Events）」即可（本机实测 `AXIsProcessTrusted=true`、SE 读写全通）。屏幕录制（Screen Recording）只影响 `CGWindowList` 的窗口**名称**（`kCGWindowName` 为空），**不影响写窗口**；如需在扩展内显示窗口名可另行授权，非必需。
4. **P5 swift helper 路线验证可行**：由扩展进程 spawn 的辅助二进制 AX 可信（`trusted=true`，AX 直读直写成功）——精确 z 序（CGWindowList）+ 多屏 bounds + 可选 AX 直写均可用该路线；宿主命令行直接运行则不可信（`-25211`），即 helper 只能在 Raycast 会话内生效。
5. 历史记录说明：15:14 之前所有 `-10000` 均来自探针自身写法问题（`boundswrite`/`writesTargeted` 变体），与当时观测到的「no-view 成功」差异同源 —— provider 早期冒烟（15:25，字面量写法）即成功。

## 7. 第 3 轮定案（2026-09-25）—— 父侧「面板态门控」假设对照实验：证伪，机制 = 脚本写法

父侧核查 `.cache/spike` 发现 provider-smoke（07:26:48，no-view）写成功与 results.jsonl（07:27:01，view 探针）全失败相隔十几秒，提出「面板打开期间目标 App 处于非激活态 → 对其窗口写被拒」的机制假设。按任务书跑 3 组对照（原始记录：`.cache/spike/writecheck.jsonl`，`spike-writecheck`/`spike-writecheck-noview` 命令）：

| 组 | 条件 | 结果 |
| --- | --- | --- |
| a | no-view 生产写法连跑（t0/t1s/t2s/afterClose） | **OK ×4（稳定成功）** |
| c1 | **view 面板打开**（NSWorkspace frontmost=Raycast）+ 生产写法写前台窗口 | **OK** |
| c2 | **view 面板打开** + 历史探针原样（内联读取写法） | **-10000（复现历史基线故障）** |
| c3 | **view 面板打开** + 生产写法写**非前台 App** 窗口（pid 11228，与前台 37186 不同） | **OK** |
| b | view：`closeMainWindow()` → sleep 250ms → 生产写法 | **OK（生产修复路径稳定）** |

**定案**：
1. 「面板打开/目标非激活 → 写被拒」**不成立**：c1 与 c3 在 NSWorkspace frontmost=Raycast、面板全程打开时写成功（含非前台 App）。
2. 唯一复现 -10000 的场景是 c2 —— 与面板状态无关的**内联读取写法** `set position of window 1 to (position of window 1)`（System Events/AppleScript 的 set-RHS 自引用陷阱）；对照矩阵（§6 的 V1–V6 与本节 c2/c1）均指向同一机制。07:26/07:27 的矛盾即由此解释：smoke 的 provider 脚本用字面量（成功），探针用内联/缺花括号写法（失败）。
3. 生产写路径（已落地）：`setBounds` 前统一 `ensurePanelClosed()`（`closeMainWindow()` → sleep 250ms，模块级记忆避免多窗排布重复关面板；偶发失败再关一次 + 300ms 重试）→ 字面量 + unix id 寻址写。对照实验 a/b 确认该路径稳定。
4. 保留独立事实：「CGWindowList 窗口名为空 = 无屏幕录制」仅影响窗口名显示（P5 诊断增强），与写路径无关。
