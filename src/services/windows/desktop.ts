// 桌面窗口识别：Finder 桌面（以及其他壁纸类 App 的桌面级窗口）同样出现在 AX 窗口列表里。
// 它没有标题、恰好铺满整块屏幕，且不保证上报 AXSubrole（实测为空串）——会被「标准窗口」
// 判定放行，于是在自动排布里被当成一个可排布窗口：1 个真实窗口被数成 2 窗，套用 2 窗模板。
// Finder 的真实窗口总有标题（文件夹名），所以「无标题的 Finder 窗口」只可能是桌面。
import type { Screen } from "../../domain/types";

/** 判定桌面窗口所需的最小字段（两种 provider 的原始窗口行都具备） */
export interface DesktopWindowLike {
  bundleId: string;
  title: string;
  subrole: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const FINDER_BUNDLE = "com.apple.finder";
/** 桌面窗口与屏幕帧严格相等；留 2pt 容差容忍缩放/取整误差 */
const EPS = 2;

/**
 * 是否桌面窗口（不可排布）：无标题 + 铺满某块屏幕的整屏帧。
 * Finder 只看 bundle；其他 App 需同时「不上报 subrole」，避免误伤无标题的真实窗口。
 */
export function isDesktopWindow(w: DesktopWindowLike, screens: Screen[]): boolean {
  if (w.title !== "") return false;
  if (w.bundleId !== FINDER_BUNDLE && w.subrole !== "") return false;
  return screens.some(
    ({ frame: f }) =>
      Math.abs(w.x - f.x) <= EPS &&
      Math.abs(w.y - f.y) <= EPS &&
      Math.abs(w.w - f.w) <= EPS &&
      Math.abs(w.h - f.h) <= EPS
  );
}
