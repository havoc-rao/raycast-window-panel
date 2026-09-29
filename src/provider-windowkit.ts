// windowkit 主后端：常驻 swift helper daemon（Hammerspoon 同构 —— 进程内原生 AX/NSWorkspace/NSScreen）。
// 传输：unix socket + 换行 JSON。helper 由本进程首次 spawn（继承辅助功能信任），之后跨扩展进程存活：
// 新会话直接连接复用（WINDOWKIT_SOCK 固定路径），不再重复付 spawn 冷启动；空闲 10 分钟 helper 自行退出。
// 不可用（无 swiftc/编译失败/无辅助功能信任/进程崩溃）时由 actions 回落 AppleScript 后端。
import { execFile } from "child_process";
import { spawn, type ChildProcess } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { getFrontmostApplication } from "@raycast/api";
import type { Frame, Region, Screen, TargetWindow } from "./types";
import { ProviderError } from "./windows";
import type { BoundsWrite, WindowProvider } from "./windows";
import { ensurePanelClosed, resetPanelCloseMemo } from "./panel-close";

const RAYCAST_NAME = "Raycast";
/** 与 assets/windowkit.swift 的 WINDOWKIT_VERSION 保持一致；不一致时重新编译/重建 helper */
const WINDOWKIT_VERSION = 4;
const CACHE_DIR = path.join(os.homedir(), "Library", "Caches", "raycast-window-panel");
const BIN_NAME = "windowkit";
const SOCK_NAME = "windowkit.sock";
export const SOCKET_PATH = path.join(CACHE_DIR, SOCK_NAME);

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

/**
 * socket 线协议客户端：先尝试复用既有 daemon（跨扩展进程），失败才 spawn 新 helper；
 * 请求/响应配对 + 超时 + 连接断开兜底。
 */
export class WindowKitClient {
  private socket: net.Socket | null = null;
  private proc: ChildProcess | null = null;
  private spawnFailed = false;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private closed = true;

  constructor(
    private binary: string,
    private socketPath: string,
    private spawnArgs: string[] = []
  ) {}

  /** 连接复用优先；无可用 daemon 时 spawn（等 socket 就绪，最多 ~8s） */
  async start(): Promise<boolean> {
    // 1) 复用既有 helper（常驻跨进程）
    if (await this.connect(700)) {
      try {
        const pong = (await this.request<{ version?: number }>("ping", {}, 3000)) ?? {};
        if (pong.version === WINDOWKIT_VERSION) return true;
        // 版本不符：让旧实例退出，改 spawn 新版本
        await this.request("quit", {}, 800).catch(() => {});
      } catch {
        /* 旧实例已死 */
      }
      this.detach();
    }
    // 2) spawn 新 helper 并等 socket 就绪
    if (!this.spawnHelper()) return false;
    for (let i = 0; i < 80; i++) {
      if (this.spawnFailed) return false;
      await sleep(100);
      if (await this.connect(300)) {
        try {
          const pong = (await this.request<{ version?: number }>("ping", {}, 3000)) ?? {};
          if (pong.version === WINDOWKIT_VERSION) return true;
          await this.request("quit", {}, 800).catch(() => {});
          this.detach();
          return false;
        } catch {
          this.detach();
        }
      }
    }
    return false;
  }

  request<T = unknown>(op: string, params?: unknown, timeoutMs = 5000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const sock = this.socket;
      if (!sock || this.closed || sock.destroyed) {
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
      sock.write(JSON.stringify({ id, op, params: params ?? {} }) + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(new Error(`windowkit 写入失败: ${err.message}`));
        }
      });
    });
  }

  /** 断开连接（helper 常驻保留，供后续会话复用） */
  stop(): void {
    this.detach();
  }

  /** 断开并让 helper 退出（版本不符 / untrusted 重建时用） */
  stopAndQuit(): void {
    const sock = this.socket;
    if (sock && !sock.destroyed) {
      try {
        sock.write(JSON.stringify({ id: this.nextId++, op: "quit", params: {} }) + "\n");
      } catch {
        /* 通道已断 */
      }
    }
    this.detach();
  }

  // ---- 内部 ----

  private attach(sock: net.Socket): void {
    this.socket = sock;
    this.buffer = "";
    this.closed = false;
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => this.onData(chunk));
    sock.on("close", () => {
      if (this.socket !== sock) return; // 已被 detach 换新
      this.failAll("windowkit 连接已断开");
    });
    sock.on("error", () => {
      if (this.socket !== sock) return;
      this.failAll("windowkit 连接出错");
    });
  }

  private detach(): void {
    this.closed = true;
    const sock = this.socket;
    this.socket = null;
    if (sock) {
      sock.removeAllListeners();
      sock.destroy();
    }
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("windowkit 通道不可用"));
    }
    this.pending.clear();
  }

  private connect(timeoutMs: number): Promise<boolean> {
    if (this.socket) return Promise.resolve(true);
    return new Promise((resolve) => {
      const sock = net.connect({ path: this.socketPath });
      const timer = setTimeout(() => {
        sock.destroy();
        resolve(false);
      }, timeoutMs);
      sock.once("connect", () => {
        clearTimeout(timer);
        this.attach(sock);
        resolve(true);
      });
      sock.once("error", () => {
        clearTimeout(timer);
        sock.destroy();
        resolve(false);
      });
    });
  }

  private spawnHelper(): boolean {
    try {
      this.spawnFailed = false;
      this.proc = spawn(this.binary, this.spawnArgs, {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, WINDOWKIT_SOCK: this.socketPath },
      });
    } catch {
      return false;
    }
    const p = this.proc;
    p.stderr?.on("data", (chunk: string) =>
      console.debug("[Window Panel windowkit]", String(chunk).trimEnd())
    );
    p.on("error", (err) => {
      this.spawnFailed = true;
      console.debug(`[Window Panel windowkit] 进程错误: ${err.message}`);
    });
    p.on("exit", (code, signal) =>
      console.debug(`[Window Panel windowkit] helper 退出 (${code ?? signal})`)
    );
    return true;
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

  /**
   * 启动链路：编译/缓存 → 连接或 spawn → ping → AX 信任探针。
   * untrusted（孤儿 daemon 可能失去由原扩展进程授予的 AX 信任）→ 重建一次；
   * 其余失败或两次仍未通过 → 返回 null（回落 AppleScript）。
   */
  static async create(opts?: { binary?: string; socketPath?: string }): Promise<WindowKitProvider | null> {
    const bin = opts?.binary ?? (await compileWindowKit());
    if (!bin) return null;
    const sockPath = opts?.socketPath ?? SOCKET_PATH;
    try {
      fs.mkdirSync(path.dirname(sockPath), { recursive: true });
    } catch {
      return null;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const client = new WindowKitClient(bin, sockPath);
      if (!(await client.start())) return null;
      try {
        const probe = await client.request<unknown[]>("windows", {}, 5000);
        if (!Array.isArray(probe)) throw new Error("windows 探针异常");
        return new WindowKitProvider(client);
      } catch (e) {
        const untrusted = String((e as Error)?.message ?? e).includes("untrusted");
        client.stopAndQuit();
        if (!untrusted) return null; // 非 untrusted 不重试（避免掩盖真实错误）
        await sleep(400); // 等旧实例清 socket
      }
    }
    return null;
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
    const parts = w.id.split("|");
    const pid = Number(parts[0]);
    const index = Number(parts[1]);
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
      const parts = it.window.id.split("|");
      const pid = Number(parts[0]);
      const index = Number(parts[1]);
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