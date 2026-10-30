import { describe, expect, it } from "vitest";
import { isDesktopWindow } from "../src/services/windows/desktop";
import type { Screen } from "../src/domain/types";

const primary: Screen = { frame: { x: 0, y: 0, w: 1920, h: 1080 } };
const external: Screen = { frame: { x: -1280, y: 56, w: 1280, h: 1024 } };
const screens = [primary, external];

function win(over: Partial<Parameters<typeof isDesktopWindow>[0]>) {
  return {
    bundleId: "com.apple.finder",
    title: "",
    subrole: "",
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
    ...over,
  };
}

describe("isDesktopWindow", () => {
  it("Finder 无标题 + 铺满整屏 = 桌面", () => {
    expect(isDesktopWindow(win({}), screens)).toBe(true);
  });

  it("Finder 真实窗口总有标题，即使铺满整屏也不算桌面", () => {
    expect(isDesktopWindow(win({ title: "Documents" }), screens)).toBe(false);
  });

  it("Finder 无标题但未铺满整屏（不是桌面）", () => {
    expect(isDesktopWindow(win({ w: 900, h: 600 }), screens)).toBe(false);
  });

  it("其他 App 的壁纸/桌面级窗口：无标题 + 不报 subrole + 铺满整屏", () => {
    expect(isDesktopWindow(win({ bundleId: "com.example.wallpaper" }), screens)).toBe(true);
  });

  it("其他 App 上报 AXStandardWindow 的无标题全屏窗口不被误伤", () => {
    expect(isDesktopWindow(win({ bundleId: "com.example.player", subrole: "AXStandardWindow" }), screens)).toBe(false);
  });

  it("容差 2pt：缩放取整误差仍识别为桌面，差一个菜单栏高度则不是", () => {
    expect(isDesktopWindow(win({ x: 1, y: 1, w: 1920, h: 1079 }), screens)).toBe(true);
    expect(isDesktopWindow(win({ y: 39, h: 1041 }), screens)).toBe(false);
  });

  it("副屏桌面按该屏整屏帧匹配", () => {
    expect(isDesktopWindow(win({ x: -1280, y: 56, w: 1280, h: 1024 }), screens)).toBe(true);
    expect(isDesktopWindow(win({ x: 0, y: 0, w: 1280, h: 1024 }), screens)).toBe(false);
  });
});
