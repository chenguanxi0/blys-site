-- App 原生推送：同一账号同一平台只保留最新 token，避免一台/多台手机重复弹同一消息。

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
BEGIN
  SELECT * INTO v_user FROM public.profiles WHERE token = p_token;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_room = 'vip' AND NOT (COALESCE(v_user.is_admin, false) OR (v_user.vip_expire IS NOT NULL AND v_user.vip_expire > now())) THEN
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
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    )
  ORDER BY npt.user_token, npt.platform, npt.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
