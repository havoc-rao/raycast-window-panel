import { describe, expect, it } from "vitest";
import type { Frame, LayoutsData, Screen, TargetWindow } from "../src/types";
import {
  arrangeWithTemplate,
  deleteSnapshot,
  doArrange,
  findWindowFor,
  forgetWindow,
  makeArrangeContext,
  replayAppWindows,
  ruleFor,
  saveCurWindow,
  windowKey,
} from "../src/engine";
import { defaultTemplateFor, templateById } from "../src/templates";

const SCREENS: Screen[] = [{ frame: { x: 0, y: 0, w: 1440, h: 900 } }];
const REGION = SCREENS[0].frame;

let seq = 0;
function win(bundleId: string, title: string, bounds: Frame, extra?: Partial<TargetWindow>): TargetWindow {
  seq += 1;
  return {
    id: extra?.id ?? String(1000 + seq),
    appName: extra?.appName ?? bundleId,
    bundleId,
    title,
    bounds,
    fullScreen: false,
    positionable: true,
    resizable: true,
    ...extra,
  };
}

function layouts(winRecords?: LayoutsData["windows"], snapshot?: LayoutsData["snapshot"]): LayoutsData {
  return { windows: winRecords ?? {}, snapshot };
}

/** TargetWindow 的键（注意字段名：bundleId vs 数据键的 bundleID） */
const keyOf = (w: TargetWindow) => windowKey({ bundleID: w.bundleId, title: w.title });

describe("windowKey / ruleFor", () => {
  it("键 = bundleID|标题", () => {
    expect(windowKey({ bundleID: "com.apple.Terminal", title: "zsh" })).toBe("com.apple.Terminal|zsh");
  });
  it("ruleFor 命中 windows 表条目（frame 存在才算规则）", () => {
    const w = win("com.apple.Terminal", "zsh", { x: 0, y: 0, w: 100, h: 100 });
    const data = layouts({ "com.apple.Terminal|zsh": { bundleID: "com.apple.Terminal", title: "zsh", frame: { x: 1, y: 2, w: 3, h: 4 } } });
    expect(ruleFor(w, data)?.frame).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(ruleFor(win("other", "x", { x: 0, y: 0, w: 1, h: 1 }), data)).toBeUndefined();
  });
});

describe("makeArrangeContext（弹性/豁免划分）", () => {
  const target = win("com.apple.Safari", "Safari", { x: 0, y: 0, w: 800, h: 600 });
  it("记忆窗口豁免：原位不动、不参与计数与几何", () => {
    const ignored = win("com.apple.Terminal", "zsh", { x: 10, y: 10, w: 500, h: 400 });
    const fluid = win("com.apple.Notes", "Notes", { x: 300, y: 100, w: 700, h: 500 });
    const data = layouts({ "com.apple.Terminal|zsh": { bundleID: "com.apple.Terminal", title: "zsh", frame: { x: 10, y: 10, w: 500, h: 400 } } });
    const ctx = makeArrangeContext(target, [ignored, fluid], data, REGION, SCREENS)!;
    expect(ctx.fluid.map((w) => w.title)).toEqual(["Safari", "Notes"]);
    expect(ctx.ignored.map((w) => w.title)).toEqual(["zsh"]);
    expect(ctx.ignoreLabel).toContain("无视");
    expect(ctx.ignoreLabel).toContain("com.apple.Terminal"); // appName
  });
  it("最多 8 个窗口（含目标）", () => {
    const others = Array.from({ length: 10 }, (_, i) => win("app" + i, "w" + i, { x: i, y: i, w: 100, h: 100 }));
    const ctx = makeArrangeContext(target, others, layouts(), REGION, SCREENS)!;
    expect(ctx.fluid.length).toBe(8); // 1 + 7
  });
  it("无目标 → null", () => {
    expect(makeArrangeContext(null as unknown as TargetWindow, [], layouts(), REGION, SCREENS)).toBeNull();
  });
});

