import {paymentImage} from './share.js';
import {CardCloud} from './cloud.js';
import {supabaseConfig} from './config.js';
import {report,validatePurchase,cents,paymentBreakdown,bankPeriod,validateMonthAdjustment,withMonthAdjustment} from './finance.js';
const $=s=>document.querySelector(s), money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v/100);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,added=[],mode='local',saving=false,cloudBusy=false,captureId=null,lastCloudRead=0,cloudOwner=null,monthSaving=false,editContext=null;const controlKey='control-tarjetas-controls-v1';const adjustmentKey='control-tarjetas-monthly-v1';const key='control-tarjetas-new-v1';
const cloud=new CardCloud(supabaseConfig);
const shortcutRequested=new URL(location.href).searchParams.get('nuevo')==='1';let shortcutOpened=false;
const isLocal=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
function cardLabel(c){const labels={'TAR-BBVAORO-BBVA-01':'BBVA Oro','TAR-JOY-BANAMEX-02':'Banamex Joy','TAR-Platino-BANREJIO-03':'Banregio Platino','TAR-Mas-BANREJIO-04':'Banregio Más','TAR-Platino-BANORTE-05':'Banorte Platino','TAR-PlatinoAMEX-AMEX-06':'AMEX Platino','TAR-MercadoLibre-MercadoPago-08':'Mercado Pago'};return labels[c.id]||c.name;}
function paymentButton(person,card,label,cls=''){return `<button class="payment-trigger ${cls}" data-person="${esc(person)}" data-card="${esc(card)}" aria-label="Ver detalle de ${esc(name(person,data.people))}${card?' en '+esc(name(card,data.cards)):''}">${esc(label)}</button>`;}
function renderPayment(){
 const person=$('#payment-person').value,card=$('#payment-card').value,month=$('#payment-month').value;if(!person||!month)return;
 const r=paymentBreakdown(data,month,added,person,card),historical=month<data.baseline&&!r.isSnapshot;
 $('#payment-context').textContent=name(person,data.people)+' · '+(card?name(card,data.cards):'Todas las tarjetas');
 $('#payment-total').textContent=historical?'Sin determinar':money(r.total);
 $('#payment-note').textContent=r.isSnapshot?'Recurrentes, MSI y compras confirmadas de noviembre. El mes indica el pago previsto, aunque lo realices entre el 30 y el 8. No registra pagos ni abonos.':historical?'No hay información confirmada para reconstruir este mes anterior al Excel.':r.estimated?`Incluye ${money(r.estimated)} de recurrentes de referencia por confirmar. No acredita un pago recibido.`:'Importes previstos para el mes seleccionado. No acredita un pago recibido.';
 const actions=(p,excluded=false)=>`<div class="month-line-actions"><button type="button" class="month-action secondary" data-month-action="edit" data-id="${esc(p.id)}">Ajustar</button><button type="button" class="month-action secondary" data-month-action="${excluded?'include':'skip'}" data-id="${esc(p.id)}">${excluded?'Volver a incluir':'No aplica este mes'}</button>${p.adjusted||excluded?`<button type="button" class="month-action subtle" data-month-action="reset" data-id="${esc(p.id)}">Restaurar original</button>`:''}</div>`;
 const lineHtml=(p,excluded=false)=>{const type=p.kind==='msi'?'MSI':p.kind==='recurring'?'Recurrente':'Compra o cuota';const seq=p.sequence&&p.terms>1?` · Mensualidad ${p.sequence} de ${p.terms}`:'';const original=p.adjustment?.amountCents??p.baseValue;return `<article class="payment-line ${excluded?'skipped-line':''}"><div><h3>${esc(p.description)}</h3><p>${esc(name(p.card,data.cards))} · ${type}${seq}</p><small>Compra original: ${money(cents(p.amount))}${p.estimate?' · Vigencia por confirmar':''}</small>${excluded?'<span class="adjustment-tag excluded-tag">No aplica este mes</span>':p.adjusted?'<span class="adjustment-tag">Importe ajustado solo este mes</span>':''}${actions(p,excluded)}${managementActions(p)}</div><strong>${excluded?`<s>${original===null?'Sin importe base':money(original)}</s>`:money(p.value)}</strong></article>`;};
 $('#payment-lines').innerHTML=r.lines.map(p=>lineHtml(p)).join('')||'<div class="empty-payment">'+(historical?'No hay un desglose histórico confirmado.':'No hay cargos incluidos para esta selección.')+'</div>';
 $('#payment-skipped-section').hidden=!r.skipped.length;$('#payment-skipped').innerHTML=r.skipped.map(p=>lineHtml(p,true)).join('');
 $('#payment-unassigned').textContent=!historical&&r.unknown.length?`${r.unknown.length} registros conservados de esta selección quedan fuera del plan de recurrentes y MSI; consulta «Por revisar».`:'';
}
function openPayment(person,card=''){$('#payment-feedback').textContent='';$('#payment-person').value=person;$('#payment-card').value=card;$('#payment-month').value=$('#month').value;renderPayment();$('#payment-dialog').showModal();}

