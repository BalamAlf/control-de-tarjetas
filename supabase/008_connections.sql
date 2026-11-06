begin;
alter table public.ct_reader_keys alter column expires_at drop not null;
create or replace function public.ct_issue_reader(p_owner uuid,p_label text,p_scopes text[],p_days integer default 1)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token text;v_id uuid;v_expiry timestamptz;v_allowed text[]:=array['connection:read','people:read','cards:read','purchases:read','installments:read','summary:read','proposals:read','proposals:write'];
begin
 if coalesce(length(trim(p_label)),0) not between 1 and 80 or (p_days is not null and p_days not between 1 and 30) or p_scopes is null or cardinality(p_scopes)=0 or cardinality(p_scopes)>8 or array_position(p_scopes,null) is not null or not(p_scopes<@v_allowed) then raise exception 'Invalid credential settings';end if;
 if not exists(select 1 from public.ct_books where owner_id=p_owner) then raise exception 'Unknown book';end if;
 v_token:='ctr_'||replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');v_expiry:=case when p_days is null then null else now()+make_interval(days=>p_days) end;
 insert into public.ct_reader_keys(owner_id,label,token_hash,scopes,expires_at) values(p_owner,trim(p_label),encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_scopes,v_expiry) returning id into v_id;
 return jsonb_build_object('credentialId',v_id,'token',v_token,'expiresAt',v_expiry,'scopes',p_scopes);
end $$;
create or replace function public.ct_reader_snapshot(p_hash text,p_scope text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.ct_reader_keys%rowtype;v_status integer:=200;v_book jsonb;
begin
 select * into k from public.ct_reader_keys where token_hash=p_hash for update;
 if not found or k.revoked_at is not null or (k.expires_at is not null and k.expires_at<=now()) then return jsonb_build_object('status',401);end if;
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
create or replace function public.ct_proposal_auth(p_hash text,p_scope text,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare k public.ct_reader_keys%rowtype;v_status integer:=200;
begin
 select * into k from public.ct_reader_keys where token_hash=p_hash for update;
 if not found or k.revoked_at is not null or (k.expires_at is not null and k.expires_at<=now()) then return jsonb_build_object('status',401);end if;
 if k.window_start<=now()-interval '1 minute' then update public.ct_reader_keys set window_start=now(),window_count=1 where id=k.id;
 elsif k.window_count>=30 then v_status:=429;else update public.ct_reader_keys set window_count=window_count+1 where id=k.id;end if;
 if v_status=200 and (p_scope is null or not(p_scope=any(k.scopes))) then v_status:=403;end if;
 if v_status<>429 then insert into public.ct_reader_audit(key_id,request_id,scope,status) values(k.id,p_request,coalesce(p_scope,'invalid'),v_status);end if;
 return jsonb_build_object('status',v_status,'owner',case when v_status=200 then k.owner_id else null end);
end $$;

create or replace function public.ct_list_connections()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'label',label,'scopes',scopes,'expiresAt',expires_at,'revoked',revoked_at is not null) order by label,id) from public.ct_reader_keys where owner_id=auth.uid()),'[]'::jsonb);
end $$;
create or replace function public.ct_create_connection(p_profile text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_scopes text[];v_label text;
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_profile='read' then v_label:='Polilla lectura real';v_scopes:=array['connection:read','people:read','cards:read','purchases:read','installments:read','summary:read'];
 elsif p_profile='proposals' then v_label:='Polilla propuestas';v_scopes:=array['proposals:read','proposals:write'];
 else raise exception 'Perfil inválido.';end if;
 perform 1 from public.ct_books where owner_id=auth.uid() for update;
 if not found then raise exception 'No hay una cuenta de tarjetas para este usuario.';end if;
 if (select count(*) from public.ct_reader_keys where owner_id=auth.uid() and revoked_at is null and (expires_at is null or expires_at>now()))>=10 then raise exception 'Hay diez accesos activos. Revoca los que no utilices antes de generar otro.';end if;
 return public.ct_issue_reader(auth.uid(),v_label,v_scopes,null);
end $$;
create or replace function public.ct_disconnect(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 update public.ct_reader_keys set revoked_at=coalesce(revoked_at,now()) where id=p_id and owner_id=auth.uid();return found;
end $$;
revoke all on function public.ct_issue_reader(uuid,text,text[],integer),public.ct_reader_snapshot(text,text,uuid),public.ct_proposal_auth(text,text,uuid),public.ct_list_connections(),public.ct_create_connection(text),public.ct_disconnect(uuid) from public,anon,authenticated,service_role;
grant execute on function public.ct_issue_reader(uuid,text,text[],integer),public.ct_reader_snapshot(text,text,uuid) to service_role;
grant execute on function public.ct_list_connections(),public.ct_create_connection(text),public.ct_disconnect(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
