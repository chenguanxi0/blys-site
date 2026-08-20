# 聊天室 Web Push 部署说明

## 1. 执行 SQL

在 Supabase SQL Editor 执行：

```text
web/tools/push_upgrade.sql
```

作用：创建 `push_subscriptions` 表，以及前端保存/删除订阅用的 RPC。

## 2. 添加 Edge Function Secrets

在 Supabase Project Settings -> Edge Functions -> Secrets 添加：

```text
SUPABASE_SERVICE_ROLE_KEY = 你的 Supabase service_role key
VAPID_PRIVATE_KEY = Web Push VAPID private key
```

注意：`VAPID_PRIVATE_KEY` 只能放在 Supabase Secret，不要写进前端或提交到 GitHub。

## 3. 部署 Edge Function

新建 Supabase Edge Function：

```text
名称：notify-chat
源码：web/tools/notify-chat-edge-function.ts
```

部署后，前端会在用户发消息成功时调用：

```text
/functions/v1/notify-chat
```

## 4. 前端行为

- 用户登录后点击聊天室里的“开启提醒”
- 支持 Web Push 的浏览器会弹通知授权，并保存订阅
- 不支持 Web Push 的浏览器会退回页内提醒
- 发消息成功后，`notify-chat` 会给同房间其他订阅用户推送系统通知
