// 动作结果契约：业务服务返回结果，展示层决定如何反馈。
export interface ActionResult {
  ok: boolean;
  message: string;
}

export function ok(message: string): ActionResult {
  return { ok: true, message };
}

export function fail(message: string): ActionResult {
  return { ok: false, message };
}
