// windowkit 主后端：常驻 swift helper（Hammerspoon 同构 —— 进程内原生 AX/NSWorkspace/NSScreen）。
// 首次使用时 swiftc 编译 assets/windowkit.swift 到缓存目录，spawn 常驻进程，stdio 换行 JSON 协议；
// 每次窗口操作 = 原生调用 + 微秒级往返（此前 osascript 路径 ~125ms/次固定进程开销）。
// 不可用（无 swiftc/编译失败/无辅助功能信任/进程崩溃）时由 actions 回落 AppleScript 后端。
import { execFile } from "child_process";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getFrontmostApplication } from "@raycast/api";
import type { Frame, Region, Screen, TargetWindow } from "./types";
import { ProviderError } from "./windows";
import type { BoundsWrite, WindowProvider } from "./windows";
import { ensurePanelClosed, resetPanelCloseMemo } from "./panel-close";

const RAYCAST_NAME = "Raycast";
/** 与 assets/windowkit.swift 的 WINDOWKIT_VERSION 保持一致；不一致时重新编译 */
const WINDOWKIT_VERSION = 3;
const CACHE_DIR = path.join(os.homedir(), "Library", "Caches", "raycast-window-panel");
const BIN_NAME = "windowkit";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 确保 helper 二进制存在（版本标记不匹配或缺失则用 swiftc 重新编译）；并发去重 */
let compilePromise: Promise<string | null> | null = null;
export function compileWindowKit(): Promise<string | null> {
  if (!compilePromise) compilePromise = doCompileWindowKit();
  return compilePromise;
}

