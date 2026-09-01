-- 后台模拟群聊发言：固定 5 个会员账号与 5 个普通账号。
-- 账号仅用于前台群聊展示和后台代发，排除在真实会员统计之外。

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_demo_account boolean NOT NULL DEFAULT false;

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
    ('demo-vip-01-7fa0b31c', 'demo-vip-01@blys.local', '沐言', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-02-5e62cd14', 'demo-vip-02@blys.local', '若川', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-03-9c13ea65', 'demo-vip-03@blys.local', '星野', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-04-2b76d8f9', 'demo-vip-04@blys.local', '南栀', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-vip-05-84a1f0ce', 'demo-vip-05@blys.local', '予安', now() - interval '20 days', now() + interval '3650 days', true),
    ('demo-public-01-3d60a2f7', 'demo-public-01@blys.local', '林默', null, null, true),
    ('demo-public-02-8e74c5b1', 'demo-public-02@blys.local', '陈川', null, null, true),
    ('demo-public-03-1af96d30', 'demo-public-03@blys.local', '宋宁', null, null, true),
    ('demo-public-04-6c28be45', 'demo-public-04@blys.local', '顾言', null, null, true),
    ('demo-public-05-f57a9138', 'demo-public-05@blys.local', '周末', null, null, true)
  ON CONFLICT (token) DO UPDATE
    SET nickname = EXCLUDED.nickname,
        vip_started_at = EXCLUDED.vip_started_at,
        vip_expire = EXCLUDED.vip_expire,
        is_demo_account = true;
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
DECLARE v_users int; v_vip int; v_cmts int;
BEGIN
  IF length(coalesce(p_admin_token, '')) < 10 THEN
    RETURN json_build_object('ok', false, 'msg', '无权限');
  END IF;
  SELECT count(*) INTO v_users FROM public.profiles WHERE NOT coalesce(is_demo_account, false);
  SELECT count(*) INTO v_vip FROM public.profiles
   WHERE vip_expire > now() AND NOT coalesce(is_admin, false) AND NOT coalesce(is_demo_account, false);
  SELECT count(*) INTO v_cmts FROM public.comments;
  RETURN json_build_object('ok', true, 'users', v_users, 'vip', v_vip, 'comments', v_cmts);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_list_chat_demo_users(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_chat_demo_message(text, text, text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
