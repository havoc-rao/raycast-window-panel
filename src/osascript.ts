// osascript 执行器：AppleScript / JXA 两条通道（探针结论：System Events 是唯一可行的 AX 通道）
import { execFile } from "child_process";

export interface OsascriptResult {
  ok: boolean;
  output: string;
  error: string;
}

export function runOsascript(
  script: string,
  language: "AppleScript" | "JavaScript" = "AppleScript",
  timeoutMs = 25000
): Promise<OsascriptResult> {
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/osascript",
      ["-l", language, "-e", script],
      { timeout: timeoutMs, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({
            ok: false,
            output: String(stdout || "").trim(),
            error: String(stderr || err.message || "").trim(),
          });
        } else {
          resolve({ ok: true, output: String(stdout || "").trim(), error: "" });
        }
      }
    );
  });
}

/** AppleScript 字符串字面量转义（进程名/标题等） */
export function appleScriptQuote(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}