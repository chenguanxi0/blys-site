-- Android App 原生推送令牌
-- 执行位置：Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.native_push_tokens (
  device_token TEXT PRIMARY KEY,
  user_token TEXT NOT NULL REFERENCES public.profiles(token) ON DELETE CASCADE,
  platform TEXT NOT NULL DEFAULT 'android',
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_native_push_tokens_user_token
  ON public.native_push_tokens(user_token);

ALTER TABLE public.native_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS native_push_tokens_no_direct_read ON public.native_push_tokens;
CREATE POLICY native_push_tokens_no_direct_read
  ON public.native_push_tokens
  FOR SELECT
  USING (false);

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

CREATE OR REPLACE FUNCTION public.delete_native_push_token(
  p_token TEXT,
  p_device_token TEXT
) RETURNS JSONB AS $$
BEGIN
  DELETE FROM public.native_push_tokens
  WHERE user_token = p_token AND device_token = p_device_token;

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
  SELECT npt.device_token, npt.platform
  FROM public.native_push_tokens npt
  JOIN public.profiles p ON p.token = npt.user_token
  WHERE npt.user_token <> p_token
    AND (
      p_room <> 'vip'
      OR COALESCE(p.is_admin, false)
      OR (p.vip_expire IS NOT NULL AND p.vip_expire > now())
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
