// 排布/记忆/快照业务引擎：移植 init.lua 的 arrangeContext / arrangeWithTemplate / doArrange /
// saveCurWindow / forgetWindow / replayByApp / findWindow 匹配链。
// 纯函数/数据变换：不触碰窗口对象、不读写存储；命令层负责 setBounds、持久化与反馈。
import type { Frame, LayoutsData, Region, Screen, TargetWindow, Template, WindowRecord } from "./types";
import { clampFrame } from "./geometry";
import { defaultTemplateFor, templateApplies, templateById } from "./templates";

/** 窗口标识：bundleID|标题（数据文件键） */
export function windowKey(info: { bundleID: string; title: string }): string {
  return info.bundleID + "|" + info.title;
}

/** 记忆规则查询：命中 windows 表的条目，其 frame 就是自动排布的保护几何 */
export function ruleFor(w: Pick<TargetWindow, "bundleId" | "title">, layouts: LayoutsData): WindowRecord | undefined {
  const rule = layouts.windows[windowKey({ bundleID: w.bundleId, title: w.title })];
  return rule && rule.frame ? rule : undefined;
}

export interface ArrangeContext {
  /** 目标屏幕区域（整屏 frame，原版 focused:screen():frame()） */
  region: Region;
  /** 全部屏幕（clampFrame 安全网；screens[0] 约定主屏） */
  screens: Screen[];
  focused: TargetWindow;
  /** 弹性窗口（无记忆豁免），frames[i] 对应该列表第 i 项 */
  fluid: TargetWindow[];
  /** 记忆窗口（原位不动、不参与计数与几何） */
  ignored: TargetWindow[];
  ignoreLabel: string;
}

export type ArrangeKind = "applied" | "replayed" | "saved" | "no-snapshot" | "none" | "not-applicable";

export interface ArrangePlan {
  ok: boolean;
  kind: ArrangeKind;
  message: string;
  /** 应用到 fluid[i] 的帧（已过 clampFrame；kind=applied/replayed 时存在） */
  frames?: Frame[];
  applied?: number;
  /** i===0 且焦点窗非记忆时置顶 */
  raiseFirst?: boolean;
  /** 成功后需要记住的选择（arrangeTemplate.N + MRU） */
  remember?: { n: number; id: string };
}

/**
 * arrangeContext：目标窗口 + 同屏标准窗口（已含目标且按 z 序近似排序，最多 8 个）→ 弹性/豁免划分。
 * 与 Lua 一致：记忆窗口完全无视（原位不动、不参与计数），其余窗口当作屏幕上的全部窗口。
 */
export function makeArrangeContext(
  target: TargetWindow,
  orderedWindows: TargetWindow[],
  layouts: LayoutsData,
  region: Region,
  screens: Screen[]
): ArrangeContext | null {
  if (!target) return null;
  const wins = [target, ...orderedWindows.filter((w) => w.id !== target.id)].slice(0, 8);
  const fluid: TargetWindow[] = [];
  const ignored: TargetWindow[] = [];
  for (const w of wins) {
    if (ruleFor(w, layouts)) ignored.push(w);
    else fluid.push(w);
  }
  const ignoreLabel = ignored.length > 0 ? " (无视 " + ignored.map((w) => w.appName).join("、") + ")" : "";
  return { region, screens, focused: target, fluid, ignored, ignoreLabel };
}

/**
 * 把模板帧应用到流体窗口（计算层，返回计划；实际 setBounds 由调用方执行）。
 * 特殊项 save：把当前弹性窗口位置+大小按顺序存为纯槽位快照（数据写入 layouts.snapshot）。
 * 特殊项 replay：按窗口顺序简单套用快照槽位（不匹配 app）。
 */
