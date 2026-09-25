// 原生 WindowManagement API 骨架（用户无 Raycast Pro，默认不可用；有 Pro 时自动启用）
// PLAN：原生 API 仅保留代码骨架供将来自动启用，不做运行时依赖。
// 探测方式：@raycast/api 是否导出 windowManagement（Pro 专属）；缺失则回落 AppleScript 后端。
import type { WindowProvider } from "./windows";

export async function createNativeProvider(): Promise<WindowProvider | null> {
  try {
    const mod = (await import("@raycast/api")) as unknown as { windowManagement?: unknown };
    if (!mod.windowManagement || typeof mod.windowManagement !== "object") return null;
    // TODO(Pro): 接入 windowManagement 实现 WindowProvider（frontmostWindow / getAllWindows / setBounds...），
    // 语义与 AppleScript 后端一致（TargetWindow 句柄、AXFullScreen 拦截、标准窗口过滤）。
    return null;
  } catch {
    return null;
  }
}