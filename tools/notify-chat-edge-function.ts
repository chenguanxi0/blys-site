// ============================================================
// 白鹿原上-交易笔记 · 聊天室 Web Push 推送
// 部署：Supabase Dashboard → Edge Functions → New function
//       名称填 notify-chat → 粘贴本文件 → Deploy
// Secrets：
//   SUPABASE_SERVICE_ROLE_KEY = Supabase service_role key
//   VAPID_PRIVATE_KEY = Web Push VAPID private key
// 说明：前端发消息成功后调用本函数；函数校验发送者身份，
//       再给同房间其他已订阅用户发送系统通知。
// ============================================================

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC_KEY = "BA2xT4Y1plL6c9JNmBJI8aqp_vjxrnOG1-p-nhazGbm_QGnnuq8A7hbYbBIpZKd3MQ3-jx0EfXZGnKYQQuFHFac";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function dbHeaders() {
  return {
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
  };
}

async function dbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: dbHeaders(),
  });
  if (!res.ok) throw new Error(`db ${res.status}`);
  return await res.json();
}

async function dbDeleteEndpoint(endpoint: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
    headers: dbHeaders(),
  });
}

function cleanText(text: string, max = 80) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);

  try {
    if (!SUPABASE_SERVICE_ROLE_KEY || !VAPID_PRIVATE_KEY) {
      return json({ ok: false, msg: "push secrets missing" }, 500);
    }

    const body = await req.json();
    const token = String(body.token || "");
    const room = body.room === "vip" ? "vip" : "public";
    const content = cleanText(String(body.content || ""));
    const hasImage = !!body.image;

    if (!token) return json({ ok: false, msg: "missing token" }, 401);

    const senders = await dbGet(`profiles?select=token,email,nickname,vip_expire&token=eq.${encodeURIComponent(token)}&limit=1`);
    const sender = Array.isArray(senders) ? senders[0] : null;
    if (!sender) return json({ ok: false, msg: "invalid token" }, 401);
    if (room === "vip") {
      const expire = sender.vip_expire ? new Date(sender.vip_expire).getTime() : 0;
      if (!expire || expire <= Date.now()) return json({ ok: false, msg: "vip only" }, 403);
    }

    const name = cleanText(sender.nickname || (sender.email ? String(sender.email).split("@")[0] : "群友"), 24);
    const preview = content || (hasImage ? "[图片]" : "新消息");
    const title = room === "vip" ? "会员群聊有新消息" : "注册用户群聊有新消息";
    const payload = JSON.stringify({
      title,
      body: `${name}：${preview}`,
      icon: "/assets/favicon.png",
      badge: "/assets/favicon.png",
      tag: `blys-chat-${room}`,
      url: `/chat.html?room=${room}`,
    });

    const subs = await dbGet(`push_subscriptions?select=endpoint,user_token,subscription&user_token=neq.${encodeURIComponent(token)}&limit=1000`);
    let targets = Array.isArray(subs) ? subs : [];

    if (room === "vip" && targets.length) {
      const tokens = Array.from(new Set(targets.map((s) => s.user_token).filter(Boolean)));
      const tokenList = tokens.map((t) => `"${String(t).replace(/"/g, '\\"')}"`).join(",");
      const vipProfiles = await dbGet(`profiles?select=token,vip_expire&token=in.(${tokenList})`);
      const vipSet = new Set(
        (Array.isArray(vipProfiles) ? vipProfiles : [])
          .filter((p) => p.vip_expire && new Date(p.vip_expire).getTime() > Date.now())
          .map((p) => p.token),
      );
      targets = targets.filter((s) => vipSet.has(s.user_token));
    }

    webpush.setVapidDetails("mailto:noreply@blys.site", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    let sent = 0;
    let removed = 0;
    await Promise.all(targets.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, payload, { TTL: 120 });
        sent++;
      } catch (e) {
        const code = Number((e as { statusCode?: number }).statusCode || 0);
        if (code === 404 || code === 410) {
          removed++;
          await dbDeleteEndpoint(sub.endpoint);
        }
      }
    }));

    return json({ ok: true, sent, removed });
  } catch (e) {
    return json({ ok: false, msg: (e as Error).message || "push failed" }, 500);
  }
}

Deno.serve(handler);
