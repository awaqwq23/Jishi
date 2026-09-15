# Android 客户端

通过 `JISHI_WEB_URL` 配置服务地址。执行 `npm install`、首次执行 `npx cap add android`，之后 `npm run build` 生成 APK。

0.4.7 会把未来 366 天内最早 300 条待办和定期任务提醒保存到本机 AlarmManager；应用退到后台、退出或设备重启后仍可触发。Android 13 及以上开启提醒时会请求系统通知权限，Android 12 及以上还会进入“闹钟和提醒”授权页；未授予精确定时权限时会明确提示系统可能延后通知。

客户端更新交给 Android DownloadManager 持久下载。系统通知栏和应用内更新弹窗都会显示进度；应用打开时弹窗额外显示实时速度与剩余时间，关闭应用不会清除系统下载。下载完成后按清单 SHA-256 校验，损坏文件不会保留。
