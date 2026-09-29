#!/usr/bin/env node
// 测试用假 windowkit helper：实现线协议，数据固定，行为由环境变量控制
// WK_DELAY=ms 延迟响应；WK_CHUNK=1 分两段写响应（测分包）；WK_VERSION 覆盖版本；
// WK_FAIL_SETBOUNDS=1 setbounds 全部失败；op=exit 时按 WK_EXIT_CODE 退出。
const readline = require("readline");

const CANNED_WINDOWS = [
  { pid: 11228, appName: "Electron", bundleId: "com.github.Electron", index: 1, title: "Harness", x: 0, y: 0, w: 900, h: 600, subrole: "AXStandardWindow", fullScreen: false, minimized: false, resizable: true },
  { pid: 11228, appName: "Electron", bundleId: "com.github.Electron", index: 2, title: "Console", x: 500, y: 0, w: 400, h: 300, subrole: "", fullScreen: false, minimized: false, resizable: true },
  { pid: 11228, appName: "Electron", bundleId: "com.github.Electron", index: 3, title: "Hidden", x: 0, y: 0, w: 100, h: 100, subrole: "AXStandardWindow", fullScreen: false, minimized: true, resizable: true },
  { pid: 999, appName: "Raycast", bundleId: "com.raycast.macos", index: 1, title: "Panel", x: 0, y: 0, w: 100, h: 100, subrole: "AXStandardWindow", fullScreen: false, minimized: false, resizable: true },
  { pid: 777, appName: "Notes", bundleId: "com.apple.Notes", index: 1, title: "Note", x: 100, y: 100, w: 500, h: 400, subrole: "AXDialog", fullScreen: false, minimized: false, resizable: true },
];

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const respond = (payload) => {
    const text = JSON.stringify({ id: req.id, ...payload }) + "\n";
    if (process.env.WK_CHUNK === "1") {
      const mid = Math.floor(text.length / 2);
      setTimeout(() => process.stdout.write(text.slice(0, mid)), 1);
      setTimeout(() => process.stdout.write(text.slice(mid)), 2);
    } else {
      setTimeout(() => process.stdout.write(text), Number(process.env.WK_DELAY || 0));
    }
  };
  switch (req.op) {
    case "ping":
      respond({ ok: true, result: { version: Number(process.env.WK_VERSION || 3) } });
      break;
    case "screens":
      respond({ ok: true, result: [{ x: 0, y: 0, w: 1920, h: 1080 }] });
      break;
    case "windows": {
      const bid = req.params.bundleId;
      const rows = bid ? CANNED_WINDOWS.filter((w) => w.bundleId === bid) : CANNED_WINDOWS;
      respond({ ok: true, result: rows });
      break;
    }
    case "window": {
      const hit = CANNED_WINDOWS.find((w) =>
        req.params.bundleId ? w.bundleId === req.params.bundleId : w.appName === req.params.name
      );
      respond({ ok: true, result: hit || null });
      break;
    }
    case "setbounds":
      if (process.env.WK_FAIL_SETBOUNDS === "1") {
        respond({ ok: true, result: req.params.items.map(() => ({ ok: false, error: "-10000|denied" })) });
      } else {
        respond({ ok: true, result: req.params.items.map(() => ({ ok: true })) });
      }
      break;
    case "raise":
      respond({ ok: true, result: null });
      break;
    case "quit":
      respond({ ok: true, result: null });
      process.exit(0);
      break;
    case "exit":
      setTimeout(() => process.exit(Number(process.env.WK_EXIT_CODE || 1)), 10);
      break;
    default:
      respond({ ok: false, error: "unknown-op: " + req.op });
  }
});