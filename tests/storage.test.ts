import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { KVStore } from "../src/types";
import {
  ARRANGE_TEMPLATE_PREFIX,
  MAX_RECENT,
  MEMORY_TARGET_KEY,
  MemoryStore,
  RECENT_KEY,
  SINGLE_RECENT_KEY,
  emptyLayouts,
  mergeLayoutsInto,
  parseLayouts,
  readLayoutsFile,
  serializeLayouts,
  writeLayoutsFile,
} from "../src/storage";

class MemKV implements KVStore {
  m = new Map<string, string>();
  async get(k: string): Promise<string | undefined> {
    return this.m.get(k);
  }
  async set(k: string, v: string): Promise<void> {
    this.m.set(k, v);
  }
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rwp-storage-"));
}

describe("parseLayouts（schema v2 容错加载，语义同 Lua loadLayouts）", () => {
  it("合法 v2 数据往返", () => {
    const raw = JSON.stringify({
      windows: {
        "com.apple.Terminal|zsh — 80×24": {
          id: 12345,
          bundleID: "com.apple.Terminal",
          title: "zsh — 80×24",
          frame: { x: 0, y: 39, w: 900, h: 600 },
        },
      },
      snapshot: {
        savedAt: 1788372000,
        count: 2,
        frames: [{ x: 0, y: 39, w: 1440, h: 900 }, { x: 1500, y: 39, w: 1400, h: 900 }],
      },
    });
    const data = parseLayouts(raw);
    expect(data.windows["com.apple.Terminal|zsh — 80×24"]).toMatchObject({
      id: 12345,
      bundleID: "com.apple.Terminal",
      title: "zsh — 80×24",
      frame: { x: 0, y: 39, w: 900, h: 600 },
    });
    expect(data.snapshot?.count).toBe(2);
    expect(data.snapshot?.frames).toHaveLength(2);
  });
  it("快照只认纯槽位格式；旧按 app 记忆的 items 格式直接忽略", () => {
    const data = parseLayouts(
      JSON.stringify({ windows: {}, snapshot: { savedAt: 1, items: [{ bundleID: "x" }] } })
    );
    expect(data.snapshot).toBeUndefined();
  });
  it("空/损坏 JSON → 空数据", () => {
    expect(parseLayouts(null)).toEqual({ windows: {} });
    expect(parseLayouts("not json{{")).toEqual({ windows: {} });
    expect(parseLayouts(undefined)).toEqual({ windows: {} });
  });
  it("非法条目（frame 字段非数字）被跳过，合法条目保留", () => {
    const data = parseLayouts(
      JSON.stringify({
        windows: {
          bad: { bundleID: "x", title: "y", frame: { x: "a", y: 0, w: 1, h: 1 } },
          good: { bundleID: "x", title: "y", frame: { x: 1, y: 2, w: 3, h: 4 } },
        },
      })
    );
    expect(Object.keys(data.windows)).toEqual(["good"]);
  });
});

describe("writeLayoutsFile（原子写 tmp+rename）", () => {
  it("写出后可读；无 .tmp 残留；目录自动创建", () => {
    const dir = tmpDir();
    const file = path.join(dir, "a", "b", "window-layouts.json");
    const data = { windows: { k: { bundleID: "b", title: "t", frame: { x: 1, y: 2, w: 3, h: 4 } } } };
    writeLayoutsFile(file, data);
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(file + ".tmp")).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(data);
    // 覆盖写（替换旧文件）
    writeLayoutsFile(file, { windows: {} });
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ windows: {} });
  });
  it("readLayoutsFile：缺文件 → 空数据", () => {
    expect(readLayoutsFile(path.join(tmpDir(), "nope.json"))).toEqual({ windows: {} });
  });
  it("serialize/parse 往返一致", () => {
    const data = { windows: {}, snapshot: { savedAt: 1, count: 0, frames: [] } };
    expect(parseLayouts(serializeLayouts(data))).toEqual(data);
  });
});

