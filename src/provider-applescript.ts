// AppleScript 窗口后端（System Events 为主，SPIKE 已验证：读可靠、写受屏幕录制权限门控）
// 目标窗口 = frontmost + front window（面板打开时 frontmost 仍返回目标 App）；
// 窗口句柄 = 进程 unix id + 窗口索引；z 序近似 = 焦点优先 + App 优先；全屏/最小化标记随枚举返回。
import type { Frame, Region, Screen, TargetWindow } from "./types";
import { appleScriptQuote, runOsascript } from "./osascript";
import { ProviderError } from "./windows";
import type { WindowProvider } from "./windows";
import { closeMainWindow } from "@raycast/api";

/** 窗口枚举行字段分隔符（控制字符 US，避免与标题冲突） */
const SEP = "\u001f";
const RAYCAST_NAME = "Raycast";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 生产写路径的前置：先关面板再写。
 * 对照实验结论（SPIKE.md §6/§7）：面板打开与否不影响写入（正确写法下均成功），
 * 但保留「先关面板」策略 = 与原版 Hammerspoon「关面板→回焦→执行」一致的 UX，并在
 * 个别环境存在状态门控时作为防御（closeMainWindow 后睡眠 250ms 再写）。
 * 模块级记忆：一次命令运行内多次 setBounds（排布多窗）只关一次面板。
 */
let lastPanelCloseAt = 0;
async function ensurePanelClosed(): Promise<void> {
  if (Date.now() - lastPanelCloseAt < 1500) return;
  try {
    await closeMainWindow();
  } catch {
    /* 忽略：no-view 等场景 close 可能为 no-op */
  }
  await sleep(250);
  lastPanelCloseAt = Date.now();
}

interface RawWindow {
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
  /** 进程内窗口索引（1 起，System Events 列表序） */
  index: number;
}

const ENUMERATE_SCRIPT = `
set SEP to character id 31
set out to {}
tell application "System Events"
  repeat with p in (every application process whose visible is true)
    try
      set pname to name of p
      set pbid to ""
      try
        set pbid to bundle identifier of p
      end try
      set ppid to unix id of p
      set windex to 0
      repeat with w in (every window of p)
        set windex to windex + 1
        set wtitle to ""
        try
          set wtitle to name of w
        end try
        set wx to 0
        set wy to 0
        set ww to 0
        set wh to 0
        try
          set wpos to position of w
          set wx to item 1 of wpos
          set wy to item 2 of wpos
          set wsz to size of w
          set ww to item 1 of wsz
          set wh to item 2 of wsz
        end try
        set wsub to ""
        try
          set wsub to (value of attribute "AXSubrole" of w) as text
        end try
        set wfull to "false"
        try
          set wfull to ((value of attribute "AXFullScreen" of w) as boolean) as text
        end try
        set wmin to "false"
        try
          set wmin to ((value of attribute "AXMinimized" of w) as boolean) as text
        end try
        set wres to "true"
        try
          set wres to ((value of attribute "AXResizable" of w) as boolean) as text
        end try
        set end of out to (ppid as text) & SEP & pname & SEP & pbid & SEP & wtitle & SEP & (wx as text) & SEP & (wy as text) & SEP & (ww as text) & SEP & (wh as text) & SEP & wsub & SEP & wfull & SEP & wmin & SEP & wres
      end repeat
    end try
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
`;

export class AppleScriptWindowProvider implements WindowProvider {
  async enumerateWindows(): Promise<RawWindow[]> {
    const r = await runOsascript(ENUMERATE_SCRIPT, "AppleScript");
    if (!r.ok) return [];
    const out: RawWindow[] = [];
    const perProcess = new Map<number, number>();
    for (const line of r.output.split("\n")) {
      const f = line.split(SEP);
      if (f.length < 12) continue;
      const pid = Number(f[0]);
      if (!Number.isFinite(pid)) continue;
      const idx = (perProcess.get(pid) ?? 0) + 1;
      perProcess.set(pid, idx);
      const num = (s: string) => Number(s) || 0;
      out.push({
        pid,
        appName: f[1],
        bundleId: f[2],
        title: f[3],
        x: num(f[4]),
        y: num(f[5]),
        w: num(f[6]),
        h: num(f[7]),
        subrole: f[8],
        fullScreen: f[9] === "true",
        minimized: f[10] === "true",
        resizable: f[11] !== "false",
        index: idx,
      });
    }
    return out;
  }

