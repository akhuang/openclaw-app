import {
  createPluginRuntimeStore,
  type PluginRuntime,
} from "openclaw/plugin-sdk/runtime-store";

const { setRuntime: setWelinkRuntime, getRuntime: getWelinkRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Welink runtime not initialized - plugin not registered");

export { getWelinkRuntime, setWelinkRuntime };
