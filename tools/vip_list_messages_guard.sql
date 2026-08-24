-- VIP 群读取权限修复：会员群 list_messages 必须带有效会员 token
-- 在 Supabase SQL Editor 执行一次。
-- 作用：public 群仍可正常读取；vip 群只有未过期会员或管理员可以读取。

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'list_messages'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.list_messages(
  p_room TEXT,
  p_limit INTEGER DEFAULT 100,
  p_after TIMESTAMPTZ DEFAULT NULL,
  p_before TIMESTAMPTZ DEFAULT NULL,
  p_token TEXT DEFAULT NULL
) RETURNS TABLE(
  id UUID,
  user_email TEXT,
  user_nickname TEXT,
  content TEXT,
  image TEXT,
  reply_to_id UUID,
  reply_to_nickname TEXT,
  reply_to_content TEXT,
  reply_to_image TEXT,
  recalled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
DECLARE
  v_user RECORD;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100);
BEGIN
  p_room := COALESCE(NULLIF(trim(p_room), ''), 'public');

  IF p_room NOT IN ('public', 'vip') THEN
    RETURN;
  END IF;

  IF p_room = 'vip' THEN
    SELECT email, vip_expire, is_admin
      INTO v_user
      FROM public.profiles
     WHERE token = p_token
     LIMIT 1;

    IF NOT FOUND OR (COALESCE(v_user.is_admin, false) IS NOT TRUE AND (v_user.vip_expire IS NULL OR v_user.vip_expire <= now())) THEN
      RETURN;
    END IF;
  END IF;

  IF p_after IS NOT NULL THEN
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname, m.content, m.image,
      m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
      m.recalled_at, m.created_at
    FROM public.messages m
    WHERE m.room = p_room AND (m.created_at > p_after OR m.recalled_at > p_after)
    ORDER BY m.created_at ASC;
  ELSIF p_before IS NOT NULL THEN
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname, m.content, m.image,
      m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
      m.recalled_at, m.created_at
    FROM public.messages m
    WHERE m.room = p_room AND m.created_at < p_before
    ORDER BY m.created_at DESC
    LIMIT v_limit;
  ELSE
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname, m.content, m.image,
      m.reply_to_id, m.reply_to_nickname, m.reply_to_content, m.reply_to_image,
      m.recalled_at, m.created_at
    FROM public.messages m
    WHERE m.room = p_room
    ORDER BY m.created_at DESC
    LIMIT v_limit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_messages(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
