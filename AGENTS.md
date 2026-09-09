# 记时（Jishi）项目 AI 工作约束

本文件对整个仓库生效。任何新 AI 会话在分析、修改、创建、打包或部署前都必须先完整阅读本文件和全局技能 `C:\Users\82028\.codex\skills\jishi-release-guard\SKILL.md`，并在首次进度说明中确认已读取。除定位和读取这两个文件外，不得先执行其他项目命令；技能缺失时先恢复技能，发布或部署工作不得绕过此门禁。

## 项目与生产环境

- 项目是 Web、Windows Electron、Android Capacitor 和 Cloudflare Worker/D1 风格 Server 共用的多端应用。
- 正式入口为 `https://awaqwq233.com/note/`；应用必须同时正确处理 `/note` 子路径和配置中的备用站点。
- 生产代码位于 `/opt/jishi`，数据库持久化目录为 `/var/lib/jishi`，更新清单位于 `/var/www/jishi-downloads/latest.json`。
- systemd 服务为 `jishi-api`、`jishi-web`，入口代理为 `nginx`。
- SSH 前置机、后端机和账号信息可从用户授权的会话或既有部署记录获取；禁止把密码、私钥、Cookie 或密钥写入仓库、文档、脚本或输出。

## 旧客户端兼容要求

- 必须兼容仍可能安装在用户设备上的 Windows/Android 0.4.x 客户端，当前至少覆盖 0.4.3、0.4.4，以及已有 Service Worker 缓存的 Web/PWA。
- Windows/Android 客户端主要加载远程 Web 页面，因此 Server/Web 更新不能假定用户已经重装客户端。
- 不得删除或重命名旧 API 路径、请求字段、响应字段、Cookie 名称、登录流程、`/note` 基路径或备用站点行为。
- 新 API 字段必须采用可忽略的增量方式；旧字段继续返回。新数据库结构使用新的编号迁移，禁止修改已执行的迁移。
- API 错误必须返回 JSON 和准确状态码。客户端出现“操作没有完成，请稍后重试”时，优先检查对应请求是否返回了 HTML 500/502 或空响应。
- 每次 Server/Web 更新后，都要从 Nginx 日志检查 `JishiWindows/0.4.4` 等旧客户端 User-Agent 是否出现新增的 4xx/5xx。

## 版本与更新规则

- 每次完成的功能或修复都必须形成只包含本次任务文件的 Git 提交。若仓库配置了 Git remote，则必须推送对应提交；当前仓库未配置 Git remote 时，不得声称已完成 Git 推送，并将“推送到远端”落实为经用户最终确认后的生产 SSH 部署。
- 每次更新在测试和 Linux 暂存验证通过后都应部署到生产远端，不得只停留在本地。生产部署仍必须遵守下方的准确命令展示和最终明确确认门禁。
- 只修改远程 Web/Server 时，可以维持 Windows/Android 安装包版本，但必须重新生成并发布 Web `releaseId`/`webBuild`，让已安装客户端刷新。
- 修改 Electron/Capacitor 原生壳、主机解析、离线页或本地权限时，必须提升对应客户端版本和构建号，重建安装包，并同步所有版本标记、文件名、SHA256、大小和更新清单。
- 发布前运行 `npm run check:updates`，确认更新清单、安装包、客户端标记和主机配置一致。
- Web `webBuild` 必须使用跨平台稳定算法计算；文本文件在哈希前统一为 LF。发布前必须在 Windows 工作区和 Linux 暂存目录分别重算并得到相同结果。
- 不得用新安装包强迫解决本可由向后兼容 Server/Web 修复的问题。

## 生产秘密文件：强制规则

- `/opt/jishi/server/.dev.vars` 是生产运行必需文件，包含 `AUTH_SECRET`。它被 Git 忽略，不会出现在发布包中。
- 使用 `rsync --delete` 或任何镜像同步时，必须显式排除并保留：

  ```text
  .dev.vars
  .dev.vars.*
  .env
  .env.*
  ```

  已提交的 `.env.example`、`.env.selfhost.example` 等示例文件可以正常更新。
- API 重启前必须只检查以下条件，不得输出文件内容或密钥值：文件存在、不是符号链接、所有者为服务账号、权限为 600、`AUTH_SECRET` 非空且长度符合要求。
- 同步还必须保留 `/var/lib/jishi`、上传媒体、`/var/www/jishi-downloads/latest.json` 以及其他生产专用运行数据。
- 2026-08-16 曾因部署同步删除 `.dev.vars`，导致所有新登录请求返回 HTTP 500。任何后续部署都必须包含防复发检查。

