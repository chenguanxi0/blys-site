// ============================================================
// 白鹿原上-交易笔记 · Android App 原生推送（FCM）
// 部署：Supabase Dashboard -> Edge Functions -> New function
//       名称填 notify-native-chat -> 粘贴本文件 -> Deploy
// Secrets：
//   FIREBASE_SERVICE_ACCOUNT_JSON = Firebase service account 整段 JSON
//   FIREBASE_PROJECT_ID           = Firebase project id（可选，JSON 里有时可省）
// 说明：前端发消息成功后调用本函数；函数校验发送者身份，
//       再给同房间其他 Android App 设备发系统通知。
// ============================================================

import { JWT } from "npm:google-auth-library@9.15.1";

const SUPABASE_URL = "https://ojioiglffglyuellvcex.supabase.co";
const SUPABASE_ANON = "sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV";
const FIREBASE_SERVICE_ACCOUNT_JSON = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON") || "";
const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID") || "";

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

function loadServiceAccount() {
  if (!FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("firebase service account missing");
  const account = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
  const projectId = FIREBASE_PROJECT_ID || account.project_id || "";
  if (!account.client_email || !account.private_key || !projectId) {
    throw new Error("firebase credentials incomplete");
  }
  return { account, projectId };
}

async function getAccessToken(clientEmail: string, privateKey: string) {
  const jwt = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
  });
  const token = await jwt.getAccessToken();
  if (!token) throw new Error("firebase access token missing");
  return token;
}

async function sendToDevice(projectId: string, accessToken: string, deviceToken: string, title: string, body: string, room: string) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title, body },
        data: {
          url: `/chat.html?room=${room}`,
          room,
        },
        android: {
          priority: "high",
          notification: {
            channel_id: "chat_messages",
            click_action: "FCM_PLUGIN_ACTIVITY",
            sound: "default",
          },
        },
      },
    }),
  });

  if (res.ok) return { ok: true };

  const text = await res.text();
  return { ok: false, status: res.status, text };
}

async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, msg: "method not allowed" }, 405);

  try {
    const { account, projectId } = loadServiceAccount();
    const body = await req.json();
    const token = String(body.token || "");
    const room = body.room === "vip" ? "vip" : "public";
    const content = cleanText(String(body.content || ""));
    const hasImage = !!body.image;

    if (!token) return json({ ok: false, msg: "missing token" }, 401);

    const profile = await rpc("get_profile", { p_token: token });
    if (!profile || !profile.ok) return json({ ok: false, msg: "invalid token" }, 401);
    if (room === "vip" && !profile.is_vip && !profile.is_admin) return json({ ok: false, msg: "vip only" }, 403);

    const accessToken = await getAccessToken(account.client_email, account.private_key);
    const name = cleanText(profile.nickname || (profile.email ? String(profile.email).split("@")[0] : "群友"), 24);
    const preview = content || (hasImage ? "[图片]" : "新消息");
    const title = room === "vip" ? "会员群聊有新消息" : "注册用户群聊有新消息";
    const messageBody = `${name}：${preview}`;
    const targets = await rpc("get_chat_native_push_targets", { p_token: token, p_room: room });

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const target of targets) {
      const result = await sendToDevice(projectId, accessToken, String(target.device_token || ""), title, messageBody, room);
      if (result.ok) {
        sent++;
      } else {
        failed++;
        const raw = result.text || "";
        if (errors.length < 5) errors.push(`${result.status || 0}:${raw.slice(0, 160)}`);
      }
    }

    return json({ ok: true, sent, failed, errors });
  } catch (e) {
    return json({ ok: false, msg: (e as Error).message || "native push failed" }, 500);
  }
}

Deno.serve(handler);
