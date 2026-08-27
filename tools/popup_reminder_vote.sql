CREATE TABLE IF NOT EXISTS public.popup_reminder_votes (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  nickname text,
  choice text NOT NULL CHECK (choice IN ('operation_only', 'all_messages', 'market_operation_after_all', 'other')),
  other text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS popup_reminder_votes_updated_at_idx
ON public.popup_reminder_votes (updated_at DESC);

CREATE OR REPLACE FUNCTION public._blys_popup_vote_choice(p_choice text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_choice text := trim(coalesce(p_choice, ''));
BEGIN
  RETURN CASE v_choice
    WHEN 'operation_only' THEN 'operation_only'
    WHEN 'all_messages' THEN 'all_messages'
    WHEN 'market_operation_after_all' THEN 'market_operation_after_all'
    WHEN 'other' THEN 'other'
    WHEN '只在有操作的时候弹窗通知' THEN 'operation_only'
    WHEN '所有消息都通知' THEN 'all_messages'
    WHEN '交易时间只有操作的时候弹窗通知，非交易时间所有消息都弹窗' THEN 'market_operation_after_all'
    WHEN '其他建议' THEN 'other'
    ELSE ''
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_popup_reminder_vote(
  p_token text,
  p_choice text,
  p_other text DEFAULT ''
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user record;
  v_choice text;
  v_other text;
BEGIN
  SELECT email, nickname, vip_expire, is_admin
    INTO v_user
  FROM public.profiles
  WHERE token = p_token;

  IF v_user.email IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '请先登录后再投票');
  END IF;

  IF NOT (
    COALESCE(v_user.is_admin, false)
    OR lower(v_user.email) IN ('491788533@qq.com', '491788533@gmail.com')
    OR (v_user.vip_expire IS NOT NULL AND v_user.vip_expire > now())
  ) THEN
    RETURN json_build_object('ok', false, 'msg', '仅会员可投票');
  END IF;

  v_choice := public._blys_popup_vote_choice(p_choice);
  IF v_choice = '' THEN
    RETURN json_build_object('ok', false, 'msg', '请选择投票选项');
  END IF;

  v_other := left(trim(coalesce(p_other, '')), 500);
  IF v_choice = 'other' AND v_other = '' THEN
    RETURN json_build_object('ok', false, 'msg', '请填写你的其他建议');
  END IF;
  IF v_choice <> 'other' THEN
    v_other := '';
  END IF;

  INSERT INTO public.popup_reminder_votes (email, nickname, choice, other, created_at, updated_at)
  VALUES (lower(v_user.email), v_user.nickname, v_choice, v_other, now(), now())
  ON CONFLICT (email) DO UPDATE
  SET nickname = EXCLUDED.nickname,
      choice = EXCLUDED.choice,
      other = EXCLUDED.other,
      updated_at = now();

  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_popup_reminder_vote_results(p_admin_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin record;
  v_total integer;
  v_summary json;
  v_list json;
BEGIN
  SELECT email, is_admin
    INTO v_admin
  FROM public.profiles
  WHERE token = p_admin_token;

  IF v_admin.email IS NULL OR NOT (
    COALESCE(v_admin.is_admin, false)
    OR lower(v_admin.email) IN ('491788533@qq.com', '491788533@gmail.com')
  ) THEN
    RETURN json_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT count(*)::int
    INTO v_total
  FROM public.popup_reminder_votes;

  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    INTO v_summary
  FROM (
    SELECT choice, count(*)::int AS count
    FROM public.popup_reminder_votes
    GROUP BY choice
    ORDER BY count(*) DESC, choice
  ) t;

  SELECT coalesce(json_agg(row_to_json(t)), '[]'::json)
    INTO v_list
  FROM (
    SELECT email, nickname, choice, other, created_at, updated_at
    FROM public.popup_reminder_votes
    ORDER BY updated_at DESC
    LIMIT 300
  ) t;

  RETURN json_build_object('ok', true, 'total', v_total, 'summary', v_summary, 'list', v_list);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_popup_reminder_vote(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_popup_reminder_vote_results(text) TO anon, authenticated;
