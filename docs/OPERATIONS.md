# 运维与发布

正式站点：`https://awaqwq233.com/note/`，备用站：`https://jishi.awaqwq233.com/`。

## 目录

| 位置 | 用途 |
|---|---|
| `clients/` | Web、Windows、Android、HarmonyOS 源码 |
| `server/` | API、完整数据库迁移链、可复用部署配置 |
| `scripts/` | 构建、版本校验、发布与维护工具 |
| `docs/` | 当前运维说明和最近两代版本记录 |
| `releases/current/` | 当前交付包、清单、SHA-256 |
| `releases/previous/` | 上一代交付包及校验信息 |
| `.local/` | Git 忽略的本机工具、缓存、凭据与签名材料 |

单一根 `package-lock.json` 管理所有 npm workspace；在根目录运行 `npm ci`，不再维护重复子端锁文件。所有构建产物只用于待发布验证，发布槽位不保存未完成或未签名的候选包。

超过 GitHub 单文件限制的 Windows 安装包不重复写入 Git：本机和服务器仍保存两代完整交付包，Git 保存版本、SHA-256 和对应构建运行编号；发布 Actions 获取该次经核验的 Windows 产物，检查完整性后上传稳定 Release。安卓必须沿用旧版签名以支持覆盖安装，不得把未签名候选包当成正式更新。

## 生产目录

代码 `/opt/jishi`；数据库与媒体 `/var/lib/jishi`；公开下载及更新清单 `/var/www/jishi-downloads`；发布暂存 `/opt/jishi-staging`；回退备份 `/var/backups/jishi`。不得清理其他服务目录。

生产服务是 `jishi-api`、`jishi-web`、`nginx`。API 使用单一 Wrangler 实例，Web 使用 Node 静态服务，Nginx 保留生产 HTTPS 与 `/note` 路由。Web 同时处理根路径与 `/note`，API 错误与代理失败返回 JSON。

## 发布和强制更新

1. 完成代码、迁移和原生版本号；运行 Server、Web、Windows 检查，构建并验收对应安装包，审计不得有 high/critical。
2. 新包核验后进入 `releases/current`，原当前包移到 `releases/previous`；只保留两代。生成 Web 稳定哈希、更新清单、SHA-256。清单默认 `required=true`，已安装客户端必须更新；旧 API 和 Cookie 保持兼容。
3. 提交推送代码，公开 GitHub Release 核验包大小、SHA-256 与下载链接。
4. 在 Linux 独立暂存安装依赖、执行完整迁移、构建/测试/审计，复算 Web 哈希；验证 Wrangler、Node Web 启动入口以及完整 systemd 限制组合。
5. 展示准确生产命令、新备份位置、短暂停机与回滚方式，取得本次明确确认后切换。先 API 与迁移、再 Web、最后 Nginx。
6. 检查公网、主备站、JSON 401、真实账号 bootstrap、新表与旧数据、清单、旧客户端状态码。全部成功后再清理旧暂存和旧备份，最终只保留本次创建的上一版本备份。

## 秘密与回退

生产 `server/.dev.vars` 必须存在、为普通文件、服务账号所有、权限 600，`AUTH_SECRET` 长度至少 32；只检查条件，不能输出内容。同步必须排除 `.dev.vars`、`.dev.vars.*`、`.env`、`.env.*`，保留数据库、媒体与更新清单。备份必须覆盖切换前完整生产状态，采用现有服务器密钥加密；密钥不能进入仓库、输出或发布包。

2026-08-16 部署曾删除生产 `.dev.vars`，引起登录 HTTP 500。秘密文件门禁必须在同步前和 API 重启前各检查一次。不得用仓库 Nginx 模板覆盖 Certbot 维护的生产配置。不得在 API 正在运行时用第二个 Wrangler 进程访问 `/var/lib/jishi`。