function name(id,items){const item=items.find(p=>p.id===id);return item?(items===data.cards?cardLabel(item):item.name):id;}
function table(target,headers,rows){$(target).innerHTML='<thead><tr>'+headers.map(t=>'<th>'+esc(t)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(t=>'<td>'+esc(t)+'</td>').join('')+'</tr>').join('')+'</tbody>';}
function render(){
 if(!data)return;
 const month=$('#month').value;if(!month)return;
 const result=report(data,month,added),historical=month<data.baseline&&!result.isSnapshot;const banks=bankPeriod(data,month,result);const bankByCard=new Map(banks.map(b=>[b.card,b]));const recurringTotal=result.lines.filter(p=>p.kind==='recurring').reduce((s,p)=>s+p.value,0);const newNormalTotal=result.lines.filter(p=>p.kind==='normal').reduce((s,p)=>s+p.value,0);
 $('#total').textContent=historical?'No determinado':money(result.total);
 $('#scheduled-total').textContent=historical?'Sin determinar':money(result.total-recurringTotal);
 $('#recurring-total').textContent=historical?'Sin determinar':money(recurringTotal);
 $('#card-totals').innerHTML=data.cards.map((card,i)=>{const total=[...result.cells].reduce((s,[k,v])=>s+(k.split('|')[1]===card.id?v:0),0);return `<article class="bank-tile" data-color="${i%4}"><div class="bank-heading"><span class="bank-symbol" aria-hidden="true">${esc(cardLabel(card).slice(0,1))}</span><span>${esc(cardLabel(card))}</span></div><strong>${historical?'Sin determinar':money(total)}</strong><span class="tile-caption ${bankByCard.get(card.id)?.status==='pending'?'bank-pending':''}">${bankByCard.get(card.id)?.status==='pending'?'Pendiente al banco':bankByCard.get(card.id)?.status==='paid'?'Pagada al banco':bankByCard.get(card.id)?.status==='review'?'Pago por confirmar':'Previsto este mes'}</span></article>`;}).join('');
 const monthLabel=new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));
 $('#total-label').textContent=(result.isSnapshot?'Cargos del mes · ':'Total previsto · ')+monthLabel; if(result.adjustmentCount)$('#notice').dataset.adjusted='true';else delete $('#notice').dataset.adjusted;
 $('#scheduled-label').textContent='MSI y compras programadas';
 $('#recurring-label').textContent='Recurrentes del mes';
 $('#scheduled-hint').textContent='Cuotas del mes seleccionado';
 $('#recurring-hint').textContent=result.estimated?'Importes de referencia por confirmar':'Importes del mes seleccionado';
 $('#breakdown').textContent=historical?'No hay datos confirmados para reconstruir este mes.':`${money(result.total-recurringTotal)} en MSI${newNormalTotal?' y compras con mes confirmado':''} + ${money(recurringTotal)} en recurrentes`;
 $('#notice').classList.toggle('warning',historical||result.unknown.length>0||result.isSnapshot);
 $('#notice').textContent=result.isSnapshot?'Plan de pago de noviembre: recurrentes, MSI y compras con mes confirmado. Las demás compras originales se conservan fuera del plan. Pagar entre el 30 y el 8 no cambia por sí solo el mes del cargo.':historical?'El Excel corresponde a noviembre de 2026. Para meses anteriores falta el historial comprobado.':`Del Excel original solo se incluyen MSI pendientes y recurrentes. ${result.unknown.length} registros con cuotas sin marca MSI quedan en «Por revisar»; no se borran ni se suman automáticamente.`;
 $('#matrix-caption').textContent=result.isSnapshot?'Importes confirmados de noviembre':'Incluye recurrentes de referencia';
 if(result.adjustmentCount)$('#notice').textContent+=` Hay ${result.adjustmentCount} ajustes exclusivos de este mes; no cambian compras originales ni registran pagos.`;
 const active=data.people.filter(p=>[...data.purchases,...added].some(x=>x.person===p.id));
 let html='<thead><tr><th>Persona</th>'+data.cards.map(c=>'<th>'+esc(cardLabel(c))+'</th>').join('')+'<th>Total persona</th></tr></thead><tbody>';
 for(const p of active){let total=0;html+='<tr><td>'+paymentButton(p.id,'',p.name,'person-link')+'</td>';for(const c of data.cards){const v=result.cells.get(p.id+'|'+c.id)||0;const canOpen=v||result.skipped.some(x=>x.person===p.id&&x.card===c.id)||result.lines.some(x=>x.person===p.id&&x.card===c.id&&x.adjusted);total+=v;html+=`<td class="${v?'':'zero'}">${historical?'Sin determinar':canOpen?paymentButton(p.id,c.id,money(v)):money(v)}</td>`;}html+='<td><b>'+(historical?'Sin determinar':money(total))+'</b></td></tr>';}
 html+='</tbody><tfoot><tr><td>Total tarjeta</td>'+data.cards.map(c=>'<td>'+(historical?'Sin determinar':money(active.reduce((s,p)=>s+(result.cells.get(p.id+'|'+c.id)||0),0)))+'</td>').join('')+'<td>'+(historical?'Sin determinar':money(result.total))+'</td></tr></tfoot>';$('#matrix').innerHTML=html;
 $('#mobile-people').innerHTML=active.map(p=>{const entries=data.cards.map(c=>({id:c.id,name:cardLabel(c),value:result.cells.get(p.id+'|'+c.id)||0})).filter(c=>c.value||result.skipped.some(x=>x.person===p.id&&x.card===c.id)||result.lines.some(x=>x.person===p.id&&x.card===c.id&&x.adjusted));const total=entries.reduce((s,c)=>s+c.value,0);return `<details class="person-card"><summary><span class="avatar">${esc(p.name.slice(0,1))}</span><span class="person-name">${esc(p.name)}<small>${historical?'Histórico incompleto':entries.length+(entries.length===1?' tarjeta en el detalle':' tarjetas en el detalle')}</small></span><b>${historical?'Sin determinar':money(total)}</b><span class="chevron" aria-hidden="true">⌄</span></summary><div class="person-breakdown">${entries.map(c=>`<div>${paymentButton(p.id,c.id,c.name,'mobile-card-link')}<strong>${money(c.value)}</strong></div>`).join('')||'<p>Sin importe proyectado para este mes.</p>'}</div></details>`;}).join('');
 table('#details',['Persona','Tarjeta','Concepto','Tipo','Importe del mes'],result.lines.map(p=>[name(p.person,data.people),name(p.card,data.cards),p.description,p.estimate?'Recurrente por confirmar':p.kind==='msi'?'MSI':p.kind==='recurring'?'Recurrente mensual':'Compra o cuota',money(p.value)]));
 table('#purchases',['Concepto','Persona','Tarjeta','Importe original','Cuotas','Meses pagados originales'],[...data.purchases,...added].map(p=>[p.description,name(p.person,data.people),name(p.card,data.cards),money(cents(p.amount)),p.terms,p.paid??'Sin dato']));
 const purchaseRows=[...data.purchases,...added];
 $('#purchases tbody').innerHTML=purchaseRows.map(p=>{const c=data.purchaseControls?.[p.id];return '<tr>'+[p.description,name(p.person,data.people),name(p.card,data.cards),money(cents(p.amount)),p.terms,p.paid??'Sin dato'].map(v=>'<td>'+esc(v)+'</td>').join('')+'<td>'+(c?.deleted?'<span>En papelera · excluida de todos los meses</span>':c?.endMonth?'<span>Sin cargos desde '+esc(formatMonth(c.endMonth))+'</span>':'Activa')+managementActions(p,true)+'</td></tr>';}).join('');
 $('#purchases thead tr').insertAdjacentHTML('beforeend','<th>Gestionar</th>');
 const unresolved=result.unknown;
 $('#pending-count').textContent=`(${unresolved.length})`;
 table('#pending',['Concepto','Persona','Tarjeta','Importe original','Qué falta'],unresolved.map(p=>[p.description,name(p.person,data.people),name(p.card,data.cards),money(cents(p.amount)),p.reviewReason||'Confirmar tipo o periodo de cobro']));
}
document.querySelectorAll('[data-view]').forEach(button=>{button.setAttribute('aria-pressed',String(button.classList.contains('selected')));button.onclick=()=>{document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==button.dataset.view);document.querySelectorAll('.tab').forEach(b=>{b.classList.toggle('selected',b===button);b.setAttribute('aria-pressed',String(b===button));});};});
$('#month').onchange=render;
for(const [id,step]of [['previous-month',-1],['next-month',1]])$('#'+id).onclick=()=>{const value=$('#month').value;if(!value)return;const [y,m]=value.split('-').map(Number);const next=new Date(Date.UTC(y,m-1+step,1));$('#month').value=next.toISOString().slice(0,7);render();};
$('#new').onclick=()=>{captureId=crypto.randomUUID();$('#error').textContent='';$('#form').elements.start.value=$('#month').value;$('#dialog').showModal();};
$('#close').onclick=()=>$('#dialog').close();
$('#form').elements.kind.onchange=()=>{const f=$('#form').elements;f.terms.value=1;f.terms.disabled=f.kind.value!=='msi';$('#terms-label').hidden=f.kind.value!=='msi';};
$('#form').elements.terms.disabled=true;
$('#terms-label').hidden=true;
$('#form').onsubmit=async e=>{
 e.preventDefault();if(saving||!data)return;const f=e.target.elements;const submit=e.target.querySelector('[type=submit]');saving=true;submit.disabled=true;submit.textContent='Guardando…';$('#error').textContent='';
 try{
  const terms=f.kind.value==='msi'?Number(f.terms.value):1,amount=Number(f.amount.value),regular=Math.round(cents(amount)/terms);
  const p=validatePurchase({id:captureId||(captureId=crypto.randomUUID()),person:f.person.value,card:f.card.value,description:f.description.value.trim(),amount,terms,paid:0,remaining:terms,installment:regular/100,lastInstallment:(cents(amount)-regular*(terms-1))/100,msi:f.kind.value==='msi',recurring:f.kind.value==='recurring',start:f.start.value,legacy:false});
  if(mode==='cloud'){const saved=await cloud.savePurchase(p);added=[...added.filter(x=>x.id!==saved.id),saved];markCloudReady();}else{const next=[...added,p];localStorage.setItem(key,JSON.stringify(next));added=next;}$('#month').value=p.start;$('#dialog').close();e.target.reset();f.terms.disabled=true;$('#terms-label').hidden=true;render();
 }catch(error){$('#error').textContent=error.message;}finally{saving=false;submit.disabled=false;submit.textContent='Guardar compra';}
};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),base:data,added},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='respaldo-tarjetas-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
function fillControls(){
 $('#source-count').textContent=data.purchases.length+' compras originales conservadas; las de papelera no se suman.';
 $('#payment-person').innerHTML=data.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
 $('#payment-card').innerHTML='<option value="">Todas las tarjetas</option>'+data.cards.map(c=>`<option value="${esc(c.id)}">${esc(cardLabel(c))}</option>`).join('');
 for(const [field,items]of [['person',data.people],['card',data.cards]])$('#form').elements[field].innerHTML=items.map(p=>`<option value="${esc(p.id)}">${esc(items===data.cards?cardLabel(p):p.name)}</option>`).join('');
 $('#new').disabled=false;$('#export').disabled=false;$('#main-content').hidden=false;render();maybeOpenQuickCapture();
}
function readLocalAdded(book){
 const saved=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(saved))throw Error('No se pudo leer el registro local. No se ha borrado.');
 const filtered=saved.filter(p=>!book.excludedCardIds?.includes(p.card));if(filtered.length!==saved.length)localStorage.setItem(key,JSON.stringify(filtered));return filtered;
}
function accountMessage(text,error=false){$('#account-message').textContent=text;$('#account-message').classList.toggle('error',error);}
function updateAccount(){
 const session=cloud.session();$('#login-form').hidden=!!session;$('#connected-account').hidden=!session;
 $('#account-email').textContent=session?.user?.email||'';$('#account-open').textContent=session?'Mi cuenta':isLocal?'Conectar mi cuenta':'Iniciar sesión';
 $('#import-local').hidden=!session||!isLocal;
 $('#sync-description').textContent=mode==='cloud'?(isLocal?'Tus compras se guardan en tu cuenta. Podrás consultarlas desde otros dispositivos al publicar la aplicación.':'Tus compras se guardan en tu cuenta. Usa este mismo acceso en tus otros dispositivos.'):'La sesión está abierta. Falta preparar o importar las compras para activar la sincronización.';
}
function markCloudReady(){
 mode='cloud';cloudOwner=cloud.session()?.user?.id;lastCloudRead=Date.now();document.body.classList.add('cloud-mode');$('#connection-status').textContent='Conectado a Supabase';
 $('#storage-note').textContent='Compras guardadas en tu cuenta de Supabase.';$('#deployment-note').textContent=isLocal?'Conexión privada lista. Publicación en Netlify y Atajo del iPhone pendientes.':'Tu cuenta está sincronizada con Supabase. El Atajo del iPhone está pendiente de configurar.';
 $('#cloud-banner').hidden=true;updateAccount();
}
function showCloudProblem(error){
 accountMessage(error.message,true);updateAccount();$('#cloud-banner').hidden=false;
 $('#cloud-banner-text').textContent=mode==='cloud'?'No se pudo actualizar desde Supabase. Los datos visibles son la última lectura; las nuevas compras solo se confirman si se guardan en la nube.':'La nube aún no está lista. Esta vista sigue siendo local; las compras nuevas se guardan solo en este navegador.';
 $('#connection-status').textContent=mode==='cloud'?'Sincronización pendiente':'Solo en este navegador';
}
async function loadLocal(){
 if(!isLocal)throw Error('Inicia sesión para cargar tus compras.');
 const response=await fetch('/data/base.json');if(!response.ok)throw Error('No se pudieron cargar las compras locales.');
 data=await response.json();const localMonths=JSON.parse(localStorage.getItem(adjustmentKey)||'{}');if(!localMonths||typeof localMonths!=='object'||Array.isArray(localMonths))throw Error('No se pudieron leer los ajustes locales; se conserva el registro sin borrar.');data={...data,monthAdjustments:localMonths,purchaseControls:JSON.parse(localStorage.getItem(controlKey)||'{}')};added=readLocalAdded(data);mode='local';document.body.classList.remove('cloud-mode');$('#connection-status').textContent='Vista previa local';$('#storage-note').textContent='Las compras nuevas se guardan en este navegador.';fillControls();
}
async function loadCloud(){
 if(cloudBusy||saving||monthSaving)return false;cloudBusy=true;
 try{
  const book=await cloud.load();
  if(!book){accountMessage(isLocal?'La base está preparada. Pulsa «Subir mis compras a esta cuenta».':'Esta cuenta todavía no tiene compras. La primera importación se realiza desde la versión local en tu computadora.');$('#cloud-banner').hidden=false;$('#cloud-banner-text').textContent='Tu cuenta todavía no tiene compras. Abre Mi cuenta para importar las compras originales.';updateAccount();return false;}
  data={...book,purchases:book.purchases.filter(p=>p.legacy)};added=book.purchases.filter(p=>!p.legacy);markCloudReady();fillControls();return true;
 }finally{cloudBusy=false;}
}
$('#account-open').onclick=()=>{updateAccount();$('#account-dialog').showModal();};
$('#account-close').onclick=()=>$('#account-dialog').close();
$('#cloud-banner-action').onclick=()=>$('#account-open').click();
$('#login-form').onsubmit=async e=>{
 e.preventDefault();const button=$('#login-submit');button.disabled=true;accountMessage('Conectando…');
 try{await cloud.signIn($('#login-email').value,$('#login-password').value);$('#login-password').value='';updateAccount();if(await loadCloud()){accountMessage('Cuenta conectada y compras actualizadas.');$('#account-dialog').close();}}
 catch(error){showCloudProblem(error);}finally{button.disabled=false;}
};
$('#refresh-cloud').onclick=async()=>{const b=$('#refresh-cloud');b.disabled=true;try{if(await loadCloud())accountMessage('Compras actualizadas desde Supabase.');}catch(error){showCloudProblem(error);}finally{b.disabled=false;}};
$('#import-local').onclick=async()=>{
 const button=$('#import-local');button.disabled=true;accountMessage('Preparando tus compras originales…');
 try{
  const response=await fetch('/data/base.json');if(!response.ok)throw Error('Abre la aplicación en la computadora donde está el proyecto para importar.');
  const base=await response.json();const extras=readLocalAdded(base);await cloud.initialize(base);
  for(let i=0;i<extras.length;i++){accountMessage(`Guardando compra local ${i+1} de ${extras.length}…`);await cloud.savePurchase(extras[i]);}
  const localMonths=JSON.parse(localStorage.getItem(adjustmentKey)||'{}');const pendingAdjustments=Object.entries(localMonths).flatMap(([month,items])=>Object.entries(items).map(([id,item])=>({id,month,amountCents:item.amountCents,skipped:item.skipped})));
  let adjustmentsCopied=true;
  if(pendingAdjustments.length){
   const existing=await cloud.load();const conflicts=pendingAdjustments.filter(c=>{const old=existing?.monthAdjustments?.[c.month]?.[c.id];return old&&(old.amountCents!==c.amountCents||old.skipped!==c.skipped);});
   adjustmentsCopied=!conflicts.length||confirm(`Hay ${conflicts.length} ajustes locales distintos de los que ya están en tu cuenta. ¿Quieres reemplazar esos ajustes de los mismos meses y compras?`);
   if(adjustmentsCopied)for(const change of pendingAdjustments){validateMonthAdjustment(change);await cloud.saveMonthAdjustment(change);}
  }
  const controls=JSON.parse(localStorage.getItem(controlKey)||'{}');
  if(Object.keys(controls).length&&confirm('¿Copiar también las finalizaciones y la papelera de este navegador a tu cuenta?')){
   for(const [id,c] of Object.entries(controls)){if(c.endMonth)await cloud.savePurchaseControl(id,'end',c.endMonth);if(c.deleted)await cloud.savePurchaseControl(id,'delete',null);}
  }
  await loadCloud();accountMessage(adjustmentsCopied?'Compras y ajustes guardados en tu cuenta. Se conserva también la copia local.':'Compras guardadas. No se copiaron los ajustes locales; se conservan en este navegador.');
 }catch(error){showCloudProblem(error);}finally{button.disabled=false;}
};
$('#sign-out').onclick=async()=>{
 try{await cloud.signOut();}catch{accountMessage('La sesión de este dispositivo se cerró.');}
 if($('#share-dialog').open)$('#share-dialog').close();clearSharedImage();mode='local';data=undefined;added=[];document.body.classList.remove('cloud-mode');
 for(const id of ['matrix','details','purchases','pending','card-totals','mobile-people','payment-lines'])$('#'+id).innerHTML='';
 $('#total').textContent='—';$('#scheduled-total').textContent='—';$('#recurring-total').textContent='—';$('#new').disabled=true;$('#export').disabled=true;$('#main-content').hidden=true;$('#connection-status').textContent='Sin sesión';
 if(isLocal)await loadLocal();updateAccount();accountMessage('Sesión cerrada en este dispositivo.');
};
window.addEventListener('storage',async event=>{
 if(event.key!==cloud.sessionKey||mode!=='cloud'||cloud.session()?.user?.id===cloudOwner)return;
 data=undefined;added=[];mode='local';document.body.classList.remove('cloud-mode');$('#main-content').hidden=true;$('#new').disabled=true;$('#export').disabled=true;
 for(const id of ['matrix','details','purchases','pending','card-totals','mobile-people','payment-lines'])$('#'+id).innerHTML='';
 $('#total').textContent='—';$('#scheduled-total').textContent='—';$('#recurring-total').textContent='—';$('#connection-status').textContent='Acceso actualizado';
 if($('#share-dialog').open)$('#share-dialog').close();clearSharedImage();if($('#manage-dialog').open)$('#manage-dialog').close();if($('#month-adjust-dialog').open)$('#month-adjust-dialog').close();if($('#payment-dialog').open)$('#payment-dialog').close();if($('#dialog').open)$('#dialog').close();updateAccount();
 if(cloud.session()){try{await loadCloud();}catch(error){showCloudProblem(error);}}
 if(!data&&!$('#account-dialog').open)$('#account-dialog').showModal();
});
async function refreshIfNeeded(){if(mode!=='cloud'||monthSaving||document.hidden||Date.now()-lastCloudRead<15000||$('#dialog').open||$('#account-dialog').open||$('#payment-dialog').open||$('#month-adjust-dialog').open||$('#manage-dialog').open)return;try{await loadCloud();}catch(error){showCloudProblem(error);}}
window.addEventListener('focus',refreshIfNeeded);setInterval(refreshIfNeeded,60000);
try{
 $('#new').disabled=true;$('#export').disabled=true;
 if(isLocal)await loadLocal();else{$('#main-content').hidden=true;$('#connection-status').textContent='Acceso privado';}
 updateAccount();if(cloud.session()){try{await loadCloud();}catch(error){showCloudProblem(error);}}else if(!isLocal)$('#account-dialog').showModal();if(!data&&!$('#account-dialog').open)$('#account-dialog').showModal();
}catch(error){$('#notice').textContent=error.message;$('#notice').classList.add('warning');$('#new').disabled=true;accountMessage(error.message,true);}

