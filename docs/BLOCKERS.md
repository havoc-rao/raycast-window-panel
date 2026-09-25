# BLOCKERS · 阻塞与遗留事项

> 按任务书：任何阶段遇阻塞均如实记录，不绕开、不伪造。（2026-09-25，第 3 轮已更新定案）

## 1. 窗口写入机制定案（第 3 轮对照实验完成，无阻塞）

- **机制**：`-10000` 写失败 = System Events/AppleScript 的「内联读取写法」陷阱（`set position of window 1 to (position of window 1)`）；与权限、面板开/关、寻址方式、目标应用（含非前台 App）均无关。两组对照证据：§6 六变体矩阵（V1/V6 内联→失败，V2–V5 变量/字面量→成功）+ §7 三组实验（面板打开仍可写非前台 App；唯一失败场景为内联写法）。
- **生产路径（已落地）**：`setBounds` 前统一 `ensurePanelClosed()`（`closeMainWindow()` + 250ms，模块级记忆；偶发失败重试一次）→ 字面量 + unix id 寻址写。任务书要求的 view/no-view 对照（a/b/c 组）全部通过。
- **必须的权限**：仅给 Raycast「辅助功能」+「自动化（控制 System Events）」（本机实测已具备：`AXIsProcessTrusted=true`、SE 读写全通）。**不需要屏幕录制**（该权限只影响 CGWindowList 窗口名显示，与写路径无关；保留为独立事实，P5 诊断增强可选）。
- 早期「屏幕录制门控」「面板态门控」两种假设均已被对照实验证伪（SPIKE.md §2 历史记录、§6、§7）。

## 2. 宿主开发环境无 AX/Automation 权限（不影响交付）

- 本委派会话宿主对 System Events 无 Automation 权限（-10004）、`AXIsProcessTrusted()=false`；全部取证在真实 Raycast 扩展进程内完成（等价有效）。
- 由扩展进程 spawn 的 swift 辅助二进制 AX 可信（`trusted=true`，实验 C），宿主直接运行不可信（`-25211`）——P5 helper 只能在 Raycast 会话内使用。

## 3. 无 Raycast Pro

- 原生 WindowManagement API 不可用（PLAN 已确认决策）；`provider-native.ts` 保留骨架与运行时守卫。

## 4. dev 期 `ray develop` 观察进程稳定性（dev-only）

- 观察进程死亡后 deep link 唤起会失效（需重启 `ray develop`）；view 命令的 deep link 唤起存在间歇性（并发唤起同一命令会终止旧进程），单次唤起稳定——dev 期注意事项，不影响最终交付。

## 5. 遗留事项（下一轮）

- P5 swift helper（windowkit）：精确 z 序 + 多屏 bounds + AX 直写——路线已验证可行，未集成。
- 端到端 GUI 目测（真实桌面执行布局）留给用户实装后验证。
- logo：codex CLI 在本沙箱受限（内建沙箱只读 + 提权被拒 + workspace-write 模式初始化失败），当前为占位图标；可在外侧终端执行 `codex exec -s danger-full-access` 生成（提示词见会话记录）。