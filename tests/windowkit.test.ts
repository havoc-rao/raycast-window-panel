// windowkit 主后端：socket daemon 协议 + Provider 行为（用假 helper 进程端到端验证）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { closeMainWindow, getFrontmostApplication } from "@raycast/api";
import { WindowKitClient, WindowKitProvider } from "../src/provider-windowkit";

vi.mock("@raycast/api", () => ({ getFrontmostApplication: vi.fn(), closeMainWindow: vi.fn() }));

const FIXTURE = path.join(__dirname, "fixtures", "fake-windowkit.js");
const frontmost = vi.mocked(getFrontmostApplication);

const ENV_KEYS = ["WK_DELAY", "WK_CHUNK", "WK_VERSION", "WK_FAIL_SETBOUNDS", "WK_FAIL_WINDOWS", "WK_FAIL_FIRST_UNTRUSTED", "WK_IDLE_MS"];
const started: Array<WindowKitClient> = [];

function tmpSock(): string {
  return path.join(os.tmpdir(), "wk-test-" + Math.random().toString(36).slice(2) + ".sock");
}

async function startClient(sockPath = tmpSock()): Promise<WindowKitClient> {
  const client = new WindowKitClient(FIXTURE, sockPath);
  expect(await client.start()).toBe(true);
  started.push(client);
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  frontmost.mockResolvedValue({
    name: "Electron",
    path: "/Applications/Harness.app",
    bundleId: "com.github.Electron",
  });
});

afterEach(async () => {
  for (const client of started.splice(0)) {
    client.stopAndQuit();
    client.stop();
  }
  for (const k of ENV_KEYS) delete process.env[k];
  await new Promise((r) => setTimeout(r, 60)); // 等 fixture 退出清理
});

describe("windowkit socket 线协议", () => {
  it("ping 往返 + 版本校验", async () => {
    const client = await startClient();
    const pong = await client.request<{ version: number }>("ping");
    expect(pong.version).toBe(5);
    client.stop();
  });

  it("screens 返回原生坐标", async () => {
    const client = await startClient();
    expect(await client.request("screens")).toEqual([{ x: 0, y: 0, w: 1920, h: 1080 }]);
    client.stop();
  });

  it("响应分包（多段 data 事件）也能完整拼装", async () => {
    process.env.WK_CHUNK = "1";
    const client = await startClient();
    const rows = await client.request<Array<{ title: string }>>("windows");
    expect(rows).toHaveLength(5);
    client.stop();
  });

  it("超时（WK_DELAY > timeoutMs）→ 拒绝并清理 pending；后续请求仍可用", async () => {
    process.env.WK_DELAY = "1500";
    const client = await startClient();
    await expect(client.request("windows", {}, 100)).rejects.toThrow("超时");
    process.env.WK_DELAY = "0";
    expect(await client.request("ping")).toEqual({ version: 5 });
    client.stop();
  });

  it("daemon 中途退出 → 拒绝全部 pending；之后再请求报通道不可用", async () => {
    const sockPath = tmpSock();
    process.env.WK_IDLE_MS = "800"; // 启动完成后让 daemon 空闲退出
    const client = await startClient(sockPath);
    fs.writeFileSync(sockPath + ".delay", "2000"); // 只延迟后续请求，不影响 start() 内 ping
    const doomed = client.request("windows");
    await expect(doomed).rejects.toThrow(/连接已断开|通道不可用/);
    await expect(client.request("ping")).rejects.toThrow("通道不可用");
    client.stop();
  });

  it("版本不符的 ping → start 失败且旧实例被 quit", async () => {
    process.env.WK_VERSION = "1";
    const client = new WindowKitClient(FIXTURE, tmpSock());
    expect(await client.start()).toBe(false);
  });

  it("未知 op → 错误透传", async () => {
    const client = await startClient();
    await expect(client.request("nope")).rejects.toThrow("unknown-op: nope");
    client.stop();
  });

  it("跨客户端复用同一 daemon（模拟扩展进程重启）", async () => {
    const sockPath = tmpSock();
    const countFile = sockPath + ".count";
    const c1 = await startClient(sockPath);
    await c1.request("ping");
    c1.stop(); // 只断开连接，不杀 daemon
    const c2 = new WindowKitClient(FIXTURE, sockPath);
    expect(await c2.start()).toBe(true); // 复用：不再 spawn
    expect(await c2.request("ping")).toEqual({ version: 5 });
    expect(fs.readFileSync(countFile, "utf8")).toBe("1"); // spawn 次数仍为 1
    started.push(c2);
  });
});

describe("WindowKitProvider 启动链路", () => {
  it("untrusted 探针 → 自动重建一次后可用（孤儿 daemon 自愈）", async () => {
    process.env.WK_FAIL_FIRST_UNTRUSTED = "1";
    const p = await WindowKitProvider.create({ binary: FIXTURE, socketPath: tmpSock() });
    expect(p).not.toBeNull();
    expect((await p!.listAllWindows()).map((w) => w.title)).toEqual(["Harness", "Console"]);
  });

  it("持续 untrusted → create 返回 null（回落 AppleScript）", async () => {
    process.env.WK_FAIL_WINDOWS = "1";
    expect(await WindowKitProvider.create({ binary: FIXTURE, socketPath: tmpSock() })).toBeNull();
  });

  it("binary 不存在 → create 返回 null", async () => {
    expect(await WindowKitProvider.create({ binary: "/nonexistent/windowkit", socketPath: tmpSock() })).toBeNull();
  });
});

