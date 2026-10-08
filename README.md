# 记时 · 多端项目

四端源码、API、运维说明和交付物分开存放。依赖统一使用根目录的锁文件。

```text
每日记录/
├─ server/             独立 API、数据库迁移、图片存储与 Linux 部署
├─ clients/
│  ├─ web/             Web / PWA 客户端
│  ├─ windows/         Windows Electron 客户端
│  ├─ android/         Android Capacitor 客户端
│  └─ harmony/         HarmonyOS ArkTS 客户端
├─ releases/current/   当前正式安装包、清单与 SHA-256
├─ releases/previous/  上一代回退安装包与 SHA-256
├─ docs/               运维说明与最近两代版本记录
├─ scripts/            可复用的校验、发布和清理工具
├─ .local/             忽略的本机工具、缓存和私密配置
├─ docker-compose.yml  1GB Linux 一键部署
└─ package.json        总控脚本
```

## 开发

```bash
npm ci
npm run dev:server
npm run dev:web
```

Web 客户端通过 `clients/web/.env.local` 的 `NEXT_PUBLIC_API_URL` 连接独立服务器。Windows、Android、HarmonyOS 客户端各自目录内都有服务地址配置和说明。

多用户登录采用邮箱和密码，密码只以 PBKDF2-SHA256 加盐哈希保存，会话 Cookie 为 HttpOnly。生产部署必须配置 HTTPS 和随机 `AUTH_SECRET`。

## 打包产物

- Web：部署压缩包（PWA 可从浏览器安装）
- Windows：NSIS `.exe` 安装程序
- Android：可直接安装的调试签名 `.apk`
- HarmonyOS：`.hap`；必须由华为 DevEco/HarmonyOS SDK 编译和签名
- Server：Linux Docker 部署压缩包

正式交付物只保留 `releases/current` 和 `releases/previous` 两代。各目录的 `SHA256SUMS` 用于检查下载完整性。未完成的构建放入 `.local/build`，不冒充正式版本。

运行 `npm run clean:local` 预览可删除目录；确认用途后用 `npm run clean:local -- -Apply` 清理可重建残留。清理工具核验两代交付包的校验和，拒绝越界路径和链接。

发布与服务器清理流程见 [运维说明](docs/OPERATIONS.md)，当前完成状态见 [版本记录](docs/RELEASES.md)。

> Windows 安装程序目前未做商业代码签名；Android APK 使用标准调试证书签名。HarmonyOS 真机安装包必须使用开发者自己的华为证书，因此仓库不会保存签名凭据。

## Linux 服务器

Docker 方案参考 [server/deploy/selfhost/README.md](server/deploy/selfhost/README.md)。1GB Linux 推荐使用 `server/deploy/native/` 中的原生 systemd + Nginx 配置，减少容器常驻开销。
