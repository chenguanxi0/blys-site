-- 管理员私聊列表加载优化
-- 在 Supabase SQL Editor 执行一次。
--
-- 作用：
-- 1. list_private_conversations 支持 p_limit / p_offset。
-- 2. 管理员默认只返回最近有聊天记录的会话，避免空会话拖慢。
-- 3. 未读会话始终优先保留，不会因为分页漏掉提醒。

CREATE INDEX IF NOT EXISTS idx_private_conversations_last_message_at_fast
  ON public.private_conversations(last_message_at DESC NULLS LAST);

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT oid::regprocedure AS sig FROM pg_proc WHERE proname = 'list_private_conversations'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.list_private_conversations(
  p_token TEXT,
  p_limit INTEGER DEFAULT 10,
  p_offset INTEGER DEFAULT 0
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me RECORD;
  v_list JSON;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
BEGIN
  SELECT email, nickname, is_admin
    INTO v_me
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF v_me IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '请先登录');
  END IF;

  IF COALESCE(v_me.is_admin, false) = true
     OR lower(v_me.email) IN ('491788533@qq.com', '491788533@gmail.com') THEN
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      INTO v_list
      FROM (
        SELECT id, user_email, user_nickname, last_message, last_message_at,
               admin_unread, user_unread, updated_at
          FROM public.private_conversations
         WHERE last_message_at IS NOT NULL
            OR COALESCE(admin_unread, 0) > 0
            OR COALESCE(user_unread, 0) > 0
         ORDER BY
           CASE WHEN COALESCE(admin_unread, 0) > 0 THEN 0 ELSE 1 END,
           COALESCE(last_message_at, updated_at, created_at) DESC
         LIMIT v_limit
        OFFSET v_offset
      ) t;
  ELSE
    PERFORM public.get_private_conversation(p_token, NULL);
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      INTO v_list
      FROM (
        SELECT id, user_email, user_nickname, last_message, last_message_at,
               admin_unread, user_unread, updated_at
          FROM public.private_conversations
         WHERE lower(user_email) = lower(v_me.email)
         LIMIT 1
      ) t;
  END IF;

  RETURN json_build_object('ok', true, 'list', v_list, 'limit', v_limit, 'offset', v_offset);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_private_conversations(TEXT, INTEGER, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
