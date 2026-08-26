// ============================================================
// 白鹿原上-交易笔记 · Android App 原生推送（个推 / Getui）
// 部署：Supabase Dashboard -> Edge Functions -> notify-native-chat
// Secrets：
//   GETUI_APPID        = 个推应用 AppId
//   GETUI_APPKEY       = 个推应用 AppKey
//   GETUI_MASTERSECRET = 个推应用 MasterSecret
// 说明：前端发消息成功后调用本函数；函数校验发送者身份，
//       再给同房间其他 Android App 设备发系统通知。
// ============================================================

const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";
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

function cleanText(text: string, max = 80) {
  return (text || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function profileIsVip(profile: Record<string, unknown>) {
  if (profile.is_vip === true) return true;
  const expire = profile.vip_expire ? Date.parse(String(profile.vip_expire)) : 0;
  return Number.isFinite(expire) && expire > Date.now();
}

function requireGetuiConfig() {
  if (!GETUI_APPID || !GETUI_APPKEY || !GETUI_MASTERSECRET) {
    throw new Error("getui credentials missing");
  }
}

async function sha256Hex(text: string) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getGetuiToken() {
  requireGetuiConfig();
  const timestamp = String(Date.now());
  const sign = await sha256Hex(GETUI_APPKEY + timestamp + GETUI_MASTERSECRET);
  const res = await fetch(`https://restapi.getui.com/v2/${GETUI_APPID}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sign,
      timestamp,
      appkey: GETUI_APPKEY,
    }),
  });
  const data = await res.json().catch(() => ({}));
  const token = data && data.data && data.data.token ? String(data.data.token) : "";
  if (!res.ok || !token) throw new Error(`getui auth failed ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return token;
}

function requestId() {
  return crypto.randomUUID().replaceAll("-", "");
}

async function postGetuiPush(token: string, requestBody: Record<string, unknown>) {
  const res = await fetch(`https://restapi.getui.com/v2/${GETUI_APPID}/push/single/cid`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "token": token,
    },
    body: JSON.stringify(requestBody),
  });

  if (res.ok) return { ok: true };

  const text = await res.text();
  return { ok: false, status: res.status, text };
}

async function sendGetuiCid(token: string, cid: string, title: string, body: string, room: string) {
  const transmitBody = {
    request_id: requestId(),
    audience: {
      cid: [cid],
    },
    settings: {
      ttl: 3600000,
    },
    push_message: {
      notification: {
        title,
        body,
        click_type: "startapp",
      },
    },
    push_channel: {
      android: {
        ups: {
          notification: {
            title,
            body,
            content: body,
            click_type: "startapp",
            channel_id: "blys_chat_alerts_v4",
            channel_name: "聊天消息提醒",
            channel_level: 4,
          },
        },
      },
    },
    extra: {
      room,
      url: `/chat.html?room=${room}`,
    },
  };

  return await postGetuiPush(token, transmitBody);
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);

  try {
    requireGetuiConfig();
    const body = await req.json();
    const token = String(body.token || "");
    const room = body.room === "vip" ? "vip" : "public";
    const content = cleanText(String(body.content || ""));
    const hasImage = !!body.image;

    if (!token) return json({ ok: false, msg: "missing token" }, 401);

    const profile = await rpc("get_profile", { p_token: token });
    if (!profile || !profile.ok) return json({ ok: false, msg: "invalid token" }, 401);
    if (room === "vip" && !profileIsVip(profile) && !profile.is_admin) return json({ ok: false, msg: "vip only" }, 403);

    const getuiToken = await getGetuiToken();
    const name = cleanText(profile.nickname || (profile.email ? String(profile.email).split("@")[0] : "群友"), 24);
    const preview = content || (hasImage ? "[图片]" : "新消息");
    const title = room === "vip" ? "会员群聊有新消息" : "注册用户群聊有新消息";
    const messageBody = `${name}：${preview}`;
    const targets = await rpc("get_chat_native_push_targets", { p_token: token, p_room: room });

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const target of targets) {
      const platform = String(target.platform || "");
      const cid = String(target.device_token || "");
      if (platform !== "getui_android") {
        skipped++;
        continue;
      }
      const result = await sendGetuiCid(getuiToken, cid, title, messageBody, room);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        const raw = result.text || "";
        if (errors.length < 5) errors.push(`${result.status || 0}:${raw.slice(0, 160)}`);
      }
    }

    return json({ ok: true, sent, skipped, failed, errors });
  } catch (e) {
    return json({ ok: false, msg: (e as Error).message || "native push failed" }, 500);
  }
}

Deno.serve(handler);
