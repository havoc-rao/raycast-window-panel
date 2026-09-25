// 命令层业务编排：目标解析 → 引擎计划 → provider 执行 → 持久化/MRU → 反馈文案
// 全部动作返回 {ok, message}，命令层负责 Toast/Alert/关闭面板。
import { closeMainWindow, showToast, Toast } from "@raycast/api";
import type { LayoutsData, TargetWindow } from "./types";
import {
  deleteSnapshot,
  doArrange,
  findWindowFor,
  forgetWindow,
  makeArrangeContext,
  replayAppWindows,
  saveCurWindow,
} from "./engine";
import { clampFrame } from "./geometry";
import { singleLayoutById, templateById } from "./templates";
import { MemoryStore, readLayoutsFile, writeLayoutsFile } from "./storage";
import { raycastKV } from "./local-storage-adapter";
import { getMemoryTargetEnabledPref, layoutsFilePath } from "./prefs";
import { AppleScriptWindowProvider } from "./provider-applescript";
import { createNativeProvider } from "./provider-native";
import { ProviderError } from "./windows";
import type { WindowProvider } from "./windows";

let providerPromise: Promise<WindowProvider> | null = null;
export function getProvider(): Promise<WindowProvider> {
  if (!providerPromise) {
    providerPromise = (async () => {
      const native = await createNativeProvider();
      if (native) return native;
      return new AppleScriptWindowProvider();
    })();
  }
  return providerPromise;
}

export const memory = new MemoryStore(raycastKV);

export interface ActionResult {
  ok: boolean;
  message: string;
}

export function ok(message: string): ActionResult {
  return { ok: true, message };
}

export function fail(message: string): ActionResult {
  return { ok: false, message };
}

function providerFail(e: unknown): ActionResult {
  if (e instanceof ProviderError) return fail(e.message);
  return fail(String((e as Error)?.message ?? e));
}

/** 布局数据文件读写（原子写）；读失败按空数据处理，写失败抛出 → Toast 失败 */
export function loadLayouts(): LayoutsData {
  return readLayoutsFile(layoutsFilePath());
}

export function persistLayouts(data: LayoutsData): void {
  writeLayoutsFile(layoutsFilePath(), data);
}

/** 统一反馈：Toast + 可选关闭面板（执行型动作关面板 → 焦点回到目标 App，与原版一致） */
export async function notify(result: ActionResult, opts?: { close?: boolean; title?: string }): Promise<void> {
  await showToast({
    style: result.ok ? Toast.Style.Success : Toast.Style.Failure,
    title: opts?.title ?? (result.ok ? result.message : result.message),
    message: result.ok ? undefined : undefined,
  });
  if (result.ok && opts?.close) await closeMainWindow();
}

export async function resolveTarget(): Promise<TargetWindow | null> {
  const p = await getProvider();
  return p.getActiveWindow();
}

/** 单窗布局：只动目标窗口（铺满/留缝/居中/半屏/1/4），不改记忆、不排其他窗口 */
export async function applySingleLayout(templateId: string): Promise<ActionResult> {
  const p = await getProvider();
  const target = await p.getActiveWindow();
  if (!target) return fail("没有焦点窗口");
  if (target.fullScreen) return fail("请先退出当前窗口的系统全屏，再调整布局");
  const region = await p.getScreenRegion(target);
  if (!region || region.w <= 0 || region.h <= 0) return fail("当前窗口屏幕不可用，请重新打开面板");
  const tmpl = singleLayoutById(templateId);
  if (!tmpl || !tmpl.fn) return fail("布局不存在");
  const frame = tmpl.fn(1, region)[0];
  try {
    await p.setBounds(target, frame);
  } catch (e) {
    return providerFail(e);
  }
  await memory.bumpSingleRecent(templateId, (id) => !!singleLayoutById(id));
  return ok("当前窗口布局：" + tmpl.name);
}

/**
 * 自动排布：tmplId 为 undefined 时按「该窗口数上次样式 / 默认」直接排（arrange-last 一键路径）。
 * 特殊项 save/replay 由引擎处理（写/读快照）；成功后按窗口数记住选择并更新 MRU。
 */
export async function runArrange(tmplId?: string): Promise<ActionResult> {
  const p = await getProvider();
  const target = await p.getActiveWindow();
  if (!target) return fail("没有焦点窗口");
  const region = await p.getScreenRegion(target);
  if (!region) return fail("当前窗口屏幕不可用，请重新打开面板");
  const screens = await p.getAllScreens();
  const others = await p.listWindowsOnActiveDesktop(target);
  const data = loadLayouts();
  const ctx = makeArrangeContext(target, others, data, region, screens);
  if (!ctx) return fail("没有焦点窗口");
  const remembered = await memory.getArrangeTemplate(ctx.fluid.length);
  const plan = doArrange(tmplId, remembered, ctx, data);

  if (plan.ok && (plan.kind === "applied" || plan.kind === "replayed") && plan.frames) {
    for (let i = 0; i < ctx.fluid.length; i++) {
      const f = plan.frames[i];
      if (!f) continue;
      try {
        await p.setBounds(ctx.fluid[i], f);
      } catch (e) {
        return providerFail(e);
      }
    }
  }
  if (plan.raiseFirst && ctx.fluid.length > 0) {
    try {
      await p.raise(ctx.fluid[0]);
    } catch {
      /* 置顶失败不阻断 */
    }
  }
  if (plan.remember) {
    await memory.setArrangeTemplate(plan.remember.n, plan.remember.id);
    await memory.bumpArrangeRecent(plan.remember.id, (id) => {
      const t = templateById(id);
      return !!t && !t.special;
    });
  }
  if (plan.kind === "saved") {
    try {
      persistLayouts(data);
    } catch (e) {
      return fail("记忆保存失败: " + String((e as Error)?.message ?? e));
    }
  }
  if (!plan.ok) return fail(plan.message);
  return ok(plan.message);
}

