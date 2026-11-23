import type { Frame, TargetWindow } from "../../domain/types";
import { framesAlmostEqual } from "../../utils/geometry";
import { setTimeout as sleep } from "node:timers/promises";
import { ProviderError, type BoundsWrite, type WindowProvider } from "./types";

/** AX reports in points; tolerate rounding and small decoration differences. */
export const BOUNDS_EPS = 2;
const SETTLE_MS = 100;
type BoundsProvider = Pick<WindowProvider, "listWindowsForApp" | "setBounds" | "setBoundsBatch">;

function sameSize(a: Frame, b: Frame): boolean {
  return Math.abs(a.w - b.w) <= BOUNDS_EPS && Math.abs(a.h - b.h) <= BOUNDS_EPS;
}

function sameFrame(a: Frame, b: Frame): boolean {
  return framesAlmostEqual(a, b, BOUNDS_EPS);
}

function describeFrame(f: Frame): string {
  return `${Math.round(f.w)}×${Math.round(f.h)} @ (${Math.round(f.x)}, ${Math.round(f.y)})`;
}

/** One read per affected app; never substitute another window if the original disappears. */
async function readBounds(p: BoundsProvider, items: BoundsWrite[]): Promise<Array<TargetWindow | undefined>> {
  const byApp = new Map<string, Promise<TargetWindow[]>>();
  for (const { window } of items) {
    if (!byApp.has(window.bundleId)) {
      byApp.set(window.bundleId, p.listWindowsForApp(window.bundleId).catch(() => []));
    }
  }
  return Promise.all(items.map(async ({ window }) => (await byApp.get(window.bundleId))?.find((w) =>
    w.id === window.id && w.bundleId === window.bundleId && w.title === window.title
  )));
}

async function write(p: BoundsProvider, items: BoundsWrite[]): Promise<void> {
  if (items.length === 1) {
    const { window, frame, positionOnly, resizeCompatibilityRetry } = items[0];
    if (resizeCompatibilityRetry) await p.setBounds(window, frame, positionOnly, true);
    else await p.setBounds(window, frame, positionOnly);
  } else if (items.length > 1) {
    await p.setBoundsBatch(items);
  }
}

/**
 * AX accepted is not AX applied. Use the fast path when confirmed immediately;
 * otherwise give the app time to settle, then retry only identified mismatches.
 * Returns a diagnostic instead of success if any target frame is unconfirmed.
 */
export async function applyVerifiedBounds(p: BoundsProvider, items: BoundsWrite[]): Promise<string | null> {
  const fullScreen = items.find(({ window }) => window.fullScreen);
  if (fullScreen) return `请先退出 ${fullScreen.window.appName} 的系统全屏，再调整布局`;
  const pending = items.filter(({ window, frame }) => !sameFrame(window.bounds, frame)).map((it) => ({
    ...it,
    positionOnly: it.positionOnly || sameSize(it.window.bounds, it.frame),
  }));
  if (pending.length === 0) return null;
  await write(p, pending);
  let actual = await readBounds(p, pending);
  const needsCheck = (i: number) => !actual[i] || !sameFrame(actual[i]!.bounds, pending[i].frame);
  const unsettled = pending.map((_, i) => i).filter(needsCheck);
  if (!unsettled.length) return null;
  await sleep(SETTLE_MS);
  (await readBounds(p, unsettled.map((i) => pending[i]))).forEach((w, j) => { actual[unsettled[j]] = w; });

  const retry = unsettled.filter((i) => actual[i] && needsCheck(i));
  let retryError: string | undefined;
  if (retry.length) {
    try {
      await write(p, retry.map((i) => {
        const item = pending[i];
        const window = actual[i]!;
        return sameSize(window.bounds, item.frame)
          ? { ...item, window, positionOnly: true }
          : { ...item, window, resizeCompatibilityRetry: !item.positionOnly };
      }));
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "accessibility-restore") throw e;
      retryError = e instanceof Error ? e.message : String(e);
    }
    await sleep(SETTLE_MS);
    (await readBounds(p, retry.map((i) => pending[i]))).forEach((w, j) => { actual[retry[j]] = w; });
  }

  const failed = unsettled.filter(needsCheck);
  if (!failed.length) return null;
  // If a resize didn't happen but its preparatory move did, undo only that move.
  // Leave other partial results alone rather than guessing how to revert them.
  const rollback = failed.flatMap((i) => {
    const { window, frame, positionOnly } = pending[i];
    const current = actual[i];
    return current && !positionOnly && !sameSize(current.bounds, frame) &&
      sameSize(current.bounds, window.bounds) && !sameFrame(current.bounds, window.bounds)
      ? [{ window: current, frame: window.bounds, positionOnly: true }]
      : [];
  });
  const restored = new Set<string>();
  if (rollback.length) {
    try {
      await write(p, rollback);
    } catch {
      // A batch may still have restored some windows. Report only confirmed rollbacks.
    }
    (await readBounds(p, rollback)).forEach((w, i) => {
      if (w && sameFrame(w.bounds, rollback[i].frame)) restored.add(w.id);
    });
  }

  const details = failed.slice(0, 2).map((i) => {
    const { window, frame } = pending[i];
    const current = actual[i];
    const name = window.appName || "该窗口";
    if (!current) return `${name}：无法读回窗口，不能确认布局`;
    const result = sameSize(current.bounds, frame) ? "未移到目标位置"
      : sameSize(current.bounds, window.bounds) ? "未执行尺寸调整" : "尺寸未达到目标";
    const back = restored.has(window.id) ? "，已恢复原位置" : "";
    return `${name} ${result}（读回 ${describeFrame(current.bounds)}，目标 ${describeFrame(frame)}）${back}`;
  });
  const prefix = items.length > 1 ? `布局未全部生效（${items.length - failed.length}/${items.length} 窗已确认）：` : "";
  return prefix + details.join("；") + (retryError ? `。重试失败：${retryError}` : "");
}
