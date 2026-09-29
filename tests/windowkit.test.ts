// windowkit 主后端：线协议 + Provider 行为（用假 helper 进程端到端验证）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "path";
import { closeMainWindow, getFrontmostApplication } from "@raycast/api";
import { WindowKitClient, WindowKitProvider } from "../src/provider-windowkit";

vi.mock("@raycast/api", () => ({ getFrontmostApplication: vi.fn(), closeMainWindow: vi.fn() }));

const FIXTURE = path.join(__dirname, "fixtures", "fake-windowkit.js");
const frontmost = vi.mocked(getFrontmostApplication);

const ENV_KEYS = ["WK_DELAY", "WK_CHUNK", "WK_VERSION", "WK_FAIL_SETBOUNDS", "WK_EXIT_CODE"];

async function startClient(): Promise<WindowKitClient> {
  const client = new WindowKitClient(process.execPath, [FIXTURE]);
  expect(await client.start()).toBe(true);
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

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("windowkit 线协议", () => {
  it("ping 往返 + 版本校验", async () => {
    const client = await startClient();
    const pong = await client.request<{ version: number }>("ping");
    expect(pong.version).toBe(3);
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

  it("超时（WK_DELAY > timeoutMs）→ 拒绝并清理 pending", async () => {
    process.env.WK_DELAY = "1500";
    const client = await startClient();
    await expect(client.request("windows", {}, 100)).rejects.toThrow("超时");
    // 后续正常请求仍可用（超时不清进程）
    process.env.WK_DELAY = "0";
    expect(await client.request("ping")).toEqual({ version: 3 });
    client.stop();
  });

  it("helper 退出 → 拒绝全部 pending；之后再请求报通道不可用", async () => {
    process.env.WK_DELAY = "500";
    const client = await startClient();
    const doomed = client.request("windows");
    client.request("exit").catch(() => {});
    await expect(doomed).rejects.toThrow(/已退出|进程错误/);
    await expect(client.request("ping")).rejects.toThrow("通道不可用");
    client.stop();
  });

  it("版本不符的 ping → start 失败", async () => {
    process.env.WK_VERSION = "1";
    const client = new WindowKitClient(process.execPath, [FIXTURE]);
    expect(await client.start()).toBe(false);
  });

  it("未知 op → 错误透传", async () => {
    const client = await startClient();
    await expect(client.request("nope")).rejects.toThrow("unknown-op: nope");
    client.stop();
  });
});

describe("WindowKitProvider（假 helper 端到端）", () => {
  async function provider(): Promise<WindowKitProvider> {
    return new WindowKitProvider(await startClient());
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
    // 目标在 900×600 内（0,0），Console(500,0) 同进程也在区域内；Notes 是 AXDialog 已被过滤
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

  it("helper 停止后读路径回落为空（不抛给调用方）", async () => {
    const p = await provider();
    const client = (p as unknown as { client: WindowKitClient }).client;
    client.stop();
    expect(await p.listAllWindows()).toEqual([]);
    expect(await p.getActiveWindow()).toBeNull();
  });
});