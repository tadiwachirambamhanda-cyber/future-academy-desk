-- Future Academy Desk, F2: Jev's answer is saved next to each message.
alter table public.academy_messages
  add column language text,
  add column language_confidence real,
  add column label text,
  add column label_confidence real,
  add column engine text check (engine in ('jev', 'error', 'skipped')),
  add column latency_ms integer,
  add column input_tokens integer,
  add column cost_usd numeric(12, 8),
  add column classification_error text;

-- The save function now also says whether the message already has an engine
-- (was classified). A message saved but never classified is found again on a retry.
drop function public.academy_save_inbound(text, text, text, timestamptz);

create function public.academy_save_inbound(
  p_wa_id text,
  p_wa_message_id text,
  p_body text,
  p_sent_at timestamptz
)
returns table (out_conversation_id uuid, out_message_id uuid, out_inserted boolean, out_classified boolean)
language plpgsql
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_message_id uuid;
  v_engine text;
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
    select m.id, m.engine into v_message_id, v_engine
      from academy_messages m where m.wa_message_id = p_wa_message_id;
    return query select v_conversation_id, v_message_id, false, (v_engine is not null);
    return;
  end if;

  update academy_conversations
     set last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at)
   where id = v_conversation_id;

  return query select v_conversation_id, v_message_id, true, false;
end;
$$;

revoke all on function public.academy_save_inbound(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.academy_save_inbound(text, text, text, timestamptz) to service_role;
