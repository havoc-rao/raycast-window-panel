// windowkit · SPIKE/P5 用 CGWindowList 探针：按 z 序（前→后）输出前台窗口
// 用法: windowkit [limit]
// 输出: 每行 JSON {"pid":..,"number":..,"layer":..,"owner":..,"bounds":{x,y,w,h},"name":..}
import CoreGraphics
import Foundation

let limit = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) ?? 20 : 20
let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
guard let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else {
  FileHandle.standardError.write("no window info\n".data(using: .utf8)!)
  exit(1)
}
var count = 0
for w in info {
  if count >= limit { break }
  let pid = w["kCGWindowOwnerPID"] as? Int ?? 0
  let num = w["kCGWindowNumber"] as? Int ?? 0
  let layer = w["kCGWindowLayer"] as? Int ?? 0
  let owner = w["kCGWindowOwnerName"] as? String ?? ""
  let name = w["kCGWindowName"] as? String ?? ""
  var bx = 0.0, by = 0.0, bw = 0.0, bh = 0.0
  if let b = w["kCGWindowBounds"] as? [String: Any] {
    bx = b["X"] as? Double ?? 0
    by = b["Y"] as? Double ?? 0
    bw = b["Width"] as? Double ?? 0
    bh = b["Height"] as? Double ?? 0
  }
  let obj: [String: Any] = ["pid": pid, "number": num, "layer": layer, "owner": owner, "name": name,
                            "bounds": ["x": bx, "y": by, "w": bw, "h": bh]]
  if let data = try? JSONSerialization.data(withJSONObject: obj),
     let line = String(data: data, encoding: .utf8) {
    print(line)
    count += 1
  }
}