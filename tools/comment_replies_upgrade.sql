-- 评论回复功能：给 comments 增加父评论，并兼容旧评论接口。

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS parent_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'comments_parent_id_fkey'
       AND conrelid = 'public.comments'::regclass
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_parent_id_fkey
      FOREIGN KEY (parent_id)
      REFERENCES public.comments(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comments_article_parent_created
  ON public.comments(article, parent_id, created_at);

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DROP FUNCTION IF EXISTS public.add_comment(text, text, text);
DROP FUNCTION IF EXISTS public.add_comment(text, text, text, bigint);

CREATE OR REPLACE FUNCTION public.add_comment(
  p_token text,
  p_article text,
  p_content text,
  p_parent_id bigint DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user record;
  v_today_rewards int;
  v_points int;
  v_parent record;
BEGIN
  SELECT email, nickname INTO v_user FROM public.profiles WHERE token = p_token;
  IF v_user IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '登录已过期');
  END IF;

  IF p_article IS NULL OR length(trim(p_article)) = 0 THEN
    RETURN json_build_object('ok', false, 'msg', '文章缺失');
  END IF;

  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RETURN json_build_object('ok', false, 'msg', '内容为空');
  END IF;

  IF p_parent_id IS NOT NULL THEN
    SELECT id, article INTO v_parent
      FROM public.comments
     WHERE id = p_parent_id
       AND article = p_article;

    IF v_parent IS NULL THEN
      RETURN json_build_object('ok', false, 'msg', '回复的评论不存在');
    END IF;
  END IF;

  INSERT INTO public.comments (article, email, nickname, content, parent_id)
  VALUES (
    trim(p_article),
    v_user.email,
    coalesce(v_user.nickname, split_part(v_user.email, '@', 1)),
    trim(p_content),
    p_parent_id
  );

  SELECT count(*) INTO v_today_rewards
    FROM public.point_logs
   WHERE email = v_user.email
     AND reason = '评论奖励'
     AND created_at::date = current_date;

  IF v_today_rewards < 10 THEN
    INSERT INTO public.user_points (email, points, total_earned)
    VALUES (v_user.email, 2, 2)
    ON CONFLICT (email) DO UPDATE
      SET points = public.user_points.points + 2,
          total_earned = public.user_points.total_earned + 2,
          updated_at = now();

    INSERT INTO public.point_logs (email, amount, reason)
    VALUES (v_user.email, 2, '评论奖励');

    SELECT points INTO v_points FROM public.user_points WHERE email = v_user.email;
    RETURN json_build_object('ok', true, 'msg', '评论成功 +2积分', 'points', coalesce(v_points, 0));
  END IF;

  SELECT points INTO v_points FROM public.user_points WHERE email = v_user.email;
  RETURN json_build_object('ok', true, 'msg', '评论成功', 'points', coalesce(v_points, 0));
END;
$$;

DROP FUNCTION IF EXISTS public.list_comments(text);

CREATE OR REPLACE FUNCTION public.list_comments(p_article text)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT json_build_object(
    'ok', true,
    'list', coalesce(json_agg(row_to_json(x) ORDER BY x.created_at), '[]'::json)
  )
  FROM (
    SELECT
      c.id,
      c.article,
      c.email,
      c.nickname,
      c.content,
      c.created_at,
      c.parent_id,
      p.nickname AS parent_nickname,
      p.email AS parent_email,
      left(p.content, 120) AS parent_content
    FROM public.comments c
    LEFT JOIN public.comments p ON p.id = c.parent_id
    WHERE c.article = p_article
    ORDER BY c.created_at ASC
  ) x;
$$;

GRANT EXECUTE ON FUNCTION public.add_comment(text, text, text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_comments(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_admin_comment_web_push_targets()
RETURNS TABLE(
  endpoint text,
  subscription jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (ps.user_token, coalesce(ps.user_agent, ''))
    ps.endpoint,
    ps.subscription
  FROM public.push_subscriptions ps
  JOIN public.profiles p ON p.token = ps.user_token
  WHERE coalesce(p.is_admin, false)
     OR lower(coalesce(p.email, '')) IN ('491788533@qq.com', '491788533@gmail.com')
  ORDER BY ps.user_token, coalesce(ps.user_agent, ''), ps.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_comment_native_push_targets()
RETURNS TABLE(
  device_token text,
  platform text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (npt.user_token, npt.platform)
    npt.device_token,
    npt.platform
  FROM public.native_push_tokens npt
  JOIN public.profiles p ON p.token = npt.user_token
  WHERE coalesce(p.is_admin, false)
     OR lower(coalesce(p.email, '')) IN ('491788533@qq.com', '491788533@gmail.com')
  ORDER BY npt.user_token, npt.platform, npt.updated_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.get_comment_notification_detail(p_comment_id bigint)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', c.id IS NOT NULL,
    'comment', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', c.id,
      'article', c.article,
      'email', c.email,
      'nickname', c.nickname,
      'content', c.content,
      'created_at', c.created_at,
      'parent_id', c.parent_id
    ) END
  )
  FROM (SELECT 1) one
  LEFT JOIN public.comments c ON c.id = p_comment_id;
$$;

CREATE OR REPLACE FUNCTION public.log_comment_push_delivery(
  p_comment_id bigint,
  p_target text,
  p_channel text,
  p_ok boolean,
  p_status_code int DEFAULT NULL,
  p_error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_email text;
  v_target_email text;
BEGIN
  SELECT email INTO v_sender_email
  FROM public.comments
  WHERE id = p_comment_id;

  IF p_channel = 'web' THEN
    SELECT p.email INTO v_target_email
    FROM public.push_subscriptions ps
    JOIN public.profiles p ON p.token = ps.user_token
    WHERE ps.endpoint = p_target
    LIMIT 1;
  ELSE
    SELECT p.email INTO v_target_email
    FROM public.native_push_tokens nt
    JOIN public.profiles p ON p.token = nt.user_token
    WHERE nt.device_token = p_target
    LIMIT 1;
  END IF;

  INSERT INTO public.push_delivery_logs(channel, function_name, room, sender_email, target_email, ok, status_code, error)
  VALUES (coalesce(p_channel, 'web'), 'notify-comment', 'comment', v_sender_email, v_target_email, coalesce(p_ok, false), p_status_code, left(coalesce(p_error, ''), 500));

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_comment_admin_push_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_headers jsonb;
BEGIN
  IF lower(coalesce(NEW.email, '')) IN ('491788533@qq.com', '491788533@gmail.com') THEN
    RETURN NEW;
  END IF;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', 'sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV',
    'Authorization', 'Bearer sb_publishable_rGCr3ILVWQpvpURhctuYQg_K_jC-WHV'
  );

  PERFORM net.http_post(
    url := 'https://ojioiglffglyuellvcex.supabase.co/functions/v1/notify-comment',
    headers := v_headers,
    body := jsonb_build_object('comment_id', NEW.id),
    timeout_milliseconds := 5000
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comment_admin_push_after_insert ON public.comments;
CREATE TRIGGER trg_comment_admin_push_after_insert
AFTER INSERT ON public.comments
FOR EACH ROW
EXECUTE FUNCTION public.trigger_comment_admin_push_after_insert();

GRANT EXECUTE ON FUNCTION public.get_admin_comment_web_push_targets() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_comment_native_push_targets() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_comment_notification_detail(bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_comment_push_delivery(bigint, text, text, boolean, int, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
