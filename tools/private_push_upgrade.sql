-- 私聊 Web Push：仅向当前私聊的另一方发送。
CREATE OR REPLACE FUNCTION public.get_private_push_targets(
  p_token text,
  p_conversation_id uuid
) RETURNS TABLE(endpoint text, subscription jsonb)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender record;
  v_conversation record;
  v_is_admin boolean := false;
  v_recipient_email text;
BEGIN
  SELECT email, is_admin INTO v_sender
  FROM public.profiles WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO v_conversation
  FROM public.private_conversations WHERE id = p_conversation_id LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  v_is_admin := public._blys_is_admin_identity(v_sender.email, v_sender.is_admin);
  IF NOT v_is_admin AND lower(v_sender.email) <> lower(v_conversation.user_email) THEN RETURN; END IF;

  v_recipient_email := CASE WHEN v_is_admin THEN v_conversation.user_email ELSE public._blys_admin_email() END;
  RETURN QUERY
  SELECT ps.endpoint, ps.subscription
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE lower(p.email) = lower(v_recipient_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_private_push_targets(text, uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
