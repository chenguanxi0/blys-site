CREATE INDEX IF NOT EXISTS idx_private_messages_conv_time_fast
ON public.private_messages (conversation_id, created_at DESC);

DROP FUNCTION IF EXISTS public.list_private_messages(text, uuid, int, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.list_private_messages(
  p_token text,
  p_conversation_id uuid,
  p_limit int DEFAULT 100,
  p_after timestamptz DEFAULT NULL,
  p_before timestamptz DEFAULT NULL
) RETURNS TABLE(
  id uuid,
  user_email text,
  user_nickname text,
  content text,
  image text,
  reply_to_id uuid,
  reply_to_nickname text,
  reply_to_content text,
  reply_to_image text,
  recalled_at timestamptz,
  created_at timestamptz,
  has_image boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public._blys_can_open_private(p_token, p_conversation_id) THEN
    RETURN;
  END IF;

  p_limit := greatest(1, least(coalesce(p_limit, 100), 100));

  IF p_after IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.sender_email, m.sender_nickname, m.content, NULL::text AS image,
           m.reply_to_id, m.reply_to_nickname, m.reply_to_content,
           CASE WHEN m.reply_to_image IS NOT NULL THEN '[图片]' ELSE NULL END AS reply_to_image,
           m.recalled_at, m.created_at,
           (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.private_messages m
    WHERE m.conversation_id = p_conversation_id
      AND (m.created_at > p_after OR m.recalled_at > p_after)
    ORDER BY m.created_at ASC
    LIMIT p_limit;
  ELSIF p_before IS NOT NULL THEN
    RETURN QUERY
    SELECT m.id, m.sender_email, m.sender_nickname, m.content, NULL::text AS image,
           m.reply_to_id, m.reply_to_nickname, m.reply_to_content,
           CASE WHEN m.reply_to_image IS NOT NULL THEN '[图片]' ELSE NULL END AS reply_to_image,
           m.recalled_at, m.created_at,
           (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.private_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.created_at < p_before
    ORDER BY m.created_at DESC
    LIMIT p_limit;
  ELSE
    RETURN QUERY
    SELECT m.id, m.sender_email, m.sender_nickname, m.content, NULL::text AS image,
           m.reply_to_id, m.reply_to_nickname, m.reply_to_content,
           CASE WHEN m.reply_to_image IS NOT NULL THEN '[图片]' ELSE NULL END AS reply_to_image,
           m.recalled_at, m.created_at,
           (m.recalled_at IS NULL AND m.image IS NOT NULL) AS has_image
    FROM public.private_messages m
    WHERE m.conversation_id = p_conversation_id
    ORDER BY m.created_at DESC
    LIMIT p_limit;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_private_message_image(
  p_token text,
  p_message_id uuid
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_msg record;
BEGIN
  SELECT id, conversation_id, image, recalled_at
    INTO v_msg
  FROM public.private_messages
  WHERE id = p_message_id
  LIMIT 1;

  IF v_msg.id IS NULL OR v_msg.recalled_at IS NOT NULL OR v_msg.image IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '图片不存在');
  END IF;

  IF NOT public._blys_can_open_private(p_token, v_msg.conversation_id) THEN
    RETURN json_build_object('ok', false, 'msg', '无权限');
  END IF;

  RETURN json_build_object('ok', true, 'image', v_msg.image);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_private_messages(text, uuid, int, timestamptz, timestamptz) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_private_message_image(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
