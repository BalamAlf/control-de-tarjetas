begin;
create or replace function public.ct_save_entity(p_kind text,p_id text,p_name text,p_bank text,p_archived boolean,p_revision integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid:=auth.uid();v_settings jsonb;v_list jsonb;v_old jsonb;v_new jsonb;v_pos integer;v_revision integer;
begin
 if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_kind is null or p_kind not in ('people','cards') or p_id is null or length(p_id) not between 1 and 100 or coalesce(length(trim(p_name)),0) not between 1 and 80 or p_archived is null or coalesce(length(p_bank),0)>80 then raise exception 'Datos inválidos.';end if;
 select settings into v_settings from public.ct_books where owner_id=v_owner for update;
 if not found then raise exception 'Primero prepara tu cuenta.';end if;
 if p_kind='cards' and coalesce(v_settings->'excludedCardIds','[]'::jsonb) ? p_id then raise exception 'Esta tarjeta está excluida.';end if;
 v_list:=v_settings->p_kind;
 select value,(ordinality-1)::integer into v_old,v_pos from jsonb_array_elements(v_list) with ordinality where value->>'id'=p_id;
 if v_old is null then
  if p_revision is not null or p_id !~ '^[0-9a-fA-F-]{36}$' then raise exception 'Identificador nuevo inválido.';end if;
  v_old:=jsonb_build_object('id',p_id);v_revision:=0;
 else
  if v_old->>'name'=trim(p_name) and coalesce((v_old->>'archived')::boolean,false)=p_archived and (p_kind='people' or coalesce(v_old->>'bank','')=coalesce(trim(p_bank),'')) then return v_old;end if;
  if p_revision is null or p_revision<>coalesce((v_old->>'revision')::integer,0) then raise exception 'Este registro cambió en otro dispositivo. Actualiza tu cuenta y vuelve a abrir Editar.';end if;
  v_revision:=coalesce((v_old->>'revision')::integer,0);
 end if;
 v_new:=v_old||jsonb_build_object('name',trim(p_name),'archived',p_archived,'revision',v_revision+1);
 if p_kind='cards' then v_new:=v_new||jsonb_build_object('displayName',trim(p_name),'bank',coalesce(trim(p_bank),''));end if;
 if v_pos is null then v_list:=v_list||jsonb_build_array(v_new);else v_list:=jsonb_set(v_list,array[v_pos::text],v_new);end if;
 update public.ct_books set settings=jsonb_set(settings,array[p_kind],v_list) where owner_id=v_owner;
 return v_new;
end $$;
revoke all on function public.ct_save_entity(text,text,text,text,boolean,integer) from public,anon;
grant execute on function public.ct_save_entity(text,text,text,text,boolean,integer) to authenticated;
create or replace function public.ct_save_purchase(p_purchase jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid(); v_settings jsonb; v_payload jsonb; v_existing jsonb;
  v_id text; v_amount numeric; v_cents bigint; v_terms integer; v_regular bigint; v_last bigint;
  v_msi boolean; v_recurring boolean;
begin
  if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  select settings into v_settings from public.ct_books where owner_id=v_owner for update;
  if not found then raise exception 'Primero importa tus compras originales.'; end if;
  if p_purchase is null or jsonb_typeof(p_purchase)<>'object' or pg_column_size(p_purchase)>10000 then raise exception 'Compra inválida.'; end if;
  v_id:=p_purchase->>'id';
  if v_id is null or v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Falta el identificador de la compra.'; end if;
  if coalesce(length(trim(p_purchase->>'description')),0) not between 1 and 160
     or jsonb_typeof(p_purchase->'amount') is distinct from 'number'
     or jsonb_typeof(p_purchase->'terms') is distinct from 'number'
     or jsonb_typeof(p_purchase->'msi') is distinct from 'boolean'
     or jsonb_typeof(p_purchase->'recurring') is distinct from 'boolean'
     or (p_purchase->>'start') is null or (p_purchase->>'start') !~ '^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' then raise exception 'Completa los datos de la compra.'; end if;
  v_amount:=(p_purchase->>'amount')::numeric;
  if v_amount<=0 or v_amount>100000000 or round(v_amount,2)<>v_amount then raise exception 'El importe debe ser positivo y tener como máximo dos decimales.'; end if;
  if (p_purchase->>'terms')::numeric<>trunc((p_purchase->>'terms')::numeric) then raise exception 'Las mensualidades deben ser enteras.'; end if;
  v_terms:=(p_purchase->>'terms')::integer;
  v_msi:=(p_purchase->>'msi')::boolean; v_recurring:=(p_purchase->>'recurring')::boolean;
  if v_terms not between 1 and 120 or (v_msi and v_recurring) or (not v_msi and v_terms<>1) then raise exception 'Tipo o mensualidades inválidas.'; end if;
  if not exists(select 1 from jsonb_array_elements(v_settings->'people') x where x->>'id'=p_purchase->>'person')
     or not exists(select 1 from jsonb_array_elements(v_settings->'cards') x where x->>'id'=p_purchase->>'card') then raise exception 'Persona o tarjeta no válida.'; end if;
  if not exists(select 1 from public.ct_purchases where owner_id=v_owner and id=v_id) and (
   exists(select 1 from jsonb_array_elements(v_settings->'people') x where x->>'id'=p_purchase->>'person' and coalesce((x->>'archived')::boolean,false)) or
   exists(select 1 from jsonb_array_elements(v_settings->'cards') x where x->>'id'=p_purchase->>'card' and coalesce((x->>'archived')::boolean,false))) then raise exception 'La persona o tarjeta está archivada. Restáurala antes de registrar otra compra.';end if;
  v_cents:=(v_amount*100)::bigint; v_regular:=round(v_cents::numeric/v_terms)::bigint; v_last:=v_cents-v_regular*(v_terms-1);
  if v_last<0 then raise exception 'El importe es demasiado pequeño para ese número de mensualidades.'; end if;
  v_payload:=jsonb_build_object('id',v_id,'person',p_purchase->>'person','card',p_purchase->>'card',
    'description',trim(p_purchase->>'description'),'amount',v_amount,'terms',v_terms,'paid',0,'remaining',v_terms,
    'installment',v_regular::numeric/100,'lastInstallment',v_last::numeric/100,'msi',v_msi,'recurring',v_recurring,
    'start',p_purchase->>'start','legacy',false);
  insert into public.ct_purchases(owner_id,id,payload) values(v_owner,v_id,v_payload) on conflict(owner_id,id) do nothing;
  select payload into v_existing from public.ct_purchases where owner_id=v_owner and id=v_id;
  if v_existing<>v_payload then raise exception 'Este identificador ya corresponde a otra compra. No se guardó un duplicado.'; end if;
  return v_existing;
end $$;

revoke all on function public.ct_save_purchase(jsonb) from public,anon;
grant execute on function public.ct_save_purchase(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
