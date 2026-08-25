-- Enforce unique non-empty profile nicknames.
-- Safe to run more than once.

-- 1) Clean existing duplicate nicknames first, otherwise the unique index cannot be created.
with ranked as (
  select
    email,
    nickname,
    row_number() over (
      partition by lower(btrim(nickname))
      order by created_at nulls last, email
    ) as rn
  from public.profiles
  where nickname is not null
    and btrim(nickname) <> ''
)
update public.profiles p
set nickname = left(btrim(p.nickname), 14) || '-' || substr(md5(coalesce(p.email, random()::text)), 1, 5)
from ranked r
where lower(coalesce(p.email, '')) = lower(coalesce(r.email, ''))
  and r.rn > 1;

-- 2) Add a database-level unique index. Empty nicknames are still allowed.
create unique index if not exists profiles_nickname_unique_idx
on public.profiles (lower(btrim(nickname)))
where nickname is not null and btrim(nickname) <> '';

-- 3) Give registration/update a clear error and normalize whitespace.
create or replace function public.ensure_unique_profile_nickname()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.nickname is null or btrim(new.nickname) = '' then
    new.nickname := null;
    return new;
  end if;

  new.nickname := btrim(new.nickname);

  if length(new.nickname) > 20 then
    raise exception '昵称最多 20 个字'
      using errcode = '22001';
  end if;

  if exists (
    select 1
    from public.profiles p
    where lower(btrim(p.nickname)) = lower(new.nickname)
      and lower(coalesce(p.email, '')) <> lower(coalesce(new.email, ''))
  ) then
    raise exception '昵称已被使用'
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_profiles_unique_nickname on public.profiles;
create trigger trg_profiles_unique_nickname
before insert or update of nickname on public.profiles
for each row
execute function public.ensure_unique_profile_nickname();
