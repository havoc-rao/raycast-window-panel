// 单窗布局的动作层：写入后校验（AX 成功 ≠ 应用照做）
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Frame } from "../src/domain/types";

const h = vi.hoisted(() => ({
  bump: vi.fn(async () => {}),
  provider: {
    getActiveWindow: vi.fn(),
    getScreenRegion: vi.fn(),
    listWindowsForApp: vi.fn(),
    setBounds: vi.fn(async () => {}),
  },
}));

vi.mock("@raycast/api", () => ({ getFrontmostApplication: vi.fn(), closeMainWindow: vi.fn() }));
vi.mock("../src/services/windows/provider", () => ({ getProvider: async () => h.provider }));
vi.mock("../src/services/storage/repository", () => ({
  loadLayouts: () => ({ windows: {}, snapshot: undefined }),
  persistLayouts: vi.fn(),
  memory: { bumpSingleRecent: h.bump },
}));

import { applySingleLayout } from "../src/services/actions";

/** 复现截图里的场景：CodeBuddy CN 窗口 1440×900 @ (0,104)，屏幕可用区 1710×1073 @ (0,39) */
const target = {
  id: "81685|1",
  appName: "CodeBuddy CN",
  bundleId: "com.tencent.codebuddycn",
  title: "chatgpt-reverse",
  bounds: { x: 0, y: 104, w: 1440, h: 900 },
  fullScreen: false,
  positionable: true,
  resizable: true,
};
const region = { x: 0, y: 39, w: 1710, h: 1073 };
const maximized = region;

function seen(bounds: Frame) {
  return [{ ...target, bounds }];
}

beforeEach(() => {
  h.bump.mockClear();
  h.provider.getActiveWindow.mockReset().mockResolvedValue({ ...target, bounds: { ...target.bounds } });
  h.provider.getScreenRegion.mockReset().mockResolvedValue({ ...region });
  h.provider.setBounds.mockReset().mockResolvedValue(undefined);
  h.provider.listWindowsForApp.mockReset();
});

describe("applySingleLayout 写入后校验", () => {
  it("应用照做 → 成功且只写一次", async () => {
    h.provider.listWindowsForApp.mockResolvedValue(seen(maximized));
    const r = await applySingleLayout("maximize");
    expect(r).toEqual({ ok: true, message: "当前窗口布局：铺满可用屏幕" });
    expect(h.provider.setBounds).toHaveBeenCalledTimes(1);
    expect(h.bump).toHaveBeenCalledWith("maximize", expect.any(Function));
  });

  it("AX 接受但尺寸没变 → 重试一次、回滚原帧、报错且不记最近", async () => {
    // 真实表现：位置漂到 (0,147)，尺寸仍是 1440×900
    h.provider.listWindowsForApp.mockResolvedValue(seen({ x: 0, y: 147, w: 1440, h: 900 }));
    const r = await applySingleLayout("maximize");

    expect(r.ok).toBe(false);
    expect(r.message).toContain("CodeBuddy CN");
    expect(r.message).toContain("1440×900");
    expect(r.message).toContain("1710×1073");
    expect(r.message).toContain("已恢复原位置");

    expect(h.provider.setBounds).toHaveBeenCalledTimes(3); // 写入 → 重试 → 回滚
    expect(h.provider.setBounds.mock.calls[2][1]).toEqual(target.bounds);
    expect(h.bump).not.toHaveBeenCalled();
  });

  it("第一次没生效、重试后生效 → 成功", async () => {
    h.provider.listWindowsForApp
      .mockResolvedValueOnce(seen({ x: 0, y: 147, w: 1440, h: 900 }))
      .mockResolvedValueOnce(seen(maximized));
    const r = await applySingleLayout("maximize");
    expect(r.ok).toBe(true);
    expect(h.provider.setBounds).toHaveBeenCalledTimes(2);
    expect(h.bump).toHaveBeenCalled();
  });

  it("读不回窗口（已关闭/通道异常）→ 不误报失败", async () => {
    h.provider.listWindowsForApp.mockRejectedValue(new Error("windowkit 通道不可用"));
    const r = await applySingleLayout("maximize");
    expect(r.ok).toBe(true);
  });

  it("已经铺满（目标尺寸等于原尺寸）→ 单次写入、成功", async () => {
    h.provider.getActiveWindow.mockResolvedValue({ ...target, bounds: { ...maximized } });
    h.provider.listWindowsForApp.mockResolvedValue(seen(maximized));
    const r = await applySingleLayout("maximize");
    expect(r.ok).toBe(true);
    expect(h.provider.setBounds).toHaveBeenCalledTimes(1);
  });

  it("写入本身报错 → 原样转为失败提示，不做回滚", async () => {
    h.provider.setBounds.mockRejectedValue(new Error("窗口可能已关闭或无法调整"));
    const r = await applySingleLayout("maximize");
    expect(r.ok).toBe(false);
    expect(r.message).toContain("窗口可能已关闭");
    expect(h.provider.setBounds).toHaveBeenCalledTimes(1);
    expect(h.provider.listWindowsForApp).not.toHaveBeenCalled();
  });
});
