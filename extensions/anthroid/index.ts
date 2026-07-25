import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "anthroid",
  name: "Anthroid",
  description: "Pending queue delivery for Anthroid mobile clients",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./api.js",
    exportName: "anthroidPlugin",
  },
});