export function arrangeWithTemplate(tmpl: Template | undefined, ctx: ArrangeContext, layouts: LayoutsData): ArrangePlan {
  if (!tmpl) return { ok: false, kind: "not-applicable", message: "模板不存在" };
  const n = ctx.fluid.length;

  if (tmpl.special === "save") {
    layouts.snapshot = {
      savedAt: Math.floor(Date.now() / 1000),
      count: ctx.fluid.length,
      frames: ctx.fluid.map((w) => ({ x: w.bounds.x, y: w.bounds.y, w: w.bounds.w, h: w.bounds.h })),
    };
    return { ok: true, kind: "saved", message: "已保存当前布局 (" + n + " 窗); 子菜单可随时重放" };
  }

  let ownFrames: Frame[] | null = null;
  if (tmpl.special === "replay") {
    const snap = layouts.snapshot;
    if (!(snap && snap.frames && snap.frames.length > 0)) {
      return { ok: true, kind: "no-snapshot", message: "还没有保存的布局: 先选「保存当前布局」" };
    }
    ownFrames = snap.frames;
  } else {
    if (!tmpl.fn) return { ok: false, kind: "not-applicable", message: "模板不适用" };
    let frames: Frame[];
    try {
      frames = tmpl.fn(n, ctx.region);
    } catch {
      return { ok: false, kind: "not-applicable", message: "模板不适用" };
    }
    if (!Array.isArray(frames) || frames.length < n) {
      return { ok: false, kind: "not-applicable", message: "模板不适用" };
    }
    ownFrames = frames;
  }

  const focusedIgnored = ruleFor(ctx.focused, layouts) !== undefined;
  const out: Frame[] = [];
  let applied = 0;
  let raiseFirst = false;
  for (let i = 0; i < ctx.fluid.length; i++) {
    const f = ownFrames[i];
    if (f) {
      out.push(clampFrame(f, ctx.screens));
      applied += 1;
      if (i === 0 && !focusedIgnored) raiseFirst = true;
    }
  }
  const plan: ArrangePlan = {
    ok: true,
    kind: tmpl.special === "replay" ? "replayed" : "applied",
    frames: out,
    applied,
    raiseFirst,
    message:
      tmpl.special === "replay"
        ? "已重放我的布局 (" + applied + "/" + n + " 窗)" + ctx.ignoreLabel
        : "已排布: " + tmpl.name + " (" + n + " 窗)" + ctx.ignoreLabel,
  };
  if (tmpl.special !== "replay") plan.remember = { n, id: tmpl.id };
  return plan;
}

/**
 * 统一入口：tmplId 可为 undefined（用记忆/默认），窗口数变了模板失效时自动回落默认。
 * rememberedIdForN = 该窗口数上次选过的模板 id（由调用方从存储读取，保持引擎同步纯函数）。
 */
export function doArrange(
  tmplId: string | undefined,
  rememberedIdForN: string | undefined,
  ctx: ArrangeContext,
  layouts: LayoutsData
): ArrangePlan {
  const n = ctx.fluid.length;
  if (n === 0) {
    return { ok: true, kind: "none", message: "全部为记忆窗口, 保持原状" + ctx.ignoreLabel, raiseFirst: true };
  }
  let tmpl: Template | undefined = tmplId ? templateById(tmplId) : undefined;
  if (!templateApplies(tmpl, n)) {
    tmpl = pickTemplateLocal(n, rememberedIdForN);
  }
  let plan = arrangeWithTemplate(tmpl, ctx, layouts);
  if (!plan.ok) {
    const fb = defaultTemplateFor(n);
    if (fb && fb.id !== (tmpl ? tmpl.id : undefined)) {
      plan = arrangeWithTemplate(fb, ctx, layouts);
    }
  }
  return plan;
}

function pickTemplateLocal(n: number, rememberedId: string | undefined): Template | undefined {
  const t = templateById(rememberedId);
  if (templateApplies(t, n)) return t;
  return defaultTemplateFor(n);
}

