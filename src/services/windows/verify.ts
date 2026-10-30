// 写入后校验：AX 返回成功只代表请求被接受，不代表应用真的照做。
// 只识别「尺寸完全没变」这一种情况：应用按最小尺寸/步长收敛时不算失败，
// 但接受写入后保持原尺寸（CodeBuddy CN 这类锁定窗口尺寸的应用）必须报错而不是报成功。
import type { Frame } from "../../domain/types";

/** 判定尺寸是否变化时允许的误差（pt）：覆盖应用取整、缩放步长带来的微小偏差。 */
export const BOUNDS_EPS = 2;

export function sizeUnchanged(a: Frame, b: Frame): boolean {
  return Math.abs(a.w - b.w) <= BOUNDS_EPS && Math.abs(a.h - b.h) <= BOUNDS_EPS;
}

/**
 * 目标尺寸确实要求变化，但写入后的尺寸与写入前完全一致 → 应用没有执行尺寸调整。
 * applied 为 null（读不到实际帧，例如窗口已关闭/句柄失效）时不猜测失败，保持旧语义。
 */
export function writeIgnored(original: Frame, target: Frame, applied: Frame | null): boolean {
  if (!applied) return false;
  if (sizeUnchanged(original, target)) return false;
  return sizeUnchanged(original, applied);
}

export function sizeText(f: Frame): string {
  return `${Math.round(f.w)}×${Math.round(f.h)}`;
}

/** 面向用户的失败文案：说明应用没照做、当前实际尺寸，以及是否已回滚位置。 */
export function refusedMessage(
  appName: string,
  target: Frame,
  applied: Frame | null,
  restored: boolean
): string {
  const app = appName || "该窗口";
  const actual = applied ? sizeText(applied) : "未知";
  const rollback = restored ? "，已恢复原位置" : "";
  // 实测（CodeBuddy CN）：窗口本身可以手动缩放，但 AX 尺寸写入返回成功却不生效，
  // 所以文案不能写成“锁定了窗口尺寸”，只陈述“接受但没执行”。
  return `${app} 未执行尺寸调整（仍为 ${actual}，目标 ${sizeText(target)}）${rollback}。AX 写入被接受但没有生效。`;
}