async function doCompileWindowKit(): Promise<string | null> {
  const src = path.join(__dirname, "assets", "windowkit.swift");
  if (!fs.existsSync(src)) return null;
  const bin = path.join(CACHE_DIR, BIN_NAME);
  const marker = bin + ".version";
  try {
    if (
      fs.existsSync(bin) &&
      fs.readFileSync(marker, "utf8").trim() === String(WINDOWKIT_VERSION)
    ) {
      return bin;
    }
  } catch {
    /* 标记缺失 → 重新编译 */
  }
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      execFile(
        "/usr/bin/swiftc",
        ["-O", "-module-cache-path", path.join(CACHE_DIR, "modcache"), src, "-o", bin],
        { timeout: 120000, maxBuffer: 8 * 1024 * 1024 },
        (err, _stdout, stderr) => {
          if (err) {
            console.debug(`[Window Panel windowkit] 编译失败: ${String(stderr || err.message).trim()}`);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
    fs.writeFileSync(marker, String(WINDOWKIT_VERSION), "utf8");
    return bin;
  } catch {
    return null;
  }
}

/** 常驻进程的线协议客户端：请求/响应配对 + 超时 + 退出兜底 */
export class WindowKitClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = false;

  constructor(private binary: string, private args: string[] = []) {}

  async start(): Promise<boolean> {
    try {
      this.proc = spawn(this.binary, this.args, { stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      return false;
    }
    this.closed = false;
    this.buffer = "";
    const p = this.proc;
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (chunk: string) => this.onData(chunk));
    p.stderr.on("data", (chunk: string) => console.debug("[Window Panel windowkit]", String(chunk).trimEnd()));
    p.on("error", (err) => this.failAll(`windowkit 进程错误: ${err.message}`));
    p.on("exit", (code, signal) => this.failAll(`windowkit 已退出 (${code ?? signal})`));
    try {
      const pong = (await this.request<{ version?: number }>("ping", {}, 5000)) ?? {};
      if (pong.version !== WINDOWKIT_VERSION) {
        this.stop();
        return false;
      }
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  request<T = unknown>(op: string, params?: unknown, timeoutMs = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const p = this.proc;
      if (!p || this.closed || !p.stdin.writable) {
        reject(new Error("windowkit 通道不可用"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`windowkit ${op} 超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      p.stdin.write(JSON.stringify({ id, op, params: params ?? {} }) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`windowkit 写入失败: ${err.message}`));
        }
      });
    });
  }

  stop(): void {
    this.closed = true;
    const p = this.proc;
    this.proc = null;
    if (!p) return;
    try {
      p.stdin.write(JSON.stringify({ id: 0, op: "quit", params: {} }) + "\n");
    } catch {
      /* 通道已断 */
    }
    setTimeout(() => {
      try {
        p.kill();
      } catch {
        /* 已退出 */
      }
    }, 100);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: string };
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const id = msg.id;
      if (id === undefined) continue;
      const entry = this.pending.get(id);
      if (!entry) continue;
      this.pending.delete(id);
      clearTimeout(entry.timer);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(new Error(msg.error ?? "windowkit 操作失败"));
    }
  }

  private failAll(reason: string): void {
    this.closed = true;
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

interface RawWin {
  pid: number;
  appName: string;
  bundleId: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  subrole: string;
  fullScreen: boolean;
  minimized: boolean;
  resizable: boolean;
  index: number;
}

/** windowkit 主后端。语义与 AppleScriptWindowProvider 对齐（过滤/z 序近似/缓存/重试）。 */
export class WindowKitProvider implements WindowProvider {
  private screenCache: { screens: Screen[]; expiresAt: number } | null = null;
  private screenRead: Promise<Screen[] | null> | null = null;

  constructor(private client: WindowKitClient) {}

  /** 启动链路：编译/缓存 → spawn → ping → AX 信任探针；任一失败返回 null（回落 AppleScript） */
  static async create(): Promise<WindowKitProvider | null> {
    const bin = await compileWindowKit();
    if (!bin) return null;
    const client = new WindowKitClient(bin);
    if (!(await client.start())) return null;
    try {
      // AX 信任探针：辅助功能权限缺失时 helper 的 AX 操作全部失败 → 整体回落 AppleScript
      const probe = await client.request<unknown[]>("windows", {}, 5000);
      if (!Array.isArray(probe)) throw new Error("windows 探针异常");
    } catch {
      client.stop();
      return null;
    }
    return new WindowKitProvider(client);
  }

  // ---- 读写接口（read 失败返回空/空值并记录，write 失败抛 ProviderError） ----

  async getActiveWindow(): Promise<TargetWindow | null> {
    try {
      const app = await getFrontmostApplication();
      if (app.bundleId === "com.raycast.macos" || app.name === RAYCAST_NAME) return null;
      const identity = app.bundleId || app.name;
      if (!identity) return null;
      const r = await this.client.request<Record<string, unknown> | null>(
        "window",
        app.bundleId ? { bundleId: identity } : { name: identity }
      );
      if (!r) return null;
      const raw = this.parseRow(r);
      if (!raw) return null;
      // 与 AppleScript 路径一致的身份校验：不猜测其他 App
      if (raw.minimized || raw.bundleId === "com.raycast.macos" || raw.appName === RAYCAST_NAME) return null;
      if ((app.bundleId && raw.bundleId !== app.bundleId) || (!app.bundleId && raw.appName !== app.name)) return null;
      return this.toTargetWindow(raw);
    } catch (e) {
      this.logChannel(e);
      return null;
    }
  }

  async listWindowsOnActiveDesktop(target: TargetWindow): Promise<TargetWindow[]> {
    try {
      const raws = await this.fetchRaws();
      const region = await this.getScreenRegion(target);
      if (!region) return [];
      const targetPid = Number(target.id.split("|")[0]);
      const inRegion = raws.filter(
        (w) =>
          w.appName !== RAYCAST_NAME &&
          !w.minimized &&
          this.isStandard(w) &&
          `${w.pid}|${w.index}` !== target.id &&
          w.x + w.w > region.x &&
          w.x < region.x + region.w &&
          w.y + w.h > region.y &&
          w.y < region.y + region.h
      );
      // z 序近似：前台 App（目标所在进程）优先，其余按枚举序
      const sameProcess = inRegion.filter((w) => w.pid === targetPid);
      const others = inRegion.filter((w) => w.pid !== targetPid);
      return [...sameProcess, ...others].map((w) => this.toTargetWindow(w));
    } catch (e) {
      this.logChannel(e);
      return [];
    }
  }

  async listAllWindows(): Promise<TargetWindow[]> {
    try {
      return (await this.fetchRaws())
        .filter((w) => w.appName !== RAYCAST_NAME && !w.minimized && this.isStandard(w))
        .map((w) => this.toTargetWindow(w));
    } catch (e) {
      this.logChannel(e);
      return [];
    }
  }

  async listWindowsForApp(bundleId: string): Promise<TargetWindow[]> {
    try {
      // bundleId 为空/"unknown"（无 bundle 的历史记忆）时无法定位进程 → 全量枚举后过滤
      const scoped = bundleId !== "" && bundleId !== "unknown";
      return (await this.fetchRaws(scoped ? bundleId : undefined))
        .filter((w) => w.appName !== RAYCAST_NAME && !w.minimized && this.isStandard(w))
        .map((w) => this.toTargetWindow(w));
    } catch (e) {
      this.logChannel(e);
      return [];
    }
  }

  async enumerateScreens(): Promise<Screen[]> {
    let screens: Screen[] | null;
    if (this.screenCache && Date.now() < this.screenCache.expiresAt) {
      screens = this.screenCache.screens;
    } else {
      this.screenCache = null;
      if (!this.screenRead) {
        this.screenRead = this.readScreens()
          .catch((e) => {
            this.logChannel(e);
            return null;
          })
          .then((result) => {
            if (result) this.screenCache = { screens: result, expiresAt: Date.now() + 1000 };
            return result;
          })
          .finally(() => {
            this.screenRead = null;
          });
      }
      screens = await this.screenRead;
    }
    // Legacy fallback only; never cache it as a measurement of the user's display.
    return (screens ?? [{ frame: { x: 0, y: 0, w: 2560, h: 1440 } }]).map((s) => ({
      ...s,
      frame: { ...s.frame },
    }));
  }

  async getScreenRegion(w: TargetWindow): Promise<Region | null> {
    const screens = await this.enumerateScreens();
    if (screens.length === 0) return null;
    const cx = w.bounds.x + w.bounds.w / 2;
    const cy = w.bounds.y + w.bounds.h / 2;
    const hit = screens.find(
      (s) =>
        cx >= s.frame.x && cx < s.frame.x + s.frame.w && cy >= s.frame.y && cy < s.frame.y + s.frame.h
    );
    return (hit ?? screens[0]).frame;
  }

  async getAllScreens(): Promise<Screen[]> {
    return this.enumerateScreens();
  }

  async setBounds(w: TargetWindow, frame: Frame): Promise<void> {
    const [pid, index] = w.id.split("|").map((v) => Number(v));
    if (!Number.isFinite(pid) || !Number.isFinite(index)) {
      throw new ProviderError("窗口句柄失效，请重新打开面板", "no-window");
    }
    await ensurePanelClosed();
    const err = await this.writeBounds(w, frame);
    if (err) {
      // 偶发失败重试一次：重置面板关闭记忆 + 等待 300ms 后重写
      resetPanelCloseMemo();
      await sleep(300);
      await ensurePanelClosed();
      const err2 = await this.writeBounds(w, frame);
      if (err2) throw this.toProviderError(err2);
    }
  }

  async setBoundsBatch(items: BoundsWrite[]): Promise<void> {
    if (items.length === 0) return;
    for (const it of items) {
      const [pid, index] = it.window.id.split("|").map((v) => Number(v));
      if (!Number.isFinite(pid) || !Number.isFinite(index)) {
        throw new ProviderError("窗口句柄失效，请重新打开面板", "no-window");
      }
    }
    await ensurePanelClosed();
    const failed = await this.writeBoundsBatch(items);
    if (failed.length > 0) {
      // 偶发失败整体重试一次（仅失败项）
      resetPanelCloseMemo();
      await sleep(300);
      await ensurePanelClosed();
      const still = await this.writeBoundsBatch(failed);
      if (still.length > 0) throw this.toProviderError(still[0].error);
    }
  }

  async raise(w: TargetWindow): Promise<void> {
    const parts = w.id.split("|");
    const pid = Number(parts[0]);
    const index = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(index)) return;
    try {
      await this.client.request("raise", { pid, index });
    } catch (e) {
      this.logChannel(e);
    }
  }

  // ---- 内部 ----

  private async fetchRaws(bundleId?: string): Promise<RawWin[]> {
    const rows = await this.client.request<Array<Record<string, unknown>>>(
      "windows",
      bundleId ? { bundleId } : {}
    );
    const out: RawWin[] = [];
    for (const r of rows ?? []) {
      const raw = this.parseRow(r);
      if (raw) out.push(raw);
    }
    return out;
  }

  private parseRow(r: Record<string, unknown>): RawWin | null {
    const pid = Number(r.pid);
    const index = Number(r.index);
    const x = Number(r.x);
    const y = Number(r.y);
    const w = Number(r.w);
    const h = Number(r.h);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(index) || index <= 0) return null;
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
    return {
      pid,
      appName: String(r.appName ?? ""),
      bundleId: String(r.bundleId ?? ""),
      title: String(r.title ?? ""),
      x,
      y,
      w,
      h,
      subrole: String(r.subrole ?? ""),
      fullScreen: r.fullScreen === true,
      minimized: r.minimized === true,
      resizable: r.resizable !== false,
      index,
    };
  }

  private isStandard(raw: RawWin): boolean {
    return raw.subrole === "AXStandardWindow" || raw.subrole === "";
  }

  private toTargetWindow(raw: RawWin): TargetWindow {
    return {
      id: `${raw.pid}|${raw.index}`,
      appName: raw.appName,
      bundleId: raw.bundleId || "unknown",
      title: raw.title || "",
      bounds: { x: raw.x, y: raw.y, w: raw.w, h: raw.h },
      fullScreen: raw.fullScreen,
      positionable: true,
      resizable: raw.resizable,
    };
  }

  private async writeBounds(w: TargetWindow, frame: Frame): Promise<string | null> {
    const parts = w.id.split("|");
    const pid = Number(parts[0]);
    const index = Number(parts[1]);
    const res = await this.client.request<Array<{ ok?: boolean; error?: string }>>("setbounds", {
      items: [{ pid, index, x: frame.x, y: frame.y, w: frame.w, h: frame.h }],
    });
    const first = res?.[0];
    if (!first) return "no-result";
    return first.ok ? null : first.error ?? "unknown";
  }

  private async writeBoundsBatch(
    items: BoundsWrite[]
  ): Promise<Array<BoundsWrite & { error: string }>> {
    const res = await this.client.request<Array<{ ok?: boolean; error?: string }>>("setbounds", {
      items: items.map((it) => {
        const parts = it.window.id.split("|");
        const pid = Number(parts[0]);
        const index = Number(parts[1]);
        return { pid, index, x: it.frame.x, y: it.frame.y, w: it.frame.w, h: it.frame.h };
      }),
    });
    const failed: Array<BoundsWrite & { error: string }> = [];
    for (let i = 0; i < items.length; i++) {
      const st = res?.[i];
      if (!st || st.ok !== true) failed.push({ ...items[i], error: st?.error ?? "no-result" });
    }
    return failed;
  }

  private toProviderError(err: string): ProviderError {
    const hint = /-?10000|处理程序失败/.test(err)
      ? `窗口移动被系统拒绝（-10000）：System Events 写入异常，请确认已给 Raycast 辅助功能权限后重试 (${err.replace(/\n/g, " ").slice(0, 120)})`
      : `窗口可能已关闭或无法调整：${err.replace(/\n/g, " ").slice(0, 160)}`;
    return new ProviderError(hint, "generic");
  }

  private async readScreens(): Promise<Screen[] | null> {
    const rows = await this.client.request<Array<Record<string, unknown>>>("screens");
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const frames = rows.map((r) => {
      const x = Number(r.x);
      const y = Number(r.y);
      const w = Number(r.w);
      const h = Number(r.h);
      return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0
        ? { x, y, w, h }
        : null;
    });
    if (!frames[0]) return null;
    return frames.flatMap((f) => (f ? [{ frame: f }] : []));
  }

  private logChannel(e: unknown): void {
    // 读路径失败按 AirGap 语义返回空（与 AppleScript 后端一致），写路径错误由调用方呈现
    console.debug(`[Window Panel windowkit] 读取失败: ${String((e as Error)?.message ?? e)}`);
  }
}