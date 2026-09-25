// 模板注册表：从 init.lua 的 layoutTemplates + single-layout.lua 1:1 移植。
// 新增模板 = 追加一条记录（与 Lua 版约定一致：fn 为纯几何函数、minN/maxN 声明适用窗口数、order 控制排序）。
import type { Frame, Region, Template } from "./types";
import { EDGE_TWO, GAP, cascadeFrames, slotFrames, splitH, splitV, tiled } from "./geometry";

// ---- 排布模板（自动排布用） ----
export const layoutTemplates: Template[] = [
  // n = 1
  {
    id: "maximize",
    name: "全屏",
    eng: "Maximize",
    keywords: "quanping full zoom max",
    minN: 1,
    maxN: 1,
    order: 1,
    accent: "#3478f6",
    fn: (_n, r) => [r],
  },
  {
    id: "center76",
    name: "居中 76%",
    eng: "Center",
    keywords: "juzhong center middle",
    minN: 1,
    maxN: 1,
    order: 2,
    fn: (_n, r) => {
      const w = r.w * 0.76;
      const h = r.h * 0.76;
      return [{ x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h }];
    },
  },
  {
    id: "half-left",
    name: "左半屏",
    eng: "Left Half",
    keywords: "zuoban left half",
    minN: 1,
    maxN: 1,
    order: 3,
    fn: (_n, r) => [{ x: r.x, y: r.y, w: r.w / 2, h: r.h }],
  },
  {
    id: "half-right",
    name: "右半屏",
    eng: "Right Half",
    keywords: "youban right half",
    minN: 1,
    maxN: 1,
    order: 4,
    fn: (_n, r) => [{ x: r.x + r.w / 2, y: r.y, w: r.w / 2, h: r.h }],
  },

  // n = 2（默认"重叠左右"，即现状行为）
  {
    id: "overlap-lr",
    name: "重叠左右",
    eng: "Overlap LR",
    keywords: "chongdie zuoyou overlap lu bian",
    minN: 2,
    maxN: 2,
    order: 1,
    accent: "#3478f6",
    fn: (_n, r) => slotFrames(r, EDGE_TWO),
  },
  {
    id: "split-h2",
    name: "左右各半",
    eng: "Side by Side",
    keywords: "zuoyou geban side split half",
    minN: 2,
    maxN: 2,
    order: 2,
    fn: (_n, r) => splitH(r, [0.5, 0.5], GAP),
  },
  {
    id: "split-v2",
    name: "上下各半",
    eng: "Top Bottom",
    keywords: "shangxia geban top bottom half",
    minN: 2,
    maxN: 2,
    order: 3,
    fn: (_n, r) => splitV(r, [0.5, 0.5], GAP),
  },
  {
    id: "focus-left",
    name: "主左次右",
    eng: "Focus Left",
    keywords: "zhu zuo ci you focus 2 1",
    minN: 2,
    maxN: 2,
    order: 4,
    fn: (_n, r) => splitH(r, [2 / 3, 1 / 3], GAP),
  },

  // n = 3
  {
    id: "left-stack",
    name: "左半+右上右下",
    eng: "Left + Stack",
    keywords: "zuo youshang youxia stack",
    minN: 3,
    maxN: 3,
    order: 1,
    fn: (_n, r) => {
      const lw = (r.w - GAP) / 2;
      const left = { x: r.x, y: r.y, w: lw, h: r.h };
      const right = { x: r.x + lw + GAP, y: r.y, w: lw, h: r.h };
      const st = tiled(right, 2, 1, GAP, 2);
      return [left, st[0], st[1]];
    },
  },
  {
    id: "three-h",
    name: "三列等宽",
    eng: "3 Columns",
    keywords: "sanlie dengkuan columns",
    minN: 3,
    maxN: 3,
    order: 2,
    fn: (_n, r) => splitH(r, [1 / 3, 1 / 3, 1 / 3], GAP),
  },
  {
    id: "top-bottom",
    name: "上一下二",
    eng: "Top + Bottom",
    keywords: "shangyi xiaer title",
    minN: 3,
    maxN: 3,
    order: 3,
    fn: (_n, r) => {
      const th = (r.h - GAP) / 2;
      const top = { x: r.x, y: r.y, w: r.w, h: th };
      const bot = { x: r.x, y: r.y + th + GAP, w: r.w, h: th };
      const b2 = tiled(bot, 1, 2, GAP, 2);
      return [top, b2[0], b2[1]];
    },
  },

  // n >= 3 的叠放（现状行为）；也作为 n=4 的可选项之一
  {
    id: "cascade",
    name: "叠放瀑布",
    eng: "Cascade",
    keywords: "diefang pubu cascade overlap",
    minN: 3,
    maxN: 8,
    order: 9,
    accent: "#c67424",
    fn: (n, r) => cascadeFrames(r, n, EDGE_TWO),
  },

  // n = 4
  {
    id: "grid-2x2",
    name: "四宫格",
    eng: "2×2 Grid",
    keywords: "sigongge grid quarters",
    minN: 4,
    maxN: 4,
    order: 1,
    fn: (n, r) => tiled(r, 2, 2, GAP, n),
  },
  {
    id: "four-h",
    name: "四列等宽",
    eng: "4 Columns",
    keywords: "silie dengkuan columns",
    minN: 4,
    maxN: 4,
    order: 2,
    fn: (_n, r) => splitH(r, [0.25, 0.25, 0.25, 0.25], GAP),
  },

  // n >= 5: 按数量自动选择行列数的等分网格
  {
    id: "grid-auto",
    name: "等分网格",
    eng: "Auto Grid",
    keywords: "dengfen wangge grid auto",
    minN: 5,
    maxN: 8,
    order: 1,
    fn: (n, r) => {
      const cols = Math.ceil(Math.sqrt(n));
      const rows = Math.ceil(n / cols);
      return tiled(r, rows, cols, GAP, n);
    },
  },
];

