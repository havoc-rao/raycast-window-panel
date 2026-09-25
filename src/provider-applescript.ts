// AppleScript 窗口后端（System Events；需辅助功能权限，写入仍受应用自身约束）
// 目标窗口 = Raycast 识别的前台 App 内的 AXFocusedWindow / AXMainWindow；不猜测其他 App。
// 窗口句柄 = 进程 unix id + 窗口索引；z 序近似 = 焦点优先 + App 优先；全屏/最小化标记随枚举返回。
import type { Frame, Region, Screen, TargetWindow } from "./types";
import { appleScriptQuote, runOsascript } from "./osascript";
import { ProviderError } from "./windows";
import type { WindowProvider } from "./windows";
import { closeMainWindow, getFrontmostApplication } from "@raycast/api";

/** 窗口枚举行字段分隔符（控制字符 US，避免与标题冲突） */
const SEP = "\u001f";
const RAYCAST_NAME = "Raycast";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 生产写路径的前置：先关面板再写。
 * 对照实验结论（SPIKE.md §6/§7）：面板打开与否不影响写入（正确写法下均成功），
 * 但保留「先关面板」策略 = 与原版 Hammerspoon「关面板→回焦→执行」一致的 UX，并在
 * 个别环境存在状态门控时由写入失败后的延迟重试作为防御。
 * 模块级记忆：最近 1500ms 已关闭时跳过；耗时较长的排布仍可能再次关闭。
 */
