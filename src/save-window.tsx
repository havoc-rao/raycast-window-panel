// save-window 命令（no-view）：记忆当前窗口（位置+大小），受「记录到此 App」偏好控制
import { notify, saveWindowCommand } from "./actions";

export default async function Command() {
  const result = await saveWindowCommand();
  await notify(result);
}