describe("WindowKitProvider（假 daemon 端到端）", () => {
  async function provider(): Promise<WindowKitProvider> {
    const p = await WindowKitProvider.create({ binary: FIXTURE, socketPath: tmpSock() });
    expect(p).not.toBeNull();
    return p!;
  }

  it("listAllWindows：过滤 Raycast/最小化/非标准窗口", async () => {
    const p = await provider();
    const wins = await p.listAllWindows();
    expect(wins.map((w) => w.title)).toEqual(["Harness", "Console"]);
    expect(wins[0]).toMatchObject({ id: "11228|1", bundleId: "com.github.Electron" });
  });

  it("listWindowsForApp：按 bundle 限定枚举；unknown 回落全量", async () => {
    const p = await provider();
    const client = (p as unknown as { client: WindowKitClient }).client;
    const spy = vi.spyOn(client, "request");
    expect((await p.listWindowsForApp("com.github.Electron")).map((w) => w.title)).toEqual([
      "Harness",
      "Console",
    ]);
    expect(spy).toHaveBeenCalledWith("windows", { bundleId: "com.github.Electron" });
    expect((await p.listWindowsForApp("unknown")).map((w) => w.title)).toEqual(["Harness", "Console"]);
    expect(spy).toHaveBeenCalledWith("windows", {});
  });

  it("getActiveWindow：前台 App 身份 + 焦点窗校验", async () => {
    const p = await provider();
    const win = await p.getActiveWindow();
    expect(win).toMatchObject({ id: "11228|1", title: "Harness", bundleId: "com.github.Electron" });
    // bundle 不匹配（Raycast 身份 ≠ 记忆身份）→ 不猜测其他 App
    frontmost.mockResolvedValue({ name: "Other", path: "/Applications/Other.app", bundleId: "com.other.app" });
    expect(await p.getActiveWindow()).toBeNull();
    // Raycast 自身 → null
    frontmost.mockResolvedValue({ name: "Raycast", path: "/Applications/Raycast.app", bundleId: "com.raycast.macos" });
    expect(await p.getActiveWindow()).toBeNull();
  });

  it("屏幕缓存：1s TTL 内只请求一次", async () => {
    const p = await provider();
    const client = (p as unknown as { client: WindowKitClient }).client;
    const spy = vi.spyOn(client, "request");
    const a = await p.getAllScreens();
    const b = await p.enumerateScreens();
    expect(a).toEqual([{ frame: { x: 0, y: 0, w: 1920, h: 1080 } }]);
    expect(b).toEqual(a);
    expect(spy.mock.calls.filter((c) => c[0] === "screens")).toHaveLength(1);
  });

  it("listWindowsOnActiveDesktop：同进程优先 + 区域过滤", async () => {
    const p = await provider();
    const target = { id: "11228|1", appName: "Electron", bundleId: "com.github.Electron", title: "Harness", bounds: { x: 0, y: 0, w: 900, h: 600 }, fullScreen: false, positionable: true, resizable: true };
    const wins = await p.listWindowsOnActiveDesktop(target);
    expect(wins.map((w) => w.title)).toEqual(["Console"]);
  });

  it("setBoundsBatch：成功路径一次请求；失败重试一次后仍失败 → ProviderError", async () => {
    const p = await provider();
    await p.setBoundsBatch([{ window: { id: "11228|1", appName: "E", bundleId: "b", title: "t", bounds: { x: 0, y: 0, w: 1, h: 1 }, fullScreen: false, positionable: true, resizable: true }, frame: { x: 10, y: 20, w: 300, h: 200 } }]);
    expect(closeMainWindow).toHaveBeenCalledTimes(1);

    process.env.WK_FAIL_SETBOUNDS = "1";
    const p2 = await provider();
    const write = p2.setBoundsBatch([{ window: { id: "11228|1", appName: "E", bundleId: "b", title: "t", bounds: { x: 0, y: 0, w: 1, h: 1 }, fullScreen: false, positionable: true, resizable: true }, frame: { x: 10, y: 20, w: 300, h: 200 } }]);
    await expect(write).rejects.toThrow("-10000");
  });

  it("无效句柄 → 直接抛 no-window，不发请求", async () => {
    const p = await provider();
    const client = (p as unknown as { client: WindowKitClient }).client;
    const spy = vi.spyOn(client, "request");
    await expect(
      p.setBoundsBatch([{ window: { id: "bad", appName: "E", bundleId: "b", title: "t", bounds: { x: 0, y: 0, w: 1, h: 1 }, fullScreen: false, positionable: true, resizable: true }, frame: { x: 1, y: 1, w: 1, h: 1 } }])
    ).rejects.toThrow("窗口句柄失效");
    expect(spy).not.toHaveBeenCalled();
  });

  it("daemon 停止后读路径回落为空（不抛给调用方）", async () => {
    process.env.WK_IDLE_MS = "100";
    const p = await provider();
    const client = (p as unknown as { client: WindowKitClient }).client;
    await new Promise((r) => setTimeout(r, 400)); // daemon 空闲退出
    expect(await p.listAllWindows()).toEqual([]);
    expect(await p.getActiveWindow()).toBeNull();
  });
});