/** 记忆当前焦点窗口（位置+大小）：既是重放数据，也是自动排布的豁免规则；返回数据键 */
export function saveCurWindow(
  layouts: LayoutsData,
  info: { id?: string | number; bundleID: string; title: string; frame: Frame }
): string {
  const key = windowKey(info);
  layouts.windows[key] = {
    ...(info.id !== undefined && info.id !== "" ? { id: info.id } : {}),
    bundleID: info.bundleID,
    title: info.title,
    frame: { x: info.frame.x, y: info.frame.y, w: info.frame.w, h: info.frame.h },
  };
  return key;
}

export interface ForgetResult {
  removed: boolean;
  key?: string;
  /** 同 bundleID 的记忆条数（标题可能已变的提示用） */
  matches: number;
  message: string;
}

/** 解除当前窗口的记忆（规则）：与 Lua 一致 —— 标题可能已变，该 App 仅有一条记忆时也按它处理 */
export function forgetWindow(layouts: LayoutsData, info: { bundleID: string; title: string }): ForgetResult {
  const key = windowKey(info);
  let matches: string[] = [];
  if (!layouts.windows[key]) {
    matches = Object.keys(layouts.windows).filter((k) => layouts.windows[k].bundleID === info.bundleID);
    if (matches.length === 1) {
      // 单条同 App 记忆：按它处理（与重放一致）
      // 注意：不修改 key 变量来源，直接换 key
      return removeByKey(layouts, matches[0], info, matches.length);
    }
  }
  return removeByKey(layouts, key, info, matches.length);
}

function removeByKey(layouts: LayoutsData, key: string, info: { bundleID: string; title: string }, matches: number): ForgetResult {
  if (!layouts.windows[key]) {
    return {
      removed: false,
      matches,
      message: "该窗口没有记忆: " + info.title + " (该 App 共 " + matches + " 条, 标题可能已变)",
    };
  }
  delete layouts.windows[key];
  return { removed: true, key, matches, message: "已解除记忆: " + info.title };
}

/** 在全部窗口中找记忆对应的窗口：先 id，再 bundleID+标题，最后同 bundleID 首个（按窗口列表迭代序，与 Lua 一致） */
export function findWindowFor(info: WindowRecord, windows: TargetWindow[]): TargetWindow | undefined {
  let fallback: TargetWindow | undefined;
  for (const w of windows) {
    if (info.id !== undefined && info.id !== "" && String(info.id) === w.id) return w;
    if (w.bundleId === info.bundleID) {
      if (w.title === info.title) return w;
      if (!fallback) fallback = w;
    }
  }
  return fallback;
}

export interface ReplayAppPlan {
  ok: boolean;
  windows: TargetWindow[];
  frames: Frame[];
  count: number;
  message: string;
}

/** 重放某 bundleID 的全部已记忆窗口（帧已 clamp 到合法屏幕） */
export function replayAppWindows(
  layouts: LayoutsData,
  bundleId: string,
  allWindows: TargetWindow[],
  screens: Screen[]
): ReplayAppPlan {
  let count = 0;
  const windows: TargetWindow[] = [];
  const frames: Frame[] = [];
  for (const info of Object.values(layouts.windows)) {
    if (info.bundleID === bundleId) {
      const target = findWindowFor(info, allWindows);
      if (target) {
        windows.push(target);
        frames.push(clampFrame(info.frame, screens));
        count += 1;
      }
    }
  }
  return {
    ok: count > 0,
    windows,
    frames,
    count,
    message: count === 0 ? "该 app 没有记忆的窗口: " + bundleId : "已重放 " + bundleId + " 的 " + count + " 个窗口",
  };
}

/** 删除「我的布局」快照；返回删除的槽位数（无快照返回 0） */
export function deleteSnapshot(layouts: LayoutsData): number {
  const snap = layouts.snapshot;
  if (!(snap && Array.isArray(snap.frames) && snap.frames.length > 0)) return 0;
  const n = snap.frames.length;
  layouts.snapshot = undefined;
  return n;
}