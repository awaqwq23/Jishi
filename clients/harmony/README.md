# HarmonyOS 客户端

这是独立的 HarmonyOS ArkTS/ArkUI 工程。0.3.1（构建号 3000001）默认连接 `https://jishi.awaqwq233.com/`，连接失败时自动切换到 `https://awaqwq233.com/note/`。最低兼容 API 12，当前使用 HarmonyOS 26 SDK 构建。

客户端通过限制 HTTPS 主站、备用站来源的 `JishiNative` 代理接入通知授权、即时通知和系统代理定时提醒；禁用文件访问与混合 HTTP 内容。`syncReminders` 同步最近 21 天内最早 32 个提醒，重新打开或同步时补充。退出账号及进入登录页时清空原账号提醒。系统拒绝代理提醒时，网页明确提示降级为应用内提醒。

`ohos.permission.PUBLISH_AGENT_REMINDER` 必须与实际发布签名 Profile 的授权匹配。代码编译成功不代表该权限已经获批，也不代表进程退出后提醒已经通过真机验证。

## 生成 HAP

1. 从华为开发者联盟安装最新版 DevEco Studio 或 Command Line Tools。
2. 安装完整 HarmonyOS 26 SDK，设置 `DEVECO_SDK_HOME`（其下应有 `default/sdk-pkg.json`）和 `JAVA_HOME`。
3. 在 DevEco Studio 中配置调试签名；真机安装必须使用与设备/账号匹配的签名证书。
4. 在 PowerShell 执行 `./build-hap.ps1 -HvigorPath <hvigorw.bat或hvigor.js路径>`，或在 DevEco Studio 中选择 **Build > Build Hap(s)/APP(s) > Build Hap(s)**。

脚本自动复制必要工程文件到 ASCII 临时目录，解决中文仓库路径无法编译的问题；输出复制到仓库 `outputs/harmony/`，并打印 SHA256。临时目录保留编译日志。发布 APP 使用 `-BuildMode release -Artifact app`。没有签名配置时只能产生 unsigned 包，不能直接安装或提交商店。

## 上架前仍需完成

- 在开发者本人账号下确认实名认证、应用记录和包名 `cn.jishi.todo`；配置发布证书、Profile 及代理提醒权限。私钥和证书密码不得进入 Git、聊天或发布包。
- 用签名 HAP 在真实设备验证主站、备用站、断网重试、返回键、通知拒绝/允许、杀进程定时提醒、退出与切换账号后提醒隔离。
- 准备真实截图、应用图标、产品描述、分级、隐私政策公开地址、开发者联系邮箱及账号注销途径。未完成的能力不得在商店文案中宣称已经可用。
- 通过 AppGallery Connect 上传已签名发布 APP，并由开发者确认资料、协议和最终审核提交。

官方流程：[命令行构建](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-command-line-building-app)、[代理提醒](https://developer.huawei.com/consumer/cn/doc/doccenter-capabilities/agent-powered-reminder)、[AppGallery](https://developer.huawei.com/consumer/cn/appgallery/)。
