// 存储层：布局数据文件（原子写 tmp+rename）+ MRU/上次样式/开关的 KV 语义（key 对应原 hs.settings）
// 纯 Node（fs），不依赖 Raycast API；命令层把 Raycast LocalStorage 适配为 KVStore。
import * as fs from "fs";
import * as path from "path";
import type { LayoutsData, Snapshot, WindowRecord } from "./types";

/** hs.settings key 语义 1:1（原版 windowPanel.* 前缀保留） */
export const RECENT_KEY = "windowPanel.arrangeRecent";
export const SINGLE_RECENT_KEY = "windowPanel.singleRecent";
export const ARRANGE_TEMPLATE_PREFIX = "windowPanel.arrangeTemplate.";
export const MEMORY_TARGET_KEY = "windowPanel.memoryTargetEnabled";
export const MAX_RECENT = 6;

export interface KVStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

export function emptyLayouts(): LayoutsData {
  return { windows: {} };
}

/** 解析数据文件（含容错）：与 Lua loadLayouts 一致 —— windows 只收纯表条目；snapshot 只认纯槽位格式(frames)，旧 items 格式忽略 */
export function parseLayouts(raw: string | null | undefined): LayoutsData {
  if (!raw) return emptyLayouts();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyLayouts();
  }
  const out: LayoutsData = { windows: {} };
  if (!data || typeof data !== "object") return out;
  const d = data as Record<string, unknown>;
  if (d.windows && typeof d.windows === "object") {
    for (const [k, v] of Object.entries(d.windows as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const rec = v as Record<string, unknown>;
      const f = rec.frame as Record<string, unknown> | undefined;
      if (!f || typeof f !== "object") continue;
      if (typeof f.x !== "number" || typeof f.y !== "number" || typeof f.w !== "number" || typeof f.h !== "number") continue;
      const record: WindowRecord = {
        bundleID: typeof rec.bundleID === "string" ? rec.bundleID : "unknown",
        title: typeof rec.title === "string" ? rec.title : "",
        frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      };
      if (typeof rec.id === "string" && rec.id !== "") record.id = rec.id;
      else if (typeof rec.id === "number") record.id = rec.id;
      out.windows[k] = record;
    }
  }
  const snap = d.snapshot as Record<string, unknown> | undefined;
  if (snap && typeof snap === "object" && Array.isArray(snap.frames)) {
    const frames = snap.frames
      .filter((fr): fr is Record<string, unknown> => !!fr && typeof fr === "object")
      .filter((fr) => typeof fr.x === "number" && typeof fr.y === "number" && typeof fr.w === "number" && typeof fr.h === "number")
      .map((fr) => ({ x: fr.x as number, y: fr.y as number, w: fr.w as number, h: fr.h as number }));
    out.snapshot = {
      savedAt: typeof snap.savedAt === "number" ? snap.savedAt : 0,
      count: frames.length,
      frames,
    };
  }
  return out;
}

export function serializeLayouts(data: LayoutsData): string {
  return JSON.stringify(data);
}

/** 原子写：先写 .tmp 再 rename（沿用原版 saveLayouts），目录不存在则创建 */
export function writeLayoutsFile(filePath: string, data: LayoutsData): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, serializeLayouts(data), "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 清理失败不影响主错误 */
    }
    throw e;
  }
}

export function readLayoutsFile(filePath: string): LayoutsData {
  try {
    return parseLayouts(fs.readFileSync(filePath, "utf8"));
  } catch {
    return emptyLayouts();
  }
}

export interface MergeReport {
  added: number;
  updated: number;
  snapshotImported: boolean;
}

/** 一次性导入合并（import-from-hammerspoon 用）：source 按同键覆盖写入 target；source 有快照则替换 */
export function mergeLayoutsInto(target: LayoutsData, source: LayoutsData): MergeReport {
  let added = 0;
  let updated = 0;
  for (const [k, v] of Object.entries(source.windows)) {
    if (target.windows[k]) updated += 1;
    else added += 1;
    target.windows[k] = v;
  }
  let snapshotImported = false;
  if (source.snapshot) {
    target.snapshot = source.snapshot;
    snapshotImported = true;
  }
  return { added, updated, snapshotImported };
}

export function snapshotAsRecord(snap: Snapshot | undefined): Snapshot | undefined {
  return snap;
}

/** 记忆/MRU 存储：全部走 KVStore（命令层用 Raycast LocalStorage，测试用内存实现） */
export class MemoryStore {
  constructor(private readonly kv: KVStore) {}

  private async getList(key: string, valid: (id: string) => boolean, max: number): Promise<string[]> {
    const raw = await this.kv.get(key);
    if (!raw) return [];
    try {
      const arr: unknown = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((v): v is string => typeof v === "string" && valid(v)).slice(0, max);
    } catch {
      return [];
    }
  }

  /** 用了一次就把该模板提到最前（cap 到 max 条）；特殊项（保存/重放我的布局）由 valid 排除，不参与 */
  async bump(key: string, id: string, valid: (id: string) => boolean, max: number): Promise<void> {
    if (!valid(id)) return;
    const list = [id];
    for (const v of await this.getList(key, valid, max)) {
      if (v !== id) list.push(v);
    }
    await this.kv.set(key, JSON.stringify(list.slice(0, max)));
  }

  async arrangeRecent(valid: (id: string) => boolean): Promise<string[]> {
    return this.getList(RECENT_KEY, valid, MAX_RECENT);
  }

  async bumpArrangeRecent(id: string, valid: (id: string) => boolean): Promise<void> {
    await this.bump(RECENT_KEY, id, valid, MAX_RECENT);
  }

  async singleRecent(valid: (id: string) => boolean): Promise<string[]> {
    return this.getList(SINGLE_RECENT_KEY, valid, MAX_SINGLE_RECENT);
  }

  async bumpSingleRecent(id: string, valid: (id: string) => boolean): Promise<void> {
    await this.bump(SINGLE_RECENT_KEY, id, valid, MAX_SINGLE_RECENT);
  }

  /** 每次执行后记住该窗口数的模板选择（下次一键重复） */
  async getArrangeTemplate(n: number): Promise<string | undefined> {
    return this.kv.get(ARRANGE_TEMPLATE_PREFIX + n);
  }

  async setArrangeTemplate(n: number, id: string): Promise<void> {
    await this.kv.set(ARRANGE_TEMPLATE_PREFIX + n, id);
  }

  /** 「记录到此 App」开关（save-window 是否写盘），默认 true */
  async getMemoryTargetEnabled(): Promise<boolean> {
    const raw = await this.kv.get(MEMORY_TARGET_KEY);
    if (raw === undefined || raw === null) return true;
    return raw === "true";
  }

  async setMemoryTargetEnabled(v: boolean): Promise<void> {
    await this.kv.set(MEMORY_TARGET_KEY, String(v));
  }
}

export const MAX_SINGLE_RECENT = MAX_RECENT;