describe("mergeLayoutsInto（import-from-hammerspoon 合并语义）", () => {
  it("同键覆盖 + 新增计数 + 快照替换", () => {
    const target = {
      windows: {
        "a|t": { bundleID: "a", title: "t", frame: { x: 1, y: 2, w: 3, h: 4 } },
        "keep|t": { bundleID: "keep", title: "t", frame: { x: 0, y: 0, w: 1, h: 1 } },
      },
      snapshot: { savedAt: 1, count: 1, frames: [{ x: 0, y: 0, w: 100, h: 100 }] },
    };
    const source = {
      windows: {
        "a|t": { bundleID: "a", title: "t", frame: { x: 9, y: 9, w: 9, h: 9 } },
        "new|t": { bundleID: "new", title: "t", frame: { x: 5, y: 5, w: 5, h: 5 } },
      },
      snapshot: { savedAt: 2, count: 2, frames: [{ x: 1, y: 1, w: 2, h: 2 }, { x: 3, y: 3, w: 4, h: 4 }] },
    };
    const report = mergeLayoutsInto(target, source);
    expect(report).toEqual({ added: 1, updated: 1, snapshotImported: true });
    expect(target.windows["a|t"].frame).toEqual({ x: 9, y: 9, w: 9, h: 9 }); // 覆盖
    expect(target.windows["keep|t"]).toBeDefined(); // 保留
    expect(target.windows["new|t"]).toBeDefined(); // 新增
    expect(target.snapshot?.count).toBe(2);
  });
  it("source 无快照时保留 target 快照", () => {
    const target = { windows: {}, snapshot: { savedAt: 1, count: 1, frames: [{ x: 0, y: 0, w: 1, h: 1 }] } };
    const report = mergeLayoutsInto(target, { windows: {} });
    expect(report.snapshotImported).toBe(false);
    expect(target.snapshot).toBeDefined();
  });
});

describe("MemoryStore（MRU/上次样式/开关 key 语义对应 hs.settings）", () => {
  const valid = (id: string) => id.startsWith("t-");
  it("key 命名与 plan 一致", () => {
    expect(RECENT_KEY).toBe("windowPanel.arrangeRecent");
    expect(SINGLE_RECENT_KEY).toBe("windowPanel.singleRecent");
    expect(ARRANGE_TEMPLATE_PREFIX).toBe("windowPanel.arrangeTemplate.");
    expect(MEMORY_TARGET_KEY).toBe("windowPanel.memoryTargetEnabled");
    expect(MAX_RECENT).toBe(6);
  });
  it("bumpRecent：去重置顶 + cap 6", async () => {
    const kv = new MemKV();
    const store = new MemoryStore(kv);
    for (const id of ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6", "t-7"]) await store.bumpArrangeRecent(id, valid);
    let list = await store.arrangeRecent(valid);
    expect(list).toHaveLength(6);
    expect(list[0]).toBe("t-7");
    expect(list).not.toContain("t-1");
    // 再次使用 t-3 → 置顶
    await store.bumpArrangeRecent("t-3", valid);
    list = await store.arrangeRecent(valid);
    expect(list[0]).toBe("t-3");
    expect(list[1]).toBe("t-7");
    // 无效 id 不参与
    await store.bumpArrangeRecent("nope", valid);
    list = await store.arrangeRecent(valid);
    expect(list).not.toContain("nope");
  });
  it("singleRecent 独立 key", async () => {
    const kv = new MemKV();
    const store = new MemoryStore(kv);
    await store.bumpSingleRecent("t-s1", valid);
    expect(await store.singleRecent(valid)).toEqual(["t-s1"]);
    expect(await store.arrangeRecent(valid)).toEqual([]);
  });
  it("arrangeTemplate.N：按窗口数分别记住", async () => {
    const kv = new MemKV();
    const store = new MemoryStore(kv);
    expect(await store.getArrangeTemplate(2)).toBeUndefined();
    await store.setArrangeTemplate(2, "split-h2");
    expect(await store.getArrangeTemplate(2)).toBe("split-h2");
    expect(await store.getArrangeTemplate(3)).toBeUndefined();
  });
  it("memoryTargetEnabled 默认 true，可开关", async () => {
    const kv = new MemKV();
    const store = new MemoryStore(kv);
    expect(await store.getMemoryTargetEnabled()).toBe(true);
    await store.setMemoryTargetEnabled(false);
    expect(await store.getMemoryTargetEnabled()).toBe(false);
  });
  it("损坏的 recent 数据 → 空列表", async () => {
    const kv = new MemKV();
    kv.m.set(RECENT_KEY, "{oops");
    const store = new MemoryStore(kv);
    expect(await store.arrangeRecent(valid)).toEqual([]);
  });
  it("emptyLayouts 初始状态", () => {
    expect(emptyLayouts()).toEqual({ windows: {} });
  });
});