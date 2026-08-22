# 记时 · 多端项目

项目已按“服务器端 / 用户端”完全拆分，每一端都可以独立安装依赖、修改和打包。

```text
每日记录/
├─ server/             独立 API、数据库迁移、图片存储与 Linux 部署
├─ clients/
│  ├─ web/             Web / PWA 客户端
│  ├─ windows/         Windows Electron 客户端
│  ├─ android/         Android Capacitor 客户端
│  └─ harmony/         HarmonyOS ArkTS 客户端
├─ Jishi-*.exe/.apk    当前版本客户端安装包
├─ INSTALL-PACKAGES-SHA256.txt  当前版安装包校验文件
├─ docker-compose.yml  1GB Linux 一键部署
└─ package.json        总控脚本
```

## 开发

```bash
npm install
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

当前版本客户端安装包放在仓库根目录；对应的
`INSTALL-PACKAGES-SHA256.txt` 可用于检查下载完整性。旧版本发布包不保留在源码仓库中。

> Windows 安装程序目前未做商业代码签名；Android APK 使用标准调试证书签名。HarmonyOS 真机安装包必须使用开发者自己的华为证书，因此仓库不会保存签名凭据。

## Linux 服务器

Docker 方案参考 [server/deploy/selfhost/README.md](server/deploy/selfhost/README.md)。1GB Linux 推荐使用 `server/deploy/native/` 中的原生 systemd + Nginx 配置，减少容器常驻开销。
