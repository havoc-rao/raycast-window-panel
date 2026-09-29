// windowkit · 常驻窗口助手（P5 落地 / 与 Hammerspoon 同构：进程内原生 AX + NSWorkspace + NSScreen）
// 由 Raycast 扩展进程 spawn（继承辅助功能信任，AX 直读直写；SPIKE §6.1-C 实证 trusted=true）。
// 协议：stdio 换行 JSON。
//   请求  {"id":N,"op":"...","params":{...}}
//   响应  {"id":N,"ok":true,"result":...} | {"id":N,"ok":false,"error":"..."}
// op：
//   ping              → {"version": N}
//   window            params {bundleId?|name?} → 该 App 焦点窗（AXFocusedWindow→AXMainWindow 兜底）信息或 null
//   windows           params {bundleId?|name?} → 全部（或该 App 的）标准窗口列表
//   screens           → [{x,y,w,h}]（AX 坐标系：主屏原点在左上，y 向下）
//   setbounds         params {items:[{pid,index,x,y,w,h}]} → [{ok:bool,error?}]
//   raise             params {pid,index}
//   quit              → 退出
import Foundation
import AppKit
import ApplicationServices

let WINDOWKIT_VERSION = 3
signal(SIGPIPE, SIG_IGN)

// MARK: - 窗口信息

struct Win {
  var pid: pid_t = 0
  var appName: String = ""
  var bundleId: String = ""
  var index: Int = 0
  var title: String = ""
  var x: Double = 0, y: Double = 0, w: Double = 0, h: Double = 0
  var subrole: String = ""
  var fullScreen = false
  var minimized = false
  var resizable = true

  var json: [String: Any] {
    ["pid": pid, "appName": appName, "bundleId": bundleId, "index": index,
     "title": title, "x": x, "y": y, "w": w, "h": h, "subrole": subrole,
     "fullScreen": fullScreen, "minimized": minimized, "resizable": resizable]
  }
}

// MARK: - AX 工具

func axValue(_ el: AXUIElement, _ attr: CFString) -> CFTypeRef? {
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(el, attr, &v) == .success else { return nil }
  return v
}

func axString(_ el: AXUIElement, _ attr: CFString) -> String {
  (axValue(el, attr) as? String) ?? ""
}

func axPoint(_ el: AXUIElement) -> CGPoint? {
  guard let v = axValue(el, kAXPositionAttribute as CFString) else { return nil }
  var p = CGPoint.zero
  guard AXValueGetValue(v as! AXValue, .cgPoint, &p) else { return nil }
  return p
}

func axSize(_ el: AXUIElement) -> CGSize? {
  guard let v = axValue(el, kAXSizeAttribute as CFString) else { return nil }
  var s = CGSize.zero
  guard AXValueGetValue(v as! AXValue, .cgSize, &s) else { return nil }
  return s
}

/// AX 布尔属性；属性缺失时返回 default（与 AppleScript try-as-boolean 语义一致）
func axBool(_ el: AXUIElement, _ attr: CFString, default def: Bool) -> Bool {
  (axValue(el, attr) as? NSNumber)?.boolValue ?? def
}

func windowsOf(_ pid: pid_t) -> [AXUIElement] {
  let app = AXUIElementCreateApplication(pid)
  guard let v = axValue(app, kAXWindowsAttribute as CFString) else { return [] }
  let arr = v as! CFArray
  var out: [AXUIElement] = []
  out.reserveCapacity(CFArrayGetCount(arr))
  for i in 0..<CFArrayGetCount(arr) {
    out.append(unsafeBitCast(CFArrayGetValueAtIndex(arr, i), to: AXUIElement.self))
  }
  return out
}

func winInfo(_ app: NSRunningApplication, _ el: AXUIElement, _ index: Int) -> Win {
  var w = Win()
  w.pid = app.processIdentifier
  w.appName = app.localizedName ?? ""
  w.bundleId = app.bundleIdentifier ?? ""
  w.index = index
  w.title = axString(el, kAXTitleAttribute as CFString)
  if let p = axPoint(el) { w.x = Double(p.x); w.y = Double(p.y) }
  if let s = axSize(el) { w.w = Double(s.width); w.h = Double(s.height) }
  w.subrole = axString(el, kAXSubroleAttribute as CFString)
  w.fullScreen = axBool(el, "AXFullScreen" as CFString, default: false)
  w.minimized = axBool(el, kAXMinimizedAttribute as CFString, default: false)
  w.resizable = axBool(el, "AXResizable" as CFString, default: true)
  return w
}

/// 焦点窗（AXFocusedWindow → AXMainWindow 兜底），带进程内索引；无焦点窗返回 nil
func focusedWindow(of app: NSRunningApplication) -> Win? {
  let pid = app.processIdentifier
  let axApp = AXUIElementCreateApplication(pid)
  var el: AXUIElement?
  if let f = axValue(axApp, kAXFocusedWindowAttribute as CFString) {
    el = unsafeBitCast(f, to: AXUIElement.self)
  }
  if el == nil, let m = axValue(axApp, kAXMainWindowAttribute as CFString) {
    el = unsafeBitCast(m, to: AXUIElement.self)
  }
  guard let win = el else { return nil }
  let wins = windowsOf(pid)
  guard let idx = wins.firstIndex(where: { CFEqual($0, win) }) else { return nil }
  return winInfo(app, win, idx + 1)
}