document.addEventListener('click',e=>{const button=e.target.closest('.payment-trigger');if(button)openPayment(button.dataset.person,button.dataset.card);});
$('#payment-close').onclick=()=>$('#payment-dialog').close();
for(const id of ['payment-person','payment-card'])$('#'+id).onchange=renderPayment;
$('#payment-month').onchange=()=>{if(!$('#payment-month').value)return;$('#month').value=$('#payment-month').value;render();renderPayment();};


function formatMonth(month){return new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'));}
function monthlyRow(id,month){const r=report(data,month,added);return [...r.lines,...r.skipped].find(p=>p.id===id);}
function openMonthEditor(id){
 const month=$('#payment-month').value,row=monthlyRow(id,month);if(!row)return;
 editContext={id,month,row};$('#month-adjust-title').textContent=row.description;$('#month-adjust-context').textContent=name(row.person,data.people)+' · '+name(row.card,data.cards);$('#month-adjust-period').textContent=formatMonth(month);
 const value=row.adjustment?.amountCents??row.baseValue;$('#month-adjust-amount').value=value===null?'':(value/100).toFixed(2);$('#month-adjust-skipped').checked=!!row.adjustment?.skipped;$('#month-adjust-amount').disabled=$('#month-adjust-skipped').checked;
 $('#month-adjust-help').textContent=(row.baseValue===null?'Sin importe programado original para este mes.':`Importe original de este mes: ${money(row.baseValue)}.`)+' Solo se ajusta este mes; los demás conservan su programación. No registra un pago.'+(row.msi?' En MSI, excluir este mes no reprograma la cuota ni modifica los meses pagados.':'');
 $('#month-adjust-error').textContent='';$('#month-adjust-dialog').showModal();
}
async function saveMonthChange(change){
 validateMonthAdjustment(change);if(monthSaving)throw Error('Espera a que termine el ajuste anterior.');monthSaving=true;
 document.querySelectorAll('.month-action,#month-adjust-save,#month-adjust-reset').forEach(b=>b.disabled=true);$('#payment-feedback').textContent='Guardando ajuste…';
 try{
  let value=change.amountCents===null&&!change.skipped?null:{amountCents:change.amountCents,skipped:change.skipped,updatedAt:new Date().toISOString()};
  if(mode==='cloud'){const saved=await cloud.saveMonthAdjustment(change);if(saved.purchaseId!==change.id||saved.month!==change.month)throw Error('La respuesta del ajuste no coincide. Actualiza antes de continuar.');value=saved.adjustment;}
  const next=withMonthAdjustment(data,change,value);if(mode!=='cloud')localStorage.setItem(adjustmentKey,JSON.stringify(next.monthAdjustments));data=next;render();renderPayment();$('#payment-feedback').textContent='Ajuste guardado solo para '+formatMonth(change.month)+'.';
 }catch(error){$('#payment-feedback').textContent=error.message;throw error;}
 finally{monthSaving=false;document.querySelectorAll('.month-action,#month-adjust-save,#month-adjust-reset').forEach(b=>b.disabled=false);}
}
document.addEventListener('click',async e=>{
 const button=e.target.closest('[data-month-action]');if(!button||monthSaving)return;
 const id=button.dataset.id,month=$('#payment-month').value,row=monthlyRow(id,month);if(!row)return;
 if(button.dataset.monthAction==='edit'){openMonthEditor(id);return;}
 const action=button.dataset.monthAction,change={id,month,amountCents:action==='reset'?null:row.adjustment?.amountCents??null,skipped:action==='skip'};
 try{await saveMonthChange(change);}catch{/* The dialog displays the error and the old totals remain. */}
});
$('#month-adjust-close').onclick=()=>$('#month-adjust-dialog').close();
$('#month-adjust-skipped').onchange=()=>$('#month-adjust-amount').disabled=$('#month-adjust-skipped').checked;
$('#month-adjust-form').onsubmit=async e=>{
 e.preventDefault();if(!editContext||monthSaving)return;$('#month-adjust-error').textContent='';
 try{
  const raw=$('#month-adjust-amount').value,number=Number(raw),skipped=$('#month-adjust-skipped').checked;
  if((!raw&&!skipped)||!Number.isFinite(number)||Math.abs(number*100-Math.round(number*100))>0.000001)throw Error('Escribe un importe válido con máximo dos decimales.');
  const requested=!raw&&skipped?editContext.row.adjustment?.amountCents??null:Math.round(number*100);const amountCents=requested===editContext.row.baseValue?null:requested;
  await saveMonthChange({id:editContext.id,month:editContext.month,amountCents,skipped});$('#month-adjust-dialog').close();editContext=null;
 }catch(error){$('#month-adjust-error').textContent=error.message;}
};
$('#month-adjust-reset').onclick=async()=>{if(!editContext||monthSaving)return;try{await saveMonthChange({id:editContext.id,month:editContext.month,amountCents:null,skipped:false});$('#month-adjust-dialog').close();editContext=null;}catch(error){$('#month-adjust-error').textContent=error.message;}};

function managementActions(p,all=false){
 const c=data.purchaseControls?.[p.id];
 return `<div class="month-line-actions">${c?.deleted?`<button type="button" class="secondary" data-manage="restore" data-id="${esc(p.id)}">Restaurar de papelera</button>`:`${p.recurring?`<button type="button" class="secondary" data-manage="${c?.endMonth?'resume':'end'}" data-id="${esc(p.id)}">${c?.endMonth?'Reactivar recurrente':'Finalizar recurrente'}</button>`:''}<button type="button" class="subtle" data-manage="delete" data-id="${esc(p.id)}">Eliminar compra</button>`}</div>`;
}
let manageContext=null;
document.addEventListener('click',e=>{
 const b=e.target.closest('[data-manage]');if(!b||monthSaving)return;
 const p=[...data.purchases,...added].find(x=>x.id===b.dataset.id);if(!p)return;
 manageContext={id:p.id,action:b.dataset.manage};
 $('#manage-title').textContent=({end:'Finalizar recurrente',resume:'Reactivar recurrente',delete:'Eliminar compra',restore:'Restaurar compra'})[b.dataset.manage];
 $('#manage-concept').textContent=p.description+' · '+name(p.person,data.people)+' · '+name(p.card,data.cards);
 $('#manage-month-label').hidden=b.dataset.manage!=='end';$('#manage-month').value=$('#payment-dialog').open?$('#payment-month').value:$('#month').value;
 $('#manage-note').textContent=({end:'No se incluirá desde el mes que elijas. Los meses anteriores conservan sus cargos.',resume:'Se quitará la fecha de finalización y volverá a aplicarse la programación original.',delete:'Se excluirá de TODOS los meses. Se guardará en la papelera de Compras para poder restaurarla. No registra ni cancela pagos al banco.',restore:'Volverá a incluirse con sus importes y ajustes guardados. Se conserva cualquier fecha de finalización previa.'})[b.dataset.manage];
 $('#manage-error').textContent='';$('#manage-dialog').showModal();
});
$('#manage-close').onclick=()=>$('#manage-dialog').close();
$('#manage-form').onsubmit=async e=>{
 e.preventDefault();if(!manageContext||monthSaving)return;
 const {id,action}=manageContext,month=$('#manage-month').value;
 if(action==='end'&&!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month)){$('#manage-error').textContent='Selecciona un mes válido.';return;}
 monthSaving=true;$('#manage-save').disabled=true;
 try{
  let control={...(data.purchaseControls?.[id]||{})};
  if(action==='end')control.endMonth=month;if(action==='resume')delete control.endMonth;if(action==='delete')control.deleted=true;if(action==='restore')delete control.deleted;
  if(mode==='cloud'){const saved=await cloud.savePurchaseControl(id,action,month);if(saved.purchaseId!==id)throw Error('No coincide la compra guardada.');control=saved.control;}
  const controls={...(data.purchaseControls||{}),[id]:control};if(mode!=='cloud')localStorage.setItem(controlKey,JSON.stringify(controls));
  data={...data,purchaseControls:controls};render();if($('#payment-dialog').open)renderPayment();$('#manage-dialog').close();manageContext=null;
 }catch(error){$('#manage-error').textContent=error.message;}finally{monthSaving=false;$('#manage-save').disabled=false;}
};

