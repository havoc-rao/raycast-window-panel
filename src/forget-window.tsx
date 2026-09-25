// forget-window 命令（no-view）：解除当前窗口的记忆（之后自动排布不再保护它）
import { forgetWindowCommand, notify } from "./actions";

export default async function Command() {
  const result = await forgetWindowCommand();
  await notify(result);
}