/// 按 bundleId 或 name 匹配可见 App（与 AppleScript `visible is true` 语义对齐；
/// regular + accessory 都可能有可见窗口）
func matchApps(bundleId: String?, name: String?) -> [NSRunningApplication] {
  NSWorkspace.shared.runningApplications.filter { app in
    guard [.regular, .accessory].contains(app.activationPolicy), !app.isHidden else { return false }
    if let bid = bundleId, !bid.isEmpty { return app.bundleIdentifier == bid }
    if let n = name, !n.isEmpty { return app.localizedName == n }
    return true
  }
}

func setFrame(_ el: AXUIElement, _ x: Double, _ y: Double, _ w: Double, _ h: Double) -> String? {
  var p = CGPoint(x: x, y: y)
  var sz = CGSize(width: w, height: h)
  guard let pv = AXValueCreate(.cgPoint, &p), let sv = AXValueCreate(.cgSize, &sz) else {
    return "axvalue-create-failed"
  }
  let e1 = AXUIElementSetAttributeValue(el, kAXPositionAttribute as CFString, pv)
  if e1 != .success { return "position:\(e1.rawValue)" }
  let e2 = AXUIElementSetAttributeValue(el, kAXSizeAttribute as CFString, sv)
  if e2 != .success { return "size:\(e2.rawValue)" }
  return nil
}

func screensJson() -> [[String: Double]] {
  let ss = NSScreen.screens
  guard let primary = ss.first else { return [] }
  let primaryTop = primary.frame.origin.y + primary.frame.size.height
  return ss.map { s -> [String: Double] in
    let f = s.frame
    return ["x": Double(f.origin.x),
            "y": Double(primaryTop - f.origin.y - f.size.height),
            "w": Double(f.size.width),
            "h": Double(f.size.height)]
  }
}

// MARK: - 分发

enum OpResult {
  case success(Any)
  case failure(String)
}

func dispatch(_ op: String, _ params: [String: Any]) -> OpResult {
  switch op {
  case "ping":
    return .success(["version": WINDOWKIT_VERSION])

  case "window":
    guard AXIsProcessTrusted() else { return .failure("untrusted") }
    let app = matchApps(bundleId: params["bundleId"] as? String,
                        name: params["name"] as? String)
      .first(where: { $0.isActive }) // 多进程同 bundle 时优先前台（与 AppleScript 一致）
    guard let target = app else { return .success(NSNull()) }
    if let w = focusedWindow(of: target) { return .success(w.json) }
    return .success(NSNull())

  case "windows":
    guard AXIsProcessTrusted() else { return .failure("untrusted") }
    let apps = matchApps(bundleId: params["bundleId"] as? String,
                         name: params["name"] as? String)
    var out: [[String: Any]] = []
    for app in apps {
      for (i, el) in windowsOf(app.processIdentifier).enumerated() {
        out.append(winInfo(app, el, i + 1).json)
      }
    }
    return .success(out)

  case "screens":
    return .success(screensJson())

  case "setbounds":
    guard AXIsProcessTrusted() else { return .failure("untrusted") }
    let items = params["items"] as? [[String: Any]] ?? []
    var out: [[String: Any]] = []
    for it in items {
      guard let pid = (it["pid"] as? NSNumber)?.int32Value,
            let index = (it["index"] as? NSNumber)?.intValue,
            let x = it["x"] as? Double, let y = it["y"] as? Double,
            let w = it["w"] as? Double, let h = it["h"] as? Double else {
        out.append(["ok": false, "error": "invalid-item"])
        continue
      }
      let wins = windowsOf(pid)
      guard index >= 1, index <= wins.count else {
        out.append(["ok": false, "error": "no-window"])
        continue
      }
      if let err = setFrame(wins[index - 1], x, y, w, h) {
        out.append(["ok": false, "error": err])
      } else {
        out.append(["ok": true])
      }
    }
    return .success(out)

  case "raise":
    guard AXIsProcessTrusted() else { return .failure("untrusted") }
    if let pid = (params["pid"] as? NSNumber)?.int32Value,
       let index = (params["index"] as? NSNumber)?.intValue {
      let wins = windowsOf(pid)
      if index >= 1, index <= wins.count {
        AXUIElementPerformAction(wins[index - 1], kAXRaiseAction as CFString)
      }
    }
    return .success(NSNull())

  case "quit":
    exit(0)

  default:
    return .failure("unknown-op: " + op)
  }
}

// MARK: - 主循环（顺序处理，一次一个请求；TS 侧排队）

while let line = readLine() {
  guard !line.isEmpty,
        let data = line.data(using: .utf8),
        let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
        let id = req["id"],
        let op = req["op"] as? String else { continue }
  let params = req["params"] as? [String: Any] ?? [:]
  var resp: [String: Any] = ["id": id]
  switch dispatch(op, params) {
  case .success(let payload):
    resp["ok"] = true
    resp["result"] = payload
  case .failure(let err):
    resp["ok"] = false
    resp["error"] = err
  }
  if let d = try? JSONSerialization.data(withJSONObject: resp),
     let s = String(data: d, encoding: .utf8) {
    print(s)
    fflush(stdout)
  }
}