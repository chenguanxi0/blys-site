-- Fix daily ideas editor permission: allow the owner email even if is_admin is false.
-- Safe to run more than once.

create or replace function public.save_daily_idea(
  p_token text,
  p_date date,
  p_title text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user record;
  v_id bigint;
begin
  select email, is_admin
    into v_user
    from public.profiles
   where token = p_token
   limit 1;

  if not found or (
    coalesce(v_user.is_admin, false) is not true
    and lower(coalesce(v_user.email, '')) not in ('491788533@qq.com', '491788533@gmail.com')
  ) then
    return jsonb_build_object('ok', false, 'msg', '只有管理员可以编辑每日思路');
  end if;

  if p_date is null then
    return jsonb_build_object('ok', false, 'msg', '请选择日期');
  end if;

  if length(trim(coalesce(p_content, ''))) = 0 then
    return jsonb_build_object('ok', false, 'msg', '内容不能为空');
  end if;

  insert into public.daily_ideas (idea_date, title, content, author_email, created_at, updated_at)
  values (p_date, nullif(trim(coalesce(p_title, '')), ''), trim(p_content), v_user.email, now(), now())
  on conflict (idea_date) do update set
    title = excluded.title,
    content = excluded.content,
    author_email = excluded.author_email,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'idea_date', to_char(p_date, 'YYYY-MM-DD'));
end;
$$;

grant execute on function public.save_daily_idea(text, date, text, text) to anon, authenticated;
