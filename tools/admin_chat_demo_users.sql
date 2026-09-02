-- 后台模拟群聊发言：固定 5 个会员账号与 5 个普通账号。
-- 账号仅用于前台群聊展示和后台代发，排除在真实会员统计之外。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_demo_account boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS exclude_from_stats boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._blys_is_admin_token(p_token text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 管理后台沿用 admin_login 签发的随机管理令牌；其余后台 RPC 也以此格式校验。
  SELECT length(coalesce(p_token, '')) >= 10;
$$;

CREATE OR REPLACE FUNCTION public._blys_ensure_chat_demo_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (token, email, nickname, vip_started_at, vip_expire, is_demo_account)
  VALUES
    ('demo-vip-01-7fa0b31c', 'demo-vip-01@blys.local', 'Vivi_88', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-02-5e62cd14', 'demo-vip-02@blys.local', 'Mike Trader', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-03-9c13ea65', 'demo-vip-03@blys.local', 'K哥', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-04-2b76d8f9', 'demo-vip-04@blys.local', 'Stock007', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-05-84a1f0ce', 'demo-vip-05@blys.local', 'Momo', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-06-18cb5e2a', 'demo-vip-06@blys.local', 'Aiden', now() - interval '16 days', now() + interval '3650 days', true),
    ('demo-vip-07-6d9af304', 'demo-vip-07@blys.local', '橙子', now() - interval '16 days', now() + interval '3650 days', true),
    ('demo-vip-08-c4e17b96', 'demo-vip-08@blys.local', 'Trader_77', now() - interval '16 days', now() + interval '3650 days', true),
    ('demo-vip-09-2fa83dc1', 'demo-vip-09@blys.local', 'Kevin L', now() - interval '16 days', now() + interval '3650 days', true),
    ('demo-vip-10-b71e4f58', 'demo-vip-10@blys.local', '阿明', now() - interval '16 days', now() + interval '3650 days', true),
    ('demo-public-01-3d60a2f7', 'demo-public-01@blys.local', 'tommy', null, null, true),
    ('demo-public-02-8e74c5b1', 'demo-public-02@blys.local', '小8', null, null, true),
    ('demo-public-03-1af96d30', 'demo-public-03@blys.local', 'Lucky_09', null, null, true),
    ('demo-public-04-6c28be45', 'demo-public-04@blys.local', '陈哥', null, null, true),
    ('demo-public-05-f57a9138', 'demo-public-05@blys.local', 'Nina', null, null, true),
    ('demo-public-06-15fc8a32', 'demo-public-06@blys.local', 'Leo_06', null, null, true),
    ('demo-public-07-8e2ab941', 'demo-public-07@blys.local', '可乐', null, null, true),
    ('demo-public-08-3cf75d60', 'demo-public-08@blys.local', 'MiaX', null, null, true),
    ('demo-public-09-a61e2b85', 'demo-public-09@blys.local', '老周', null, null, true),
    ('demo-public-10-94bd5c37', 'demo-public-10@blys.local', 'Sky-9', null, null, true)
  ON CONFLICT (token) DO UPDATE
    SET nickname = EXCLUDED.nickname,
        vip_started_at = EXCLUDED.vip_started_at,
        vip_expire = EXCLUDED.vip_expire,
        is_demo_account = true,
        exclude_from_stats = true;

  UPDATE public.profiles
     SET exclude_from_stats = true
   WHERE is_demo_account = true;

  UPDATE public.messages m
     SET user_nickname = p.nickname
    FROM public.profiles p
   WHERE p.is_demo_account = true
     AND lower(p.email) = lower(m.user_email)
     AND m.user_nickname IS DISTINCT FROM p.nickname;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_chat_demo_users(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_items jsonb;
BEGIN
  IF NOT public._blys_is_admin_token(p_admin_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  PERFORM public._blys_ensure_chat_demo_users();
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'token', p.token,
    'nickname', p.nickname,
    'type', CASE WHEN public._blys_has_active_vip(p.vip_expire) THEN 'vip' ELSE 'public' END
  ) ORDER BY p.nickname), '[]'::jsonb)
  INTO v_items
  FROM public.profiles p
  WHERE p.is_demo_account = true;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_chat_demo_message(
  p_admin_token text,
  p_user_token text,
  p_content text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.profiles%rowtype;
  v_room text;
  v_message_id uuid;
  v_content text := btrim(coalesce(p_content, ''));
BEGIN
  IF NOT public._blys_is_admin_token(p_admin_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;
  IF v_content = '' OR char_length(v_content) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'msg', '内容需为 1–500 个字符');
  END IF;

  PERFORM public._blys_ensure_chat_demo_users();
  SELECT * INTO v_user FROM public.profiles
   WHERE token = p_user_token AND is_demo_account = true
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请选择预置用户');
  END IF;

  v_room := CASE WHEN public._blys_has_active_vip(v_user.vip_expire) THEN 'vip_chat' ELSE 'public' END;
  INSERT INTO public.messages (room, user_email, user_nickname, content, created_at)
  VALUES (v_room, v_user.email, v_user.nickname, v_content, now())
  RETURNING id INTO v_message_id;

  RETURN jsonb_build_object('ok', true, 'id', v_message_id, 'room', v_room, 'nickname', v_user.nickname);
END;
$$;

-- 演示账号不计入真实用户/会员总数。
CREATE OR REPLACE FUNCTION public.admin_stats(p_admin_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_users int; v_vip int; v_cmts int;
  v_new_users_today int; v_new_users_yesterday int;
  v_new_vip_today int; v_new_vip_yesterday int;
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai';
BEGIN
  IF length(coalesce(p_admin_token, '')) < 10 THEN
    RETURN json_build_object('ok', false, 'msg', '无权限');
  END IF;
  SELECT count(*) INTO v_users FROM public.profiles WHERE NOT coalesce(is_demo_account, false) AND NOT coalesce(exclude_from_stats, false);
  SELECT count(*) INTO v_vip FROM public.profiles
   WHERE vip_expire > now() AND NOT coalesce(is_admin, false) AND NOT coalesce(is_demo_account, false) AND NOT coalesce(exclude_from_stats, false);
  SELECT count(*) INTO v_cmts FROM public.comments;
  SELECT count(*) INTO v_new_users_today FROM public.profiles WHERE created_at >= v_today_start AND NOT coalesce(is_demo_account, false) AND NOT coalesce(exclude_from_stats, false);
  SELECT count(*) INTO v_new_users_yesterday FROM public.profiles WHERE created_at >= v_today_start - interval '1 day' AND created_at < v_today_start AND NOT coalesce(is_demo_account, false) AND NOT coalesce(exclude_from_stats, false);
  SELECT count(DISTINCT lower(e.user_email)) INTO v_new_vip_today FROM public.vip_membership_events e JOIN public.profiles p ON lower(p.email) = lower(e.user_email) WHERE e.event_type = 'new' AND e.occurred_at >= v_today_start AND NOT coalesce(p.is_admin, false) AND NOT coalesce(p.is_demo_account, false) AND NOT coalesce(p.exclude_from_stats, false);
  SELECT count(DISTINCT lower(e.user_email)) INTO v_new_vip_yesterday FROM public.vip_membership_events e JOIN public.profiles p ON lower(p.email) = lower(e.user_email) WHERE e.event_type = 'new' AND e.occurred_at >= v_today_start - interval '1 day' AND e.occurred_at < v_today_start AND NOT coalesce(p.is_admin, false) AND NOT coalesce(p.is_demo_account, false) AND NOT coalesce(p.exclude_from_stats, false);
  RETURN json_build_object('ok', true, 'users', v_users, 'vip', v_vip, 'comments', v_cmts, 'new_users_today', v_new_users_today, 'new_users_yesterday', v_new_users_yesterday, 'new_vip_today', v_new_vip_today, 'new_vip_yesterday', v_new_vip_yesterday);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_list_chat_demo_users(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_chat_demo_message(text, text, text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
