// Raycast LocalStorage → KVStore 适配（MRU/上次样式/开关的持久化后端）
import { LocalStorage } from "@raycast/api";
import type { KVStore } from "./types";

export const raycastKV: KVStore = {
  get: (key) => LocalStorage.getItem<string>(key),
  set: (key, value) => LocalStorage.setItem(key, value),
};