-- 修复管理员账号接收群聊弹窗的问题。
-- 所有人自己发的消息都不推给自己；管理员作为接收者时按 VIP 目标保留。

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
