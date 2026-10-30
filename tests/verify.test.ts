import { describe, expect, it } from "vitest";
import { refusedMessage, sizeUnchanged, sizeText, writeIgnored } from "../src/services/windows/verify";

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("sizeUnchanged", () => {
  it("2pt 以内视为未变化（覆盖取整/步长误差）", () => {
    expect(sizeUnchanged(frame(0, 0, 1440, 900), frame(0, 0, 1440, 900))).toBe(true);
    expect(sizeUnchanged(frame(0, 0, 1440, 900), frame(0, 0, 1441.5, 898.5))).toBe(true);
    expect(sizeUnchanged(frame(0, 0, 1440, 900), frame(0, 0, 1443, 900))).toBe(false);
    expect(sizeUnchanged(frame(0, 0, 1440, 900), frame(0, 0, 1440, 890))).toBe(false);
  });
});

describe("writeIgnored", () => {
  const original = frame(0, 104, 1440, 900);

  it("尺寸完全没变 + 目标要求变化 → 未生效", () => {
    // CodeBuddy CN 实测：写入 1710×1073 后仍是 1440×900，只有位置漂移
    expect(writeIgnored(original, frame(0, 39, 1710, 1073), frame(0, 147, 1440, 900))).toBe(true);
  });

  it("应用按自己的约束收敛（尺寸变了但不是目标值）→ 不算未生效", () => {
    expect(writeIgnored(original, frame(0, 39, 1710, 1073), frame(0, 39, 1700, 1050))).toBe(false);
    // 只应用了宽度：也算有响应，不误报
    expect(writeIgnored(original, frame(0, 39, 1710, 1073), frame(0, 39, 1710, 900))).toBe(false);
  });

  it("目标尺寸本来就和当前一致 → 不判定失败", () => {
    expect(writeIgnored(original, frame(0, 104, 1440, 900), frame(0, 104, 1440, 900))).toBe(false);
  });

  it("读不到实际帧（null）→ 保持旧语义，不猜失败", () => {
    expect(writeIgnored(original, frame(0, 39, 1710, 1073), null)).toBe(false);
  });
});

describe("refusedMessage", () => {
  it("包含实际尺寸、目标尺寸与回滚状态", () => {
    const msg = refusedMessage("CodeBuddy CN", frame(0, 39, 1710, 1073), frame(0, 147, 1440, 900), true);
    expect(msg).toContain("CodeBuddy CN");
    expect(msg).toContain("1440×900");
    expect(msg).toContain("1710×1073");
    expect(msg).toContain("已恢复原位置");
  });

  it("回滚失败时不宣称已恢复", () => {
    const msg = refusedMessage("App", frame(0, 0, 800, 600), frame(0, 0, 400, 300), false);
    expect(msg).not.toContain("已恢复");
  });
});

describe("sizeText", () => {
  it("取整后输出 宽×高", () => {
    expect(sizeText(frame(0, 0, 1710.4, 1072.6))).toBe("1710×1073");
  });
});
