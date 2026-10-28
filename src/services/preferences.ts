// 偏好：layoutsPath（数据文件路径，~ 自动展开）/ memoryTargetEnabled（记录到此 App 开关）
import { getPreferenceValues } from "@raycast/api";
import * as os from "os";
import * as path from "path";

export const DEFAULT_LAYOUTS_PATH = "~/Library/Application Support/raycast-window-panel/window-layouts.json";

export interface Preferences {
  layoutsPath?: string;
  memoryTargetEnabled?: boolean;
}

export function getPreferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function layoutsFilePath(): string {
  const raw = (getPreferences().layoutsPath || DEFAULT_LAYOUTS_PATH).trim();
  if (raw.startsWith("~/")) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

export function getMemoryTargetEnabledPref(): boolean {
  const v = getPreferences().memoryTargetEnabled;
  return v === undefined ? true : v;
}