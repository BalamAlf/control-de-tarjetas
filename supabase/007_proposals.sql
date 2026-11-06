begin;
create table if not exists public.ct_proposals(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.ct_books(owner_id) on delete cascade,
 intent_id uuid not null,payload jsonb not null,content_hash text not null,version integer not null default 1,
 state text not null default 'pending_approval' check(state in ('pending_approval','committed','cancelled','stale')),
 created_at timestamptz not null default now(),expires_at timestamptz not null default clock_timestamp()+interval '10 minutes',
 purchase_id text,unique(owner_id,intent_id),foreign key(owner_id,purchase_id) references public.ct_purchases(owner_id,id)
);
create index if not exists ct_proposals_owner_created on public.ct_proposals(owner_id,created_at desc);
create table if not exists public.ct_proposal_events(
 id bigint generated always as identity primary key,proposal_id uuid not null references public.ct_proposals(id) on delete cascade,
 actor text not null,event text not null,created_at timestamptz not null default now()
);
alter table public.ct_proposals enable row level security;
alter table public.ct_proposal_events enable row level security;
revoke all on public.ct_proposals,public.ct_proposal_events from public,anon,authenticated;
create or replace function public.ct_proposal_view(p public.ct_proposals)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.id,'clientIntentId',p.intent_id,'purchase',p.payload,'contentHash',p.content_hash,'version',p.version,
 'status',case when p.state='pending_approval' and p.expires_at<=now() then 'expired' else p.state end,'expiresAt',p.expires_at,'purchaseId',p.purchase_id)
