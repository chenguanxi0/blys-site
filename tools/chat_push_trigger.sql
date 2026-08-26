-- 群聊消息入库后由数据库统一触发推送，避免依赖发送者页面 JS。

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trigger_chat_push_after_insert()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_token TEXT;
  v_body JSONB;
  v_headers JSONB;
BEGIN
  IF NEW.room NOT IN ('public', 'vip') THEN
    RETURN NEW;
  END IF;

  SELECT token INTO v_sender_token
  FROM public.profiles
  WHERE lower(email) = lower(NEW.user_email)
  LIMIT 1;

  IF v_sender_token IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := jsonb_build_object(
    'token', v_sender_token,
    'room', NEW.room,
    'content', COALESCE(NEW.content, ''),
    'image', NEW.image IS NOT NULL
  );

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', 'sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV',
    'Authorization', 'Bearer sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV'
  );

  PERFORM net.http_post(
    url := 'https://ojioiglffglyuellvcex.supabase.co/functions/v1/notify-chat',
    headers := v_headers,
    body := v_body,
    timeout_milliseconds := 5000
  );

  PERFORM net.http_post(
    url := 'https://ojioiglffglyuellvcex.supabase.co/functions/v1/notify-native-chat',
    headers := v_headers,
    body := v_body,
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_chat_push_after_insert ON public.messages;
CREATE TRIGGER trg_chat_push_after_insert
AFTER INSERT ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.trigger_chat_push_after_insert();

NOTIFY pgrst, 'reload schema';
