-- Ajustes exclusivos de un mes: importe, no aplica y restauración.
-- Ejecutar después de 001_setup.sql. No modifica ni borra compras.
begin;
create or replace function public.ct_save_month_adjustment(
  p_purchase_id text, p_month text, p_amount numeric, p_skipped boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid := auth.uid();
  v_settings jsonb; v_months jsonb; v_items jsonb; v_adjustment jsonb;
begin
  if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501'; end if;
  if p_purchase_id is null or length(p_purchase_id) not between 1 and 100
     or p_month is null or p_month !~ '^(19|20|21)\d{2}-(0[1-9]|1[0-2])$'
     or p_skipped is null then raise exception 'Compra o mes inválidos.'; end if;
  if p_amount is not null and (p_amount<0 or p_amount>100000000 or round(p_amount,2)<>p_amount) then
    raise exception 'Usa un importe de cero o mayor, con máximo dos decimales.';
  end if;
  -- Lock the owner's book so simultaneous edits to different records are merged.
  select settings into v_settings from public.ct_books where owner_id=v_owner for update;
  if not found then raise exception 'Primero importa tus compras.'; end if;
  if not exists(select 1 from public.ct_purchases where owner_id=v_owner and id=p_purchase_id) then
    raise exception 'No se encontró esa compra en tu cuenta.';
  end if;
  v_months:=coalesce(v_settings->'monthAdjustments','{}'::jsonb);
  v_items:=coalesce(v_months->p_month,'{}'::jsonb);
  if p_amount is null and p_skipped=false then
    v_items:=v_items-p_purchase_id; v_adjustment:=null;
  else
    v_adjustment:=jsonb_build_object('amountCents',case when p_amount is null then null else (p_amount*100)::bigint end,
      'skipped',p_skipped,'updatedAt',now());
    v_items:=jsonb_set(v_items,array[p_purchase_id],v_adjustment,true);
  end if;
  v_months:=jsonb_set(v_months,array[p_month],v_items,true);
  update public.ct_books set settings=jsonb_set(settings,'{monthAdjustments}',v_months,true) where owner_id=v_owner;
  return jsonb_build_object('purchaseId',p_purchase_id,'month',p_month,'adjustment',v_adjustment);
end $$;
revoke all on function public.ct_save_month_adjustment(text,text,numeric,boolean) from public,anon;
grant execute on function public.ct_save_month_adjustment(text,text,numeric,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
