// Execute the production Swift selector, not a JS reimplementation or fake daemon.
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")("Swift target selection accepts inactive unique apps and rejects ambiguity", () => {
  const source = fs.readFileSync(path.join(__dirname, "../assets/windowkit.swift"), "utf8");
  const start = source.indexOf("func selectTarget<T>");
  const end = source.indexOf("\nfunc setFrame", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wk-selection-"));
  try {
    const test = path.join(dir, "main.swift");
    fs.writeFileSync(test, source.slice(start, end) + `
struct App { let pid: Int; let active: Bool }
let inactive = App(pid: 1, active: false)
let active = App(pid: 2, active: true)
assert(selectTarget([inactive], isActive: { $0.active })?.pid == 1)
assert(selectTarget([inactive, active], isActive: { $0.active })?.pid == 2)
assert(selectTarget([inactive, inactive], isActive: { $0.active }) == nil)
assert(selectTarget([active, active], isActive: { $0.active }) == nil)
assert(selectTarget([App](), isActive: { $0.active }) == nil)
print("selection passed")
`);
    const cache = path.join(__dirname, "../.cache/swift");
    const binary = path.join(dir, "test");
    execFileSync("/usr/bin/swiftc", ["-module-cache-path", cache, test, "-o", binary], { timeout: 60000 });
    expect(execFileSync(binary, { encoding: "utf8" }).trim()).toBe("selection passed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 65000);
