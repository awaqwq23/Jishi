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

- 当前工程仍只有 unsigned 0.3.1 HAP/APP，没有可用于上架的发布 `.p12`、`.cer`、`.p7b` 组合；本仓库的 release 构建门禁会拒绝未签名交付物。
- 多次尝试连接用户已登录的华为开发者浏览器页面（含重置、按 URL 选浏览器和打开页面）均未取得可交互的页面，主要错误为 `nodeRepl.fetch request failed`。用户确认发布签名材料尚未创建。无法查看账号内应用、证书、Profile、代理提醒权限或资料状态；没有上传、提交审核或声称上架。
- 开发者本人需保管发布私钥和密码；不得发到聊天、Git 或发布资料。签名后还需真实鸿蒙设备验证主备站、登录和后台提醒，以及核对商店所需的隐私政策、账号注销和真实素材。

## 验证与发布结果

- 本地 Web 生产构建通过；`npm run check` 全部通过：Server TypeScript 与 Wrangler dry-run、Server 6/6、Web lint 与 4/4、Windows 7/7、备份加密 1/1、更新契约。
- `npm audit --audit-level=high` 返回 0：无 high/critical，仍有 4 个 moderate，位于开发工具依赖链；未执行会造成破坏性降级的 `--force`。
- 当前变更仅涉及 Web 更新入口、清单、GitHub 发布自动化和文档，未修改 Server API、数据库、原生壳或安装包字节。正式生产切换仍需 Linux 暂存、准确命令展示和最终明确确认。
- Linux 独立暂存目录 `/opt/jishi-stage-b410f25` 从已推送提交检出，`npm ci` 成功。暂存 `npm run check` 通过 Server 6/6、Web 4/4、Windows 7/7、加密备份 1/1、TypeScript、dry-run、lint、构建与更新契约；全新独立 `.stage-d1` 完整迁移 `0000`、`0001`、`0002` 成功，未触碰生产数据库。Linux `npm audit --audit-level=high` 无 high/critical，仍有 4 个 moderate。Linux 清单 SHA-256 `e0d3993ed51c13f8f6fcfbbe63d42c1e8913e1e72e9a094dc5f4befb8dfa223d` 与 Windows 一致，`webBuild` 同为 `1eb33d5ff18eb60d1658b947aff42c57f71231e47bedef1946bd6eb95319acfc`。
- 生产只读检查：API/Web/Nginx 均 active；旧清单哈希为 `b93752517e10a05c1708128b6c482aae7deb40a738b8bdf021106b21922ec433`，生产 Nginx 配置哈希为 `6b78ae9f26c6adb819ff0be45c5a72ee300002baec866baabf59ae8d7e591781`，当前唯一旧备份为 `/var/backups/jishi/pre-02a1aea-20260916-progress-notifications`，磁盘可用约 15 GiB。
- 新生产守卫脚本目标为 `server/deploy/native/releases/deploy-b410f25-20260918.sh`；部署前将完整旧生产版本加密备份到 `/var/backups/jishi/pre-b410f25-20260918-github-update`。自动核验会检查旧接口、无效登录 JSON 401、现有用户签名会话 bootstrap、清单/安装包、服务与旧客户端日志。签名会话不能替代真实密码登录；在用户完成真实账号/设备验收前，新旧两份备份与暂存目录均保留，不执行清理。
- 待补充发布守卫提交号、Linux `--preflight` 结果、准确生产命令和最终确认、部署与真实账号验收。未通过的环节不得写为完成。
