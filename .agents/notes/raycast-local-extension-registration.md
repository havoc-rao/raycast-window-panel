# Raycast 本地扩展：构建文件与本体注册状态要分别验证

## 本次现象

用户反馈本地 Window Panel 扩展安装状态不稳定，进一步确认是：

- 正式面板命令已存在，但没有 logo。
- 两个 `[dev]` 测试命令仍出现在 Raycast 中。
- 修正 manifest 并执行 `npm run build` 后，用户完整重启 Raycast，现象依旧。

## 已确认的配置问题与修复

### 图标路径

Raycast manifest 的 `icon` 路径相对于扩展的 `assets/` 目录。

```json
{ "icon": "logo.png" }
```

本项目此前写为 `assets/logo.png`，已在根目录 `package.json` 修正。实际图片仍位于 `assets/logo.png`。

### 测试命令暴露

根目录 `package.json` 的 `commands` 仍声明了以下测试命令：

- `spike-writecheck`
- `spike-writecheck-noview`

已移除这两项声明，保留测试源码供调试。目前 manifest 中有 9 个正式命令。仅从清单移除命令不等于已验证 Raycast UI 中旧注册条目消失。

## 本机取证与操作结果

- 本地构建输出目录：`~/.config/raycast/extensions/raycast-window-panel/`。
- 该目录包含 manifest、assets 和各命令 JS，证明构建产物已部署，但不能单独证明 Raycast 本体里的命令注册、启用状态或图标已更新。
- 本项目 `npm run build` 对应 `ray build -e dist`。
- 构建成功，TypeScript 检查通过；读取安装目录中的 `package.json`，确认图标为 `logo.png`，命令清单不再含两个测试项。
- 用户明确反馈：重启 Raycast 后，界面问题仍然存在。因此不能把这次问题简单归因于重启即可清除的缓存。
- 随后执行 `npm run dev`（`ray develop`），尝试通过 CLI 的开发注册／刷新流程让 Raycast 重新接收扩展信息。
- CLI 输出 9 个正式入口，构建成功。完成首次构建后停止监听，CLI 输出 `stopped development mode`，没有刻意保留常驻开发进程。

**验证边界：截至记录时，用户尚未确认运行 develop 后 logo 恢复、两个旧条目消失。不能把本次操作写成已验证解决，也未证实存在重复注册。**

## 核心经验

1. **源码配置、安装目录中的构建产物、Raycast 本体的注册记录、最终 UI 是不同验证层。** 不能用“文件更新成功”替代端到端成功。
2. `ray build` 的成功日志只证明构建步骤完成，不应直接承诺新增／删除命令及图标元数据已在本体同步。
3. manifest 的命令或图标变化后，可用官方 `ray develop` 流程尝试重新注册／刷新，但仍需验证本体 UI；不应把它描述为已证实有效的一次性正式安装命令。
4. 停止开发进程不等于扩展未安装；也不应未经验证就建议靠常驻开发进程维持日常使用。
5. 若重启后旧条目仍在，应检查 Settings → Extensions 中的实际注册情况、来源及是否存在重复扩展，而不是重复构建／重启或直接删目录。
6. 未查清前不要删除 Raycast 数据库、扩展偏好或用户布局数据。重装可能影响快捷键与偏好，需要先说明和确认。
7. 向用户汇报应明确区分“已修改”“已构建”“已尝试刷新”“用户界面已验证”。上次遗漏注册层验证并建议重启，没有解决问题，应承认验证不足。

## 后续排查入口

如果仍然异常，请用户提供 Raycast → Settings → Extensions 中搜索 `Window Panel` 的截图：

- 是否存在多份扩展或旧来源；
- 两个 `[dev]` 条目归属于哪个扩展；
- 正式命令与测试命令是否属于同一注册记录；
- 图标和命令列表是否与当前 manifest 一致。

确认注册来源后再决定刷新、重新导入或移除旧注册，不要把“重复安装”当作已确认根因。

## 执行环境注意

本次工作区沙箱只允许写项目目录，而 Raycast CLI 会写 `~/.config/raycast/extensions/`：

- `npm run build` 首次因输出文件写入被拒而退出 1。
- `npm run dev` 首次因 `cli.pid` 写入被拒而退出 1。
- 均在实际拒绝后，以同一命令请求扩大权限并获准运行。
- 对后台 develop 任务必须跟踪 job id，收集输出，并在不需要监听时主动停止、确认结束，避免遗留后台任务。