let sharedImage=null,sharedUrl=null;
function clearSharedImage(){if(sharedUrl)URL.revokeObjectURL(sharedUrl);sharedUrl=null;sharedImage=null;$('#share-preview').removeAttribute('src');}
$('#payment-share').onclick=async()=>{
 if(!data)return;const button=$('#payment-share');button.disabled=true;
 try{
 const person=$('#payment-person').value,month=$('#payment-month').value,card=$('#payment-card').value;
 const r=paymentBreakdown(data,month,added,person,card),historical=month<data.baseline&&!r.isSnapshot;
 const {canvas}=paymentImage({person:name(person,data.people),month:formatMonth(month),cards:data.cards.filter(c=>!card||c.id===card).map(c=>({id:c.id,name:cardLabel(c)})),lines:r.lines,skipped:r.skipped,unknownCount:r.unknown.length,historical});
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('No se pudo generar la imagen.')),'image/png'));
 clearSharedImage();const safe=person.replace(/[^a-z0-9-]/gi,'-');sharedImage=new File([blob],`Resumen-${safe}-${month}.png`,{type:'image/png'});sharedUrl=URL.createObjectURL(blob);$('#share-preview').src=sharedUrl;$('#share-preview').alt='Resumen de '+name(person,data.people)+' de '+formatMonth(month);$('#share-status').textContent='Solo incluye a la persona y tarjetas seleccionadas. Revisa los importes antes de enviarlo.';$('#share-dialog').showModal();
 }catch(error){$('#payment-feedback').textContent=error.message;}finally{button.disabled=false;}
};
$('#share-close').onclick=()=>$('#share-dialog').close();
$('#share-download').onclick=()=>{if(!sharedImage)return;const a=document.createElement('a');a.href=sharedUrl;a.download=sharedImage.name;a.click();$('#share-status').textContent='Imagen descargada. Puedes enviarla a la persona.';};
$('#share-send').onclick=async()=>{if(!sharedImage)return;try{if(navigator.canShare?.({files:[sharedImage]})){await navigator.share({files:[sharedImage],title:'Resumen de tarjetas'});$('#share-status').textContent='Se cerró la ventana de compartir.';}else{$('#share-status').textContent='Descarga la imagen y adjúntala en WhatsApp o en la aplicación que prefieras.';$('#share-download').click();}}catch(error){if(error.name!=='AbortError')$('#share-status').textContent='No se pudo compartir. Usa Descargar imagen.';}};

