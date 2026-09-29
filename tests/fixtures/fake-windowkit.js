#!/usr/bin/env node
// 测试用假 windowkit daemon：unix socket 上实现线协议，行为由环境变量控制
// WINDOWKIT_SOCK 必填（socket 路径）；WK_DELAY=ms 延迟响应；WK_CHUNK=1 分两段写响应（测分包）；
// WK_VERSION 覆盖版本；WK_FAIL_WINDOWS=1 / WK_FAIL_FIRST_UNTRUSTED=1 模拟 untrusted；
// WK_FAIL_SETBOUNDS=1 setbounds 全部失败；WK_IDLE_MS 空闲自动退出。
const net = require("net");
const fs = require("fs");

const SOCK = process.env.WINDOWKIT_SOCK;
if (!SOCK) process.exit(1);

// spawn 计数（跨进程持久）：测试据此断言“未重复 spawn”
try {
  const n = Number(fs.readFileSync(SOCK + ".count", "utf8") || 0) + 1;
  fs.writeFileSync(SOCK + ".count", String(n));
} catch {
  fs.writeFileSync(SOCK + ".count", "1");
}

const CANNED_WINDOWS = [
  { pid: 11228, appName: "Electron", bundleId: "com.github.Electron", index: 1, title: "Harness", x: 0, y: 0, w: 900, h: 600, subrole: "AXStandardWindow", fullScreen: false, minimized: false, resizable: true },
  { pid: 11228, appName: "Electron", bundleId: "com.github.Electron", index: 2, title: "Console", x: 500, y: 0, w: 400, h: 300, subrole: "", fullScreen: false, minimized: false, resizable: true },
  { pid: 11228, appName: "Electron", bundleId: "com.github.Electron", index: 3, title: "Hidden", x: 0, y: 0, w: 100, h: 100, subrole: "AXStandardWindow", fullScreen: false, minimized: true, resizable: true },
  { pid: 999, appName: "Raycast", bundleId: "com.raycast.macos", index: 1, title: "Panel", x: 0, y: 0, w: 100, h: 100, subrole: "AXStandardWindow", fullScreen: false, minimized: false, resizable: true },
  { pid: 777, appName: "Notes", bundleId: "com.apple.Notes", index: 1, title: "Note", x: 100, y: 100, w: 500, h: 400, subrole: "AXDialog", fullScreen: false, minimized: false, resizable: true },
];

const server = net.createServer((conn) => {
  let buf = "";
  conn.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const req = JSON.parse(line);
      const respond = (payload) => {
        const text = JSON.stringify({ id: req.id, ...payload }) + "\n";
        // 延迟优先级：SOCK.delay 文件（运行期可改）> WK_DELAY 环境变量（spawn 时冻结）
        let delay = Number(process.env.WK_DELAY || 0);
        try { delay = Number(fs.readFileSync(SOCK + ".delay", "utf8")); } catch {}
        if (process.env.WK_CHUNK === "1") {
          const mid = Math.floor(text.length / 2);
          setTimeout(() => conn.write(text.slice(0, mid)), 1);
          setTimeout(() => conn.write(text.slice(mid)), 2);
        } else {
          setTimeout(() => conn.write(text), delay);
        }
      };
      switch (req.op) {
        case "ping":
          respond({ ok: true, result: { version: Number(process.env.WK_VERSION || 5) } });
          break;
        case "screens":
          respond({ ok: true, result: [{ x: 0, y: 0, w: 1920, h: 1080 }] });
          break;
        case "windows":
          const burnt = process.env.WK_FAIL_FIRST_UNTRUSTED === "1" && !fs.existsSync(SOCK + ".burnt");
          if (process.env.WK_FAIL_WINDOWS === "1" || burnt) {
            if (burnt) {
              try { fs.writeFileSync(SOCK + ".burnt", "1"); } catch {}
            }
            respond({ ok: false, error: "untrusted" });
          } else {
            const bid = req.params.bundleId;
            respond({ ok: true, result: bid ? CANNED_WINDOWS.filter((w) => w.bundleId === bid) : CANNED_WINDOWS });
          }
          break;
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
          setTimeout(() => {
            server.close();
            try { fs.unlinkSync(SOCK); } catch {}
            process.exit(0);
          }, 20);
          break;
        default:
          respond({ ok: false, error: "unknown-op: " + req.op });
      }
    }
  });
  conn.on("error", () => {});
});

server.on("error", () => process.exit(1));
try { fs.unlinkSync(SOCK); } catch {}
server.listen(SOCK);
setTimeout(() => process.exit(0), Number(process.env.WK_IDLE_MS || 10000));
