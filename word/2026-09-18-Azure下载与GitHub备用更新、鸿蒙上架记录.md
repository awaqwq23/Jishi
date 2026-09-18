# 2026-09-18 Azure 下载与 GitHub 备用更新、鸿蒙上架记录

## 用户要求

1. 排查 Azure 服务器下载约 95 MiB 安装包耗时近一小时的问题并修复。
2. 今后将最新 Windows/Android 安装包同步到 GitHub，软件更新时提供前往 GitHub 下载并覆盖安装的入口。
3. 利用已登录的华为开发者页面签发鸿蒙发布包并提交应用市场。

## Azure 只读诊断

- Azure CLI 只读查询确认正式站点 IP `104.214.169.232` 对应东亚区 `awanote`，实例规格为 `Standard_B2ats_v2`，网卡加速网络已启用。
- Azure Monitor 近六小时的 CPU 平均约 0.9% 至 1.1%，CPU 积分未耗尽，出站流量约 44 至 70 MB/小时，未见实例资源或出站总量接近带宽上限。
- 2026-09-16 当前电脑到服务器的 512 KiB Range 下载为 13.7 KiB/s，备用域名为 21.4 KiB/s，两域名指向同一 IP；2026-09-18 对正式地址的 256 KiB Range 抽样为约 199 KiB/s。速度明显波动。返回 206，支持 Range、Content-Length 和附件下载。
- 2026-09-15 服务器本机回环读取安装包曾测得约 406 MB/s，Nginx 已启用 `sendfile` 和 `tcp_nopush`。这些证据更符合源站至中国用户的公网路径波动；不能由此断言 Azure 的哪段路由故障或保证单用户达到标称聚合带宽。未改动 Azure 资源、DNS、Nginx 或生产服务。
- 微软规格说明：`Standard_B2ats_v2` 的网络数字是所有目标的整机聚合上限，实际值受拥塞与应用配置影响，不保证单连接速度。来源：[Azure Basv2 规格](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/basv2-series)、[Azure VM 网络带宽说明](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-machine-network-throughput)。

## GitHub 备用更新

