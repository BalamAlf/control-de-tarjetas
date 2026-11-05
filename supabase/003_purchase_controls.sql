-- Finalización de recurrentes y papelera recuperable, aisladas por propietario.
begin;
create or replace function public.ct_manage_purchase(p_purchase_id text,p_action text,p_month text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_owner uuid:=auth.uid();v_settings jsonb;v_controls jsonb;v_control jsonb;v_purchase jsonb;
begin
 if v_owner is null then raise exception 'Inicia sesión.' using errcode='42501';end if;
 if p_action is null or p_action not in ('end','resume','delete','restore') then raise exception 'Acción inválida.';end if;
 if p_action='end' and (p_month is null or p_month !~ '^(19|20|21)\d{2}-(0[1-9]|1[0-2])$') then raise exception 'Selecciona un mes válido.';end if;
 select settings into v_settings from public.ct_books where owner_id=v_owner for update;
 if not found then raise exception 'Primero importa tus compras.';end if;
 select payload into v_purchase from public.ct_purchases where owner_id=v_owner and id=p_purchase_id;
 if not found then raise exception 'No se encontró esa compra en tu cuenta.';end if;
 if p_action in ('end','resume') and coalesce((v_purchase->>'recurring')::boolean,false)=false then raise exception 'La compra no es recurrente.';end if;
 v_controls:=coalesce(v_settings->'purchaseControls','{}'::jsonb);
 v_control:=coalesce(v_controls->p_purchase_id,'{}'::jsonb);
 if p_action='end' then v_control:=v_control||jsonb_build_object('endMonth',p_month);end if;
 if p_action='resume' then v_control:=v_control-'endMonth';end if;
 if p_action='delete' then v_control:=v_control||'{"deleted":true}'::jsonb;end if;
 if p_action='restore' then v_control:=v_control-'deleted';end if;
 v_control:=v_control||jsonb_build_object('updatedAt',now());
 v_controls:=jsonb_set(v_controls,array[p_purchase_id],v_control,true);
 update public.ct_books set settings=jsonb_set(settings,'{purchaseControls}',v_controls,true) where owner_id=v_owner;
 return jsonb_build_object('purchaseId',p_purchase_id,'control',v_control);
end $$;
revoke all on function public.ct_manage_purchase(text,text,text) from public,anon;
grant execute on function public.ct_manage_purchase(text,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
