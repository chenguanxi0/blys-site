-- 聊天图片按需加载优化
-- 在 Supabase SQL Editor 执行一次。
--
-- 作用：
-- 1. list_messages 不再返回 base64 大图，只返回 has_image 标记，会员群首屏/历史加载会轻很多。
-- 2. 新增 get_chat_message_image，用户点击图片占位时才拉取原图。
-- 3. 保留会员群权限：非会员不能通过图片接口偷看会员群图片。

CREATE INDEX IF NOT EXISTS idx_profiles_token_fast
  ON public.profiles(token);

CREATE INDEX IF NOT EXISTS idx_messages_room_created_at_fast
  ON public.messages(room, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_room_recalled_at_fast
  ON public.messages(room, recalled_at DESC)
  WHERE recalled_at IS NOT NULL;

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
  created_at TIMESTAMPTZ,
  has_image BOOLEAN
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

    IF NOT FOUND OR (
      COALESCE(v_user.is_admin, false) IS NOT TRUE
      AND (v_user.vip_expire IS NULL OR v_user.vip_expire <= now())
    ) THEN
      RETURN;
    END IF;
  END IF;

  IF p_after IS NOT NULL THEN
    RETURN QUERY
    SELECT q.id, q.user_email, q.user_nickname, q.content, q.image,
           q.reply_to_id, q.reply_to_nickname, q.reply_to_content, q.reply_to_image,
           q.recalled_at, q.created_at, q.has_image
    FROM (
      SELECT
        m.id, m.user_email, m.user_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
        NULL::TEXT AS image,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
        CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::TEXT ELSE NULL::TEXT END AS reply_to_image,
        m.recalled_at,
        m.created_at,
        (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
      FROM public.messages m
      WHERE m.room = p_room AND m.created_at > p_after

      UNION

      SELECT
        m.id, m.user_email, m.user_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
        NULL::TEXT AS image,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
        CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
        CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::TEXT ELSE NULL::TEXT END AS reply_to_image,
        m.recalled_at,
        m.created_at,
        (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
      FROM public.messages m
      WHERE m.room = p_room AND m.recalled_at > p_after
    ) q
    ORDER BY q.created_at ASC
    LIMIT v_limit;
  ELSIF p_before IS NOT NULL THEN
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
      NULL::TEXT AS image,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
      CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::TEXT ELSE NULL::TEXT END AS reply_to_image,
      m.recalled_at,
      m.created_at,
      (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.messages m
    WHERE m.room = p_room AND m.created_at < p_before
    ORDER BY m.created_at DESC
    LIMIT v_limit;
  ELSE
    RETURN QUERY SELECT
      m.id, m.user_email, m.user_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.content ELSE NULL END AS content,
      NULL::TEXT AS image,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_id ELSE NULL END AS reply_to_id,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_nickname ELSE NULL END AS reply_to_nickname,
      CASE WHEN m.recalled_at IS NULL THEN m.reply_to_content ELSE NULL END AS reply_to_content,
      CASE WHEN m.recalled_at IS NULL AND m.reply_to_image IS NOT NULL THEN '[图片]'::TEXT ELSE NULL::TEXT END AS reply_to_image,
      m.recalled_at,
      m.created_at,
      (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.messages m
    WHERE m.room = p_room
    ORDER BY m.created_at DESC
    LIMIT v_limit;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP FUNCTION IF EXISTS public.get_chat_message_image(TEXT, UUID);

CREATE OR REPLACE FUNCTION public.get_chat_message_image(
  p_token TEXT,
  p_message_id UUID
) RETURNS JSONB AS $$
DECLARE
  v_user RECORD;
  v_msg RECORD;
BEGIN
  SELECT email, vip_expire, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'msg', '请先登录');
  END IF;

  SELECT id, room, image, recalled_at
    INTO v_msg
    FROM public.messages
   WHERE id = p_message_id
   LIMIT 1;

  IF NOT FOUND OR v_msg.recalled_at IS NOT NULL OR v_msg.image IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'msg', '图片不存在');
  END IF;

  IF v_msg.room = 'vip'
     AND COALESCE(v_user.is_admin, false) IS NOT TRUE
     AND (v_user.vip_expire IS NULL OR v_user.vip_expire <= now()) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '会员专属图片');
  END IF;

  RETURN jsonb_build_object('ok', true, 'image', v_msg.image);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_messages(TEXT, INTEGER, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_chat_message_image(TEXT, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
