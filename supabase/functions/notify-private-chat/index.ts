import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";
const VAPID_PUBLIC_KEY = "BA2xT4Y1plL6c9JNmBJI8aqp_vjxrnOG1-p-nhazGbm_QGnnuq8A7hbYbBIpZKd3MQ3-jx0EfXZGnKYQQuFHFac";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } }); }
function headers() { return { "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON, "Content-Type": "application/json" }; }
function clean(value: unknown, max: number) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }

async function rpc(fn: string, params: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(), body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`db ${res.status}`);
  return await res.json();
}

async function logDelivery(endpoint: string, token: string, ok: boolean, statusCode = 0, error = "") {
  try {
    await rpc("log_web_push_delivery", {
      p_sender_token: token,
      p_endpoint: endpoint,
      p_room: "private",
      p_ok: ok,
      p_status_code: statusCode || null,
      p_error: error || null,
    });
  } catch (_) {}
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);
  if (!VAPID_PRIVATE_KEY) return json({ ok: false, msg: "push secrets missing" }, 500);
  try {
    const body = await req.json();
    const token = String(body.token || "");
    const conversationId = String(body.conversation_id || "");
    if (!token || !conversationId) return json({ ok: false, msg: "missing parameters" }, 400);
    const profile = await rpc("get_profile", { p_token: token });
    if (!profile?.ok) return json({ ok: false, msg: "invalid token" }, 401);
    const targets = await rpc("get_private_push_targets", { p_token: token, p_conversation_id: conversationId });
    const name = clean(profile.nickname || String(profile.email || "").split("@")[0] || "对方", 24);
    const preview = clean(body.content, 80) || (body.image ? "[图片]" : "新消息");
    const payload = JSON.stringify({ title: "✉️ 私聊 · 白鹿原上", body: `${name}：${preview}`, icon: "/assets/favicon.png", badge: "/assets/favicon.png", tag: `blys-private-${conversationId}`, url: "/chat.html#private" });
    webpush.setVapidDetails("mailto:noreply@blys.site", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    let sent = 0, removed = 0;
    await Promise.all((Array.isArray(targets) ? targets : []).map(async (sub: { endpoint: string; subscription: PushSubscriptionJSON }) => {
      try {
        await webpush.sendNotification(sub.subscription, payload, { TTL: 120 });
        sent++;
        await logDelivery(sub.endpoint, token, true);
      } catch (e) {
        const code = Number((e as { statusCode?: number }).statusCode || 0);
        await logDelivery(sub.endpoint, token, false, code, (e as Error).message || String(e));
        if (code === 404 || code === 410) {
          removed++;
          await rpc("delete_push_subscription_by_endpoint", { p_endpoint: sub.endpoint });
        }
      }
    }));
    return json({ ok: true, sent, removed });
  } catch (e) { return json({ ok: false, msg: (e as Error).message || "push failed" }, 500); }
});
