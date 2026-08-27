// 白鹿原上-交易笔记 · 新评论管理员通知

import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";
const VAPID_PUBLIC_KEY = "BA2xT4Y1plL6c9JNmBJI8aqp_vjxrnOG1-p-nhazGbm_QGnnuq8A7hbYbBIpZKd3MQ3-jx0EfXZGnKYQQuFHFac";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const GETUI_APPID = Deno.env.get("GETUI_APPID") || "";
const GETUI_APPKEY = Deno.env.get("GETUI_APPKEY") || "";
const GETUI_MASTERSECRET = Deno.env.get("GETUI_MASTERSECRET") || "";

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

function cleanText(text: string, max = 90) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function articleTitle(article: string) {
  if (article.startsWith("review:")) return `每日复盘 ${article.slice(7)}`;
  if (article === "market-overview") return "短线核心·市场大局观";
  if (article === "trading-mindset") return "交易中必备的四种心态";
  return article || "文章";
}

function commentUrl(article: string) {
  if (article.startsWith("review:")) return `/assets/reviews/${article.slice(7)}.html#comments`;
  if (article === "market-overview" || article === "trading-mindset") return `/tutorials/${article}.html#comments`;
  return "/daily.html";
}

async function dbDeleteEndpoint(endpoint: string) {
  await rpc("delete_push_subscription_by_endpoint", { p_endpoint: endpoint });
}

async function logDelivery(commentId: number, target: string, channel: string, ok: boolean, statusCode = 0, error = "") {
  try {
    await rpc("log_comment_push_delivery", {
      p_comment_id: commentId,
      p_target: target,
      p_channel: channel,
      p_ok: ok,
      p_status_code: statusCode || null,
      p_error: error || null,
    });
  } catch (_) {
    // Logging must never block notification delivery.
  }
}

async function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getGetuiToken() {
  if (!GETUI_APPID || !GETUI_APPKEY || !GETUI_MASTERSECRET) return "";
  const timestamp = String(Date.now());
  const sign = await sha256Hex(GETUI_APPKEY + timestamp + GETUI_MASTERSECRET);
  const res = await fetch(`https://restapi.getui.com/v2/${GETUI_APPID}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sign, timestamp, appkey: GETUI_APPKEY }),
  });
  const data = await res.json().catch(() => ({}));
  return res.ok && data && data.data && data.data.token ? String(data.data.token) : "";
}

function requestId() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function sendGetuiCid(token: string, cid: string, title: string, body: string, url: string) {
  const res = await fetch(`https://restapi.getui.com/v2/${GETUI_APPID}/push/single/cid`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "token": token },
    body: JSON.stringify({
      request_id: requestId(),
      audience: { cid: [cid] },
      settings: { ttl: 3600000 },
      push_message: { notification: { title, body, click_type: "startapp" } },
      push_channel: {
        android: {
          ups: {
            notification: {
              title,
              body,
              content: body,
              click_type: "startapp",
              channel_id: "blys_chat_alerts_v4",
              channel_name: "消息提醒",
              channel_level: 4,
            },
          },
        },
      },
      extra: { url, type: "comment" },
    }),
  });
  if (res.ok) return { ok: true, status: res.status, text: "" };
  return { ok: false, status: res.status, text: await res.text() };
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);

  try {
    const body = await req.json();
    const commentId = Number(body.comment_id || 0);
    if (!commentId) return json({ ok: false, msg: "missing comment_id" }, 400);

    const detail = await rpc("get_comment_notification_detail", { p_comment_id: commentId });
    if (!detail || !detail.ok || !detail.comment) return json({ ok: false, msg: "comment not found" }, 404);

    const c = detail.comment;
    const title = "有新评论";
    const bodyText = `${cleanText(c.nickname || c.email || "用户", 24)} 评论了 ${articleTitle(String(c.article || ""))}：${cleanText(c.content || "")}`;
    const url = commentUrl(String(c.article || ""));

    let webSent = 0;
    let webRemoved = 0;
    if (VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails("mailto:noreply@blys.site", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const targets = await rpc("get_admin_comment_web_push_targets", {});
      await Promise.all((Array.isArray(targets) ? targets : []).map(async (sub) => {
        try {
          await webpush.sendNotification(sub.subscription, JSON.stringify({
            title,
            body: bodyText,
            icon: "/assets/favicon.png",
            badge: "/assets/favicon.png",
            tag: "blys-comment-admin",
            url,
          }), { TTL: 300 });
          webSent++;
          await logDelivery(commentId, sub.endpoint, "web", true);
        } catch (e) {
          const code = Number((e as { statusCode?: number }).statusCode || 0);
          await logDelivery(commentId, sub.endpoint, "web", false, code, (e as Error).message || String(e));
          if (code === 404 || code === 410) {
            webRemoved++;
            await dbDeleteEndpoint(sub.endpoint);
          }
        }
      }));
    }

    let nativeSent = 0;
    const getuiToken = await getGetuiToken();
    if (getuiToken) {
      const nativeTargets = await rpc("get_admin_comment_native_push_targets", {});
      await Promise.all((Array.isArray(nativeTargets) ? nativeTargets : []).map(async (target) => {
        const cid = String(target.device_token || "");
        if (!cid) return;
        const result = await sendGetuiCid(getuiToken, cid, title, bodyText, url);
        if (result.ok) nativeSent++;
        await logDelivery(commentId, cid, "native", result.ok, result.status, result.text);
      }));
    }

    return json({ ok: true, webSent, webRemoved, nativeSent });
  } catch (e) {
    return json({ ok: false, msg: (e as Error).message || "notify comment failed" }, 500);
  }
}

Deno.serve(handler);