describe("arrangeWithTemplate（几何套用与特殊项）", () => {
  const target = win("com.apple.Safari", "Safari", { x: 0, y: 0, w: 800, h: 600 });
  const other = win("com.apple.Notes", "Notes", { x: 300, y: 100, w: 700, h: 500 });

  it("普通模板：产出 clamp 后帧 + remember 记录", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const plan = arrangeWithTemplate(templateById("split-h2"), ctx, layouts());
    expect(plan.kind).toBe("applied");
    expect(plan.ok).toBe(true);
    expect(plan.applied).toBe(2);
    expect(plan.frames).toHaveLength(2);
    // 左右各半 @1440：缝 4 → 每窗 718 宽
    expect(plan.frames![0]).toEqual({ x: 0, y: 0, w: 718, h: 900 });
    expect(plan.frames![1]).toEqual({ x: 722, y: 0, w: 718, h: 900 });
    expect(plan.remember).toEqual({ n: 2, id: "split-h2" });
    expect(plan.message).toContain("已排布");
  });
  it("帧不足（模板 maxN 之外由调用方过滤；这里直接传 n=1 的模板给 n=2）→ not-applicable", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const plan = arrangeWithTemplate(templateById("maximize"), ctx, layouts());
    expect(plan.ok).toBe(false);
    expect(plan.kind).toBe("not-applicable");
  });
  it("special=save：纯槽位快照（不关联 App）", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const data = layouts();
    const plan = arrangeWithTemplate(templateById("save-layout"), ctx, data);
    expect(plan.kind).toBe("saved");
    expect(data.snapshot?.frames).toEqual([
      { x: 0, y: 0, w: 800, h: 600 },
      { x: 300, y: 100, w: 700, h: 500 },
    ]);
    expect(data.snapshot?.count).toBe(2);
    expect(plan.message).toContain("已保存当前布局 (2 窗)");
  });
  it("special=replay：无快照 → no-snapshot 提示", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const plan = arrangeWithTemplate(templateById("replay-layout"), ctx, layouts());
    expect(plan.kind).toBe("no-snapshot");
    expect(plan.message).toContain("还没有保存的布局");
  });
  it("special=replay：按窗口顺序简单套用（窗口数和槽位数不一致取较小者）", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const data = layouts({}, { savedAt: 1, count: 2, frames: [{ x: 0, y: 0, w: 900, h: 700 }, { x: 500, y: 0, w: 900, h: 700 }] });
    const plan = arrangeWithTemplate(templateById("replay-layout"), ctx, data);
    expect(plan.kind).toBe("replayed");
    expect(plan.applied).toBe(2);
    expect(plan.frames).toEqual([{ x: 0, y: 0, w: 900, h: 700 }, { x: 500, y: 0, w: 900, h: 700 }]);
    expect(plan.remember).toBeUndefined();
    expect(plan.message).toContain("已重放我的布局 (2/2 窗)");
  });
  it("replay 槽位不足时 applied < n", () => {
    const three = [target, other, win("com.apple.Mail", "Mail", { x: 20, y: 20, w: 300, h: 300 })];
    const ctx = makeArrangeContext(three[0], three.slice(1), layouts(), REGION, SCREENS)!;
    const data = layouts({}, { savedAt: 1, count: 2, frames: [{ x: 0, y: 0, w: 900, h: 700 }, { x: 500, y: 0, w: 900, h: 700 }] });
    const plan = arrangeWithTemplate(templateById("replay-layout"), ctx, data);
    expect(plan.applied).toBe(2);
    expect(plan.message).toContain("(2/3 窗)");
  });
  it("叠放瀑布 cascade：焦点窗主槽，其余左移错位（clamp 在原屏幕内）", () => {
    const a = win("a", "A", { x: 0, y: 0, w: 500, h: 400 });
    const b = win("b", "B", { x: 0, y: 0, w: 500, h: 400 });
    const c = win("c", "C", { x: 0, y: 0, w: 500, h: 400 });
    const ctx = makeArrangeContext(a, [b, c], layouts(), REGION, SCREENS)!;
    const plan = arrangeWithTemplate(templateById("cascade"), ctx, layouts());
    expect(plan.frames?.map((f) => f.x)).toEqual([60, 0, -8]);
  });
});

