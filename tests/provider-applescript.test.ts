import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeMainWindow, getFrontmostApplication } from "@raycast/api";
import { runOsascript } from "../src/osascript";
import { AppleScriptWindowProvider } from "../src/provider-applescript";

vi.mock("@raycast/api", () => ({ getFrontmostApplication: vi.fn(), closeMainWindow: vi.fn() }));
vi.mock("../src/osascript", async (original) => ({
  ...await original<typeof import("../src/osascript")>(), runOsascript: vi.fn(),
}));

const SEP = "\u001f";
const frontmost = vi.mocked(getFrontmostApplication);
const run = vi.mocked(runOsascript);
let provider: AppleScriptWindowProvider;
let testTime = Date.now();
const window = { id: "73245|3", appName: "Electron", bundleId: "com.github.Electron", title: "Harness", bounds: { x: 0, y: 0, w: 900, h: 600 }, fullScreen: false, positionable: true, resizable: true };
const fields = ["11228", "Electron", "com.github.Electron", "DeepSeek Harness", "-100", "0", "900", "600", "AXDialog", "false", "false", "true", "3"];
function output(value = fields.join(SEP)) {
  run.mockResolvedValue({ ok: true, output: value, error: "" });
}

beforeEach(() => {
  vi.resetAllMocks();
  provider = new AppleScriptWindowProvider();
  vi.useFakeTimers();
  // Advance between tests without changing the module-level recent-close heuristic.
  testTime += 10000;
  vi.setSystemTime(testTime);
  frontmost.mockResolvedValue({ name: "DeepSeek Harness", path: "/Applications/Harness.app", bundleId: "com.github.Electron" });
  output();
});

afterEach(() => { vi.useRealTimers(); });

