-- 每日思路功能：每天一条，可编辑覆盖
-- 在 Supabase SQL Editor 执行一次。

create table if not exists public.daily_ideas (
  id bigserial primary key,
  idea_date date not null unique,
  title text,
  content text not null,
  author_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_ideas enable row level security;

drop policy if exists "daily ideas public read" on public.daily_ideas;
create policy "daily ideas public read"
  on public.daily_ideas for select
  using (true);

create or replace function public.list_daily_ideas()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'ok', true,
    'list', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id,
          'idea_date', to_char(idea_date, 'YYYY-MM-DD'),
          'title', title,
          'content', content,
          'updated_at', updated_at
        ) order by idea_date desc
      )
      from public.daily_ideas
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_daily_idea(p_date date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item record;
begin
  select id, idea_date, title, content, updated_at
    into v_item
    from public.daily_ideas
   where idea_date = p_date;

  if not found then
    return jsonb_build_object('ok', true, 'item', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id', v_item.id,
      'idea_date', to_char(v_item.idea_date, 'YYYY-MM-DD'),
      'title', v_item.title,
      'content', v_item.content,
      'updated_at', v_item.updated_at
    )
  );
end;
$$;

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

  if not found or coalesce(v_user.is_admin, false) is not true then
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

grant execute on function public.list_daily_ideas() to anon, authenticated;
grant execute on function public.get_daily_idea(date) to anon, authenticated;
grant execute on function public.save_daily_idea(text, date, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
