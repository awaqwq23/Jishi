# HarmonyOS 客户端

这是独立的 HarmonyOS ArkTS/ArkUI 工程。0.3.0 默认连接 `https://jishi.awaqwq233.com/`，连接失败时自动切换到 `https://awaqwq233.com/note/`。主站、备用站和版本 User-Agent 位于 `entry/src/main/ets/pages/Index.ets`。

客户端通过受限的 `JishiNative` JavaScript 代理接入 HarmonyOS 系统通知授权和即时通知；不向网页暴露账号凭据。AppGallery 审核通过后台代理提醒能力后，可继续为 `syncReminders` 接入进程退出后的系统级定时提醒。

## 生成 HAP

1. 从华为开发者联盟安装最新版 DevEco Studio 或 Command Line Tools。
2. 使用 DevEco Studio 打开本目录并安装 HarmonyOS API 12 SDK。
3. 在 DevEco Studio 中配置调试签名；真机安装必须使用与设备/账号匹配的签名证书。
4. 在 PowerShell 执行 `./build-hap.ps1`，或在 DevEco Studio 中选择 **Build > Build Hap(s)/APP(s) > Build Hap(s)**。

HAP 通常生成在 `entry/build/default/outputs/default/`。签名证书属于开发者账号凭据，不应提交到仓库。
