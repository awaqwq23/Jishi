import type { CapacitorConfig } from "@capacitor/cli";
import packageJson from "./package.json";

const appVersion = packageJson.version;

const config: CapacitorConfig = {
  appId: "cn.jishi.todo",
  appName: "记时",
  webDir: "www",
  appendUserAgent: ` JishiAndroid/${appVersion}`,
  server: {
    url: process.env.JISHI_WEB_URL || "https://awaqwq233.com",
    cleartext: false,
  },
  android: { allowMixedContent: false, backgroundColor: "#f4f0e8" },
};

export default config;
