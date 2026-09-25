// import-from-hammerspoon 命令（no-view）：一次性导入 ~/.hammerspoon/window-layouts.json 到本扩展数据文件
// 合并语义：windows 按同键覆盖（记忆豁免名单合并）；source 有快照则替换；仅导入纯槽位格式快照（旧 items 格式忽略，与 Lua 加载器一致）
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { loadLayouts, notify, persistLayouts } from "./actions";
import { mergeLayoutsInto, parseLayouts } from "./storage";

/** 导入源路径（本机固定；可用环境变量 RWP_IMPORT_PATH 覆盖，便于测试） */
export function importSourcePath(): string {
  return process.env.RWP_IMPORT_PATH || path.join(os.homedir(), ".hammerspoon", "window-layouts.json");
}

export default async function Command() {
  const src = importSourcePath();
  if (!fs.existsSync(src)) {
    await notify({ ok: false, message: "未找到 " + src + "：请确认 Hammerspoon 数据文件存在" });
    return;
  }
  let source;
  try {
    source = parseLayouts(fs.readFileSync(src, "utf8"));
  } catch (e) {
    await notify({ ok: false, message: "导入源解析失败: " + String((e as Error)?.message ?? e) });
    return;
  }
  const target = loadLayouts();
  const report = mergeLayoutsInto(target, source);
  try {
    persistLayouts(target);
  } catch (e) {
    await notify({ ok: false, message: "写入失败: " + String((e as Error)?.message ?? e) });
    return;
  }
  const snap = report.snapshotImported ? "；快照已导入" : "；快照保留现状";
  await notify({
    ok: true,
    message: `已从 Hammerspoon 导入: 新增 ${report.added} 条、覆盖 ${report.updated} 条${snap}`,
  });
}