/** "我的布局"两个特殊项：纯槽位，不关联 app（子菜单置顶展示） */
export const specialTemplates: Template[] = [
  {
    id: "save-layout",
    name: "保存当前布局",
    eng: "Save My Layout",
    subText: "记录现在的摆放, 之后按槽位顺序重放",
    keywords: "baocun jilu dangqian buju save snapshot layout",
    accent: "#8e5cf6",
    special: "save",
    order: -2,
  },
  {
    id: "replay-layout",
    name: "重放我的布局",
    eng: "Replay My Layout",
    subText: "上次保存的摆放, 按窗口顺序简单套用",
    keywords: "chongfang wode buju replay my layout",
    accent: "#c67424",
    special: "replay",
    order: -1,
  },
];

const templateIndex: Record<string, Template> = {};
for (const t of [...layoutTemplates, ...specialTemplates]) templateIndex[t.id] = t;

export function templateById(id?: string): Template | undefined {
  return id ? templateIndex[id] : undefined;
}

export function templateApplies(t: Template | undefined, n: number): boolean {
  return !!t && (!t.minN || n >= t.minN) && (!t.maxN || n <= t.maxN);
}

/** 某窗口数适用的模板（按 order 排序；不含特殊项） */
export function templatesFor(n: number): Template[] {
  const list = layoutTemplates.filter((t) => templateApplies(t, n));
  list.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return list;
}

/** 内置默认：与历史行为完全一致（1 全屏 / 2 重叠左右 / 3+ 叠放） */
export function defaultTemplateFor(n: number): Template | undefined {
  if (n <= 1) return templateById("maximize");
  if (n === 2) return templateById("overlap-lr") ?? templateById("cascade");
  return templateById("cascade") ?? templateById("grid-auto");
}

/** 子菜单/quick 用：该窗口数上次选过的模板，没有则回默认（rememberedId 由调用方从存储取） */
export function pickTemplate(n: number, rememberedId: string | undefined): Template | undefined {
  const t = templateById(rememberedId);
  if (templateApplies(t, n)) return t;
  return defaultTemplateFor(n);
}

/** 窗口数 N 的子菜单顺序：最近用过且适用的模板（按 MRU）在前，其余按静态 order */
export function templatesForOrdered(n: number, recentIds: string[]): { ordered: Template[]; used: Set<string> } {
  const used = new Set<string>();
  const ordered: Template[] = [];
  for (const id of recentIds) {
    const t = templateById(id);
    if (t && templateApplies(t, n) && !t.special) {
      ordered.push(t);
      used.add(t.id);
    }
  }
  for (const t of templatesFor(n)) {
    if (!used.has(t.id)) ordered.push(t);
  }
  return { ordered, used };
}

/** 模板迷你预览：同一 fn 跑在 mock 区域上，纯几何所以直接可画（aspect = 屏幕高/宽） */
export function previewFrames(t: Template, n: number, aspect: number): Frame[] {
  aspect = aspect || 90 / 160;
  const mock = { x: 16, y: 0, w: 160, h: 160 * aspect };
  if (!t.fn) return [];
  try {
    const frames = t.fn(n, mock);
    if (!Array.isArray(frames)) return [];
    return frames;
  } catch {
    return [];
  }
}

