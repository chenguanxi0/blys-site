// blys.site 的同域 Supabase 中转。
// 国内用户只访问 blys.site；Worker 再从 Cloudflare 网络请求 Supabase，
// 避免浏览器直连 *.supabase.co 因网络线路波动而误判为未登录。

const SUPABASE_ORIGIN = "https://ojioiglffglyuellvcex.supabase.co";
const API_PREFIX = "/api/supabase";
const ALLOWED_PREFIXES = ["/rest/v1/rpc/", "/functions/v1/"];

function isAllowedPath(pathname) {
  return ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ ok: false, msg: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function proxySupabase(request, url) {
  const upstreamPath = url.pathname.slice(API_PREFIX.length) || "/";
  if (!isAllowedPath(upstreamPath)) {
    return jsonError("unsupported api path", 404);
  }

  const upstreamUrl = new URL(SUPABASE_ORIGIN + upstreamPath);
  upstreamUrl.search = url.search;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("cf-connecting-ip");
  headers.delete("x-forwarded-for");
  headers.set("x-blys-proxy", "1");

  try {
    const init = {
      method: request.method,
      headers,
      redirect: "follow",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      init.duplex = "half";
    }
    const upstream = await fetch(upstreamUrl, init);
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("cache-control", "no-store");
    responseHeaders.set("x-content-type-options", "nosniff");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return jsonError("upstream service temporarily unavailable", 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === API_PREFIX || url.pathname.startsWith(API_PREFIX + "/")) {
      return proxySupabase(request, url);
    }
    return env.ASSETS.fetch(request);
  },
};
