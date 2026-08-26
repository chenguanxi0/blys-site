// ============================================================
// 白鹿原上-交易笔记 · 聊天室 Web Push 推送
// 部署：Supabase Dashboard → Edge Functions → New function
//       名称填 notify-chat → 粘贴本文件 → Deploy
// Secrets：
//   VAPID_PRIVATE_KEY = Web Push VAPID private key
// 说明：前端发消息成功后调用本函数；函数校验发送者身份，
//       再给同房间其他已订阅用户发送系统通知。
// ============================================================

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";
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

function apiHeaders() {
  return {
    "apikey": SUPABASE_ANON,
    "Authorization": "Bearer " + SUPABASE_ANON,
    "Content-Type": "application/json",
  };
}

async function rpc(fn: string, params: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify(params || {}),
  });
  if (!res.ok) throw new Error(`db ${res.status}`);
  return await res.json();
}

async function dbDeleteEndpoint(endpoint: string) {
  await rpc("delete_push_subscription_by_endpoint", { p_endpoint: endpoint });
}

async function logDelivery(endpoint: string, token: string, room: string, ok: boolean, statusCode = 0, error = "") {
  try {
    await rpc("log_web_push_delivery", {
      p_sender_token: token,
      p_endpoint: endpoint,
      p_room: room,
      p_ok: ok,
      p_status_code: statusCode || null,
      p_error: error || null,
    });
  } catch (_) {
    // Logging must never block notification delivery.
  }
}

function cleanText(text: string, max = 80) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function profileIsVip(profile: Record<string, unknown>) {
  if (profile.is_vip === true) return true;
  const expire = profile.vip_expire ? Date.parse(String(profile.vip_expire)) : 0;
  return Number.isFinite(expire) && expire > Date.now();
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);

  try {
    if (!VAPID_PRIVATE_KEY) {
      return json({ ok: false, msg: "push secrets missing" }, 500);
    }

    const body = await req.json();
    const token = String(body.token || "");
    const room = body.room === "vip" ? "vip" : "public";
    const content = cleanText(String(body.content || ""));
    const hasImage = !!body.image;

    if (!token) return json({ ok: false, msg: "missing token" }, 401);

    const profile = await rpc("get_profile", { p_token: token });
    if (!profile || !profile.ok) return json({ ok: false, msg: "invalid token" }, 401);
    if (room === "vip" && !profileIsVip(profile) && !profile.is_admin) return json({ ok: false, msg: "vip only" }, 403);

    const name = cleanText(profile.nickname || (profile.email ? String(profile.email).split("@")[0] : "群友"), 24);
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

    const targets = await rpc("get_chat_push_targets", { p_token: token, p_room: room });

    webpush.setVapidDetails("mailto:noreply@blys.site", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    let sent = 0;
    let removed = 0;
    await Promise.all(targets.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, payload, { TTL: 120 });
        sent++;
        await logDelivery(sub.endpoint, token, room, true);
      } catch (e) {
        const code = Number((e as { statusCode?: number }).statusCode || 0);
        await logDelivery(sub.endpoint, token, room, false, code, (e as Error).message || String(e));
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