function maybeOpenQuickCapture(){
 if(!shortcutRequested||shortcutOpened||!data||$('#account-dialog').open||$('#dialog').open)return;
 if(mode!=='cloud'&&(!isLocal||cloud.session()))return;
 shortcutOpened=true;const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit'}).formatToParts(new Date());
 $('#month').value=parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;render();$('#new').click();
 const url=new URL(location.href);url.searchParams.delete('nuevo');history.replaceState(null,'',url.pathname+url.search+url.hash);
}
$('#account-dialog').addEventListener('close',maybeOpenQuickCapture);
maybeOpenQuickCapture();

$('#shortcut-help').onclick=()=>{const url=new URL('/',location.origin);url.searchParams.set('nuevo','1');$('#shortcut-link').value=isLocal?'':url.href;$('#shortcut-copy').disabled=isLocal;$('#shortcut-status').textContent=isLocal?'Abre esta opción desde tu página publicada en Netlify para copiar el enlace que funcionará en el iPhone.':'';$('#shortcut-dialog').showModal();};
$('#shortcut-close').onclick=()=>$('#shortcut-dialog').close();
$('#shortcut-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#shortcut-link').value);$('#shortcut-status').textContent='Enlace copiado. Pégalo en la acción URL de Atajos.';}catch{$('#shortcut-link').select();$('#shortcut-status').textContent='Selecciona y copia el enlace manualmente.';}};