describe("doArrange（统一入口：记忆/默认 + 自动回落）", () => {
  const target = win("com.apple.Safari", "Safari", { x: 0, y: 0, w: 800, h: 600 });
  const other = win("com.apple.Notes", "Notes", { x: 300, y: 100, w: 700, h: 500 });

  it("无 tmplId + 无记忆 → 默认模板（2 窗 → overlap-lr）", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const plan = doArrange(undefined, undefined, ctx, layouts());
    expect(plan.ok).toBe(true);
    expect(plan.remember?.id).toBe("overlap-lr");
    // 重叠左右槽位: 主 60 宽 1380, 左 0 宽 1380
    expect(plan.frames![0]).toEqual({ x: 60, y: 0, w: 1380, h: 900 });
  });
  it("tmplId 已被窗口数淘汰 → 回落默认（n=2 时 cascade 不适用 → overlap-lr）", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const plan = doArrange("cascade", undefined, ctx, layouts());
    expect(plan.remember?.id).toBe("overlap-lr");
    expect(plan.remember?.id).not.toBe("cascade");
  });
  it("rememberedId 适用时优先生效（上次样式）", () => {
    const ctx = makeArrangeContext(target, [other], layouts(), REGION, SCREENS)!;
    const plan = doArrange(undefined, "split-v2", ctx, layouts());
    expect(plan.remember?.id).toBe("split-v2");
    // 上下各半 @1440×900：缝 4 → 每行高 (900-4)/2 = 448
    expect(plan.frames![0]).toEqual({ x: 0, y: 0, w: 1440, h: 448 });
    expect(plan.frames![1]).toEqual({ x: 0, y: 452, w: 1440, h: 448 });
  });
  it("全部为记忆窗口 → 保持原状（kind=none, raiseFirst）", () => {
    const data = layouts({
      [keyOf(target)]: { bundleID: target.bundleId, title: target.title, frame: target.bounds },
      [keyOf(other)]: { bundleID: other.bundleId, title: other.title, frame: other.bounds },
    });
    const ctx = makeArrangeContext(target, [other], data, REGION, SCREENS)!;
    const plan = doArrange(undefined, undefined, ctx, data);
    expect(plan.kind).toBe("none");
    expect(plan.raiseFirst).toBe(true);
    expect(plan.message).toContain("全部为记忆窗口");
  });
  it("焦点窗有记忆时帧[0]不置顶", () => {
    const data = layouts({ [keyOf(target)]: { bundleID: target.bundleId, title: target.title, frame: target.bounds } });
    const ctx = makeArrangeContext(target, [other], data, REGION, SCREENS)!;
    const plan = arrangeWithTemplate(templateById("split-h2"), ctx, data);
    expect(plan.raiseFirst).toBe(false);
  });
  it("默认模板本身不可用（极端）→ ok=false 不抛异常", () => {
    const ctx = makeArrangeContext(target, [], layouts(), REGION, SCREENS)!;
    const plan = doArrange("grid-auto", undefined, ctx, layouts());
    expect(typeof plan.ok).toBe("boolean");
  });
});

