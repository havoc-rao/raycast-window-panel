import { describe, expect, it, vi } from "vitest";
import type { TargetWindow } from "../src/domain/types";
import type { WindowProvider } from "../src/services/windows/types";
import { applyVerifiedBounds } from "../src/services/windows/verify";

const original = { x: 0, y: 104, w: 1440, h: 900 };
const desired = { x: 0, y: 39, w: 1710, h: 1073 };
const target: TargetWindow = { id: "123|1", bundleId: "example", appName: "CodeBuddy CN", title: "Editor", bounds: original, fullScreen: false, positionable: true, resizable: true };
const other = { ...target, id: "123|2", title: "Other" };

function provider() {
  return {
    setBounds: vi.fn<WindowProvider["setBounds"]>().mockResolvedValue(undefined),
    setBoundsBatch: vi.fn<WindowProvider["setBoundsBatch"]>().mockResolvedValue(undefined),
    listWindowsForApp: vi.fn<WindowProvider["listWindowsForApp"]>(),
  };
}

describe("applyVerifiedBounds", () => {
  it("不重写已经到位的窗口", async () => {
    const p = provider();
    expect(await applyVerifiedBounds(p, [{ window: target, frame: original }])).toBeNull();
    expect(p.setBounds).not.toHaveBeenCalled();
    expect(p.listWindowsForApp).not.toHaveBeenCalled();
  });

  it("允许异步生效，不必重写", async () => {
    const p = provider();
    p.listWindowsForApp.mockResolvedValueOnce([target]).mockResolvedValueOnce([{ ...target, bounds: desired }]);
    expect(await applyVerifiedBounds(p, [{ window: target, frame: desired }])).toBeNull();
    expect(p.setBounds).toHaveBeenCalledTimes(1);
  });

  it("批量写入只重试未达目标的窗口，同 App 每轮仅枚举一次", async () => {
    const p = provider();
    const otherFrame = { ...original, x: 240 };
    const partial = { ...target, bounds: { ...desired, h: original.h } };
    p.listWindowsForApp.mockResolvedValue([partial, { ...other, bounds: otherFrame }]);
    const result = await applyVerifiedBounds(p, [
      { window: target, frame: desired }, { window: other, frame: otherFrame },
    ]);
    expect(p.setBoundsBatch).toHaveBeenCalledWith([
      { window: target, frame: desired, positionOnly: false }, { window: other, frame: otherFrame, positionOnly: true },
    ]);
    expect(p.setBounds).toHaveBeenCalledTimes(1);
    expect(p.setBounds).toHaveBeenCalledWith(partial, desired, false, true);
    expect(p.listWindowsForApp).toHaveBeenCalledTimes(3);
    expect(result).toContain("1/2 窗已确认");
    expect(result).toContain("尺寸未达到目标");
  });

  it("尺寸没变但位置被挪走时，只回滚位置且读回确认", async () => {
    const p = provider();
    const moved = { ...target, bounds: { ...original, y: 147 } };
    p.listWindowsForApp.mockResolvedValueOnce([moved]).mockResolvedValueOnce([moved]).mockResolvedValueOnce([moved]).mockResolvedValueOnce([target]);
    const result = await applyVerifiedBounds(p, [{ window: target, frame: desired }]);
    expect(result).toContain("未执行尺寸调整");
    expect(result).toContain("1440×900");
    expect(result).toContain("1710×1073");
    expect(result).toContain("已恢复原位置");
    expect(p.setBounds).toHaveBeenLastCalledWith(moved, original, true);
  });

  it("位置写入没生效也失败；不会冒充已回滚", async () => {
    const p = provider();
    p.listWindowsForApp.mockResolvedValue([target]);
    const move = { ...original, y: desired.y };
    const result = await applyVerifiedBounds(p, [{ window: target, frame: move }]);
    expect(result).toContain("未移到目标位置");
    expect(p.setBounds).toHaveBeenLastCalledWith(target, move, true);
    expect(p.setBounds).toHaveBeenCalledTimes(2);
  });

  it("尺寸已到位但位置未到位时，只重试移动，不启用缩放兼容处理", async () => {
    const p = provider();
    const resized = { ...target, bounds: { ...desired, y: 80 } };
    p.listWindowsForApp.mockResolvedValueOnce([resized]).mockResolvedValueOnce([resized])
      .mockResolvedValueOnce([{ ...target, bounds: desired }]);
    expect(await applyVerifiedBounds(p, [{ window: target, frame: desired }])).toBeNull();
    expect(p.setBounds.mock.calls).toEqual([[target, desired, false], [resized, desired, true]]);
  });

  it("同一索引现在指向别的窗口时不冒充成功，也不重写", async () => {
    const p = provider();
    p.listWindowsForApp.mockResolvedValue([{ ...target, title: other.title, bounds: desired }]);
    expect(await applyVerifiedBounds(p, [{ window: target, frame: desired }])).toContain("不能确认布局");
    expect(p.setBounds).toHaveBeenCalledTimes(1);
  });

  it("窗口索引重排且标题变更时，凭原生 windowId 仍能读回并触发缩放兼容重试一次成功", async () => {
    const p = { ...provider(), readWindows: vi.fn<NonNullable<WindowProvider["readWindows"]>>() };
    const electronTarget: TargetWindow = { ...target, id: "123|2", windowId: 5001 };
    const shiftedUnchanged: TargetWindow = { ...electronTarget, id: "123|1", title: "Editor — updated", bounds: original };
    const shiftedApplied: TargetWindow = { ...shiftedUnchanged, bounds: desired };
    p.readWindows
      .mockResolvedValueOnce([shiftedUnchanged])
      .mockResolvedValueOnce([shiftedUnchanged])
      .mockResolvedValueOnce([shiftedApplied]);
    expect(await applyVerifiedBounds(p, [{ window: electronTarget, frame: desired }])).toBeNull();
    expect(p.listWindowsForApp).not.toHaveBeenCalled();
    expect(p.setBounds).toHaveBeenNthCalledWith(1, electronTarget, desired, false);
    expect(p.setBounds).toHaveBeenNthCalledWith(2, shiftedUnchanged, desired, false, true);
  });

  it("原 windowId 消失后即使同索引出现新窗口，也不误认成功", async () => {
    const p = { ...provider(), readWindows: vi.fn<NonNullable<WindowProvider["readWindows"]>>() };
    const originalWin: TargetWindow = { ...target, windowId: 5001 };
    p.readWindows.mockResolvedValue([{ ...target, windowId: 9999, bounds: desired }]);
    expect(await applyVerifiedBounds(p, [{ window: originalWin, frame: desired }])).toContain("不能确认布局");
    expect(p.setBounds).toHaveBeenCalledTimes(1);
  });

  it("缩放兼容重试后若 AX 短暂不可读，额外等待一轮即可确认生效", async () => {
    const p = { ...provider(), readWindows: vi.fn<NonNullable<WindowProvider["readWindows"]>>() };
    const electronTarget: TargetWindow = { ...target, windowId: 5001 };
    p.readWindows
      .mockResolvedValueOnce([electronTarget])
      .mockResolvedValueOnce([electronTarget])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...electronTarget, bounds: desired }]);
    expect(await applyVerifiedBounds(p, [{ window: electronTarget, frame: desired }])).toBeNull();
    expect(p.setBounds).toHaveBeenCalledTimes(2);
  });

  it("缩放兼容重试后尺寸已到位但原点被旧尺寸夹住，补一次仅移动即可首次成功", async () => {
    const p = { ...provider(), readWindows: vi.fn<NonNullable<WindowProvider["readWindows"]>>() };
    const electronTarget: TargetWindow = { ...target, windowId: 5001 };
    const resizedClamped: TargetWindow = { ...electronTarget, bounds: { ...desired, x: 120 } };
    p.readWindows
      .mockResolvedValueOnce([electronTarget])
      .mockResolvedValueOnce([electronTarget])
      .mockResolvedValueOnce([resizedClamped])
      .mockResolvedValueOnce([{ ...electronTarget, bounds: desired }]);
    expect(await applyVerifiedBounds(p, [{ window: electronTarget, frame: desired }])).toBeNull();
    expect(p.setBounds.mock.calls).toEqual([
      [electronTarget, desired, false],
      [electronTarget, desired, false, true],
      [resizedClamped, desired, true],
    ]);
  });

  it("无 windowId 兜底时，同进程唯一同标题窗口发生索引漂移仍可恢复校验", async () => {
    const p = provider();
    const shifted = { ...target, id: "123|2", bounds: desired };
    p.listWindowsForApp.mockResolvedValue([shifted, { ...other, id: "123|1" }]);
    expect(await applyVerifiedBounds(p, [{ window: target, frame: desired }])).toBeNull();
    expect(p.setBounds).toHaveBeenCalledTimes(1);
  });
});
