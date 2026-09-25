// 纯几何函数：从 ~/.hammerspoon/init.lua 1:1 移植（splitH/splitV/tiled/slotFrames/cascadeFrames/clampFrame）
// 与 Lua 版约束一致：纯函数、无副作用，预览图与执行引擎共用同一实现。
import type { Frame, Region, Screen } from "./types";

/** 两窗方案专用的观察缝（更宽，方便看后台窗口） */
export const EDGE_TWO = 60;
/** 视区顶部留空（避开菜单栏） */
export const TOP = 0;
/** 底部留空 */
export const BOT = 0;
/** 分屏/网格类模板的窗口缝宽（重叠类不受影响） */
export const GAP = 4;

/** 两窗槽位几何：窗口尺寸相同、紧贴区域边缘、仅互相错位，焦点窗口在最前（frame[0] = 主/焦点槽） */
export function slotFrames(region: Region, edge: number): Frame[] {
  const H = region.h - TOP - BOT;
  const cy = region.y + TOP;
  // 两窗完全占满区域宽度: 左窗贴左缘, 主视图贴右缘, 互相错位让出左 edge
  const W = region.w - edge;
  const main = { x: region.x + edge, y: cy, w: W, h: H };
  const left = { x: region.x, y: cy, w: W, h: H }; // 露左 edge
  return [main, left];
}

/** 纵向切分（左右分栏）：ratios 之和为 1，返回等长 frame 列表 */
export function splitH(region: Region, ratios: number[], gap: number): Frame[] {
  const frames: Frame[] = [];
  let x = region.x;
  const totalGap = gap * (ratios.length - 1);
  for (const r of ratios) {
    const w = (region.w - totalGap) * r;
    frames.push({ x, y: region.y, w, h: region.h });
    x = x + w + gap;
  }
  return frames;
}

/** 横向切分（上下分行）：ratios 之和为 1，返回等长 frame 列表 */
export function splitV(region: Region, ratios: number[], gap: number): Frame[] {
  const frames: Frame[] = [];
  let y = region.y;
  const totalGap = gap * (ratios.length - 1);
  for (const r of ratios) {
    const h = (region.h - totalGap) * r;
    frames.push({ x: region.x, y, w: region.w, h });
    y = y + h + gap;
  }
  return frames;
}

/** rows×cols 等分网格，最多取 limit 个（不足的窗口只占前几个槽位） */
export function tiled(region: Region, rows: number, cols: number, gap: number, limit?: number): Frame[] {
  const frames: Frame[] = [];
  const gx = (region.w - gap * (cols - 1)) / cols;
  const gy = (region.h - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (frames.length >= (limit ?? rows * cols)) return frames;
      frames.push({
        x: region.x + c * (gx + gap),
        y: region.y + r * (gy + gap),
        w: gx,
        h: gy,
      });
    }
  }
  return frames;
}

/** 叠放瀑布：焦点窗占主槽，其余依次贴左缘并按 8px 递增错位（3+ 窗现状行为） */
export function cascadeFrames(region: Region, n: number, edge: number): Frame[] {
  const slots = slotFrames(region, edge);
  const frames: Frame[] = [slots[0]];
  for (let i = 2; i <= n; i++) {
    const s = slots[1];
    frames[i - 1] = i === 2 ? s : { x: s.x - (i - 2) * 8, y: s.y, w: s.w, h: s.h };
  }
  return frames;
}

/** frame 是否与屏幕 frame 相交（clampFrame 判定用） */
export function frameIntersectsScreen(frame: Frame, sf: Frame): boolean {
  return frame.x + frame.w > sf.x && frame.x < sf.x + sf.w && frame.y + frame.h > sf.y && frame.y < sf.y + sf.h;
}

/**
 * 帧落点安全网：不在任何屏幕内则平移到主屏（screens[0] 约定为主屏），避免窗口丢到屏幕外。
 * 与 Lua 版一致：仍落在某块屏幕上则原样返回。
 */
export function clampFrame(frame: Frame, screens: Screen[]): Frame {
  for (const s of screens) {
    if (frameIntersectsScreen(frame, s.frame)) return frame;
  }
  const mf = screens.length > 0 ? screens[0].frame : { x: 0, y: 0, w: 0, h: 0 };
  return { x: mf.x + 40, y: mf.y + 40, w: frame.w, h: frame.h };
}

/** 把真实屏幕坐标帧等比归一化到 mock 画布坐标（模板预览共用，1:1 移植 normalizeFrames） */
export function normalizeFrames(frames: Frame[], region: Region): Frame[] {
  const s = 160 / region.w;
  return frames.map((f) => ({
    x: 16 + (f.x - region.x) * s,
    y: (f.y - region.y) * s,
    w: f.w * s,
    h: f.h * s,
  }));
}

/** 测试/对照用：浮点近似相等 */
export function framesAlmostEqual(a: Frame, b: Frame, eps = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.w - b.w) <= eps &&
    Math.abs(a.h - b.h) <= eps
  );
}