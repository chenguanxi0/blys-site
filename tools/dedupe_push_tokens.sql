-- 一次性清理重复推送订阅，并升级 RPC 去重逻辑。

WITH ranked AS (
  SELECT endpoint,
         row_number() OVER (
           PARTITION BY user_token, COALESCE(user_agent, '')
           ORDER BY updated_at DESC, created_at DESC
         ) AS rn
  FROM public.push_subscriptions
)
DELETE FROM public.push_subscriptions ps
USING ranked r
WHERE ps.endpoint = r.endpoint
  AND r.rn > 1;

WITH ranked AS (
  SELECT device_token,
         row_number() OVER (
           PARTITION BY user_token, platform
           ORDER BY updated_at DESC, created_at DESC
         ) AS rn
  FROM public.native_push_tokens
)
DELETE FROM public.native_push_tokens nt
USING ranked r
WHERE nt.device_token = r.device_token
  AND r.rn > 1;

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_token TEXT,
  p_subscription JSONB,
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_endpoint TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE token = p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;

  v_endpoint := p_subscription->>'endpoint';
  IF v_endpoint IS NULL OR length(v_endpoint) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '订阅信息无效');
  END IF;

  DELETE FROM public.push_subscriptions
  WHERE user_token = p_token
    AND COALESCE(user_agent, '') = COALESCE(p_user_agent, '')
    AND endpoint <> v_endpoint;

  INSERT INTO public.push_subscriptions(endpoint, user_token, subscription, user_agent, created_at, updated_at, last_seen_at)
  VALUES (v_endpoint, p_token, p_subscription, p_user_agent, now(), now(), now())
  ON CONFLICT (endpoint) DO UPDATE SET
    user_token = EXCLUDED.user_token,
    subscription = EXCLUDED.subscription,
    user_agent = EXCLUDED.user_agent,
    updated_at = now(),
    last_seen_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_chat_push_targets(
  p_token TEXT,
  p_room TEXT
) RETURNS TABLE(
  endpoint TEXT,
  subscription JSONB
) AS $$
DECLARE
  v_user public.profiles%rowtype;
  v_sender_is_admin boolean := false;
BEGIN
  SELECT * INTO v_user FROM public.profiles WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_sender_is_admin := COALESCE(v_user.is_admin, false)
    OR lower(COALESCE(v_user.email, '')) IN ('491788533@qq.com', '491788533@gmail.com');

  IF p_room = 'vip' AND NOT (
    v_sender_is_admin
    OR (v_user.vip_expire IS NOT NULL AND v_user.vip_expire > now())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ps.user_token, COALESCE(ps.user_agent, '')) ps.endpoint, ps.subscription
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE ps.user_token <> p_token
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR lower(COALESCE(p.email, '')) IN ('491788533@qq.com', '491788533@gmail.com')
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    )
  ORDER BY ps.user_token, COALESCE(ps.user_agent, ''), ps.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.delete_push_subscriptions_for_user(
  p_token TEXT
) RETURNS JSONB AS $$
BEGIN
  DELETE FROM public.push_subscriptions
  WHERE user_token = p_token;

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.save_native_push_token(
  p_token TEXT,
  p_device_token TEXT,
  p_platform TEXT DEFAULT 'android',
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE token = p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;

  IF p_device_token IS NULL OR length(trim(p_device_token)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'msg', 'device token 无效');
  END IF;

  DELETE FROM public.native_push_tokens
  WHERE user_token = p_token
    AND platform = COALESCE(NULLIF(trim(p_platform), ''), 'android')
    AND device_token <> trim(p_device_token);

  INSERT INTO public.native_push_tokens(device_token, user_token, platform, user_agent, created_at, updated_at, last_seen_at)
  VALUES (trim(p_device_token), p_token, COALESCE(NULLIF(trim(p_platform), ''), 'android'), p_user_agent, now(), now(), now())
  ON CONFLICT (device_token) DO UPDATE SET
    user_token = EXCLUDED.user_token,
    platform = EXCLUDED.platform,
    user_agent = EXCLUDED.user_agent,
    updated_at = now(),
    last_seen_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_chat_native_push_targets(
  p_token TEXT,
  p_room TEXT
) RETURNS TABLE(
  device_token TEXT,
  platform TEXT
) AS $$
DECLARE
  v_user public.profiles%rowtype;
  v_sender_is_admin boolean := false;
BEGIN
  SELECT * INTO v_user FROM public.profiles WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_sender_is_admin := COALESCE(v_user.is_admin, false)
    OR lower(COALESCE(v_user.email, '')) IN ('491788533@qq.com', '491788533@gmail.com');

  IF p_room = 'vip' AND NOT (
    v_sender_is_admin
    OR (v_user.vip_expire IS NOT NULL AND v_user.vip_expire > now())
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (npt.user_token, npt.platform) npt.device_token, npt.platform
  FROM public.native_push_tokens npt
  JOIN public.profiles p ON p.token = npt.user_token
  WHERE npt.user_token <> p_token
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR lower(COALESCE(p.email, '')) IN ('491788533@qq.com', '491788533@gmail.com')
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    )
  ORDER BY npt.user_token, npt.platform, npt.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
