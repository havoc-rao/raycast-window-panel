// 后端生命周期与预热：主后端 windowkit，不可用时回落 AppleScript。
import { AppleScriptWindowProvider } from "./provider-applescript";
import { WindowKitProvider } from "./provider-windowkit";
import type { WindowProvider } from "./types";
import { timed } from "../../utils/timing";

let providerPromise: Promise<WindowProvider> | null = null;
export function getProvider(): Promise<WindowProvider> {
  if (!providerPromise) {
    providerPromise = (async () => {
      const native = await timed("provider.init-windowkit", () => WindowKitProvider.create());
      if (native) return native;
      console.debug("[Window Panel timing] provider.init-windowkit fallback-to-applescript");
      return new AppleScriptWindowProvider();
    })();
  }
  return providerPromise;
}

// 保留原 actions 装载时预热的时机；不缓存窗口对象。
void getProvider().catch(() => {
  /* 初始化失败由动作调用方处理。 */
});
