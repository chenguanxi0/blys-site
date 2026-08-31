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

CREATE TABLE IF NOT EXISTS public.admin_automation_sync_key (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  secret text NOT NULL
);

ALTER TABLE public.admin_automation_projects
  ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100);

UPDATE public.admin_automation_projects
SET progress = CASE status
  WHEN 'submitted' THEN 10 WHEN 'queued' THEN 10 WHEN 'in_progress' THEN 55
  WHEN 'ready' THEN 80 WHEN 'downloaded' THEN 90 WHEN 'repaired' THEN 75
  WHEN 'issue' THEN 45 WHEN 'archived' THEN 100 WHEN 'completed_missing' THEN 95
  ELSE 0 END
WHERE progress IS NULL OR progress = 0;

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
    'progress', progress,
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
    'submitted_at', submitted_at, 'progress', progress, 'reviewed_at', reviewed_at, 'issue_note', issue_note,
    'updated_at', updated_at
  ) ORDER BY coalesce(submitted_at, updated_at) DESC, project), '[]'::jsonb)
  INTO v_items
  FROM public.admin_automation_projects;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_admin_automation_projects(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_admin_automation_projects(p_secret text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_automation_sync_key WHERE id = true AND secret = p_secret) THEN
    RETURN jsonb_build_object('ok', false, 'msg', '无权限');
  END IF;
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'msg', '数据格式错误');
  END IF;

  INSERT INTO public.admin_automation_projects
    (project, owner, status, source_file, submitted_at, reviewed_at, issue_note, progress, updated_at)
  SELECT project, coalesce(owner, ''), coalesce(status, 'queued'), coalesce(source_file, ''),
         submitted_at, reviewed_at, coalesce(issue_note, ''),
         CASE coalesce(status, 'queued')
           WHEN 'submitted' THEN 10 WHEN 'queued' THEN 10 WHEN 'in_progress' THEN 55
           WHEN 'ready' THEN 80 WHEN 'downloaded' THEN 90 WHEN 'repaired' THEN 75
           WHEN 'issue' THEN 45 WHEN 'archived' THEN 100 WHEN 'completed_missing' THEN 95 ELSE 0 END,
         now()
  FROM jsonb_to_recordset(p_items) AS x(project text, owner text, status text, source_file text, submitted_at timestamptz, reviewed_at timestamptz, issue_note text)
  WHERE nullif(trim(project), '') IS NOT NULL
  ON CONFLICT (project) DO UPDATE SET
    owner = excluded.owner, status = excluded.status, source_file = excluded.source_file,
    submitted_at = excluded.submitted_at, reviewed_at = excluded.reviewed_at,
    issue_note = excluded.issue_note, progress = excluded.progress, updated_at = now();

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_admin_automation_projects(text, jsonb) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