  private toTargetWindow(raw: RawWindow): TargetWindow {
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

  private isStandard(raw: RawWindow): boolean {
    return raw.subrole === "AXStandardWindow" || raw.subrole === "";
  }

  private async frontmostProcessName(): Promise<string | null> {
    const r = await runOsascript(
      'tell application "System Events" to get name of first application process whose frontmost is true',
      "AppleScript"
    );
    return r.ok && r.output ? r.output : null;
  }

  async getActiveWindow(): Promise<TargetWindow | null> {
    const raws = await this.enumerateWindows();
    if (raws.length === 0) return null;
    const frontmost = await this.frontmostProcessName();
    // 1) frontmost 进程的标准窗口（面板打开时 frontmost 仍是目标 App —— SPIKE 实证）
    let candidates = raws.filter((w) => w.appName === frontmost && !w.minimized && this.isStandard(w));
    if (candidates.length === 0 && (!frontmost || frontmost === RAYCAST_NAME)) {
      // 2) 防御性兜底：首个非 Raycast 可见进程的标准窗口
      candidates = raws.filter((w) => w.appName !== RAYCAST_NAME && !w.minimized && this.isStandard(w));
    }
    if (candidates.length === 0) return null;
    return this.toTargetWindow(candidates[0]);
  }

  async listWindowsOnActiveDesktop(target: TargetWindow): Promise<TargetWindow[]> {
    const raws = await this.enumerateWindows();
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
  }

  async listAllWindows(): Promise<TargetWindow[]> {
    const raws = await this.enumerateWindows();
    return raws
      .filter((w) => w.appName !== RAYCAST_NAME && !w.minimized && this.isStandard(w))
      .map((w) => this.toTargetWindow(w));
  }

  async enumerateScreens(): Promise<Screen[]> {
    const r = await runOsascript(
      `
ObjC.import("AppKit");
const ss = $.NSScreen.screens;
const out = [];
for (let i = 0; i < ss.count; i++) {
  const f = ss.objectAtIndex(i).frame;
  out.push(f.origin.x + "," + f.origin.y + "," + f.size.width + "," + f.size.height);
}
out.join("|");
`,
      "JavaScript"
    );
    if (!r.ok) return [{ frame: { x: 0, y: 0, w: 2560, h: 1440 } }]; // 探针实测主屏；读取失败时的保守兜底
    const out: Screen[] = [];
    for (const line of r.output.split("|")) {
      const p = line.split(",").map(Number);
      if (p.length === 4 && p.every((v) => Number.isFinite(v) && v > 0)) {
        out.push({ frame: { x: p[0], y: p[1], w: p[2], h: p[3] } });
      }
    }
    return out.length > 0 ? out : [{ frame: { x: 0, y: 0, w: 2560, h: 1440 } }];
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
    const r = await this.writeBounds(pid, index, frame);
    if (!(r.ok && r.output === "OK")) {
      // 偶发失败重试一次：重置面板关闭记忆 + 等待 300ms 后重写
      lastPanelCloseAt = 0;
      await sleep(300);
      await ensurePanelClosed();
      const r2 = await this.writeBounds(pid, index, frame);
      if (!(r2.ok && r2.output === "OK")) {
        const err = r2.ok ? r2.output : r2.error;
        const hint = /-?10000|处理程序失败/.test(err)
          ? `窗口移动被系统拒绝（-10000）：System Events 写入异常，请确认已给 Raycast 辅助功能权限后重试 (${err.replace(/\n/g, " ").slice(0, 120)})`
          : `窗口可能已关闭或无法调整：${err.replace(/\n/g, " ").slice(0, 160)}`;
        throw new ProviderError(hint, "generic");
      }
    }
  }

  private async writeBounds(
    pid: number,
    index: number,
    frame: Frame
  ): Promise<{ ok: boolean; output: string; error: string }> {
    const script = `tell application "System Events"
  try
    set p to first application process whose unix id is ${pid}
    set position of window ${index} of p to {${frame.x}, ${frame.y}}
    set size of window ${index} of p to {${frame.w}, ${frame.h}}
    return "OK"
  on error errMsg number errNum
    return "ERR|" & errNum & "|" & errMsg
  end try
end tell`;
    return runOsascript(script, "AppleScript");
  }

  async raise(w: TargetWindow): Promise<void> {
    const parts = w.id.split("|");
    const pid = Number(parts[0]);
    const index = Number(parts[1]);
    if (!Number.isFinite(pid) || !Number.isFinite(index)) return;
    await runOsascript(
      `tell application "System Events"
  try
    set p to first application process whose unix id is ${pid}
    perform action "AXRaise" of window ${index} of p
  end try
end tell`,
      "AppleScript"
    );
  }
}

export { ProviderError };