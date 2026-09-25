// [dev] 第 3 轮写窗口对照（no-view 模式）：
//   a 组：生产写法（字面量）连跑 3 次，应稳定成功
//   生产路径最终验证：provider.setBounds（含 ensurePanelClosed → closeMainWindow+250ms → 字面量写）连跑 3 次
import { closeMainWindow } from "@raycast/api";
import { AppleScriptWindowProvider } from "./provider-applescript";
import { frontmostInfo, literalWriteScript, logRow, runProbeScript, sleep } from "./spike-write-probe";

async function readFrame(pid: number): Promise<{ x: number; y: number; w: number; h: number }> {
  const r = await import("./osascript").then((m) =>
    m.runOsascript(
      `tell application "System Events"\n  set p to first application process whose unix id is ${pid}\n  set wpos to position of window 1 of p\n  set wsz to size of window 1 of p\n  return (item 1 of wpos as text) & "," & (item 2 of wpos as text) & "," & (item 1 of wsz as text) & "," & (item 2 of wsz as text)\nend tell`,
      "AppleScript"
    )
  );
  const p = r.output.split(",").map(Number);
  return p.length === 4 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : { x: 0, y: 0, w: 100, h: 100 };
}

export default async function Command() {
  // a 组：生产写法（字面量）连跑
  for (const t of ["t0", "t1s", "t2s"]) {
    const info = await frontmostInfo();
    if (!info) {
      logRow("noview", t, "no frontmost");
      continue;
    }
    const frame = await readFrame(info.pid);
    await runProbeScript("noview", t, literalWriteScript(info.pid, 1, frame));
    await sleep(1000);
  }
  // 生产路径最终验证：真实 provider（ensurePanelClosed + 字面量写）
  try {
    const provider = new AppleScriptWindowProvider();
    for (const t of ["provider1", "provider2", "provider3"]) {
      const target = await provider.getActiveWindow();
      if (!target) {
        logRow("noview", t, "no active window");
        continue;
      }
      try {
        await provider.setBounds(target, target.bounds); // 同值写，走生产路径
        logRow("noview", t, "OK (provider path)");
      } catch (e) {
        logRow("noview", t, "ERR " + String((e as Error).message).slice(0, 140));
      }
      await sleep(400);
    }
  } catch (e) {
    logRow("noview", "providerFatal", String((e as Error)?.stack ?? e));
  }
  await closeMainWindow();
}