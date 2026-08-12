import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "cn.jishi.todo",
  appName: "记时",
  webDir: "www",
  server: {
    url: process.env.JISHI_SERVER_URL || "http://10.0.2.2:3000",
    cleartext: process.env.NODE_ENV !== "production",
  },
  android: { allowMixedContent: false, backgroundColor: "#f4f0e8" },
};

export default config;
