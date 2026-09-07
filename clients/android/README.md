# Android 客户端

通过 `JISHI_WEB_URL` 配置服务地址。执行 `npm install`、首次执行 `npx cap add android`，之后 `npm run build` 生成 APK。

0.4.6 会把未来 21 天、最多 300 条待办和定期任务提醒保存到本机 AlarmManager；应用退到后台或设备重启后仍可触发。Android 13 及以上首次开启提醒时会请求系统通知权限。