describe("targeted active window lookup", () => {
  it("uses bundle identity, one script, and the real index for a focused nonstandard Electron window", async () => {
    const enumerate = vi.spyOn(provider, "enumerateWindows");
    expect(await provider.getActiveWindow()).toEqual({
      id: "11228|3", appName: "Electron", bundleId: "com.github.Electron", title: "DeepSeek Harness",
      bounds: { x: -100, y: 0, w: 900, h: 600 }, fullScreen: false, positionable: true, resizable: true,
    });
    expect(enumerate).not.toHaveBeenCalled();
    enumerate.mockRestore();
    expect(frontmost).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    const [script, language] = run.mock.calls[0];
    expect(language).toBe("AppleScript");
    expect(script).toContain('application processes whose bundle identifier is "com.github.Electron"');
    expect(script).toContain('value of attribute "AXFocusedWindow" of p');
    expect(script).toContain('if w is missing value then\n      try\n        set w to value of attribute "AXMainWindow" of p');
    expect(script).toContain("if (item i of ws) is equal to w then");
    expect(script).toContain("set windex to i");
    expect(script).toContain('set targetPids to unix id of (application processes whose bundle identifier is "com.github.Electron")');
    expect(script).toContain("if frontmost of (first application process whose unix id is (contents of candidatePid)) then");
    expect(script).toContain('if targetPid is 0 then return ""');
    expect(script).toContain("set p to a reference to (first application process whose unix id is targetPid)");
    expect(script).toContain("set w to a reference to window windex of p");
    expect(script).not.toMatch(/whose visible|whose frontmost|AXStandardWindow|AXSubrole/);
  });

  it("escapes a name-only target rather than using another application", async () => {
    frontmost.mockResolvedValue({ name: 'App "quoted"\\name', path: "/tmp/app" });
    output("");
    expect(await provider.getActiveWindow()).toBeNull();
    expect(run.mock.calls[0][0]).toContain('whose name is "App \\"quoted\\"\\\\name"');
    expect(run).toHaveBeenCalledOnce();
  });

  it("accepts an exact name-only target when the API omits bundle ID", async () => {
    frontmost.mockResolvedValue({ name: "Electron", path: "/Applications/Harness.app" });
    expect(await provider.getActiveWindow()).toMatchObject({ id: "11228|3", appName: "Electron" });
    expect(run.mock.calls[0][0]).toContain('whose name is "Electron"');
  });

  it("preserves multiline titles and fullscreen/nonresizable flags", async () => {
    const row = [...fields];
    row[3] = "First\nSecond";
    row[9] = "true";
    row[11] = "false";
    output(row.join(SEP));
    expect(await provider.getActiveWindow()).toMatchObject({ title: "First\nSecond", fullScreen: true, resizable: false });
  });

  it.each(["", "ERR|denied", fields.slice(0, 12).join(SEP), fields.join(SEP) + SEP + "extra"])("returns null for absent/malformed output %j", async (value) => {
    output(value);
    expect(await provider.getActiveWindow()).toBeNull();
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([[0, "0"], [12, "0"], [12, "1.5"], [4, "NaN"], [5, ""], [6, "0"], [7, "-1"], [10, "true"], [9, "unknown"], [2, "another.app"]] as const)("rejects unsafe field %i=%s", async (index, value) => {
    const row = [...fields];
    row[index] = value;
    output(row.join(SEP));
    expect(await provider.getActiveWindow()).toBeNull();
  });

  it.each([
    { name: "Raycast", path: "/Applications/Raycast.app" },
    { name: "Localized Raycast", path: "/Applications/Raycast.app", bundleId: "com.raycast.macos" },
    { name: "", path: "" },
  ])("does not query System Events for an unusable target", async (app) => {
    frontmost.mockResolvedValue(app);
    expect(await provider.getActiveWindow()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns null when Raycast cannot identify the target", async () => {
    frontmost.mockRejectedValue(new Error("no foreground application"));
    expect(await provider.getActiveWindow()).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns null on script failure without enumerating a fallback", async () => {
    run.mockResolvedValue({ ok: false, output: "", error: "AX denied" });
    expect(await provider.getActiveWindow()).toBeNull();
    expect(run).toHaveBeenCalledOnce();
    run.mockRejectedValue(new Error("executor failed"));
    expect(await provider.getActiveWindow()).toBeNull();
  });
});

describe("PID-stable writes", () => {
  it("writes immediately after close and retains the 1500ms recent-close heuristic", async () => {
    output("OK");
    await provider.setBounds(window, window.bounds);
    expect(closeMainWindow).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1499);
    await provider.setBounds(window, window.bounds);
    expect(closeMainWindow).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await provider.setBounds(window, window.bounds);
    expect(closeMainWindow).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([true, false])("retries once after exactly 300ms (retry succeeds: %s)", async (succeeds) => {
    output(succeeds ? "OK" : "ERR|-10000|denied");
    run.mockResolvedValueOnce({ ok: false, output: "", error: "denied" });
    const write = provider.setBounds(window, window.bounds);
    const outcome = succeeds
      ? expect(write).resolves.toBeUndefined()
      : expect(write).rejects.toThrow("-10000");
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledOnce();
    expect(closeMainWindow).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(299);
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    await outcome;
    expect(run).toHaveBeenCalledTimes(2);
    expect(closeMainWindow).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("keeps writeBounds and raise references PID-based for same-name Electron processes", async () => {
    output("OK");
    await provider.setBounds(window, window.bounds);
    expect(closeMainWindow).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await provider.raise(window);
    expect(run).toHaveBeenCalledTimes(2);
    for (const [script] of run.mock.calls) {
      expect(script).toContain("set p to a reference to (first application process whose unix id is 73245)");
      expect(script).toContain("window 3 of p");
    }
  });
});

describe("screen cache", () => {
  const screens = [{ frame: { x: 0, y: 0, w: 1920, h: 1080 } }];
  const fallback = [{ frame: { x: 0, y: 0, w: 2560, h: 1440 } }];

  it("shares reads across screen APIs until the 1000ms TTL and clones returned frames", async () => {
    output("0,0,1920,1080");
    const first = await provider.enumerateScreens();
    first[0].frame.w = 1;
    first.push({ frame: { x: 0, y: 0, w: 1, h: 1 } });
    expect(await provider.getAllScreens()).toEqual(screens);
    const region = await provider.getScreenRegion(window);
    region!.x = 999;
    await vi.advanceTimersByTimeAsync(999);
    expect(await provider.enumerateScreens()).toEqual(screens);
    expect(run).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    output("0,0,1600,900");
    await vi.advanceTimersByTimeAsync(1);
    expect(await provider.enumerateScreens()).toEqual([{ frame: { x: 0, y: 0, w: 1600, h: 900 } }]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("deduplicates in-flight reads and starts the TTL when the read completes", async () => {
    let resolve!: (result: Awaited<ReturnType<typeof runOsascript>>) => void;
    run.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const first = provider.enumerateScreens();
    const second = provider.getAllScreens();
    expect(run).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1500);
    resolve({ ok: true, output: "0,0,1920,1080", error: "" });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(screens);
    expect(b).toEqual(screens);
    expect(a).not.toBe(b);
    expect(a[0].frame).not.toBe(b[0].frame);
    await vi.advanceTimersByTimeAsync(999);
    expect(await provider.getAllScreens()).toEqual(screens);
    expect(run).toHaveBeenCalledOnce();
    output("0,0,1920,1080");
    await vi.advanceTimersByTimeAsync(1);
    await provider.getAllScreens();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it.each(["script failure", "rejection", "empty", "invalid primary"])("does not cache fallback after %s", async (failure) => {
    if (failure === "rejection") run.mockRejectedValueOnce(new Error("executor failed"));
    else run.mockResolvedValueOnce({
      ok: failure !== "script failure",
      output: failure === "invalid primary" ? "broken|-1280,0,1280,1024" : "",
      error: "denied",
    });
    const [a, b] = await Promise.all([provider.enumerateScreens(), provider.getAllScreens()]);
    expect(a).toEqual(fallback);
    expect(b).toEqual(fallback);
    expect(run).toHaveBeenCalledOnce();
    output("0,0,1920,1080");
    expect(await provider.enumerateScreens()).toEqual(screens);
    expect(run).toHaveBeenCalledTimes(2);
    expect(await provider.getAllScreens()).toEqual(screens);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not reuse expired screens after a failed refresh or share caches across instances", async () => {
    output("0,0,1920,1080");
    await provider.getAllScreens();
    await new AppleScriptWindowProvider().getAllScreens();
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    run.mockResolvedValueOnce({ ok: false, output: "", error: "denied" });
    expect(await provider.getAllScreens()).toEqual(fallback);
    expect(await provider.getAllScreens()).toEqual(screens);
    expect(run).toHaveBeenCalledTimes(4);
  });
});

describe("screen coordinates", () => {
  it("accepts zero/negative origins and converts Cocoa y-up to AX y-down", async () => {
    output("0,0,1920,1080|-1280,0,1280,1024|0,1080,1600,900|0,-900,1600,900|1920,0,2560,1440");
    expect(await provider.enumerateScreens()).toEqual([
      { frame: { x: 0, y: 0, w: 1920, h: 1080 } },
      { frame: { x: -1280, y: 56, w: 1280, h: 1024 } },
      { frame: { x: 0, y: -900, w: 1600, h: 900 } },
      { frame: { x: 0, y: 1080, w: 1600, h: 900 } },
      { frame: { x: 1920, y: -360, w: 2560, h: 1440 } },
    ]);
    expect(run.mock.calls[0][1]).toBe("JavaScript");
  });

  it("ignores malformed secondary frames, not zero origins", async () => {
    output("0,0,1920,1080|,0,800,600|NaN,0,800,600|0,0,0,600|0,0,800,-1|0,0,800,600,1");
    expect(await provider.enumerateScreens()).toEqual([{ frame: { x: 0, y: 0, w: 1920, h: 1080 } }]);
  });

  it.each(["", "broken|-1280,0,1280,1024"])("retains legacy fallback if primary screen is unavailable", async (value) => {
    output(value);
    expect(await provider.enumerateScreens()).toEqual([{ frame: { x: 0, y: 0, w: 2560, h: 1440 } }]);
  });

  it("finds an above-primary screen using AX window bounds", async () => {
    output("0,0,1920,1080|0,1080,1600,900");
    const window = { id: "1|1", appName: "App", bundleId: "app", title: "", bounds: { x: 50, y: -800, w: 800, h: 600 }, fullScreen: false, positionable: true, resizable: true };
    expect(await provider.getScreenRegion(window)).toEqual({ x: 0, y: -900, w: 1600, h: 900 });
  });
});