2026-10-18 离线故障中，API 在 300 MiB 内存限制下占用约 1.9 GB 交换空间，耗尽整机交换空间，内部健康检查与 bootstrap 均超时，服务仍显示 active。验证秘密门禁与全部迁移已执行后，重启现有 API 恢复服务。防护配置使用 `MemorySwapMax=384M` 与 `OOMPolicy=kill`，让达到总内存预算的进程组退出后由既有 `Restart=on-failure` 恢复；暂存需验证实际 cgroup 限制及完整沙箱。此保护限制故障影响，未证明 Wrangler/workerd 长期内存增长的内部原因；若再次触发 OOM 或容量不足，应采集增长证据后调整运行方式或主机容量。持久化配置是否已生效以本次发布记录为准。

## 鸿蒙发布和验收状态

应用名“拾光记事”，包名 `cn.jishi.todo`，APP ID `6917615912834362075`。2026-10-11 创建的新发布证书有效至 2029-10-11；发布 Profile 已授予代理提醒，当前 0.3.6（3000006）正式包已官方 SDK 编译、签名及验签。签名材料和 DPAPI 加密密码仅保存在忽略目录，不能放入 Git 或上架素材。可用 `node scripts/check-harmony-profile.mjs` 查看不含密钥的身份与能力摘要。

即时通知与代理提醒使用 SERVICE_INFORMATION；内容资讯类别默认不展示状态栏图标、横幅或声音，不能用来实现用户要求的任务到时通知。只因任务数据刷新而重建整份队列，会取消正在到时的提醒；应保留未变更的提醒，并将明确关闭提醒与“未来队列为空”分开处理。编译、系统 API 接受或 Windows 构建机通知测试，均不能替代鸿蒙手机通知栏、锁屏及关闭应用后的实测。

目前没有完成鸿蒙真机验收或 0.3.6 商店上传。AGC 页面清单显示登录页，浏览器连接超时；恢复有效登录后选取当前正式包及配套图标、截图。备案由开发者办理，不能伪造资质或更改单机声明绕过审核。

各平台可以独立发布。只更新 Windows 时，使用 `npm run release:manifest -- --keep-android` 继承现有正式 APK；先将原正式清单保留在 `releases/previous/latest.json`。检查会比对留用 APK 的旧版哈希与大小，开发中的安卓源码版本不会被误当作交付版本。Windows 超过 Git 单文件限制时，通过 `releases/current/build.json` 记录经安装验证的构建，GitHub Actions 下载相同产物后校验并发布。

应用市场图标需与应用一致且为合规方形图；现有横幅不能直接替代。正式审核资料和协议需要开发者本人确认。

## API 代理来源保留

Wrangler dev 的 ProxyWorker 会重写与外部 Host 匹配的 URL 类请求头。Nginx 直连 8787 API 时应使用 Host 127.0.0.1:8787，并用 X-Forwarded-Host 保存原站点 Host，保持浏览器 Origin 不变。出现合法子域名登录/注册 JSON 403 时，对比直连 API 与子域名的空登录请求；不能依靠添加内部来源、信任客户端 UA、清空 Origin 或全来源 CORS 放行解决。修改生产 Nginx 必须保留 Certbot 专用段、校验原配置哈希、测试合并候选，并让本次完整备份覆盖修改及回滚。

## 部署状态与清理

部署脚本采用短暂停服的一致性备份，备份解密比对成功后才更新代码。停服阶段旧 Wrangler 进程可能留下 143 退出状态；不能据此判断新 API 启动失败，应核对新一轮启动日志和实际健康响应，不在部署中途自行重复启动 Wrangler。

2026-10-13 生产已发布 web-b426708b717067dc / Windows 0.4.10，Android 正式保留 0.4.7。验收后只保留 /var/backups/jishi/previous-20261013-offline-sync 完整加密回滚备份。备份中的 verification-complete 和 old-data-verification.json 记录服务、主备站、真实账号、旧客户端与旧数据检查；其范围是服务器，明确标记鸿蒙真机尚未验收。

过期独立暂存目录和本次临时下载文件，仅在逐一列出绝对路径、验证其位于项目约定位置、确认服务启动路径不引用它们后删除。公开下载与 releases 仅保留当前和前一候选；前一候选不等同于原生产版本，生产回滚必须用完整部署前备份。
