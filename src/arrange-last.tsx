// arrange-last 命令（no-view）：一键按当前弹性窗口数的上次样式直接排布，无记忆则用默认（1 全屏/2 重叠/3+ 叠放）
import { runArrange, notify } from "./actions";

export default async function Command() {
  const result = await runArrange(undefined);
  await notify(result);
}