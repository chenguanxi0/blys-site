CREATE OR REPLACE FUNCTION public.auto_reply_membership_inquiry(
  p_token text,
  p_conversation_id uuid
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_me record;
  v_conv record;
  v_admin_email text;
  v_admin_nickname text;
  v_user_msg record;
  v_reply_id uuid;
  v_reply_content text := '普通群聊和每日复盘都是免费的，没考虑清楚的建议先在普通群交流，会员群有门槛的，考虑好了再进';
BEGIN
  SELECT email, nickname, is_admin, vip_expire
    INTO v_me
  FROM public.profiles
  WHERE token = p_token;

  IF v_me.email IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '请先登录');
  END IF;

  IF COALESCE(v_me.is_admin, false)
     OR lower(v_me.email) IN ('491788533@qq.com', '491788533@gmail.com')
     OR (v_me.vip_expire IS NOT NULL AND v_me.vip_expire > now()) THEN
    RETURN json_build_object('ok', true, 'skipped', 'not_plain_user');
  END IF;

  SELECT *
    INTO v_conv
  FROM public.private_conversations
  WHERE id = p_conversation_id
    AND lower(user_email) = lower(v_me.email);

  IF v_conv.id IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '会话不存在');
  END IF;

  SELECT email, COALESCE(nickname, '白鹿原上') AS nickname
    INTO v_admin_email, v_admin_nickname
  FROM public.profiles
  WHERE COALESCE(is_admin, false) = true
     OR lower(email) IN ('491788533@qq.com', '491788533@gmail.com')
  ORDER BY
    CASE WHEN lower(email) = '491788533@qq.com' THEN 0 ELSE 1 END,
    created_at ASC
  LIMIT 1;

  IF v_admin_email IS NULL THEN
    v_admin_email := '491788533@qq.com';
    v_admin_nickname := '白鹿原上';
  END IF;

  SELECT id, created_at
    INTO v_user_msg
  FROM public.private_messages
  WHERE conversation_id = p_conversation_id
    AND lower(sender_email) = lower(v_me.email)
    AND content = '开通会员'
    AND created_at > now() - interval '5 minutes'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_user_msg.id IS NULL THEN
    RETURN json_build_object('ok', true, 'skipped', 'no_recent_membership_message');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.private_messages
    WHERE conversation_id = p_conversation_id
      AND lower(sender_email) = lower(v_admin_email)
      AND content = v_reply_content
      AND created_at >= v_user_msg.created_at
  ) THEN
    RETURN json_build_object('ok', true, 'skipped', 'already_replied');
  END IF;

  INSERT INTO public.private_messages(
    conversation_id,
    sender_email,
    sender_nickname,
    recipient_email,
    content,
    image,
    created_at
  ) VALUES (
    p_conversation_id,
    v_admin_email,
    v_admin_nickname,
    v_me.email,
    v_reply_content,
    NULL,
    now()
  )
  RETURNING id INTO v_reply_id;

  UPDATE public.private_conversations
  SET last_message = left(v_reply_content, 120),
      last_message_at = now(),
      updated_at = now(),
      user_unread = user_unread + 1
  WHERE id = p_conversation_id;

  RETURN json_build_object(
    'ok', true,
    'id', v_reply_id,
    'message', json_build_object(
      'id', v_reply_id,
      'user_email', v_admin_email,
      'user_nickname', v_admin_nickname,
      'sender_email', v_admin_email,
      'sender_nickname', v_admin_nickname,
      'recipient_email', v_me.email,
      'content', v_reply_content,
      'image', NULL,
      'created_at', now()
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_reply_membership_inquiry(text, uuid) TO anon, authenticated;
