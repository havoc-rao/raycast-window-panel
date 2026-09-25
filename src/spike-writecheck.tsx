// [dev] 第 3 轮写窗口对照（view 模式，单次唤起联跑）：
//   c1 面板打开 + 生产写法 → 预期 OK
//   c2 面板打开 + 旧内联写法 → 预期 -10000（历史基线故障复现，证明是写法问题）
//   c3 面板打开 + 生产写法写「非前台 App」窗口 → 预期 OK（面板态假设证伪）
//   b  closeMainWindow → sleep 250ms → 生产写法 → 预期 OK（生产修复路径）
import { List } from "@raycast/api";
import { closeMainWindow } from "@raycast/api";
import { useEffect, useState } from "react";
import { runOsascript } from "./osascript";
import { frontmostInfo, inlineIdiomScript, literalWriteScript, logRow, panelState, runProbeScript, firstOtherWindow, sleep } from "./spike-write-probe";

async function readFrontWindowFrame(pid: number): Promise<{ x: number; y: number; w: number; h: number }> {
  const r = await runOsascript(
    `tell application "System Events"\n  set p to first application process whose unix id is ${pid}\n  set wpos to position of window 1 of p\n  set wsz to size of window 1 of p\n  return (item 1 of wpos as text) & "," & (item 2 of wpos as text) & "," & (item 1 of wsz as text) & "," & (item 2 of wsz as text)\nend tell`,
    "AppleScript"
  );
  const p = r.output.split(",").map(Number);
  return p.length === 4 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : { x: 0, y: 0, w: 100, h: 100 };
}

export default function Command() {
  const [rows, setRows] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const step = async (label: string, fn: () => Promise<string>) => {
          const v = await fn();
          logRow("view", label, v);
          setRows((r) => [...r, `${label}: ${v}`]);
        };
        logRow("view", "RUN_START", "mounted");
        await step("panelState_start", () => panelState("start"));
        const info = await frontmostInfo();
        if (!info) throw new Error("no frontmost");
        // c1: 面板打开 + 生产写法（同值写）
        await step("c1_panelOpen_literal", async () => {
          const frame = await readFrontWindowFrame(info.pid);
          return runProbeScript("view", "c1_panelOpen_literal", literalWriteScript(info.pid, 1, frame));
        });
        // c2: 面板打开 + 旧内联写法（历史探针原样）
        await step("c2_panelOpen_inline", () => runProbeScript("view", "c2_panelOpen_inline", inlineIdiomScript(info.name)));
        // c3: 面板打开 + 生产写法写非前台 App 的窗口
        await step("c3_panelOpen_otherApp", async () => {
          const other = await firstOtherWindow(info.pid);
          if (!other) return "no other window found";
          logRow("view", "c3_target", JSON.stringify(other));
          return runProbeScript("view", "c3_panelOpen_otherApp", literalWriteScript(other.pid, other.index, other.frame));
        });
        // b: 生产修复路径 —— 先关面板再写
        await closeMainWindow();
        await sleep(250);
        await step("panelState_afterClose", () => panelState("after closeMainWindow+250ms"));
        const info2 = await frontmostInfo();
        if (!info2) throw new Error("no frontmost after close");
        await step("b_afterClose_literal", async () => {
          const frame = await readFrontWindowFrame(info2.pid);
          return runProbeScript("view", "b_afterClose_literal", literalWriteScript(info2.pid, 1, frame));
        });
        logRow("view", "RUN_DONE", "all steps finished");
      } catch (e) {
        logRow("view", "RUN_ERROR", String((e as Error)?.stack ?? e));
      }
    })();
  }, []);
  return (
    <List>
      {rows.map((r, i) => (
        <List.Item key={i} title={r} />
      ))}
    </List>
  );
}