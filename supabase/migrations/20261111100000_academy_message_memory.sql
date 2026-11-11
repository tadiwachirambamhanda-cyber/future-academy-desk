-- Future Academy Desk, F1: conversations and messages.
-- Lives in the shared `liwan-desk` Supabase project, so every name starts with academy_.
-- Locked: row-level security on, no policies, and no privileges for anon or authenticated.

create table public.academy_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'whatsapp',
  wa_id text not null unique,
  status text not null default 'bot' check (status in ('bot', 'with_person')),
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table public.academy_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.academy_conversations(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  body text not null,
  wa_message_id text unique,
  sent_at timestamptz not null,
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now()
);

create index academy_messages_conversation_order
  on public.academy_messages (conversation_id, sent_at, id);

alter table public.academy_conversations enable row level security;
alter table public.academy_messages enable row level security;

revoke all on public.academy_conversations from anon, authenticated;
revoke all on public.academy_messages from anon, authenticated;

-- One safe step: find or create the conversation, insert the message once
-- (a repeated WhatsApp message id is ignored), and move last_message_at only
-- after the message is in.
create or replace function public.academy_save_inbound(
  p_wa_id text,
  p_wa_message_id text,
  p_body text,
  p_sent_at timestamptz
)
returns table (out_conversation_id uuid, out_message_id uuid, out_inserted boolean)
language plpgsql
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
begin
  insert into academy_conversations (wa_id)
  values (p_wa_id)
  on conflict (wa_id) do update set wa_id = excluded.wa_id
  returning id into v_conversation_id;

  insert into academy_messages (conversation_id, direction, body, wa_message_id, sent_at)
  values (v_conversation_id, 'in', p_body, p_wa_message_id, p_sent_at)
  on conflict (wa_message_id) do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select m.id into v_message_id from academy_messages m where m.wa_message_id = p_wa_message_id;
    return query select v_conversation_id, v_message_id, false;
    return;
  end if;

  update academy_conversations
     set last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at)
   where id = v_conversation_id;

  return query select v_conversation_id, v_message_id, true;
end;
$$;

revoke all on function public.academy_save_inbound(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.academy_save_inbound(text, text, text, timestamptz) to service_role;