/** 删除「我的布局」快照（Alert 两步确认后调用） */
export async function deleteMyLayout(): Promise<ActionResult> {
  const data = loadLayouts();
  const n = deleteSnapshot(data);
  if (n === 0) return fail("没有已保存的「我的布局」");
  try {
    persistLayouts(data);
  } catch (e) {
    return fail("记忆保存失败: " + String((e as Error)?.message ?? e));
  }
  return ok("已删除「我的布局」(" + n + " 窗的摆放)");
}

/** 记忆当前窗口（受「记录到此 App」偏好控制） */
export async function saveWindowCommand(): Promise<ActionResult> {
  if (!getMemoryTargetEnabledPref()) return fail("已关闭「记录到此 App」：请到扩展设置中开启后再记忆");
  const target = await resolveTarget();
  if (!target) return fail("没有焦点窗口");
  const data = loadLayouts();
  saveCurWindow(data, { id: target.id, bundleID: target.bundleId, title: target.title, frame: target.bounds });
  try {
    persistLayouts(data);
  } catch (e) {
    return fail("记忆保存失败: " + String((e as Error)?.message ?? e));
  }
  const size = Math.floor(target.bounds.w + 0.5) + "×" + Math.floor(target.bounds.h + 0.5);
  return ok("已记忆: " + target.title + " " + size);
}

/** 解除当前窗口的记忆（标题已变时该 App 仅一条也按它处理） */
export async function forgetWindowCommand(): Promise<ActionResult> {
  const target = await resolveTarget();
  if (!target) return fail("没有焦点窗口");
  const data = loadLayouts();
  const r = forgetWindow(data, { bundleID: target.bundleId, title: target.title });
  if (!r.removed) return fail(r.message);
  try {
    persistLayouts(data);
  } catch (e) {
    return fail("记忆保存失败: " + String((e as Error)?.message ?? e));
  }
  return ok(r.message);
}

/** 重放某 App 的全部已记忆窗口（restore-app / manage-memories 共用） */
export async function replayAppCommand(bundleId: string, appName?: string): Promise<ActionResult> {
  const p = await getProvider();
  const all = await p.listAllWindows();
  const screens = await p.getAllScreens();
  const data = loadLayouts();
  const plan = replayAppWindows(data, bundleId, all, screens);
  if (!plan.ok) return fail(plan.message);
  for (let i = 0; i < plan.windows.length; i++) {
    try {
      await p.setBounds(plan.windows[i], plan.frames[i]);
    } catch (e) {
      return providerFail(e);
    }
  }
  return ok(plan.message.replace(bundleId, appName ?? bundleId));
}

/** 一键按上次样式排布（原始主列表 Enter 路径：无模板交互） */
export async function quickArrangeAction(): Promise<ActionResult> {
  return runArrange(undefined);
}

/** 全部有记忆的 App（restore-app 列表数据） */
export function rememberedApps(data: LayoutsData): Array<{ bundleId: string; name: string; count: number }> {
  const byApp = new Map<string, { bundleId: string; name: string; count: number }>();
  for (const rec of Object.values(data.windows)) {
    const existing = byApp.get(rec.bundleID);
    if (existing) existing.count += 1;
    else byApp.set(rec.bundleID, { bundleId: rec.bundleID, name: rec.bundleID, count: 1 });
  }
  return [...byApp.values()];
}

/** bundleID → 可读短名（记忆里没有存 App 名，取最后一节） */
export function shortAppName(bundleId: string): string {
  const seg = bundleId.split(".").filter(Boolean);
  const last = seg[seg.length - 1] ?? bundleId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/** 单条记忆重放（manage-memories 用）：按匹配链找窗口并套用其记忆帧 */
export async function replayMemoryCommand(key: string): Promise<ActionResult> {
  const data = loadLayouts();
  const info = data.windows[key];
  if (!info) return fail("该记忆已不存在");
  const p = await getProvider();
  const all = await p.listAllWindows();
  const screens = await p.getAllScreens();
  const target = findWindowFor(info, all);
  if (!target) return fail("找不到对应窗口: " + info.title + " (窗口可能已关闭)");
  try {
    await p.setBounds(target, clampFrame(info.frame, screens));
  } catch (e) {
    return providerFail(e);
  }
  return ok("已重放: " + info.title);
}

/** 单条记忆删除（manage-memories 用） */
export async function deleteMemoryCommand(key: string): Promise<ActionResult> {
  const data = loadLayouts();
  const info = data.windows[key];
  if (!info) return fail("该记忆已不存在");
  delete data.windows[key];
  try {
    persistLayouts(data);
  } catch (e) {
    return fail("记忆保存失败: " + String((e as Error)?.message ?? e));
  }
  return ok("已删除记忆: " + (info.title || key));
}