- 更新清单增量提供每个平台的 `githubUrl`，原服务器 `downloadUrl` 保留，以兼容旧 Windows/Android 0.4.x 与缓存 Web/PWA。
- 更新弹窗显示“从 GitHub 下载”入口和覆盖安装说明；仅接受本仓库、当前清单平台版本与文件名完全匹配的 HTTPS Release 资产 URL。
- `.github/workflows/publish-client-release.yml` 在安装包、清单或发布脚本推送到 `main` 后自动执行更新契约检查，再由 `scripts/publish-github-release.mjs` 创建或核对稳定 Release，验证两份资产大小和 GitHub 提供的 SHA-256。若同名资产与清单不一致，则拒绝覆盖。
- 功能提交 `b410f251e7ee5da5d7223fb83089bdf836e30108` 已推送 `origin/main`；GitHub Actions 运行 `35291170259` 成功。[Release](https://github.com/awaqwq23/Jishi/releases/tag/clients-v0.4.6-a0.4.7) 两个资产与正式安装包逐项匹配：Windows 99,630,936 bytes / SHA-256 `4079BCA14B51A731D7BBC230DFEAAAAA6FFC7ED184403F10880167A8A5C92244`，Android 4,069,317 bytes / SHA-256 `2C238D4F4D346F613D77E008A626EF46A98F5F70FEC6F3E84F089FFF2C0FA8E2`。
- 从当前电脑抽样访问 GitHub 安装包直链时连接被重置，未获得有效速度；不能保证该备用入口在当前网络快于 Azure。GitHub 资产在发布 API 上已验证真实存在，应用内功能仍需正式 Web 发布后由实际设备点击验收。
- 本次沿用已在正式服务器发布的 Windows 0.4.6 和 Android 0.4.7 安装包；只改远程 Web 更新入口，不提升原生壳版本。正式启用前必须核对 GitHub Release 成功及 Linux 暂存验证，再按 `AGENTS.md` 获取生产切换最终确认。

## 鸿蒙发布状态

- 当前工程的原始 0.3.1 HAP/APP 均为 unsigned；已用发布证书与发布 Profile 对原始 HAP 进行本地交互式签名，生成并核验测试用 signed HAP。尚无可提交应用市场的有效 signed APP。release 构建门禁仍会拒绝未签名交付物。
- 2026-09-18 连接 AppGallery Connect，确认 HarmonyOS APP ID `6917615912834362075`、应用名“记时”、包名 `cn.jishi.todo`；应用记录创建于 2026-09-09，至今状态“未提交”。
- 开发者本人在可见 PowerShell 窗口输入新密钥密码并生成 `.p12` 和 `.csr`。经用户当下确认，华为接受 CSR，`Jishi Harmony Release 2026` 发布证书状态“生效”，有效期至 2029-09-18；已下载 `.cer`。用户再次当下确认创建发布 Profile，华为显示“Profile已添加成功”，状态“生效”，有效期至 2029-09-18；已下载 `.p7b`。四份签名材料仅保存在 Git 忽略的 `work/harmony-signing/`，不在 Git 中；本记录不含密码、私钥或 CSR 内容。
- 在“开放能力管理”确认“代理提醒”原状态为“未申请”。经用户当下确认，根据 `TodoApp.tsx` 和 `ReminderScheduler.ets` 的真实行为填写申请原因，并上传明确标注为源码说明的 `work/harmony-signing/agent-reminder-source-evidence.txt`。申请单号 `461323198976968811` 曾显示“处理中”。随后华为发来“未通过”：要求补充 APP 内用户主动设置倒计时、日历或闹钟提醒的真实功能截图，以及 AppGallery Connect“应用上架 → 应用信息”的分类信息截图。源码说明不能替代功能截图。
- 华为退回时应用分类确实为空。重新登录后已将分类“应用 / 效率”和主标签“日程清单”分别保存，页面均显示“保存成功”；公开客服邮箱 `820288706@qq.com` 也已保存。应用市场图标仍未上传；当前工程 `app_icon.png` 为 1731×909 横幅，与页面要求的 216×216 或 1024×1024 方形图标不符。不能用与安装包不一致的商店图标冒充完成。
- 代理提醒重新申请待真实应用截图与分类截图备齐。能力获批后，需要更新发布 Profile 并重新签包；目前不能宣称提醒在应用关闭后已得到华为授权。
- 用本机 HarmonyOS SDK `hap-sign-tool.jar verify-profile` 核对下载的发布 Profile，结果 `verifiedPassed=true`、`type=release`、包名 `cn.jishi.todo`、APP ID 匹配；`app-privilege-capabilities` 为空。验证输出保存在 Git 忽略目录，不包含在提交或发布包中。由此进一步确认当前 Profile 尚未授予代理提醒能力。
- 用户仅在本机可见窗口输入 P12 密码，未发到聊天或仓库。`hap-sign-tool.jar sign-app` 生成 `outputs/harmony/Jishi-Harmony-0.3.1-signed-test.hap`；独立运行 `verify-app` 显示 `verify codesign success`、`verify permission sign success`、`Verify success`，文件大小 480,210 bytes，SHA-256 `1B1336BD7D9E2A9AA751FC9931D8E9767CF4944C239CC3D0015CC6A041296A28`。首次本机助手脚本在签名和验签后调用 Windows PowerShell 5.1 不可用的 `Get-FileHash`，误记为失败；独立验签和 .NET SHA-256 重算成功，助手脚本已改为 .NET SHA-256。此 HAP 仅能作为真机 UI 测试候选，尚无真机安装验证，且未获代理提醒授权。
- 曾用 SDK `app_packing_tool.jar --mode multiApp` 从上述 signed HAP 试生成 APP；SDK 拆包后其中 HAP 仅 462,550 bytes，`verify-app` 报 `signature not found`，因此该 APP **无效、禁止上传或分发**，已改名为 `outputs/harmony/Jishi-Harmony-0.3.1-signature-stripped.app.invalid` 以避免误传。正式交付前仍应按 DevEco/Hvigor 的签名配置重新构建 signed APP，随后抽取内含 HAP 独立验签；不得把测试 HAP 签名成功当作上架包完成。
- 为隔离打包问题，又将 SDK 生成的 `pack.info` 与逐字节未改动的 signed HAP 放入 APP 容器，得到本地 `outputs/harmony/Jishi-Harmony-0.3.1-signed-candidate.app`（480,977 bytes，SHA-256 `EF8D1CC4B827165711B6490B0103C0810FCCD040265E7CA17F607490400256DE`）。SDK `app_unpacking_tool.jar --mode app` 能解析并拆包，内含 HAP 的 SHA-256 与原 signed HAP 一致，独立 `verify-app` 再次通过。此为**本地候选包**，尚未通过 DevEco 正式 release 构建、华为上传校验或真机验证，也没有代理提醒授权；不得将这些本地检查等同于可上架状态。
- 开发者本人需保管发布私钥和密码；不得发到聊天、Git 或发布资料。签名后还需真实鸿蒙设备验证主备站、登录和后台提醒，以及核对商店所需的隐私政策、账号注销和真实素材。

## 验证与发布结果

- 本地 Web 生产构建通过；`npm run check` 全部通过：Server TypeScript 与 Wrangler dry-run、Server 6/6、Web lint 与 4/4、Windows 7/7、备份加密 1/1、更新契约。
- `npm audit --audit-level=high` 返回 0：无 high/critical，仍有 4 个 moderate，位于开发工具依赖链；未执行会造成破坏性降级的 `--force`。
- 当前变更仅涉及 Web 更新入口、清单、GitHub 发布自动化和文档，未修改 Server API、数据库、原生壳或安装包字节。正式生产切换仍需 Linux 暂存、准确命令展示和最终明确确认。
- Linux 独立暂存目录 `/opt/jishi-stage-b410f25` 从已推送提交检出，`npm ci` 成功。暂存 `npm run check` 通过 Server 6/6、Web 4/4、Windows 7/7、加密备份 1/1、TypeScript、dry-run、lint、构建与更新契约；全新独立 `.stage-d1` 完整迁移 `0000`、`0001`、`0002` 成功，未触碰生产数据库。Linux `npm audit --audit-level=high` 无 high/critical，仍有 4 个 moderate。Linux 清单 SHA-256 `e0d3993ed51c13f8f6fcfbbe63d42c1e8913e1e72e9a094dc5f4befb8dfa223d` 与 Windows 一致，`webBuild` 同为 `1eb33d5ff18eb60d1658b947aff42c57f71231e47bedef1946bd6eb95319acfc`。
- 生产只读检查：API/Web/Nginx 均 active；旧清单哈希为 `b93752517e10a05c1708128b6c482aae7deb40a738b8bdf021106b21922ec433`，生产 Nginx 配置哈希为 `6b78ae9f26c6adb819ff0be45c5a72ee300002baec866baabf59ae8d7e591781`，当前唯一旧备份为 `/var/backups/jishi/pre-02a1aea-20260916-progress-notifications`，磁盘可用约 15 GiB。
- 新生产守卫脚本目标为 `server/deploy/native/releases/deploy-b410f25-20260918.sh`；部署前将完整旧生产版本加密备份到 `/var/backups/jishi/pre-b410f25-20260918-github-update`。自动核验会检查旧接口、无效登录 JSON 401、现有用户签名会话 bootstrap、清单/安装包、服务与旧客户端日志。签名会话不能替代真实密码登录；在用户完成真实账号/设备验收前，新旧两份备份与暂存目录均保留，不执行清理。
- 发布守卫提交 `27f431bd0f5638e068ee58c94559c8f8b4fbad82` 已推送 `origin/main`，对应 GitHub Actions 运行 `35291723344` 成功。暂存目录已快进到该提交；脚本 `bash -n` 通过，`node scripts/publish-github-release.mjs --verify` 从暂存 Linux 环境通过。
- `sudo -n bash /opt/jishi-stage-b410f25/server/deploy/native/releases/deploy-b410f25-20260918.sh --preflight` 只读通过：暂存及旧生产清单哈希、两个安装包、Nginx 原配置、秘密文件存在/权限/所有者/长度、三个服务、更新契约、GitHub 资产及新备份目标均符合预期。此步没有停服务或创建备份。
- 待用户查看后最终明确确认的生产命令：`sudo -n bash /opt/jishi-stage-b410f25/server/deploy/native/releases/deploy-b410f25-20260918.sh`。脚本先停止 API/Web 并创建、解密比较新加密备份，再同步 Web/Server 代码和清单（保留 `.dev.vars`、`.env*`、数据库、媒体与生产 Nginx 配置），按 API、Web、Nginx 顺序启动并核验。短暂停机发生于停止 API/Web 至健康检查恢复；失败则从新备份回滚。实际耗时不能仅凭预检保证。
- 自动探针中的现有账号签名会话不等于真实密码登录。实际账号/设备检查尚未完成，因此生产切换即使自动探针通过，也先保留新旧两份加密备份与暂存目录，不执行清理；真实验收后再按 `AGENTS.md` 枚举核验并只保留最新一份前一版本备份。
- 用户于 2026-09-18 明确确认上述生产命令。再次运行 `--preflight` 通过后，执行 `sudo -n bash /opt/jishi-stage-b410f25/server/deploy/native/releases/deploy-b410f25-20260918.sh`，退出码 0，输出 `deployment=automated-pass`。部署前完整加密备份为 `/var/backups/jishi/pre-b410f25-20260918-github-update/production.tar.aesgcm`（1,427,998,763 bytes），校验文件通过。API/Web 启动期间出现短暂本机连接重试，最终 Nginx 配置测试和公网、JSON 401、签名会话 bootstrap、下载、表结构检查均通过。
- 部署后独立核对：`jishi-api`、`jishi-web`、`nginx` 均 active；公网 `/note/` 与 `/note/health` 返回 200，健康内容为 `{"status":"ok","service":"jishi-api"}`；公网更新清单哈希 `e0d3993ed51c13f8f6fcfbbe63d42c1e8913e1e72e9a094dc5f4befb8dfa223d` 与 Linux 暂存相同，`releaseId` 为 `web-1eb33d5ff18eb60d`，Windows/Android `githubUrl` 均已上线。部署后 10 分钟 API/Web 的 error 级别 journal 无记录。
- 自动签名会话仍不能代替实际用户密码登录或真实设备点选 GitHub 下载。根据发布脚本结果，`real_account_check=pending cleanup=pending`；保留本次和此前两份备份及暂存目录，待真实验收通过再执行保留清理。鸿蒙测试 HAP 已签名且本机验签，正式 APP 构建、真机验收、代理提醒重申请和华为应用市场提交尚未完成。
