-- 多设备 Web Push 修复：保留同一账号的所有浏览器订阅，避免相同 Chrome UA 互相覆盖。

CREATE OR REPLACE FUNCTION public.save_push_subscription(
  p_token TEXT,
  p_subscription JSONB,
  p_user_agent TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_endpoint TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE token = p_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;
  v_endpoint := p_subscription->>'endpoint';
  IF v_endpoint IS NULL OR length(v_endpoint) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '订阅信息无效');
  END IF;
  INSERT INTO public.push_subscriptions(endpoint, user_token, subscription, user_agent, created_at, updated_at, last_seen_at)
  VALUES (v_endpoint, p_token, p_subscription, p_user_agent, now(), now(), now())
  ON CONFLICT (endpoint) DO UPDATE SET
    user_token = EXCLUDED.user_token,
    subscription = EXCLUDED.subscription,
    user_agent = EXCLUDED.user_agent,
    updated_at = now(), last_seen_at = now();
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_push_targets(p_token text, p_room text)
RETURNS TABLE(endpoint text, subscription jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sender record; v_room text := lower(btrim(coalesce(p_room, 'public')));
BEGIN
  SELECT email, vip_expire, is_admin INTO v_sender FROM public.profiles WHERE token = p_token LIMIT 1;
  IF NOT FOUND OR v_room NOT IN ('public','vip','vip_chat') THEN RETURN; END IF;
  IF v_room = 'vip' AND NOT public._blys_is_admin_identity(v_sender.email, v_sender.is_admin) THEN RETURN; END IF;
  IF v_room = 'vip_chat' AND NOT (public._blys_is_admin_identity(v_sender.email, v_sender.is_admin) OR public._blys_has_active_vip(v_sender.vip_expire)) THEN RETURN; END IF;
  RETURN QUERY
  SELECT ps.endpoint, ps.subscription
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE ps.user_token <> p_token AND (
    (v_room='public' AND (public._blys_is_admin_identity(p.email,p.is_admin) OR NOT public._blys_has_active_vip(p.vip_expire))) OR
    (v_room='vip' AND (public._blys_is_admin_identity(p.email,p.is_admin) OR public._blys_has_active_vip(p.vip_expire))) OR
    (v_room='vip_chat' AND public._blys_is_admin_identity(p.email,p.is_admin))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, jsonb, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_push_targets(text, text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
