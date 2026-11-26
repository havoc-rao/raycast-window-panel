import type { Frame, TargetWindow } from "../../domain/types";
import { framesAlmostEqual } from "../../utils/geometry";
import { setTimeout as sleep } from "node:timers/promises";
import { ProviderError, type BoundsWrite, type WindowProvider } from "./types";

/** AX reports in points; tolerate rounding and small decoration differences. */
export const BOUNDS_EPS = 2;
const SETTLE_MS = 100;
type BoundsProvider = Pick<WindowProvider, "listWindowsForApp" | "setBounds" | "setBoundsBatch"> &
  Partial<Pick<WindowProvider, "readWindows">>;

function sameSize(a: Frame, b: Frame): boolean {
  return Math.abs(a.w - b.w) <= BOUNDS_EPS && Math.abs(a.h - b.h) <= BOUNDS_EPS;
}

function sameFrame(a: Frame, b: Frame): boolean {
  return framesAlmostEqual(a, b, BOUNDS_EPS);
}

function describeFrame(f: Frame): string {
  return `${Math.round(f.w)}×${Math.round(f.h)} @ (${Math.round(f.x)}, ${Math.round(f.y)})`;
}

function windowPid(w: TargetWindow): string {
  return w.id.split("|")[0];
}

function matchWindow(target: TargetWindow, candidates: TargetWindow[], items: BoundsWrite[]): TargetWindow | undefined {
  const pid = windowPid(target);
  if (target.windowId) {
    return candidates.find((w) => w.windowId === target.windowId && windowPid(w) === pid);
  }
  const exact = candidates.find(
    (w) => w.id === target.id && w.bundleId === target.bundleId && w.title === target.title
  );
  if (exact) return exact;
  if (!target.title) return undefined;
  const sameTitleTargets = items.filter(
    ({ window }) => windowPid(window) === pid && window.bundleId === target.bundleId && window.title === target.title
  );
  if (sameTitleTargets.length !== 1) return undefined;
  const byTitle = candidates.filter(
    (w) => windowPid(w) === pid && w.bundleId === target.bundleId && w.title === target.title
  );
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

/** One read per affected app (or one batched PID read); never substitute another window if the original disappears. */
async function readBounds(p: BoundsProvider, items: BoundsWrite[]): Promise<Array<TargetWindow | undefined>> {
  if (p.readWindows) {
    const candidates = await p.readWindows(items.map(({ window }) => window)).catch(() => []);
    return items.map(({ window }) => matchWindow(window, candidates, items));
  }
  const byApp = new Map<string, Promise<TargetWindow[]>>();
  for (const { window } of items) {
    if (!byApp.has(window.bundleId)) {
      byApp.set(window.bundleId, p.listWindowsForApp(window.bundleId).catch(() => []));
    }
  }
  return Promise.all(
    items.map(async ({ window }) => matchWindow(window, (await byApp.get(window.bundleId)) ?? [], items))
  );
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
    const retryItems = retry.map((i) => {
      const item = pending[i];
      const window = actual[i]!;
      return sameSize(window.bounds, item.frame)
        ? { ...item, window, positionOnly: true }
        : { ...item, window, resizeCompatibilityRetry: !item.positionOnly };
    });
    try {
      await write(p, retryItems);
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "accessibility-restore") throw e;
      retryError = e instanceof Error ? e.message : String(e);
    }
    await sleep(SETTLE_MS);
    (await readBounds(p, retryItems)).forEach((w, j) => { actual[retry[j]] = w; });

    // Toggling AXEnhancedUserInterface in Chromium/Electron can briefly interrupt AX read-back;
    // give missing windows one extra settle read before declaring them unreadable.
    const unreadable = retry.map((idx, pos) => ({ idx, item: retryItems[pos] })).filter(({ idx }) => !actual[idx]);
    if (unreadable.length) {
      await sleep(SETTLE_MS);
      (await readBounds(p, unreadable.map(({ item }) => item))).forEach((w, j) => { actual[unreadable[j].idx] = w; });
    }

    // If a resize retry succeeded asynchronously, its final position write may still have been clamped
    // to the pre-resize size. Finish with one position-only nudge so layout succeeds on the first try.
    const positionFollowUp = retry
      .map((idx, pos) => ({ idx, item: retryItems[pos] }))
      .filter(
        ({ idx, item }) =>
          !item.positionOnly &&
          actual[idx] &&
          sameSize(actual[idx]!.bounds, pending[idx].frame) &&
          !sameFrame(actual[idx]!.bounds, pending[idx].frame)
      );
    if (positionFollowUp.length) {
      const nudges = positionFollowUp.map(({ idx }) => ({
        ...pending[idx],
        window: actual[idx]!,
        positionOnly: true,
      }));
      try {
        await write(p, nudges);
      } catch (e) {
        if (e instanceof ProviderError && e.kind === "accessibility-restore") throw e;
        retryError = retryError ?? (e instanceof Error ? e.message : String(e));
      }
      await sleep(SETTLE_MS);
      (await readBounds(p, nudges)).forEach((w, j) => { actual[positionFollowUp[j].idx] = w; });
    }
  }

  const failed = unsettled.filter(needsCheck);
  if (!failed.length) return null;
  // If a resize didn't happen but its preparatory move did, undo only that move.
  // Leave other partial results alone rather than guessing how to revert them.
  const rollbackEntries = failed.flatMap((i) => {
    const { window, frame, positionOnly } = pending[i];
    const current = actual[i];
    return current && !positionOnly && !sameSize(current.bounds, frame) &&
      sameSize(current.bounds, window.bounds) && !sameFrame(current.bounds, window.bounds)
      ? [{ idx: i, write: { window: current, frame: window.bounds, positionOnly: true } }]
      : [];
  });
  const restored = new Set<number>();
  if (rollbackEntries.length) {
    const rollbackWrites = rollbackEntries.map((entry) => entry.write);
    try {
      await write(p, rollbackWrites);
    } catch {
      // A batch may still have restored some windows. Report only confirmed rollbacks.
    }
    (await readBounds(p, rollbackWrites)).forEach((w, j) => {
      if (w && sameFrame(w.bounds, rollbackWrites[j].frame)) restored.add(rollbackEntries[j].idx);
    });
  }

  const details = failed.slice(0, 2).map((i) => {
    const { window, frame } = pending[i];
    const current = actual[i];
    const name = window.appName || "该窗口";
    if (!current) return `${name}：无法读回窗口，不能确认布局`;
    const result = sameSize(current.bounds, frame) ? "未移到目标位置"
      : sameSize(current.bounds, window.bounds) ? "未执行尺寸调整" : "尺寸未达到目标";
    const back = restored.has(i) ? "，已恢复原位置" : "";
    return `${name} ${result}（读回 ${describeFrame(current.bounds)}，目标 ${describeFrame(frame)}）${back}`;
  });
  const prefix = items.length > 1 ? `布局未全部生效（${items.length - failed.length}/${items.length} 窗已确认）：` : "";
  return prefix + details.join("；") + (retryError ? `。重试失败：${retryError}` : "");
}
