-- Codex #4: the reply cap is enforced inside the claim, under a lock per conversation,
-- so messages arriving together cannot all slip past it.
drop function public.academy_claim_message(uuid, uuid, integer);

create function public.academy_claim_message(
  p_conversation_id uuid,
  p_message_id uuid,
  p_stale_seconds integer default 120,
  p_cap integer default 20
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_rows integer;
  v_recent integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_conversation_id::text));

  if exists (select 1 from academy_decisions where message_id = p_message_id) then
    -- already claimed: only a claim that never finished (stale) can be taken over
    update academy_decisions
       set claimed_at = now()
     where message_id = p_message_id
       and status = 'claimed'
       and claimed_at < now() - make_interval(secs => p_stale_seconds);
    get diagnostics v_rows = row_count;
    return case when v_rows = 1 then 'claimed' else 'taken' end;
  end if;

  select count(*) into v_recent
    from academy_decisions
   where conversation_id = p_conversation_id
     and claimed_at > now() - interval '24 hours';

  if v_recent >= p_cap then
    insert into academy_decisions (conversation_id, message_id, status, reason)
    values (p_conversation_id, p_message_id, 'needs_person', 'cap_reached');
    return 'cap';
  end if;

  insert into academy_decisions (conversation_id, message_id)
  values (p_conversation_id, p_message_id);
  return 'claimed';
end;
$$;

revoke all on function public.academy_claim_message(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.academy_claim_message(uuid, uuid, integer, integer) to service_role;