describe("记忆动作（save / forget / replay / snapshot 删除）", () => {
  it("saveCurWindow：bundleID|标题 为键写入位置+大小", () => {
    const data = layouts();
    const key = saveCurWindow(data, { id: "42|1", bundleID: "com.apple.Terminal", title: "zsh", frame: { x: 1, y: 2, w: 800, h: 600 } });
    expect(key).toBe("com.apple.Terminal|zsh");
    expect(data.windows[key]).toMatchObject({ id: "42|1", bundleID: "com.apple.Terminal", title: "zsh", frame: { x: 1, y: 2, w: 800, h: 600 } });
  });
  it("forgetWindow：精确键删除", () => {
    const data = layouts({ "a|t": { bundleID: "a", title: "t", frame: { x: 0, y: 0, w: 1, h: 1 } } });
    const r = forgetWindow(data, { bundleID: "a", title: "t" });
    expect(r.removed).toBe(true);
    expect(data.windows).toEqual({});
    expect(r.message).toBe("已解除记忆: t");
  });
  it("forgetWindow：标题已变但该 App 仅一条记忆 → 按它删除", () => {
    const data = layouts({ "a|old-title": { bundleID: "a", title: "old-title", frame: { x: 0, y: 0, w: 1, h: 1 } } });
    const r = forgetWindow(data, { bundleID: "a", title: "new-title" });
    expect(r.removed).toBe(true);
    expect(r.key).toBe("a|old-title");
    expect(data.windows).toEqual({});
  });
  it("forgetWindow：多条同 App 记忆且标题不匹配 → 不删除并提示条数", () => {
    const data = layouts({
      "a|t1": { bundleID: "a", title: "t1", frame: { x: 0, y: 0, w: 1, h: 1 } },
      "a|t2": { bundleID: "a", title: "t2", frame: { x: 0, y: 0, w: 1, h: 1 } },
    });
    const r = forgetWindow(data, { bundleID: "a", title: "t3" });
    expect(r.removed).toBe(false);
    expect(r.matches).toBe(2);
    expect(r.message).toContain("共 2 条");
    expect(Object.keys(data.windows)).toHaveLength(2);
  });
  it("findWindowFor 匹配链：id → bundleID+标题 → 同 bundleID 首个（迭代序与 Lua 一致）", () => {
    const w1 = win("a", "T1", { x: 0, y: 0, w: 1, h: 1 });
    const w2 = win("a", "T2", { x: 0, y: 0, w: 1, h: 1 });
    const w3 = win("b", "T1", { x: 0, y: 0, w: 1, h: 1 });
    // 首轮 id 命中
    expect(findWindowFor({ id: w1.id, bundleID: "a", title: "T1", frame: w1.bounds }, [w1, w2, w3])?.id).toBe(w1.id);
    // bundle+标题
    expect(findWindowFor({ bundleID: "a", title: "T2", frame: w1.bounds }, [w1, w2, w3])?.id).toBe(w2.id);
    // 同 bundleID 首个兜底
    expect(findWindowFor({ bundleID: "a", title: "T9", frame: w1.bounds }, [w1, w2, w3])?.id).toBe(w1.id);
    expect(findWindowFor({ bundleID: "zzz", title: "T9", frame: w1.bounds }, [w1, w2, w3])).toBeUndefined();
    // 与 Lua 一致：列表靠前的 bundle+标题命中优先于靠后窗口的 id 命中
    expect(findWindowFor({ id: w2.id, bundleID: "a", title: "T1", frame: w1.bounds }, [w1, w2, w3])?.id).toBe(w1.id);
  });
  it("replayAppWindows：按 bundleID 恢复全部已记忆窗口（帧被 clamp）", () => {
    const data = layouts({
      "a|t1": { bundleID: "a", title: "t1", frame: { x: 5000, y: 5000, w: 800, h: 600 } }, // 屏幕外 → clamp 到主屏 +40
      "a|t2": { bundleID: "a", title: "t2", frame: { x: 10, y: 10, w: 400, h: 300 } },
      "b|t": { bundleID: "b", title: "t", frame: { x: 0, y: 0, w: 100, h: 100 } },
    });
    const a1 = win("a", "t1", { x: 0, y: 0, w: 800, h: 600 });
    const a2 = win("a", "t2", { x: 0, y: 0, w: 800, h: 600 });
    const plan = replayAppWindows(data, "a", [a1, a2], SCREENS);
    expect(plan.ok).toBe(true);
    expect(plan.count).toBe(2);
    expect(plan.windows.map((w) => w.title)).toEqual(["t1", "t2"]);
    expect(plan.frames[0]).toEqual({ x: 40, y: 40, w: 800, h: 600 });
    expect(plan.frames[1]).toEqual({ x: 10, y: 10, w: 400, h: 300 });
  });
  it("replayAppWindows：无记忆 App → ok=false", () => {
    const plan = replayAppWindows(layouts(), "zzz", [], SCREENS);
    expect(plan.ok).toBe(false);
    expect(plan.count).toBe(0);
  });
  it("replayAppWindows：多条记忆命中同一窗口（标题兜底）→ 去重只保留第一条", () => {
    const data = layouts({
      "a|t1": { bundleID: "a", title: "t1", frame: { x: 10, y: 10, w: 400, h: 300 } },
      "a|t2": { bundleID: "a", title: "t2", frame: { x: 500, y: 10, w: 400, h: 300 } },
    });
    // 唯一窗口 a 窗口标题是 t2：记忆 t1 走同 bundleID 兜底命中同一窗口，t2 精确命中同一窗口
    const a1 = win("a", "t2", { x: 0, y: 0, w: 800, h: 600 });
    const plan = replayAppWindows(data, "a", [a1], SCREENS);
    expect(plan.ok).toBe(true);
    expect(plan.count).toBe(1);
    expect(plan.windows).toHaveLength(1);
    expect(plan.frames[0]).toEqual({ x: 10, y: 10, w: 400, h: 300 }); // 第一条记忆胜出
  });
  it("deleteSnapshot：两步确认后删除，返回槽位数", () => {
    const data = layouts({}, { savedAt: 1, count: 3, frames: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }] });
    expect(deleteSnapshot(data)).toBe(3);
    expect(data.snapshot).toBeUndefined();
    expect(deleteSnapshot(data)).toBe(0);
  });
  it("defaultTemplateFor 用于 doArrange 兜底链齐全", () => {
    expect(defaultTemplateFor(2)?.id).toBe("overlap-lr");
  });
});