import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutsData } from "../src/domain/types";

const h = vi.hoisted(() => ({
  data: {} as LayoutsData,
  bumpSingleRecent: vi.fn(),
  getArrangeTemplate: vi.fn(),
  setArrangeTemplate: vi.fn(),
  bumpArrangeRecent: vi.fn(),
  provider: {
    getActiveWindow: vi.fn(),
    getScreenRegion: vi.fn(),
    getAllScreens: vi.fn(),
    listWindowsOnActiveDesktop: vi.fn(),
    listWindowsForApp: vi.fn(),
    setBounds: vi.fn(),
    raise: vi.fn(),
  },
}));

vi.mock("@raycast/api", () => ({ getFrontmostApplication: vi.fn(), closeMainWindow: vi.fn() }));
vi.mock("../src/services/windows/provider", () => ({ getProvider: async () => h.provider }));
vi.mock("../src/services/storage/repository", () => ({
  loadLayouts: () => h.data,
  persistLayouts: vi.fn(),
  memory: h,
}));

import { applySingleLayout, replayAppCommand, replayMemoryCommand, runArrange } from "../src/services/actions";

const target = {
  id: "81685|1", appName: "CodeBuddy CN", bundleId: "com.tencent.codebuddycn", title: "Editor",
  bounds: { x: 0, y: 104, w: 1440, h: 900 }, fullScreen: false, positionable: true, resizable: true,
};
const region = { x: 0, y: 39, w: 1710, h: 1073 };
const key = target.bundleId + "|" + target.title;
const record = { id: target.id, bundleID: target.bundleId, title: target.title, frame: region };

beforeEach(() => {
  vi.resetAllMocks();
  h.data = { windows: {} };
  h.provider.getActiveWindow.mockResolvedValue(target);
  h.provider.getScreenRegion.mockResolvedValue(region);
  h.provider.getAllScreens.mockResolvedValue([{ frame: region }]);
  h.provider.listWindowsOnActiveDesktop.mockResolvedValue([]);
  h.provider.listWindowsForApp.mockResolvedValue([target]);
});

describe("所有布局入口按实际结果反馈", () => {
  it("单窗布局确认生效后更新最近使用", async () => {
    h.provider.listWindowsForApp.mockResolvedValue([{ ...target, bounds: region }]);
    expect(await applySingleLayout("maximize")).toEqual({ ok: true, message: "当前窗口布局：铺满可用屏幕" });
    expect(h.provider.setBounds).toHaveBeenCalledTimes(1);
    expect(h.bumpSingleRecent).toHaveBeenCalledWith("maximize", expect.any(Function));
  });

  it("截图里的自动排布全屏没有改尺寸时不能报成功或更新上次样式", async () => {
    const result = await runArrange("maximize");
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("未执行尺寸调整") });
    expect(h.setArrangeTemplate).not.toHaveBeenCalled();
    expect(h.bumpArrangeRecent).not.toHaveBeenCalled();
    expect(h.provider.raise).not.toHaveBeenCalled();
  });

  it("自动排布确认生效后仍保存模板", async () => {
    h.provider.listWindowsForApp.mockResolvedValue([{ ...target, bounds: region }]);
    expect(await runArrange("maximize")).toEqual({ ok: true, message: "已排布: 全屏 (1 窗)" });
    expect(h.setArrangeTemplate).toHaveBeenCalledWith(1, "maximize");
  });

  it("重放我的布局也检查尺寸", async () => {
    h.data.snapshot = { savedAt: 1, count: 1, frames: [region] };
    expect(await runArrange("replay")).toMatchObject({ ok: false, message: expect.stringContaining("未执行尺寸调整") });
    expect(h.provider.setBounds).toHaveBeenCalledWith(target, region, false);
  });

  it.each(["App", "单条"])("重放%s记忆未变更时不报成功", async (mode) => {
    h.data.windows[key] = record;
    const result = mode === "App" ? await replayAppCommand(target.bundleId) : await replayMemoryCommand(key);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("未执行尺寸调整") });
    expect(h.provider.setBounds).toHaveBeenCalledWith(target, region, false);
  });

  it("屏幕信息不可用时不重放记忆", async () => {
    h.data.windows[key] = record;
    h.provider.getAllScreens.mockResolvedValue([]);
    expect(await replayMemoryCommand(key)).toMatchObject({ ok: false, message: expect.stringContaining("无法读取当前屏幕") });
    expect(h.provider.setBounds).not.toHaveBeenCalled();
  });

  it("底层写入报错时保持原始错误", async () => {
    h.provider.setBounds.mockRejectedValue(new Error("窗口可能已关闭或无法调整"));
    expect(await applySingleLayout("maximize")).toEqual({ ok: false, message: "窗口可能已关闭或无法调整" });
    expect(h.provider.listWindowsForApp).not.toHaveBeenCalled();
  });
});
