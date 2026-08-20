# 白鹿原上 Android App 搭建说明

## 1. 安装依赖

在 `web/` 目录执行：

```bash
npm install
npm run build:app
npx cap add android
```

## 2. 安装 Android Studio

- 安装 Android Studio
- 安装 Android SDK / Platform Tools
- 首次打开项目时让 Gradle 自动同步

## 3. 接入 Firebase Cloud Messaging

1. 创建 Firebase Android 应用：`site.blys.app`
2. 下载 `google-services.json`
3. 放到：`android/app/google-services.json`
4. 在 Android Studio 中确认 Firebase Messaging 依赖已启用

## 4. 数据库

在 Supabase SQL Editor 执行：

`web/tools/native_push_upgrade.sql`

作用：保存 Android 设备的 FCM token，并提供聊天推送目标 RPC。

## 5. 前端原生推送接入

- `assets/mobile-app.js` 负责在 Capacitor Android App 中注册原生推送
- 聊天页登录后会把设备 token 保存到 `native_push_tokens`

## 6. 后端发推送

下一步需要新增一个发送 FCM 的 Edge Function，替代浏览器 Web Push。

## 7. 常用命令

```bash
npm run cap:sync
npm run cap:open
```
