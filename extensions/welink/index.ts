import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/core";
import { createWelinkPlugin } from "./src/channel.js";
import { setWelinkRuntime } from "./src/runtime.js";

const plugin = {
  id: "welink",
  name: "Welink",
  description: "Welink channel plugin for OpenClaw",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWelinkRuntime(api.runtime);
    api.registerChannel({ plugin: createWelinkPlugin() });
  },
};

export default plugin;