let lastPanelCloseAt = 0;
async function ensurePanelClosed(): Promise<void> {
  if (Date.now() - lastPanelCloseAt < 1500) return;
  try {
    await closeMainWindow();
  } catch {
    /* 忽略：no-view 等场景 close 可能为 no-op */
  }
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
  private screenCache: { screens: Screen[]; expiresAt: number } | null = null;
  private screenRead: Promise<Screen[] | null> | null = null;

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

  async getActiveWindow(): Promise<TargetWindow | null> {
    try {
      // Raycast's Application has no PID. Prefer bundle ID: Electron's process name
      // can differ from its display name. Never substitute an unrelated application.
      const app = await getFrontmostApplication();
      if (app.bundleId === "com.raycast.macos" || app.name === RAYCAST_NAME) return null;
      const identity = app.bundleId || app.name;
      if (!identity) return null;
      const selector = app.bundleId ? "bundle identifier" : "name";
      const r = await runOsascript(
        `set SEP to character id 31
 tell application "System Events"
  try
    -- Fetch scalar IDs directly: resolved process objects can collapse to a shared Electron name.
    set targetPids to unix id of (application processes whose ${selector} is "${appleScriptQuote(identity)}")
    if (count of targetPids) is 0 then return ""
    set targetPid to 0
    if (count of targetPids) is 1 then
      set targetPid to item 1 of targetPids
    else
      repeat with candidatePid in targetPids
        if frontmost of (first application process whose unix id is (contents of candidatePid)) then
          if targetPid is not 0 then return ""
          set targetPid to contents of candidatePid
        end if
      end repeat
    end if
    if targetPid is 0 then return ""
    set p to a reference to (first application process whose unix id is targetPid)
    set w to missing value
    try
      set w to value of attribute "AXFocusedWindow" of p
    end try
    if w is missing value then
      try
        set w to value of attribute "AXMainWindow" of p
      end try
    end if
    if w is missing value then return ""
    -- Preserve the actual process-local index used by setBounds/raise, not window 1.
    set ws to every window of p
    set windex to 0
    repeat with i from 1 to count of ws
      if (item i of ws) is equal to w then
        set windex to i
        exit repeat
      end if
    end repeat
    if windex is 0 then return ""
    -- Do not retain the AX-returned name-based specifier for subsequent reads.
    set w to a reference to window windex of p
    set wmin to false
    try
      set wmin to (value of attribute "AXMinimized" of w) as boolean
    end try
    if wmin then return ""
    set wtitle to ""
    try
      set wtitle to name of w
    end try
    set pbid to ""
    try
      set pbid to bundle identifier of p
    end try
    set wpos to position of w
    set wsz to size of w
    set wfull to false
    try
      set wfull to (value of attribute "AXFullScreen" of w) as boolean
    end try
    set wres to true
    try
      set wres to (value of attribute "AXResizable" of w) as boolean
    end try
    return (unix id of p as text) & SEP & (name of p) & SEP & pbid & SEP & wtitle & SEP & (item 1 of wpos as text) & SEP & (item 2 of wpos as text) & SEP & (item 1 of wsz as text) & SEP & (item 2 of wsz as text) & SEP & "" & SEP & (wfull as text) & SEP & (wmin as text) & SEP & (wres as text) & SEP & (windex as text)
  on error
    return ""
  end try
end tell`,
        "AppleScript"
      );
      if (!r.ok || !r.output) return null;
      // One record, not lines: legitimate window titles may contain newlines.
      const f = r.output.split(SEP);
      if (f.length !== 13) return null;
      const [pid, x, y, w, h, index] = [f[0], f[4], f[5], f[6], f[7], f[12]].map((v) =>
        v.trim() ? Number(v) : NaN
      );
      if (
        !Number.isInteger(pid) || pid <= 0 || !Number.isInteger(index) || index <= 0 ||
        ![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 ||
        ![f[9], f[10], f[11]].every((v) => v === "true" || v === "false") ||
        f[10] === "true" || f[1] === RAYCAST_NAME || f[2] === "com.raycast.macos" ||
        (app.bundleId && f[2] !== app.bundleId) || (!app.bundleId && f[1] !== app.name)
      ) return null;
      return this.toTargetWindow({
        pid, appName: f[1], bundleId: f[2], title: f[3], x, y, w, h,
        subrole: f[8], fullScreen: f[9] === "true", minimized: false,
        resizable: f[11] === "true", index,
      });
    } catch {
      // No target / unavailable AX data must not cause a write to another app.
      return null;
    }
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
    let screens: Screen[] | null;
    if (this.screenCache && Date.now() < this.screenCache.expiresAt) {
      screens = this.screenCache.screens;
    } else {
      this.screenCache = null;
      if (!this.screenRead) {
        this.screenRead = this.readScreens()
          .catch(() => null)
          .then((result) => {
            if (result) this.screenCache = { screens: result, expiresAt: Date.now() + 1000 };
            return result;
          })
          .finally(() => { this.screenRead = null; });
      }
      screens = await this.screenRead;
    }
    // Legacy fallback only; never cache it as a measurement of the user's display.
    return (screens ?? [{ frame: { x: 0, y: 0, w: 2560, h: 1440 } }])
      .map((screen) => ({ ...screen, frame: { ...screen.frame } }));
  }

  private async readScreens(): Promise<Screen[] | null> {
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
    if (!r.ok) return null;
    const frames = r.output.split("|").map((line) => {
      const p = line.split(",").map((v) => v.trim() ? Number(v) : NaN);
      return p.length === 4 && p.every(Number.isFinite) && p[2] > 0 && p[3] > 0
        ? { x: p[0], y: p[1], w: p[2], h: p[3] }
        : null;
    });
    // NSScreen.screens[0] is the primary screen (menu bar), not the focused screen.
    // Cocoa is bottom-left / y-up; AX is primary-screen top-left / y-down.
    const primary = frames[0];
    if (!primary) return null; // Cannot convert other screens without the primary.
    const primaryTop = primary.y + primary.h;
    return frames.flatMap((frame) => frame
      ? [{ frame: { ...frame, y: primaryTop - frame.y - frame.h } }]
      : []);

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
    set p to a reference to (first application process whose unix id is ${pid})
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
    set p to a reference to (first application process whose unix id is ${pid})
    perform action "AXRaise" of window ${index} of p
  end try
end tell`,
      "AppleScript"
    );
  }
}

export { ProviderError };