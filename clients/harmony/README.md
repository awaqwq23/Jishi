# HarmonyOS 客户端

这是独立的 HarmonyOS ArkTS/ArkUI 工程，默认连接已经部署的记时 HTTPS 服务。要更换服务地址，修改 `entry/src/main/ets/pages/Index.ets` 中的 `appUrl`。

## 生成 HAP

1. 从华为开发者联盟安装最新版 DevEco Studio 或 Command Line Tools。
2. 使用 DevEco Studio 打开本目录并安装 HarmonyOS API 12 SDK。
3. 在 DevEco Studio 中配置调试签名；真机安装必须使用与设备/账号匹配的签名证书。
4. 在 PowerShell 执行 `./build-hap.ps1`，或在 DevEco Studio 中选择 **Build > Build Hap(s)/APP(s) > Build Hap(s)**。

HAP 通常生成在 `entry/build/default/outputs/default/`。签名证书属于开发者账号凭据，不应提交到仓库。
