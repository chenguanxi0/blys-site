-- 管理员专用：自动化项目状态看板（只读）。
CREATE TABLE IF NOT EXISTS public.admin_automation_projects (
  project text PRIMARY KEY,
  owner text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'queued',
  source_file text NOT NULL DEFAULT '',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  issue_note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.get_admin_automation_projects(p_admin_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_items jsonb;
BEGIN
  IF NOT public._blys_monthly_stats_admin(p_admin_token) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'project', project,
    'owner', owner,
    'status', status,
    'source_file', source_file,
    'submitted_at', submitted_at,
    'reviewed_at', reviewed_at,
    'issue_note', issue_note,
    'updated_at', updated_at
  ) ORDER BY coalesce(submitted_at, updated_at) DESC, project), '[]'::jsonb)
  INTO v_items
  FROM public.admin_automation_projects;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_automation_projects(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_my_admin_automation_projects(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_items jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE token = p_token AND coalesce(is_admin, false)) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'project', project, 'owner', owner, 'status', status, 'source_file', source_file,
    'submitted_at', submitted_at, 'reviewed_at', reviewed_at, 'issue_note', issue_note,
    'updated_at', updated_at
  ) ORDER BY coalesce(submitted_at, updated_at) DESC, project), '[]'::jsonb)
  INTO v_items
  FROM public.admin_automation_projects;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_admin_automation_projects(text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
