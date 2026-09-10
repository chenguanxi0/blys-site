-- 移除已下线的“自动化项目状态”功能及其保存的数据。
DROP FUNCTION IF EXISTS public.get_admin_automation_projects(text);
DROP FUNCTION IF EXISTS public.get_my_admin_automation_projects(text);
DROP FUNCTION IF EXISTS public.sync_admin_automation_projects(text, jsonb);
DROP TABLE IF EXISTS public.admin_automation_projects;
DROP TABLE IF EXISTS public.admin_automation_sync_key;
NOTIFY pgrst, 'reload schema';
