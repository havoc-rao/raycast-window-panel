// golden 回归：从 init.lua / single-layout.lua 源码手算/推导期望帧值，断言 TS 移植输出一致
import { describe, expect, it } from "vitest";
import {
  EDGE_TWO,
  GAP,
  cascadeFrames,
  clampFrame,
  framesAlmostEqual,
  normalizeFrames,
  slotFrames,
  splitH,
  splitV,
  tiled,
} from "../src/geometry";
import type { Frame } from "../src/types";

// 1440×900 全屏区域（主屏常见分辨率），GAP=4，EDGE_TWO=60
const R0 = { x: 0, y: 0, w: 1440, h: 900 };
const R1 = { x: 0, y: 0, w: 1000, h: 800 };

function expectFrames(actual: Frame[], expected: Frame[], eps = 1e-6) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect(framesAlmostEqual(actual[i], e, eps), `frame[${i}] ${JSON.stringify(actual[i])} vs ${JSON.stringify(e)}`).toBe(true);
  });
}

describe("slotFrames（重叠左右槽位，两窗）", () => {
  it("1440×900 region, edge=60 → 主槽贴右、左槽贴左，均 1380 宽", () => {
    const W = R0.w - EDGE_TWO; // 1380
    expectFrames(slotFrames(R0, EDGE_TWO), [
      { x: 60, y: 0, w: W, h: 900 }, // main（焦点）
      { x: 0, y: 0, w: W, h: 900 }, // left（露左 edge）
    ]);
  });
});

describe("splitH / splitV（分屏切分）", () => {
  it("splitH 均分 2 窗：缝宽 GAP 从总宽扣除", () => {
    const w = (R0.w - GAP) * 0.5; // 718
    expectFrames(splitH(R0, [0.5, 0.5], GAP), [
      { x: 0, y: 0, w, h: 900 },
      { x: w + GAP, y: 0, w, h: 900 },
    ]);
  });
  it("splitV 均分 2 窗（上下各半）", () => {
    const h = (R0.h - GAP) * 0.5; // 448? no——上下各半是 0.5/0.5: 448
    expectFrames(splitV(R0, [0.5, 0.5], GAP), [
      { x: 0, y: 0, w: 1440, h },
      { x: 0, y: h + GAP, w: 1440, h },
    ]);
  });
  it("splitH 2/3:1/3（主左次右）", () => {
    const w1 = (R0.w - GAP) * (2 / 3); // 957.333…
    const w2 = (R0.w - GAP) * (1 / 3); // 478.666…
    expectFrames(splitH(R0, [2 / 3, 1 / 3], GAP), [
      { x: 0, y: 0, w: w1, h: 900 },
      { x: w1 + GAP, y: 0, w: w2, h: 900 },
    ], 1e-3);
  });
  it("三列等宽：总缝宽 = 2×GAP", () => {
    const w = (R0.w - 2 * GAP) / 3; // 477.333…
    expectFrames(splitH(R0, [1 / 3, 1 / 3, 1 / 3], GAP), [
      { x: 0, y: 0, w, h: 900 },
      { x: w + GAP, y: 0, w, h: 900 },
      { x: 2 * (w + GAP), y: 0, w, h: 900 },
    ], 1e-3);
  });
  it("四列等宽", () => {
    const w = (R0.w - 3 * GAP) / 4; // 357
    const frames = splitH(R0, [0.25, 0.25, 0.25, 0.25], GAP);
    expectFrames(frames, [0, 1, 2, 3].map((i) => ({ x: i * (w + GAP), y: 0, w, h: 900 })));
  });
});

