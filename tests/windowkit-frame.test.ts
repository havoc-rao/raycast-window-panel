import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { expect, it } from "vitest";

it.skipIf(process.platform !== "darwin")("production Swift writer has no settling reads and propagates actual write errors", () => {
  const source = fs.readFileSync(path.join(__dirname, "../assets/windowkit.swift"), "utf8");
  const start = source.indexOf("func applyFrame(");
  const end = source.indexOf("\nfunc setFrame", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const writer = source.slice(start, source.indexOf("\nfunc screensJson", end));
  expect(writer).not.toMatch(/RunLoop|sleep|axPoint|axSize|frame-mismatch/);
  const dir = path.join(__dirname, "../.cache/frame-test");
  fs.mkdirSync(dir, { recursive: true });
  const test = path.join(dir, "main.swift");
  const compat = writer.slice(writer.indexOf("func withResizeCompatibility("));
  fs.writeFileSync(test, "import Foundation\nimport CoreGraphics\n" + source.slice(start, end) + compat + `
let target = CGRect(x: -1920, y: 25, width: 1920, height: 1055)
var events: [String] = []
let result = applyFrame(target, position: { events.append("position"); return nil }, size: { events.append("size"); return nil })
assert(result == nil)
assert(events == ["position", "size", "position"])
assert(applyFrame(target, position: { "position-denied" }, size: { fatalError() }) == "position-denied")
assert(applyFrame(target, position: { nil }, size: { "size-denied" }) == "size-denied")
assert(applyFrame(CGRect(x: 0, y: 0, width: 0, height: 10), position: { fatalError() }, size: { fatalError() }) == "invalid-frame")
events = []
assert(withResizeCompatibility(voiceOverEnabled: false, enhancedUIEnabled: { true }, setEnhancedUI: {
  events.append($0 ? "restore" : "disable"); return true
}, write: { events.append("write"); return "write-failed" }) == "write-failed")
assert(events == ["disable", "write", "restore"])
assert(withResizeCompatibility(voiceOverEnabled: true, enhancedUIEnabled: { fatalError() }, setEnhancedUI: { _ in fatalError() }, write: { nil }) == nil)
assert(withResizeCompatibility(voiceOverEnabled: false, enhancedUIEnabled: { false }, setEnhancedUI: { _ in fatalError() }, write: { nil }) == nil)
assert(withResizeCompatibility(voiceOverEnabled: false, enhancedUIEnabled: { true }, setEnhancedUI: { $0 == false }, write: { nil }) == "enhanced-ui-restore-failed")
print("frame passed")
`);
  const binary = path.join(dir, "test");
  execFileSync("/usr/bin/swiftc", ["-module-cache-path", path.join(__dirname, "../.cache/swift"), test, "-o", binary], { timeout: 60000 });
  expect(execFileSync(binary, { encoding: "utf8" }).trim()).toBe("frame passed");
}, 65000);
