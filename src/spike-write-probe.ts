// [dev] 第 3 轮写窗口对照探针共享逻辑：面板状态记录 + 三种写脚本形式
import * as fs from "fs";
import * as path from "path";
import { runOsascript } from "./osascript";
import { AppleScriptWindowProvider } from "./provider-applescript";

const OUT_FILE = "/Users/havoc/Documents/Projects/tools/macOS/raycast-window-panel/.cache/spike/writecheck.jsonl";

export function logRow(tag: string, step: string, value: string): void {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  try {
    fs.appendFileSync(OUT_FILE, JSON.stringify({ t: new Date().toISOString(), tag, step, value }) + "\n");
  } catch (e) {
    fs.appendFileSync(OUT_FILE, JSON.stringify({ t: new Date().toISOString(), tag, step, value: "LOGFILE FAIL " + String(e) }) + "\n");
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 面板状态：SE frontmost + NSWorkspace frontmost 双记录 */
export async function panelState(label: string): Promise<string> {
  const se = await runOsascript(
    'tell application "System Events"\n  set frontPid to unix id of first application process whose frontmost is true\n  set frontName to name of first application process whose unix id is frontPid\n  return (frontPid as text) & "|" & frontName\nend tell',
    "AppleScript"
  );
  const ns = await runOsascript(
    'ObjC.import("AppKit"); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; (a?a.localizedName.js:"null")',
    "JavaScript"
  );
  return `${label}: SE=${se.ok ? se.output : "ERR:" + se.error.slice(0, 60)} | NSWorkspace=${ns.ok ? ns.output : "ERR:" + ns.error.slice(0, 60)}`;
}

export interface FrontmostInfo {
  pid: number;
  name: string;
}

export async function frontmostInfo(): Promise<FrontmostInfo | null> {
  const r = await runOsascript(
    'tell application "System Events"\n  set frontPid to unix id of first application process whose frontmost is true\n  set frontName to name of first application process whose unix id is frontPid\n  return (frontPid as text) & "|" & frontName\nend tell',
    "AppleScript"
  );
  if (!r.ok) return null;
  const i = r.output.indexOf("|");
  const pid = Number(r.output.slice(0, i));
  return Number.isFinite(pid) ? { pid, name: r.output.slice(i + 1) } : null;
}

/** 生产写法（provider 现状）：字面量 + unix id 寻址 */
export function literalWriteScript(pid: number, index: number, frame: { x: number; y: number; w: number; h: number }): string {
  return `tell application "System Events"
  try
    set p to first application process whose unix id is ${pid}
    set position of window ${index} of p to {${frame.x}, ${frame.y}}
    set size of window ${index} of p to {${frame.w}, ${frame.h}}
    return "OK"
  on error errMsg number errNum
    return "ERR|" & errNum & "|" & errMsg
  end try
end tell`;
}

/** 旧探针写法（内联读取，应为 -10000）：按进程名 */
export function inlineIdiomScript(appName: string): string {
  const q = appName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `tell application "System Events" to tell application process "${q}" to set position of window 1 to (position of window 1)`;
}

export async function runProbeScript(tag: string, step: string, script: string): Promise<string> {
  const r = await runOsascript(script, "AppleScript");
  const value = r.ok ? r.output : `OSAFAIL ${r.error.slice(0, 140)}`;
  logRow(tag, step, value);
  return value;
}

/** 找第一个非 frontmost 进程的标准窗口（c 组：非激活 App 对照） */
export async function firstOtherWindow(frontPid: number): Promise<{ pid: number; index: number; appName: string; frame: { x: number; y: number; w: number; h: number } } | null> {
  try {
    const provider = new AppleScriptWindowProvider();
    const raws = await provider.enumerateWindows();
    const w = raws.find((r) => r.pid !== frontPid && !r.minimized && (r.subrole === "AXStandardWindow" || r.subrole === ""));
    if (!w) return null;
    return { pid: w.pid, index: w.index, appName: w.appName, frame: { x: w.x, y: w.y, w: w.w, h: w.h } };
  } catch (e) {
    logRow("view", "firstOtherWindow", "ERR " + String((e as Error).message).slice(0, 120));
    return null;
  }
}