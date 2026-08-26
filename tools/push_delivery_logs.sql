-- 推送发送日志：不暴露 endpoint/device token，只记录目标账号和发送结果，便于排查单个账号收不到弹窗。

CREATE TABLE IF NOT EXISTS public.push_delivery_logs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT NOT NULL,
  function_name TEXT NOT NULL,
  room TEXT,
  sender_email TEXT,
  target_email TEXT,
  ok BOOLEAN NOT NULL DEFAULT false,
  status_code INT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_delivery_logs_created_at
  ON public.push_delivery_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_push_delivery_logs_target_email_created_at
  ON public.push_delivery_logs(lower(target_email), created_at DESC);

ALTER TABLE public.push_delivery_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_delivery_logs_no_direct_read ON public.push_delivery_logs;
CREATE POLICY push_delivery_logs_no_direct_read
  ON public.push_delivery_logs
  FOR SELECT
  USING (false);

CREATE OR REPLACE FUNCTION public.log_web_push_delivery(
  p_sender_token TEXT,
  p_endpoint TEXT,
  p_room TEXT,
  p_ok BOOLEAN,
  p_status_code INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_sender_email TEXT;
  v_target_email TEXT;
BEGIN
  SELECT email INTO v_sender_email
  FROM public.profiles
  WHERE token = p_sender_token;

  SELECT p.email INTO v_target_email
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE ps.endpoint = p_endpoint
  LIMIT 1;

  INSERT INTO public.push_delivery_logs(channel, function_name, room, sender_email, target_email, ok, status_code, error)
  VALUES ('web', 'notify-chat', p_room, v_sender_email, v_target_email, COALESCE(p_ok, false), p_status_code, left(COALESCE(p_error, ''), 500));

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.log_native_push_delivery(
  p_sender_token TEXT,
  p_device_token TEXT,
  p_room TEXT,
  p_ok BOOLEAN,
  p_status_code INT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_sender_email TEXT;
  v_target_email TEXT;
BEGIN
  SELECT email INTO v_sender_email
  FROM public.profiles
  WHERE token = p_sender_token;

  SELECT p.email INTO v_target_email
  FROM public.native_push_tokens nt
  JOIN public.profiles p ON p.token = nt.user_token
  WHERE nt.device_token = p_device_token
  LIMIT 1;

  INSERT INTO public.push_delivery_logs(channel, function_name, room, sender_email, target_email, ok, status_code, error)
  VALUES ('native', 'notify-native-chat', p_room, v_sender_email, v_target_email, COALESCE(p_ok, false), p_status_code, left(COALESCE(p_error, ''), 500));

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.log_web_push_delivery(TEXT, TEXT, TEXT, BOOLEAN, INT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_native_push_delivery(TEXT, TEXT, TEXT, BOOLEAN, INT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
