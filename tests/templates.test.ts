import { describe, expect, it } from "vitest";
import {
  defaultTemplateFor,
  layoutTemplates,
  previewFrames,
  singleGroupOrder,
  singleLayoutById,
  singleLayoutTemplates,
  singleTemplatesOrdered,
  specialTemplates,
  templateApplies,
  templateById,
  templatesFor,
  templatesForOrdered,
} from "../src/templates";

describe("layoutTemplates 注册表", () => {
  it("id 唯一且全部可查", () => {
    const ids = layoutTemplates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of layoutTemplates) expect(templateById(t.id)).toBe(t);
  });
  it("12 单窗规格 + 15 排布模板 + 2 特殊项", () => {
    expect(layoutTemplates).toHaveLength(15);
    expect(singleLayoutTemplates).toHaveLength(12);
    expect(specialTemplates.map((t) => t.id)).toEqual(["save-layout", "replay-layout"]);
  });
  it("特殊项有 special 标记且无 fn", () => {
    expect(specialTemplates.every((t) => t.special !== undefined && t.fn === undefined)).toBe(true);
  });
});

describe("templateApplies / templatesFor / defaultTemplateFor", () => {
  it("适用性边界（与 Lua templateApplies 一致）", () => {
    const cascade = templateById("cascade");
    expect(templateApplies(cascade, 3)).toBe(true);
    expect(templateApplies(cascade, 8)).toBe(true);
    expect(templateApplies(cascade, 2)).toBe(false);
    expect(templateApplies(cascade, 9)).toBe(false);
    expect(templateApplies(templateById("maximize"), 1)).toBe(true);
    expect(templateApplies(templateById("maximize"), 2)).toBe(false);
  });
  it("templatesFor(n) 按 order 排序过滤", () => {
    expect(templatesFor(1).map((t) => t.id)).toEqual(["maximize", "center76", "half-left", "half-right"]);
    expect(templatesFor(2).map((t) => t.id)).toEqual(["overlap-lr", "split-h2", "split-v2", "focus-left"]);
    expect(templatesFor(3).map((t) => t.id)).toEqual(["left-stack", "three-h", "top-bottom", "cascade"]);
    expect(templatesFor(4).map((t) => t.id)).toEqual(["grid-2x2", "four-h", "cascade"]);
    expect(templatesFor(5).map((t) => t.id)).toEqual(["grid-auto", "cascade"]);
  });
  it("默认：1 全屏 / 2 重叠左右 / 3+ 叠放（历史行为一致）", () => {
    expect(defaultTemplateFor(0)?.id).toBe("maximize");
    expect(defaultTemplateFor(1)?.id).toBe("maximize");
    expect(defaultTemplateFor(2)?.id).toBe("overlap-lr");
    expect(defaultTemplateFor(3)?.id).toBe("cascade");
    expect(defaultTemplateFor(8)?.id).toBe("cascade");
  });
});

describe("MRU 排序（templatesForOrdered / singleTemplatesOrdered）", () => {
  it("最近用过且适用的模板置前，其余按静态 order", () => {
    const { ordered, used } = templatesForOrdered(2, ["split-h2", "split-v2", "bogus"]);
    expect(ordered.slice(0, 2).map((t) => t.id)).toEqual(["split-h2", "split-v2"]);
    expect(ordered.map((t) => t.id)).toEqual(["split-h2", "split-v2", "overlap-lr", "focus-left"]);
    expect(used.has("split-h2")).toBe(true);
    expect(used.has("overlap-lr")).toBe(false);
  });
  it("不适用当前窗口数的最近项被跳过", () => {
    const { ordered } = templatesForOrdered(1, ["split-h2"]); // split-h2 不适用 n=1
    expect(ordered.map((t) => t.id)).toEqual(["maximize", "center76", "half-left", "half-right"]);
  });
  it("特殊项不进 MRU 排序结果（即使出现在 recent 里）", () => {
    const { ordered } = templatesForOrdered(3, ["save-layout", "replay-layout"]);
    expect(ordered.map((t) => t.id)).not.toContain("save-layout");
    expect(ordered.map((t) => t.id)).not.toContain("replay-layout");
  });
  it("单窗规格：组顺序固定，组内 MRU 置前", () => {
    const { ordered, used } = singleTemplatesOrdered(["half-left", "maximize"]);
    const groupNames: string[] = [];
    const groupIds: string[][] = [];
    let cur = "";
    for (const t of ordered) {
      if (t.group !== cur) {
        cur = t.group;
        groupNames.push(cur);
        groupIds.push([]);
      }
      groupIds[groupIds.length - 1].push(t.id);
    }
    expect(groupNames).toEqual(singleGroupOrder);
    expect(groupIds[0][0]).toBe("maximize"); // 全屏类组内 MRU 置前
    expect(groupIds[1][0]).toBe("half-left"); // 半屏类组内 MRU 置前
    expect(groupIds[1].indexOf("half-right")).toBeGreaterThan(groupIds[1].indexOf("half-left"));
    expect(used.size).toBe(2);
  });
});

describe("12 单窗规格几何", () => {
  const region = { x: 0, y: 0, w: 1440, h: 900 };
  const frameOf = (id: string) => singleLayoutById(id)!.fn!(1, region)[0];
  const approx = (a: Record<string, number>, b: Record<string, number>, eps = 1e-6) => {
    for (const k of ["x", "y", "w", "h"] as const) {
      expect(Math.abs(a[k] - b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(eps);
    }
  };
  it("铺满/留缝/半屏/1/4 规格与 single-layout.lua 一致", () => {
    expect(frameOf("maximize")).toEqual({ x: 0, y: 0, w: 1440, h: 900 });
    expect(frameOf("full-left-gap")).toEqual({ x: 72, y: 0, w: 1368, h: 900 });
    expect(frameOf("full-right-gap")).toEqual({ x: 0, y: 0, w: 1368, h: 900 });
    approx(frameOf("center76"), { x: 172.8, y: 108, w: 1094.4, h: 684 });
    approx(frameOf("half-top"), { x: 0, y: 0, w: 1440, h: 450 });
    approx(frameOf("half-bottom"), { x: 0, y: 450, w: 1440, h: 450 });
    approx(frameOf("quarter-bottom-right"), { x: 720, y: 450, w: 720, h: 450 });
  });
  it("副标题规则：首个铺满提示，GAP_HINTS 给留缝提示，其余通用提示", () => {
    expect(singleLayoutById("maximize")?.subText).toBe("铺满屏幕可用区域，不进入系统全屏");
    expect(singleLayoutById("full-left-gap")?.subText).toBe("露出左侧空间，右侧铺满");
    expect(singleLayoutById("full-right-gap")?.subText).toBe("露出右侧空间，左侧铺满");
    expect(singleLayoutById("half-left")?.subText).toBe("仅调整当前窗口，不影响其他窗口");
  });
});

describe("previewFrames", () => {
  it("在 mock 区域上跑纯几何 fn", () => {
    const frames = previewFrames(layoutTemplates[0], 1, 90 / 160);
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(Math.abs(f.w - 160) < 1e-9).toBe(true);
  });
  it("异常模板返回空数组", () => {
    expect(previewFrames({ ...layoutTemplates[0], fn: undefined }, 1)).toEqual([]);
  });
});