-- Future Academy Desk, F3 to F7: Claude as a second reader, hand-overs, and the decision log.
alter table public.academy_messages drop constraint academy_messages_engine_check;
alter table public.academy_messages
  add constraint academy_messages_engine_check check (engine in ('jev', 'claude', 'error', 'skipped'));

-- One decision row per incoming message. Writing it first is the claim: only one run can
-- answer a message, so a retried or duplicate delivery never sends a second reply.
create table public.academy_decisions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.academy_conversations(id) on delete cascade,
  message_id uuid not null unique references public.academy_messages(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed', 'answered', 'needs_person', 'no_reply')),
  reason text,
  language text,
  label text,
  label_confidence real,
  checks jsonb,
  fix_attempted boolean not null default false,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 8),
  latency_ms integer,
  sent boolean not null default false,
  send_error text,
  claimed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  is_synthetic boolean not null default true
);

create table public.academy_handovers (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.academy_conversations(id) on delete cascade,
  message_id uuid not null references public.academy_messages(id) on delete cascade,
  reason text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  is_synthetic boolean not null default true
);

create index academy_handovers_open on public.academy_handovers (status, created_at);

alter table public.academy_decisions enable row level security;
alter table public.academy_handovers enable row level security;
revoke all on public.academy_decisions from anon, authenticated;
revoke all on public.academy_handovers from anon, authenticated;

-- Claim a message: true for the first run, or for a run that finds a claim that never
-- finished (older than p_stale_seconds), false when someone else is already on it.
create function public.academy_claim_message(p_conversation_id uuid, p_message_id uuid, p_stale_seconds integer default 120)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_rows integer;
begin
  insert into academy_decisions (conversation_id, message_id)
  values (p_conversation_id, p_message_id)
  on conflict (message_id) do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 1 then
    return true;
  end if;

  update academy_decisions
     set claimed_at = now()
   where message_id = p_message_id
     and status = 'claimed'
     and claimed_at < now() - make_interval(secs => p_stale_seconds);
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.academy_claim_message(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.academy_claim_message(uuid, uuid, integer) to service_role;
