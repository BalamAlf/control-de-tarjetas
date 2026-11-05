begin;
create table if not exists public.ct_reader_keys(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.ct_books(owner_id) on delete cascade,
 label text not null,token_hash text not null unique,scopes text[] not null,expires_at timestamptz not null,
 revoked_at timestamptz,window_start timestamptz not null default now(),window_count integer not null default 0
);
create table if not exists public.ct_reader_audit(
 id bigint generated always as identity primary key,key_id uuid not null references public.ct_reader_keys(id) on delete cascade,
 request_id uuid not null,scope text not null,status integer not null,created_at timestamptz not null default now()
);
create index if not exists ct_reader_audit_key_time on public.ct_reader_audit(key_id,created_at);
alter table public.ct_reader_keys enable row level security;
alter table public.ct_reader_audit enable row level security;
revoke all on public.ct_reader_keys,public.ct_reader_audit from public,anon,authenticated;
-- Administrator-only issuance. The raw secret is returned once, never stored.
create or replace function public.ct_issue_reader(p_owner uuid,p_label text,p_scopes text[],p_days integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token text;v_id uuid;v_expiry timestamptz;v_allowed text[]:=array['connection:read','people:read','cards:read','purchases:read','installments:read','summary:read'];
begin
 if coalesce(length(trim(p_label)),0) not between 1 and 80 or p_days is null or p_days not between 1 and 30 or p_scopes is null or cardinality(p_scopes)=0 or cardinality(p_scopes)>6 or array_position(p_scopes,null) is not null or not(p_scopes<@v_allowed) then raise exception 'Invalid credential settings';end if;
 if not exists(select 1 from public.ct_books where owner_id=p_owner) then raise exception 'Unknown book';end if;
 v_token:='ctr_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');v_expiry:=now()+make_interval(days=>p_days);
 insert into public.ct_reader_keys(owner_id,label,token_hash,scopes,expires_at) values(p_owner,trim(p_label),encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_scopes,v_expiry) returning id into v_id;
 return jsonb_build_object('credentialId',v_id,'token',v_token,'expiresAt',v_expiry,'scopes',p_scopes);
end $$;
create or replace function public.ct_revoke_reader(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin update public.ct_reader_keys set revoked_at=now() where id=p_id;return found;end $$;
create or replace function public.ct_reader_snapshot(p_hash text,p_scope text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.ct_reader_keys%rowtype;v_status integer:=200;v_book jsonb;
begin
 select * into k from public.ct_reader_keys where token_hash=p_hash for update;
 if not found or k.revoked_at is not null or k.expires_at<=now() then return jsonb_build_object('status',401);end if;
 if k.window_start<=now()-interval '1 minute' then
  update public.ct_reader_keys set window_start=now(),window_count=1 where id=k.id;
 elsif k.window_count>=30 then v_status:=429;
 else update public.ct_reader_keys set window_count=window_count+1 where id=k.id;end if;
 if v_status=200 and (p_scope is null or not(p_scope=any(k.scopes))) then v_status:=403;end if;
 -- Keep audit bounded per key; no tokens, names, amounts or request bodies.
 delete from public.ct_reader_audit where key_id=k.id and created_at<now()-interval '30 days';
 if v_status<>429 then insert into public.ct_reader_audit(key_id,request_id,scope,status) values(k.id,p_request,coalesce(p_scope,'invalid'),v_status);end if;
 if v_status<>200 then return jsonb_build_object('status',v_status);end if;
 -- Settings and all purchases come from one MVCC statement snapshot.
 select b.settings||jsonb_build_object('purchases',coalesce((select jsonb_agg(p.payload order by p.id) from public.ct_purchases p where p.owner_id=b.owner_id),'[]'::jsonb))
 into v_book from public.ct_books b where b.owner_id=k.owner_id;
 if v_book is null then return jsonb_build_object('status',401);end if;
 return jsonb_build_object('status',200,'scopes',k.scopes,'book',v_book);
end $$;
revoke all on function public.ct_issue_reader(uuid,text,text[],integer),public.ct_revoke_reader(uuid),public.ct_reader_snapshot(text,text,uuid) from public,anon,authenticated;
grant execute on function public.ct_issue_reader(uuid,text,text[],integer),public.ct_revoke_reader(uuid),public.ct_reader_snapshot(text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
