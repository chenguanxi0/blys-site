const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";
const APPID = Deno.env.get("GETUI_APPID") || "";
const APPKEY = Deno.env.get("GETUI_APPKEY") || "";
const MASTER = Deno.env.get("GETUI_MASTERSECRET") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });
const headers = () => ({ "apikey": SUPABASE_ANON, "Authorization": "Bearer " + SUPABASE_ANON, "Content-Type": "application/json" });
const clean = (value: unknown, max: number) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
async function rpc(fn: string, params: Record<string, unknown>) { const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: headers(), body: JSON.stringify(params) }); if (!r.ok) throw new Error(`db ${r.status}`); return r.json(); }
async function sha(text: string) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return Array.from(new Uint8Array(h)).map(x => x.toString(16).padStart(2, "0")).join(""); }
async function getToken() { if (!APPID || !APPKEY || !MASTER) throw new Error("getui credentials missing"); const timestamp = String(Date.now()); const r = await fetch(`https://restapi.getui.com/v2/${APPID}/auth`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sign: await sha(APPKEY + timestamp + MASTER), timestamp, appkey: APPKEY }) }); const d = await r.json(); if (!r.ok || !d?.data?.token) throw new Error(`getui auth failed ${r.status}`); return d.data.token; }
async function log(cid: string, token: string, ok: boolean, status = 0, error = "") { try { await rpc("log_native_push_delivery", { p_sender_token: token, p_device_token: cid, p_room: "private", p_ok: ok, p_status_code: status || null, p_error: error || null }); } catch (_) {} }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);
  try {
    const body = await req.json(); const token = String(body.token || ""); const conversationId = String(body.conversation_id || "");
    if (!token || !conversationId) return json({ ok: false, msg: "missing parameters" }, 400);
    const profile = await rpc("get_profile", { p_token: token }); if (!profile?.ok) return json({ ok: false, msg: "invalid token" }, 401);
    const targets = await rpc("get_private_native_push_targets", { p_token: token, p_conversation_id: conversationId });
    const auth = await getToken(); const name = clean(profile.nickname || String(profile.email || "").split("@")[0], 24); const preview = clean(body.content, 80) || (body.image ? "[图片]" : "新消息"); const text = `${name}：${preview}`;
    let sent = 0, failed = 0;
    for (const target of (Array.isArray(targets) ? targets : [])) { const cid = String(target.device_token || ""); if (String(target.platform) !== "getui_android" || !cid) continue; const r = await fetch(`https://restapi.getui.com/v2/${APPID}/push/single/cid`, { method: "POST", headers: { "Content-Type": "application/json", token: auth }, body: JSON.stringify({ request_id: crypto.randomUUID().replaceAll("-", ""), audience: { cid: [cid] }, settings: { ttl: 3600000 }, push_message: { notification: { title: "✉️ 私聊 · 白鹿原上", body: text, click_type: "startapp" } }, push_channel: { android: { ups: { notification: { title: "✉️ 私聊 · 白鹿原上", body: text, content: text, click_type: "startapp", channel_id: "blys_chat_alerts_v4", channel_name: "聊天消息提醒", channel_level: 4 } } } }, extra: { room: "private", url: "/chat.html#private" } }) }); const raw = await r.text(); if (r.ok) { sent++; await log(cid, token, true); } else { failed++; await log(cid, token, false, r.status, raw); } }
    return json({ ok: true, sent, failed });
  } catch (e) { return json({ ok: false, msg: (e as Error).message || "push failed" }, 500); }
});
