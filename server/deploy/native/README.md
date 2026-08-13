# 原生生产部署与自动更新

生产站点使用 systemd、Nginx 和 `/var/www/jishi-downloads` 提供更新服务，不依赖 Docker。

## 更新工作方式

- Windows 客户端通过 `JishiWindows/<version>` User-Agent 报告版本。
- Android 客户端通过 `JishiAndroid/<version>` User-Agent 报告版本。
- Web 页面启动后、回到前台时及每 5 分钟请求 `/updates/latest.json`。
- 安装包版本较新时显示下载更新弹窗；只有 Web 源码更新时显示刷新弹窗。
- `jishi-web.service` 每次成功启动后执行 `mark-deployment.sh`。脚本按已部署的 Web 源码计算稳定哈希；源码没有变化的普通重启不会重复提示。

人工验收时可访问 `/?client=windows&version=0.3.1` 或 `/?client=android&version=0.3.1` 模拟旧客户端。该参数只影响页面端版本识别，不会修改账号或服务端数据。

## 每次发布

1. 同步修改客户端版本号；Android 的 `versionCode` 必须递增。
2. 运行完整检查并构建 Windows、Android 安装包。
3. 将新安装包复制到仓库根目录，名称必须为：
   - `Jishi-Windows-Setup-<version>.exe`
   - `Jishi-Android-<version>.apk`
4. 生成版本清单：

   ```powershell
   $env:JISHI_RELEASE_NOTES='更新说明一|更新说明二'
   npm run release:manifest
   ```

5. 将清单和两个安装包上传到服务器临时目录，再执行：

   ```bash
   sudo /opt/jishi/server/deploy/native/install-release.sh latest.json Jishi-Windows-Setup-<version>.exe Jishi-Android-<version>.apk
   ```

6. 部署 Web/Server 源码，运行 `npm ci`、`npm run build`，安装本目录的 systemd/Nginx 配置，然后重启 `jishi-api`、`jishi-web` 并重载 Nginx。

## 验证

```bash
curl -fsS https://awaqwq233.com/note/updates/latest.json
curl -I https://awaqwq233.com/note/downloads/Jishi-Windows-Setup-<version>.exe
systemctl is-active jishi-api jishi-web nginx
```

回滚时恢复上一版 `/opt/jishi` 源码和 systemd/Nginx 配置并重启服务。版本化安装包不会相互覆盖，可将 `latest.json` 恢复为上一版清单。
