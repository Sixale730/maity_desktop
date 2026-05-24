-- Maity Chat IA: threads, messages, and personalization memories.
-- Storage backend for the AI chat assistant in the desktop app.
-- Online-only; no local SQLite mirror.

set search_path = maity, public;

create table if not exists maity.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references maity.users(id) on delete cascade,
  title text not null default 'Nuevo chat',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_chat_threads_user_updated
  on maity.chat_threads (user_id, updated_at desc)
  where archived_at is null;

create table if not exists maity.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references maity.chat_threads(id) on delete cascade,
  user_id uuid not null references maity.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_messages_thread_created
  on maity.chat_messages (thread_id, created_at);

-- Hybrid memory store: status='proposed' rows are surfaced for review;
-- status='approved' rows are sent to the LLM as personalization context.
create table if not exists maity.chat_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references maity.users(id) on delete cascade,
  content text not null,
  status text not null check (status in ('proposed', 'approved', 'rejected')),
  source_message_id uuid references maity.chat_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_chat_memories_user_status
  on maity.chat_memories (user_id, status);

create table if not exists maity.chat_settings (
  user_id uuid primary key references maity.users(id) on delete cascade,
  memory_extraction_paused boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Trigger to keep chat_threads.updated_at fresh whenever a new message arrives,
-- so the thread list can sort by recent activity.
create or replace function maity.touch_chat_thread_on_message()
returns trigger
language plpgsql
as $$
begin
  update maity.chat_threads
     set updated_at = now()
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_chat_thread on maity.chat_messages;
create trigger trg_touch_chat_thread
  after insert on maity.chat_messages
  for each row
  execute function maity.touch_chat_thread_on_message();

-- Row-level security: a user only sees and mutates their own rows.
alter table maity.chat_threads enable row level security;
alter table maity.chat_messages enable row level security;
alter table maity.chat_memories enable row level security;
alter table maity.chat_settings enable row level security;

-- Helper: resolve the maity.users.id for the current auth user.
-- Mirrors the pattern used elsewhere in the schema where auth_id = auth.uid().
create or replace function maity.current_maity_user_id()
returns uuid
language sql
stable
as $$
  select id from maity.users where auth_id = auth.uid()
$$;

create policy chat_threads_owner on maity.chat_threads
  for all
  using (user_id = maity.current_maity_user_id())
  with check (user_id = maity.current_maity_user_id());

create policy chat_messages_owner on maity.chat_messages
  for all
  using (user_id = maity.current_maity_user_id())
  with check (user_id = maity.current_maity_user_id());

create policy chat_memories_owner on maity.chat_memories
  for all
  using (user_id = maity.current_maity_user_id())
  with check (user_id = maity.current_maity_user_id());

create policy chat_settings_owner on maity.chat_settings
  for all
  using (user_id = maity.current_maity_user_id())
  with check (user_id = maity.current_maity_user_id());
