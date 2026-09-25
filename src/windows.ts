// Provider 接口（薄适配层）：两个后端实现同样的语义；运行时自动选择（AppleScript 主后端 / 原生 Pro API 骨架）
import type { Frame, Region, Screen, TargetWindow } from "./types";

export interface WindowProvider {
  /** 唤起前目标 App 的焦点窗口；无法确定时返回 null，不猜测其他 App 的窗口 */
  getActiveWindow(): Promise<TargetWindow | null>;
  /** 目标屏幕上可排布的窗口（标准窗口；z 序近似 = 焦点优先 + App 优先），不含目标自身 */
  listWindowsOnActiveDesktop(target: TargetWindow): Promise<TargetWindow[]>;
  /** 全部标准窗口（跨屏；重放/管理记忆用） */
  listAllWindows(): Promise<TargetWindow[]>;
  /** 目标窗口所在屏幕的整屏区域（原版 focused:screen():frame()） */
  getScreenRegion(w: TargetWindow): Promise<Region | null>;
  /** 全部屏幕（clampFrame 安全网；screens[0] 约定主屏） */
  getAllScreens(): Promise<Screen[]>;
  /** 移动/缩放窗口（受应用最小窗口尺寸限制，与原版一致） */
  setBounds(w: TargetWindow, frame: Frame): Promise<void>;
  /** 置顶窗口（排布后焦点窗 raise，与原版一致） */
  raise(w: TargetWindow): Promise<void>;
}

/** Provider 解析错误（命令层转为面向用户的提示） */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "no-window" | "fullscreen" | "permission" | "generic"
  ) {
    super(message);
    this.name = "ProviderError";
  }
}