## 修改与测试门禁

- 保留用户现有改动；只暂存任务相关文件，禁止 `git add .`、`git add -A` 和破坏性 Git 命令。
- Server：至少运行 TypeScript 检查、Wrangler dry-run，并在全新数据库执行完整迁移链。
- Web：至少运行 lint、生产构建和自动测试。
- Windows：运行主机解析/兼容测试；涉及原生壳时构建并冒烟测试安装包。
- Android：涉及原生壳时构建 APK，验证远程主站、备用站和离线错误页。
- 运行 `npm audit --audit-level=high`；高危或严重问题不得发布。
- 对登录、bootstrap、待办旧接口和新模块接口做契约检查；无效登录必须返回 JSON 401，绝不能返回 HTML 500。
- `jishi-api` 运行时禁止再启动 `wrangler d1 execute --local --persist-to /var/lib/jishi` 等第二个 Wrangler 进程访问同一持久化目录；在线只读核验使用 SQLite 只读连接，写入/迁移操作必须由 systemd 的单一 API 实例执行或先停服务。
- 修改 systemd 沙箱时，暂存启动测试必须覆盖完整的生产限制组合，不能只测试其中几项。Node/Wrangler 的网卡枚举需要 `AF_NETLINK`，限制地址族时必须保留，否则会报 `uv_interface_addresses ... error 97`。同时验证 API/Web 实际启动和 HTTP 健康检查。

## 生产部署流程

1. 从干净提交生成发布内容，先在服务器独立暂存目录完成 Linux 依赖安装、迁移、Server dry-run、Web lint/构建/测试。
   - `npm ci` 使用 workspace 提升依赖时，必须验证 systemd 单元引用的 `/opt/jishi/node_modules/.bin/wrangler` 和 `/opt/jishi/node_modules/.bin/vinext` 在暂存目录对应位置真实存在且可执行，不能只依赖 `npm run` 的 PATH。
2. 部署前只读检查生产服务、磁盘、目标路径、符号链接、秘密文件和数据库状态。
3. 备份 `/opt/jishi`、`/var/lib/jishi`、更新清单和生产秘密配置；记录可恢复的绝对路径。新备份必须代表本次部署前的完整生产版本。
4. 向用户列出将执行的准确生产命令、备份、短暂停机和回滚行为，并取得最终明确确认。
5. 停止服务后同步时保护所有秘密文件和运行数据；启动 API 前再次执行秘密文件门禁。
6. 先启动 API 并应用迁移，再启动 Web，最后验证并重载 Nginx。失败时使用部署前备份回滚。
   - 普通 Web/Server 发布不得用仓库模板覆盖生产 `/etc/nginx/sites-available/jishi`。生产文件包含 Certbot 管理的 HTTPS 回源段；只有任务明确修改 Nginx 时，才可在合并生产专用段、备份、比较哈希并通过 `nginx -t` 后替换。
7. 部署后必须验证：

   - `jishi-api`、`jishi-web`、`nginx` 为 `active`；
   - 内部 API/Web 健康检查成功；
   - 公网主页和 `/note/health` 返回 HTTP 200；
   - 无效登录返回 JSON 401；已有账号能登录并读取 bootstrap；
   - 新迁移表实际存在，旧数据仍在；
   - 公网更新清单与实际 Web 源码哈希一致；
   - 0.4.3/0.4.4 客户端请求没有新增异常状态码。
8. 在 `word/*.md` 记录用户要求、修复内容、测试、提交、备份位置、部署和验证结果。
9. 仅在新版本部署成功且第 7 步全部验证通过后执行备份保留清理：枚举并逐一验证 `/var/backups/jishi` 下的候选目录，确认无符号链接/重解析点，只保留本次部署刚创建的一个“前一版本”备份，删除更早备份。部署失败、回滚中或新备份不可验证时禁止清理。
10. 成功验证后删除本次产生的过期远端暂存包、解压目录和明确可重建的构建残留；删除前必须列出准确绝对路径并验证都位于约定暂存目录。不得删除当前代码、唯一回滚备份、数据库、媒体、秘密文件、更新清单或仍在发布的安装包。

## 故障处理

- 生产故障先只读收集证据，不先重启或覆盖现场。
- 从 Nginx 状态码定位具体接口，再用 `jishi-api` 日志查原始堆栈；不要只依据客户端兜底文字猜测。
- 将故障与最近提交/部署对照，并比较生产文件和部署前备份，但不得输出秘密内容。
- 得到授权后实施最小恢复，直接复测原失败契约，并把防复发规则补充到本文件和部署脚本。
