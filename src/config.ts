import type { SlottdConfig, ModelPack } from './types.js';

let appConfig: SlottdConfig | null = null;
let defaultPacks: ModelPack[] = [];

export function setDefaultPacks(packs: ModelPack[]) {
  defaultPacks = packs;
}

export function getDefaultPacks(): ModelPack[] {
  return defaultPacks;
}

export function setSlottdConfig(cfg: SlottdConfig) {
  appConfig = cfg;
}

export function getSlottdConfig(): SlottdConfig | null {
  return appConfig;
}
