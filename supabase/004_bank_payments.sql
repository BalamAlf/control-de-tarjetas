-- Ejecutar una vez en la cuenta existente. No modifica compras ni registra transferencias.
begin;
create or replace function public.ct_set_bank_payment(p_card_id text,p_month text,p_paid boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=auth.uid();v_settings jsonb;v_months jsonb;v_cards jsonb;v_status jsonb;
begin
 if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_month is null or p_month !~ '^(19|20|21)\d{2}-(0[1-9]|1[0-2])$' or p_paid is null then raise exception 'Mes o estado inválidos.';end if;
 select settings into v_settings from public.ct_books where owner_id=v_owner for update;
 if not found then raise exception 'Primero importa tus compras.';end if;
 if p_card_id is null or not exists(select 1 from jsonb_array_elements(v_settings->'cards') c where c->>'id'=p_card_id) then raise exception 'Tarjeta inválida.';end if;
 if p_month<coalesce(v_settings->>'snapshotMonth',case when v_settings->>'baseline'='2026-12' and v_settings->>'paidThrough'='2026-11' then '2026-11' else v_settings->>'baseline' end) then raise exception 'No hay un periodo confirmado para ese mes.';end if;
 v_months:=coalesce(v_settings->'bankPayments','{}'::jsonb);v_cards:=coalesce(v_months->p_month,'{}'::jsonb);
 -- updatedAt records the edit, never an invented bank payment date or amount.
 v_status:=jsonb_build_object('paid',p_paid,'updatedAt',now());
 v_cards:=jsonb_set(v_cards,array[p_card_id],v_status,true);v_months:=jsonb_set(v_months,array[p_month],v_cards,true);
 update public.ct_books set settings=jsonb_set(settings,'{bankPayments}',v_months,true) where owner_id=v_owner;
 return jsonb_build_object('cardId',p_card_id,'month',p_month,'status',v_status);
end $$;
revoke all on function public.ct_set_bank_payment(text,text,boolean) from public,anon;
grant execute on function public.ct_set_bank_payment(text,text,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
