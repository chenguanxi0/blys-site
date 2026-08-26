CREATE TABLE IF NOT EXISTS public.site_announcements (
  id text PRIMARY KEY DEFAULT 'main',
  title text NOT NULL DEFAULT '网站公告',
  summary text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.site_announcements (id, title, summary, content, updated_at)
VALUES (
  'main',
  '网站公告模块已上线',
  '以后临时通知、重要说明都会放在这里提醒大家。',
  '以后临时通知、重要说明都会放在这里提醒大家。公告内容较多时会默认折叠，点击后展开查看完整内容。',
  now()
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_site_announcement()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item record;
BEGIN
  SELECT id, title, summary, content, updated_at
    INTO v_item
  FROM public.site_announcements
  WHERE id = 'main';

  IF v_item.id IS NULL THEN
    RETURN json_build_object('ok', true, 'item', NULL);
  END IF;

  RETURN json_build_object(
    'ok', true,
    'item', json_build_object(
      'id', v_item.id,
      'title', v_item.title,
      'summary', v_item.summary,
      'content', v_item.content,
      'updated_at', v_item.updated_at
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_site_announcement(
  p_admin_token text,
  p_title text,
  p_summary text,
  p_content text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin record;
  v_item record;
BEGIN
  IF length(coalesce(p_admin_token, '')) < 10 THEN
    RETURN json_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT email, is_admin
    INTO v_admin
  FROM public.profiles
  WHERE token = p_admin_token;

  IF v_admin.email IS NOT NULL
     AND NOT (
       COALESCE(v_admin.is_admin, false)
       OR lower(v_admin.email) IN ('491788533@qq.com', '491788533@gmail.com')
     ) THEN
    RETURN json_build_object('ok', false, 'msg', '无权限');
  END IF;

  IF NULLIF(trim(COALESCE(p_title, '')), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '标题不能为空');
  END IF;

  IF NULLIF(trim(COALESCE(p_summary, '')), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '摘要不能为空');
  END IF;

  IF NULLIF(trim(COALESCE(p_content, '')), '') IS NULL THEN
    RETURN json_build_object('ok', false, 'msg', '内容不能为空');
  END IF;

  INSERT INTO public.site_announcements (id, title, summary, content, updated_by, updated_at)
  VALUES (
    'main',
    trim(p_title),
    trim(p_summary),
    trim(p_content),
    coalesce(v_admin.email, 'admin'),
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      content = EXCLUDED.content,
      updated_by = EXCLUDED.updated_by,
      updated_at = EXCLUDED.updated_at
  RETURNING id, title, summary, content, updated_at INTO v_item;

  RETURN json_build_object(
    'ok', true,
    'item', json_build_object(
      'id', v_item.id,
      'title', v_item.title,
      'summary', v_item.summary,
      'content', v_item.content,
      'updated_at', v_item.updated_at
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_site_announcement() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_site_announcement(text, text, text, text) TO anon, authenticated;