$$;
revoke all on function public.ct_proposal_view(public.ct_proposals) from public,anon,authenticated;
create or replace function public.ct_proposal_auth(p_hash text,p_scope text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.ct_reader_keys%rowtype;v_status integer:=200;
begin
 select * into k from public.ct_reader_keys where token_hash=p_hash for update;
 if not found or k.revoked_at is not null or k.expires_at<=now() then return jsonb_build_object('status',401);end if;
 if k.window_start<=now()-interval '1 minute' then update public.ct_reader_keys set window_start=now(),window_count=1 where id=k.id;
 elsif k.window_count>=30 then v_status:=429;else update public.ct_reader_keys set window_count=window_count+1 where id=k.id;end if;
 if v_status=200 and (p_scope is null or not(p_scope=any(k.scopes))) then v_status:=403;end if;
 if v_status<>429 then insert into public.ct_reader_audit(key_id,request_id,scope,status) values(k.id,p_request,coalesce(p_scope,'invalid'),v_status);end if;
 return jsonb_build_object('status',v_status,'owner',case when v_status=200 then k.owner_id else null end);
end $$;
create or replace function public.ct_agent_proposal(p_hash text,p_request uuid,p_intent uuid,p_body jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;v_owner uuid;b jsonb;v_person jsonb;v_card jsonb;n jsonb;p public.ct_proposals%rowtype;v_amount numeric;v_terms integer;v_kind text;
begin
 a:=public.ct_proposal_auth(p_hash,'proposals:write',p_request);if (a->>'status')::integer<>200 then return a-'owner';end if;v_owner:=(a->>'owner')::uuid;
 if p_intent is null or p_body is null or jsonb_typeof(p_body)<>'object' or pg_column_size(p_body)>8192 or (p_body-array['personId','cardId','description','totalAmountCents','currency','kind','terms','firstPaymentMonth'])<>'{}'::jsonb
 or not(p_body ?& array['personId','cardId','description','totalAmountCents','currency','kind','terms','firstPaymentMonth']) then return jsonb_build_object('status',400,'code','invalid_input');end if;
 if jsonb_typeof(p_body->'personId')<>'string' or jsonb_typeof(p_body->'cardId')<>'string' or jsonb_typeof(p_body->'description')<>'string' or coalesce(length(trim(p_body->>'description')),0) not between 1 and 160
 or jsonb_typeof(p_body->'totalAmountCents')<>'number' or jsonb_typeof(p_body->'terms')<>'number' or (p_body->>'currency') is distinct from 'MXN' or coalesce(p_body->>'kind','') not in ('normal','msi') or coalesce(p_body->>'firstPaymentMonth','') !~ '^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then return jsonb_build_object('status',400,'code','invalid_input');end if;
 v_amount:=(p_body->>'totalAmountCents')::numeric;v_kind:=p_body->>'kind';
 if v_amount<=0 or v_amount>10000000000 or v_amount<>trunc(v_amount) or (p_body->>'terms')::numeric<>trunc((p_body->>'terms')::numeric) or (p_body->>'terms')::numeric not between 1 and 120 then return jsonb_build_object('status',400,'code','invalid_amount_or_terms');end if;
 v_terms:=(p_body->>'terms')::integer;if (v_kind='normal' and v_terms<>1) or v_amount-round(v_amount/v_terms)*(v_terms-1)<0 then return jsonb_build_object('status',400,'code','invalid_terms');end if;
 n:=p_body||jsonb_build_object('description',trim(p_body->>'description'));
 select settings into b from public.ct_books where owner_id=v_owner for update;
 select * into p from public.ct_proposals where owner_id=v_owner and intent_id=p_intent;
 if found then
  if (p.payload-'review')<>n then return jsonb_build_object('status',409,'code','idempotency_conflict');end if;
  return jsonb_build_object('status',200,'proposal',public.ct_proposal_view(p));
 end if;
 select value into v_person from jsonb_array_elements(b->'people') where value->>'id'=n->>'personId';
 select value into v_card from jsonb_array_elements(b->'cards') where value->>'id'=n->>'cardId';
 if v_person is null or v_card is null or coalesce((v_person->>'archived')::boolean,false) or coalesce((v_card->>'archived')::boolean,false) then return jsonb_build_object('status',409,'code','entity_unavailable');end if;
 n:=n||jsonb_build_object('review',jsonb_build_object('personName',v_person->>'name','cardName',coalesce(v_card->>'displayName',v_card->>'name'),'personRevision',coalesce((v_person->>'revision')::integer,0),'cardRevision',coalesce((v_card->>'revision')::integer,0)));
 insert into public.ct_proposals(owner_id,intent_id,payload,content_hash) values(v_owner,p_intent,n,encode(sha256(convert_to(n::text,'UTF8')),'hex')) returning * into p;
 insert into public.ct_proposal_events(proposal_id,actor,event) values(p.id,'agent','proposed');
 return jsonb_build_object('status',201,'proposal',public.ct_proposal_view(p));
end $$;
create or replace function public.ct_agent_proposal_status(p_hash text,p_request uuid,p_id uuid,p_by_intent boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a jsonb;p public.ct_proposals%rowtype;
begin
 a:=public.ct_proposal_auth(p_hash,'proposals:read',p_request);if (a->>'status')::integer<>200 then return a-'owner';end if;
 select * into p from public.ct_proposals where owner_id=(a->>'owner')::uuid and (case when p_by_intent then intent_id=p_id else id=p_id end);
 if not found then return jsonb_build_object('status',404,'code','not_found');end if;
 return jsonb_build_object('status',200,'proposal',public.ct_proposal_view(p));
end $$;
create or replace function public.ct_list_proposals()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(public.ct_proposal_view(p) order by p.created_at desc) from (select * from public.ct_proposals where owner_id=auth.uid() order by created_at desc limit 100) p),'[]'::jsonb);
end $$;
create or replace function public.ct_decide_proposal(p_id uuid,p_hash text,p_version integer,p_decision text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();b jsonb;p public.ct_proposals%rowtype;v_person jsonb;v_card jsonb;n jsonb;v_saved jsonb;
begin
 if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_decision is null or p_decision not in ('approve','cancel') then raise exception 'Decisión inválida.';end if;
 perform 1 from public.ct_books where owner_id=v_owner for update;
 select * into p from public.ct_proposals where id=p_id and owner_id=v_owner for update;
 if not found then raise exception 'Propuesta no encontrada.';end if;
 if p_hash is null or p_version is null or p.content_hash<>p_hash or p.version<>p_version then raise exception 'La propuesta no coincide. Actualiza antes de confirmar.';end if;
 if p.state<>'pending_approval' or p.expires_at<=clock_timestamp() then return public.ct_proposal_view(p);end if;
 if p_decision='cancel' then update public.ct_proposals set state='cancelled' where id=p.id returning * into p;insert into public.ct_proposal_events(proposal_id,actor,event) values(p.id,'user','cancelled');return public.ct_proposal_view(p);end if;
 select settings into b from public.ct_books where owner_id=v_owner;n:=p.payload;
 select value into v_person from jsonb_array_elements(b->'people') where value->>'id'=n->>'personId';
 select value into v_card from jsonb_array_elements(b->'cards') where value->>'id'=n->>'cardId';
 if v_person is null or v_card is null or coalesce((v_person->>'archived')::boolean,false) or coalesce((v_card->>'archived')::boolean,false)
 or coalesce((v_person->>'revision')::integer,0)<>(n#>>'{review,personRevision}')::integer or coalesce((v_card->>'revision')::integer,0)<>(n#>>'{review,cardRevision}')::integer
 or v_person->>'name'<>n#>>'{review,personName}' or coalesce(v_card->>'displayName',v_card->>'name')<>n#>>'{review,cardName}' then
  update public.ct_proposals set state='stale' where id=p.id returning * into p;insert into public.ct_proposal_events(proposal_id,actor,event) values(p.id,'user','stale');return public.ct_proposal_view(p);
 end if;
 v_saved:=public.ct_save_purchase(jsonb_build_object('id',p.id::text,'person',n->>'personId','card',n->>'cardId','description',n->>'description','amount',(n->>'totalAmountCents')::numeric/100,'terms',(n->>'terms')::integer,'msi',n->>'kind'='msi','recurring',false,'start',n->>'firstPaymentMonth'));
 update public.ct_proposals set state='committed',purchase_id=v_saved->>'id' where id=p.id returning * into p;
 insert into public.ct_proposal_events(proposal_id,actor,event) values(p.id,'user','committed');
 return public.ct_proposal_view(p);
end $$;
revoke all on function public.ct_proposal_auth(text,text,uuid),public.ct_agent_proposal(text,uuid,uuid,jsonb),public.ct_agent_proposal_status(text,uuid,uuid,boolean),public.ct_list_proposals(),public.ct_decide_proposal(uuid,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.ct_agent_proposal(text,uuid,uuid,jsonb),public.ct_agent_proposal_status(text,uuid,uuid,boolean) to service_role;
grant execute on function public.ct_list_proposals(),public.ct_decide_proposal(uuid,text,integer,text) to authenticated;
create or replace function public.ct_issue_reader(p_owner uuid,p_label text,p_scopes text[],p_days integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token text;v_id uuid;v_expiry timestamptz;v_allowed text[]:=array['connection:read','people:read','cards:read','purchases:read','installments:read','summary:read','proposals:read','proposals:write'];
begin
 if coalesce(length(trim(p_label)),0) not between 1 and 80 or p_days is null or p_days not between 1 and 30 or p_scopes is null or cardinality(p_scopes)=0 or cardinality(p_scopes)>8 or array_position(p_scopes,null) is not null or not(p_scopes<@v_allowed) then raise exception 'Invalid credential settings';end if;
 if not exists(select 1 from public.ct_books where owner_id=p_owner) then raise exception 'Unknown book';end if;
 v_token:='ctr_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');v_expiry:=now()+make_interval(days=>p_days);
 insert into public.ct_reader_keys(owner_id,label,token_hash,scopes,expires_at) values(p_owner,trim(p_label),encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_scopes,v_expiry) returning id into v_id;
 return jsonb_build_object('credentialId',v_id,'token',v_token,'expiresAt',v_expiry,'scopes',p_scopes);
end $$;
revoke all on function public.ct_issue_reader(uuid,text,text[],integer) from public,anon,authenticated;
grant execute on function public.ct_issue_reader(uuid,text,text[],integer) to service_role;
notify pgrst,'reload schema';
commit;
