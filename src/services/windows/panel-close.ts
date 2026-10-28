// 面板关闭语义（两后端共用）：写路径前置「关面板」，与 Hammerspoon 原版
// 「关面板→回焦→执行」一致；模块级记忆：最近 1500ms 已关闭则跳过。
import { closeMainWindow } from "@raycast/api";

let lastPanelCloseAt = 0;

export async function ensurePanelClosed(): Promise<void> {
  if (Date.now() - lastPanelCloseAt < 1500) return;
  try {
    await closeMainWindow();
  } catch {
    /* 忽略：no-view 等场景 close 可能为 no-op */
  }
  lastPanelCloseAt = Date.now();
}

/** 重试前置零：允许再次关面板（配对 sleep 后使用，与历史语义一致） */
export function resetPanelCloseMemo(): void {
  lastPanelCloseAt = 0;
}