describe("tiled（等分网格）", () => {
  it("2×2 四宫格 @1000×800：缝宽各扣一次", () => {
    const gx = (R1.w - GAP) / 2; // 498
    const gy = (R1.h - GAP) / 2; // 398
    expectFrames(tiled(R1, 2, 2, GAP), [
      { x: 0, y: 0, w: gx, h: gy },
      { x: gx + GAP, y: 0, w: gx, h: gy },
      { x: 0, y: gy + GAP, w: gx, h: gy },
      { x: gx + GAP, y: gy + GAP, w: gx, h: gy },
    ]);
  });
  it("limit=3 时只取前 3 个槽位", () => {
    expect(tiled(R1, 2, 2, GAP, 3)).toHaveLength(3);
  });
  it("1 列 2 行（left-stack 右侧栈）", () => {
    // 右半区域 718 宽、区域高 900：gx = 718, gy = (900-4)/2 = 448
    const right = { x: 722, y: 0, w: 718, h: 900 };
    expectFrames(tiled(right, 2, 1, GAP, 2), [
      { x: 722, y: 0, w: 718, h: 448 },
      { x: 722, y: 452, w: 718, h: 448 },
    ]);
  });
  it("grid-auto n=5 → 3 列 2 行、取 5 槽", () => {
    const cols = Math.ceil(Math.sqrt(5)); // 3
    const rows = Math.ceil(5 / cols); // 2
    const gx = (R1.w - GAP * (cols - 1)) / cols; // 330.666…
    const gy = (R1.h - GAP * (rows - 1)) / rows; // 398
    const frames = tiled(R1, rows, cols, GAP, 5);
    expect(frames).toHaveLength(5);
    expectFrames(
      frames,
      [
        { x: 0, y: 0 },
        { x: gx + GAP, y: 0 },
        { x: 2 * (gx + GAP), y: 0 },
        { x: 0, y: gy + GAP },
        { x: gx + GAP, y: gy + GAP },
      ].map((p) => ({ ...p, w: gx, h: gy })),
      1e-3
    );
  });
});

describe("cascadeFrames（叠放瀑布）", () => {
  it("n=3：主槽 + 左槽 + 左槽左移 8px", () => {
    const main = { x: EDGE_TWO, y: 0, w: 1440 - EDGE_TWO, h: 900 };
    const left = { x: 0, y: 0, w: 1440 - EDGE_TWO, h: 900 };
    expectFrames(cascadeFrames(R0, 3, EDGE_TWO), [main, left, { x: -8, y: 0, w: left.w, h: 900 }]);
  });
  it("n=4：每多一窗左移 8px", () => {
    const left = { x: 0, y: 0, w: 1380, h: 900 };
    const frames = cascadeFrames(R0, 4, EDGE_TWO);
    expect(frames[3]).toEqual({ x: -16, y: 0, w: 1380, h: 900 });
  });
});

describe("clampFrame（帧落点安全网）", () => {
  const screens = [{ frame: { x: 0, y: 0, w: 1440, h: 900 } }];
  it("仍落在某块屏幕上 → 原样返回（含负 x 的叠放帧）", () => {
    expect(clampFrame({ x: -8, y: 0, w: 1380, h: 900 }, screens)).toEqual({ x: -8, y: 0, w: 1380, h: 900 });
  });
  it("不在任何屏幕内 → 平移到主屏原点 +40", () => {
    expect(clampFrame({ x: 2000, y: 5000, w: 800, h: 600 }, screens)).toEqual({ x: 40, y: 40, w: 800, h: 600 });
  });
  it("多屏：落在副屏 → 原样", () => {
    const two = [
      { frame: { x: 0, y: 0, w: 1440, h: 900 } },
      { frame: { x: 1440, y: 0, w: 1920, h: 1080 } },
    ];
    expect(clampFrame({ x: 2000, y: 100, w: 800, h: 600 }, two)).toEqual({ x: 2000, y: 100, w: 800, h: 600 });
  });
});

describe("normalizeFrames（预览归一化）", () => {
  it("全屏帧 → 画布 {16,0,160,100}（aspect 90/160）", () => {
    const out = normalizeFrames([{ x: 0, y: 0, w: 1440, h: 900 }], R0);
    expectFrames(out, [{ x: 16, y: 0, w: 160, h: 100 }], 1e-6);
  });
});

describe("left-stack / top-bottom 组合模板（1:1 推导）", () => {
  it("左半+右上右下：left+right 各 718，右侧栈 448 高", () => {
    const lw = (R0.w - GAP) / 2; // 718
    const st = tiled({ x: lw + GAP, y: 0, w: lw, h: 900 }, 2, 1, GAP, 2);
    expectFrames(
      [ { x: 0, y: 0, w: lw, h: 900 }, ...st ],
      [
        { x: 0, y: 0, w: 718, h: 900 },
        { x: 722, y: 0, w: 718, h: 448 },
        { x: 722, y: 452, w: 718, h: 448 },
      ]
    );
  });
  it("上一下二：top 448 高，底部两列各 718", () => {
    const th = (R0.h - GAP) / 2; // 448
    expectFrames(
      [
        { x: 0, y: 0, w: 1440, h: th },
        { x: 0, y: th + GAP, w: 718, h: th },
        { x: 722, y: th + GAP, w: 718, h: th },
      ],
      [
        { x: 0, y: 0, w: 1440, h: 448 },
        { x: 0, y: 452, w: 718, h: 448 },
        { x: 722, y: 452, w: 718, h: 448 },
      ]
    );
  });
});