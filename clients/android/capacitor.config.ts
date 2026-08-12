import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cn.jishi.todo",
  appName: "记时",
  webDir: "www",
  server: {
    url: process.env.JISHI_WEB_URL || "http://104.214.169.232",
    cleartext: process.env.NODE_ENV !== "production",
  },
  android: { allowMixedContent: false, backgroundColor: "#f4f0e8" },
};

export default config;