// ---- 12 单窗规格（single-layout.lua 1:1 移植） ----
export interface SingleTemplate extends Template {
  group: string;
}

const SPECS: Array<[string, string, string, string, number, number, number, number]> = [
  ["maximize", "铺满可用屏幕", "Maximize", "quanping full zoom max", 0, 0, 1, 1],
  ["full-left-gap", "全屏（左留缝）", "Full · Left Gap", "quanping left gap liuzuo feng", 0.05, 0, 0.95, 1],
  ["full-right-gap", "全屏（右留缝）", "Full · Right Gap", "quanping right gap liuyou feng", 0, 0, 0.95, 1],
  ["center76", "居中 76%", "Center", "juzhong center middle", 0.12, 0.12, 0.76, 0.76],
  ["half-left", "左半屏", "Left Half", "zuoban left half", 0, 0, 0.5, 1],
  ["half-right", "右半屏", "Right Half", "youban right half", 0.5, 0, 0.5, 1],
  ["half-top", "上半屏", "Top Half", "shangban top half", 0, 0, 1, 0.5],
  ["half-bottom", "下半屏", "Bottom Half", "xiaban bottom half", 0, 0.5, 1, 0.5],
  ["quarter-top-left", "左上 1/4", "Top Left", "zuoshang top left quarter", 0, 0, 0.5, 0.5],
  ["quarter-top-right", "右上 1/4", "Top Right", "youshang top right quarter", 0.5, 0, 0.5, 0.5],
  ["quarter-bottom-left", "左下 1/4", "Bottom Left", "zuoxia bottom left quarter", 0, 0.5, 0.5, 0.5],
  ["quarter-bottom-right", "右下 1/4", "Bottom Right", "youxia bottom right quarter", 0.5, 0.5, 0.5, 0.5],
];

/** 语义分组（子菜单按组展示，组内最近用过置前） */
const GROUPS: Record<string, string> = {
  maximize: "全屏类",
  "full-left-gap": "全屏类",
  "full-right-gap": "全屏类",
  center76: "全屏类",
  "half-left": "半屏类",
  "half-right": "半屏类",
  "half-top": "半屏类",
  "half-bottom": "半屏类",
  "quarter-top-left": "1/4 类",
  "quarter-top-right": "1/4 类",
  "quarter-bottom-left": "1/4 类",
  "quarter-bottom-right": "1/4 类",
};

export const singleGroupOrder = ["全屏类", "半屏类", "1/4 类"];

const GAP_HINTS: Record<number, string> = {
  2: "露出左侧空间，右侧铺满",
  3: "露出右侧空间，左侧铺满",
};

export const singleLayoutTemplates: SingleTemplate[] = SPECS.map((spec, order) => {
  const [id, name, eng, keywords, x, y, w, h] = spec;
  return {
    id,
    name,
    eng,
    keywords,
    order: order + 1,
    group: GROUPS[id],
    subText:
      order === 0
        ? "铺满屏幕可用区域，不进入系统全屏"
        : GAP_HINTS[order + 1] ?? "仅调整当前窗口，不影响其他窗口",
    accent: "#3478f6",
    fn: (_n, region) => [
      { x: region.x + region.w * x, y: region.y + region.h * y, w: region.w * w, h: region.h * h },
    ],
  };
});

const singleIndex: Record<string, SingleTemplate> = {};
for (const t of singleLayoutTemplates) singleIndex[t.id] = t;

export function singleLayoutById(id?: string): SingleTemplate | undefined {
  return id ? singleIndex[id] : undefined;
}

/** 组顺序固定，组内：最近用过在前，其余按静态 order */
export function singleTemplatesOrdered(recentIds: string[]): { ordered: SingleTemplate[]; used: Set<string> } {
  const used = new Set<string>();
  const ordered: SingleTemplate[] = [];
  for (const group of singleGroupOrder) {
    const placed: SingleTemplate[] = [];
    const seen = new Set<string>();
    for (const rid of recentIds) {
      const t = singleLayoutById(rid);
      if (t && t.group === group) {
        placed.push(t);
        seen.add(t.id);
        used.add(t.id);
      }
    }
    for (const t of singleLayoutTemplates) {
      if (t.group === group && !seen.has(t.id)) placed.push(t);
    }
    ordered.push(...placed);
  }
  return { ordered, used };
}