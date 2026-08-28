-- 私聊图片查看回执：对方实际拉取图片后，发送者可看到“对方已查看图片”。

ALTER TABLE public.private_messages
  ADD COLUMN IF NOT EXISTS image_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS image_seen_by text;

CREATE INDEX IF NOT EXISTS idx_private_messages_image_receipts
  ON public.private_messages(conversation_id, sender_email, created_at DESC)
  WHERE image IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_private_message_image(text, uuid);

CREATE OR REPLACE FUNCTION public.get_private_message_image(
  p_token text,
  p_message_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
  v_msg record;
BEGIN
  SELECT email, nickname, is_admin
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF v_user IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '请先登录');
  END IF;

  SELECT id, conversation_id, sender_email, image, recalled_at, image_seen_at, image_seen_by
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

  IF lower(v_user.email) <> lower(v_msg.sender_email) THEN
    UPDATE public.private_messages
       SET image_seen_at = coalesce(image_seen_at, now()),
           image_seen_by = coalesce(image_seen_by, v_user.email)
     WHERE id = p_message_id
       AND image_seen_at IS NULL;

    SELECT image_seen_at, image_seen_by
      INTO v_msg.image_seen_at, v_msg.image_seen_by
      FROM public.private_messages
     WHERE id = p_message_id;
  END IF;

  RETURN json_build_object(
    'ok', true,
    'image', v_msg.image,
    'image_seen_at', v_msg.image_seen_at,
    'image_seen_by', v_msg.image_seen_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.list_private_image_receipts(
  p_token text,
  p_conversation_id uuid
) RETURNS TABLE(
  id uuid,
  image_seen_at timestamptz,
  image_seen_by text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT email
    INTO v_user
    FROM public.profiles
   WHERE token = p_token
   LIMIT 1;

  IF v_user IS NULL THEN
    RETURN;
  END IF;

  IF NOT public._blys_can_open_private(p_token, p_conversation_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id, m.image_seen_at, m.image_seen_by
    FROM public.private_messages m
   WHERE m.conversation_id = p_conversation_id
     AND lower(m.sender_email) = lower(v_user.email)
     AND m.image IS NOT NULL
     AND m.recalled_at IS NULL
   ORDER BY m.created_at DESC
   LIMIT 80;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_private_message_image(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_private_image_receipts(text, uuid) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
