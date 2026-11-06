import {paymentImage} from './share.js';
import {CardCloud} from './cloud.js';
import {supabaseConfig} from './config.js';
import {report,validatePurchase,cents,paymentBreakdown,bankPeriod,validateMonthAdjustment,withMonthAdjustment} from './finance.js';
const $=s=>document.querySelector(s), money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v/100);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,added=[],mode='local',saving=false,cloudBusy=false,captureId=null,lastCloudRead=0,cloudOwner=null,monthSaving=false,editContext=null;const entityKey='control-tarjetas-entities-v1';const bankKey='control-tarjetas-bank-v1';const controlKey='control-tarjetas-controls-v1';const adjustmentKey='control-tarjetas-monthly-v1';const key='control-tarjetas-new-v1';
const cloud=new CardCloud(supabaseConfig);
const shortcutRequested=new URL(location.href).searchParams.get('nuevo')==='1';let shortcutOpened=false;
const isLocal=['localhost','127.0.0.1','[::1]'].includes(location.hostname);
function cardLabel(c){const labels={'TAR-BBVAORO-BBVA-01':'BBVA Oro','TAR-JOY-BANAMEX-02':'Banamex Joy','TAR-Platino-BANREJIO-03':'Banregio Platino','TAR-Mas-BANREJIO-04':'Banregio Más','TAR-Platino-BANORTE-05':'Banorte Platino','TAR-PlatinoAMEX-AMEX-06':'AMEX Platino','TAR-MercadoLibre-MercadoPago-08':'Mercado Pago'};return c.displayName||labels[c.id]||c.name;}
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
 $('#card-totals').innerHTML=data.cards.map((card,i)=>{const total=[...result.cells].reduce((s,[k,v])=>s+(k.split('|')[1]===card.id?v:0),0);return `<article class="bank-tile" data-color="${i%4}"><div class="bank-heading"><span class="bank-symbol" aria-hidden="true">${esc(cardLabel(card).slice(0,1))}</span><span>${esc(cardLabel(card))}</span></div><strong>${historical?'Sin determinar':money(total)}</strong><span class="tile-caption ${bankByCard.get(card.id)?.status==='pending'?'bank-pending':''}">${bankByCard.get(card.id)?.status==='pending'?'Pendiente al banco':bankByCard.get(card.id)?.status==='paid'?'Pagada al banco':bankByCard.get(card.id)?.status==='review'?'Pago por confirmar':'Previsto este mes'}</span>${!historical?`<button type="button" class="secondary bank-status-button" data-bank-card="${esc(card.id)}" aria-label="${bankByCard.get(card.id)?.status==='paid'?'Dejar pendiente':'Marcar pagada al banco'} ${esc(cardLabel(card))}">${bankByCard.get(card.id)?.status==='paid'?'Dejar pendiente':'Marcar pagada al banco'}</button>`:''}</article>`;}).join('');
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
 const active=data.people.filter(p=>!p.archived||[...data.purchases,...added].some(x=>x.person===p.id));
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
  if(data.people.find(p=>p.id===f.person.value)?.archived||data.cards.find(c=>c.id===f.card.value)?.archived)throw Error('La persona o tarjeta está archivada.');
  const terms=f.kind.value==='msi'?Number(f.terms.value):1,amount=Number(f.amount.value),regular=Math.round(cents(amount)/terms);
  const p=validatePurchase({id:captureId||(captureId=crypto.randomUUID()),person:f.person.value,card:f.card.value,description:f.description.value.trim(),amount,terms,paid:0,remaining:terms,installment:regular/100,lastInstallment:(cents(amount)-regular*(terms-1))/100,msi:f.kind.value==='msi',recurring:f.kind.value==='recurring',start:f.start.value,legacy:false});
  if(mode==='cloud'){const saved=await cloud.savePurchase(p);added=[...added.filter(x=>x.id!==saved.id),saved];markCloudReady();}else{const next=[...added,p];localStorage.setItem(key,JSON.stringify(next));added=next;}$('#month').value=p.start;$('#dialog').close();e.target.reset();f.terms.disabled=true;$('#terms-label').hidden=true;render();
 }catch(error){$('#error').textContent=error.message;}finally{saving=false;submit.disabled=false;submit.textContent='Guardar compra';}
};
$('#export').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,exportedAt:new Date().toISOString(),base:data,added},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='respaldo-tarjetas-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
function fillControls(){
 const oldPerson=$('#payment-person').value,oldCard=$('#payment-card').value;
 $('#source-count').textContent=data.purchases.length+' compras originales conservadas; las de papelera no se suman.';
 $('#payment-person').innerHTML=data.people.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
 $('#payment-card').innerHTML='<option value="">Todas las tarjetas</option>'+data.cards.map(c=>`<option value="${esc(c.id)}">${esc(cardLabel(c))}</option>`).join('');
 for(const [field,items]of [['person',data.people],['card',data.cards]])$('#form').elements[field].innerHTML=items.filter(p=>!p.archived).map(p=>`<option value="${esc(p.id)}">${esc(items===data.cards?cardLabel(p):p.name)}</option>`).join('');
 if(data.people.some(p=>p.id===oldPerson))$('#payment-person').value=oldPerson;if(data.cards.some(c=>c.id===oldCard))$('#payment-card').value=oldCard;
 $('#new').disabled=!data.people.some(p=>!p.archived)||!data.cards.some(c=>!c.archived);$('#export').disabled=false;$('#main-content').hidden=false;render();maybeOpenQuickCapture();
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
 data=await response.json();const localMonths=JSON.parse(localStorage.getItem(adjustmentKey)||'{}');if(!localMonths||typeof localMonths!=='object'||Array.isArray(localMonths))throw Error('No se pudieron leer los ajustes locales; se conserva el registro sin borrar.');data={...data,monthAdjustments:localMonths,purchaseControls:JSON.parse(localStorage.getItem(controlKey)||'{}'),bankPayments:JSON.parse(localStorage.getItem(bankKey)||'{}')};data=applyLocalEntities(data);added=readLocalAdded(data);mode='local';document.body.classList.remove('cloud-mode');$('#connection-status').textContent='Vista previa local';$('#storage-note').textContent='Las compras nuevas se guardan en este navegador.';fillControls();
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
  const originalBase=await response.json();const base=applyLocalEntities(originalBase);const extras=readLocalAdded(base);await cloud.initialize(base);
  const catalog=JSON.parse(localStorage.getItem(entityKey)||'{}');if(Object.keys(catalog).length){const existing=await cloud.load();if(confirm('¿Copiar los nombres y estados locales de personas y tarjetas a tu cuenta?'))for(const kind of ['people','cards'])for(const item of Object.values(catalog[kind]||{})){const old=existing[kind].find(x=>x.id===item.id);await cloud.saveEntity({kind,...item,revision:old?(old.revision||0):null});}}
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
  const bankLocal=JSON.parse(localStorage.getItem(bankKey)||'{}');
  if(Object.keys(bankLocal).length&&confirm('¿Copiar también los estados bancarios de este navegador? Reemplazará los de esas tarjetas y meses en tu cuenta.')){
   for(const [month,cards] of Object.entries(bankLocal))for(const [card,status] of Object.entries(cards))await cloud.saveBankPayment(card,month,status.paid);
  }
  await loadCloud();accountMessage(adjustmentsCopied?'Compras y ajustes guardados en tu cuenta. Se conserva también la copia local.':'Compras guardadas. No se copiaron los ajustes locales; se conservan en este navegador.');
 }catch(error){showCloudProblem(error);}finally{button.disabled=false;}
};
$('#sign-out').onclick=async()=>{
 try{await cloud.signOut();}catch{accountMessage('La sesión de este dispositivo se cerró.');}
 clearConnections();clearProposals();if($('#entity-dialog').open)$('#entity-dialog').close();if($('#directory-dialog').open)$('#directory-dialog').close();$('#directory-list').innerHTML='';if($('#bank-status-dialog').open)$('#bank-status-dialog').close();if($('#share-dialog').open)$('#share-dialog').close();clearSharedImage();mode='local';data=undefined;added=[];document.body.classList.remove('cloud-mode');
 for(const id of ['matrix','details','purchases','pending','card-totals','mobile-people','payment-lines'])$('#'+id).innerHTML='';
 $('#total').textContent='—';$('#scheduled-total').textContent='—';$('#recurring-total').textContent='—';$('#new').disabled=true;$('#export').disabled=true;$('#main-content').hidden=true;$('#connection-status').textContent='Sin sesión';
 if(isLocal)await loadLocal();updateAccount();accountMessage('Sesión cerrada en este dispositivo.');
};
window.addEventListener('storage',async event=>{
 if(event.key!==cloud.sessionKey||mode!=='cloud'||cloud.session()?.user?.id===cloudOwner)return;
 data=undefined;added=[];mode='local';document.body.classList.remove('cloud-mode');$('#main-content').hidden=true;$('#new').disabled=true;$('#export').disabled=true;
 for(const id of ['matrix','details','purchases','pending','card-totals','mobile-people','payment-lines'])$('#'+id).innerHTML='';
 $('#total').textContent='—';$('#scheduled-total').textContent='—';$('#recurring-total').textContent='—';$('#connection-status').textContent='Acceso actualizado';
 clearConnections();clearProposals();if($('#entity-dialog').open)$('#entity-dialog').close();if($('#directory-dialog').open)$('#directory-dialog').close();$('#directory-list').innerHTML='';if($('#bank-status-dialog').open)$('#bank-status-dialog').close();if($('#share-dialog').open)$('#share-dialog').close();clearSharedImage();if($('#manage-dialog').open)$('#manage-dialog').close();if($('#month-adjust-dialog').open)$('#month-adjust-dialog').close();if($('#payment-dialog').open)$('#payment-dialog').close();if($('#dialog').open)$('#dialog').close();updateAccount();
 if(cloud.session()){try{await loadCloud();}catch(error){showCloudProblem(error);}}
 if(!data&&!$('#account-dialog').open)$('#account-dialog').showModal();
});
async function refreshIfNeeded(){if(mode!=='cloud'||monthSaving||document.hidden||Date.now()-lastCloudRead<15000||$('#dialog').open||$('#account-dialog').open||$('#payment-dialog').open||$('#month-adjust-dialog').open||$('#manage-dialog').open||$('#bank-status-dialog').open||$('#entity-dialog').open||$('#directory-dialog').open||$('#connections-dialog').open||$('#proposals-dialog').open||$('#proposal-review-dialog').open)return;try{await loadCloud();}catch(error){showCloudProblem(error);}}
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

let bankContext=null;
document.addEventListener('click',e=>{
 const button=e.target.closest('[data-bank-card]');if(!button||!data||monthSaving)return;
 const card=button.dataset.bankCard,month=$('#month').value,status=bankPeriod(data,month,report(data,month,added)).find(c=>c.card===card);if(!status)return;
 bankContext={card,month,paid:status.status!=='paid'};
 $('#bank-status-title').textContent=bankContext.paid?'Marcar pagada al banco':'Dejar pendiente al banco';
 $('#bank-status-context').textContent=name(card,data.cards)+' · '+formatMonth(month);
 $('#bank-status-note').textContent=bankContext.paid?'Confirma que esta tarjeta ya está pagada al banco para este mes. Los cargos se conservan en el desglose.':'La tarjeta volverá a aparecer pendiente al banco solo en este mes.';
 $('#bank-status-save').textContent=bankContext.paid?'Confirmar pagada':'Confirmar pendiente';$('#bank-status-error').textContent='';$('#bank-status-dialog').showModal();
});
$('#bank-status-close').onclick=()=>$('#bank-status-dialog').close();
$('#bank-status-dialog').addEventListener('cancel',e=>{if(monthSaving)e.preventDefault();});
$('#bank-status-form').onsubmit=async e=>{
 e.preventDefault();if(!bankContext||monthSaving||!data)return;const {card,month,paid}=bankContext;monthSaving=true;
 $('#bank-status-save').disabled=true;$('#bank-status-close').disabled=true;$('#bank-status-error').textContent='';
 try{
 let status={paid,updatedAt:new Date().toISOString()};
 if(mode==='cloud'){const result=await cloud.saveBankPayment(card,month,paid);if(result.cardId!==card||result.month!==month||result.status?.paid!==paid)throw Error('No coincide la confirmación. Actualiza antes de continuar.');status=result.status;}
 const bankPayments={...(data.bankPayments||{}),[month]:{...(data.bankPayments?.[month]||{}),[card]:status}};
 if(mode!=='cloud')localStorage.setItem(bankKey,JSON.stringify(bankPayments));data={...data,bankPayments};render();if($('#directory-dialog').open)renderDirectory();$('#bank-status-dialog').close();bankContext=null;
 }catch(error){$('#bank-status-error').textContent=error.message;}finally{monthSaving=false;$('#bank-status-save').disabled=false;$('#bank-status-close').disabled=false;}
};

let directoryKind='people',entityContext=null;
function applyLocalEntities(book){const saved=JSON.parse(localStorage.getItem(entityKey)||'{}');const next={...book};for(const kind of ['people','cards']){next[kind]=book[kind].map(x=>({...x,...saved[kind]?.[x.id]}));for(const item of Object.values(saved[kind]||{}))if(!next[kind].some(x=>x.id===item.id))next[kind].push(item);}return next;}
function renderDirectory(){
 if(!data)return;const kind=directoryKind,query=$('#directory-search').value.trim().toLocaleLowerCase(),month=$('#month').value,r=report(data,month,added),banks=bankPeriod(data,month,r);
 $('#directory-title').textContent=kind==='people'?'Personas':'Tarjetas y pagos al banco';$('#directory-add').textContent=kind==='people'?'Agregar persona':'Agregar tarjeta';$('#directory-month').textContent=formatMonth(month);
 $('#directory-list').innerHTML=data[kind].filter(x=>(kind==='cards'?cardLabel(x):x.name).toLocaleLowerCase().includes(query)).map(x=>{const amount=r.lines.filter(p=>kind==='people'?p.person===x.id:p.card===x.id).reduce((s,p)=>s+p.value,0),status=banks.find(b=>b.card===x.id)?.status;return `<article class="directory-item"><div><h3>${esc(kind==='cards'?cardLabel(x):x.name)}</h3><p>${month<data.baseline&&!r.isSnapshot?'Histórico sin determinar':money(amount)+' en cargos del mes'}${x.archived?' · Archivada para nuevas compras':''}</p>${kind==='cards'?`<p>${status==='paid'?'Pagada al banco':status==='pending'?'Pendiente al banco':'Previsto este mes'}</p>`:''}</div><div class="directory-actions"><button type="button" class="secondary" data-entity-edit="${esc(x.id)}">Editar</button>${kind==='people'?paymentButton(x.id,'','Ver detalle','secondary'):status?`<button type="button" data-bank-card="${esc(x.id)}">${status==='paid'?'Dejar pendiente':'Marcar pagada al banco'}</button>`:''}</div></article>`;}).join('')||'<p>No se encontraron registros.</p>';
}
function openDirectory(kind){directoryKind=kind;$('#directory-search').value='';renderDirectory();$('#directory-dialog').showModal();}
function openEntity(id=null){const item=id?data[directoryKind].find(x=>x.id===id):null;entityContext={kind:directoryKind,id:item?.id||crypto.randomUUID(),revision:item?(item.revision||0):null};$('#entity-title').textContent=(item?'Editar ':'Agregar ')+(directoryKind==='people'?'persona':'tarjeta');$('#entity-name').value=item?(directoryKind==='cards'?cardLabel(item):item.name):'';$('#entity-bank').value=item?.bank||'';$('#entity-bank-label').hidden=directoryKind!=='cards';$('#entity-archived').checked=!!item?.archived;$('#entity-archive-label').hidden=!item;$('#entity-error').textContent='';$('#entity-dialog').showModal();}
$('#people-manage').onclick=()=>openDirectory('people');$('#cards-manage').onclick=()=>openDirectory('cards');$('#directory-close').onclick=()=>$('#directory-dialog').close();$('#directory-search').oninput=renderDirectory;$('#directory-add').onclick=()=>openEntity();$('#directory-list').addEventListener('click',e=>{const b=e.target.closest('[data-entity-edit]');if(b)openEntity(b.dataset.entityEdit);});$('#entity-close').onclick=()=>$('#entity-dialog').close();$('#entity-dialog').addEventListener('cancel',e=>{if(monthSaving)e.preventDefault();});
$('#entity-form').onsubmit=async e=>{
 e.preventDefault();if(!entityContext||monthSaving)return;const change={...entityContext,name:$('#entity-name').value.trim(),bank:$('#entity-bank').value.trim(),archived:$('#entity-archived').checked};if(!change.name){$('#entity-error').textContent='Escribe un nombre.';return;}
 monthSaving=true;$('#entity-save').disabled=true;$('#entity-close').disabled=true;$('#entity-error').textContent='';
 try{let entity={id:change.id,name:change.name,archived:change.archived,revision:(change.revision||0)+1,...(change.kind==='cards'?{bank:change.bank,displayName:change.name}:{})};if(mode==='cloud')entity=await cloud.saveEntity(change);if(entity.id!==change.id)throw Error('No coincide el registro guardado.');
 const list=data[change.kind].map(x=>x.id===entity.id?{...x,...entity}:x);if(!list.some(x=>x.id===entity.id))list.push(entity);
 if(mode!=='cloud'){const saved=JSON.parse(localStorage.getItem(entityKey)||'{}');saved[change.kind]={...(saved[change.kind]||{}),[entity.id]:entity};localStorage.setItem(entityKey,JSON.stringify(saved));}
 data={...data,[change.kind]:list};fillControls();if($('#payment-dialog').open)renderPayment();renderDirectory();$('#entity-dialog').close();entityContext=null;
 }catch(error){$('#entity-error').textContent=error.message;}finally{monthSaving=false;$('#entity-save').disabled=false;$('#entity-close').disabled=false;}
};

let proposalRows=[],reviewProposal=null,proposalBusy=false;
const proposalStatus=p=>p.status==='pending_approval'&&Date.parse(p.expiresAt)<=Date.now()?'expired':p.status;
const proposalLabels={pending_approval:'Por confirmar',committed:'Registrada',cancelled:'Cancelada',expired:'Expirada',stale:'Necesita nueva revisión'};
function clearProposals(){proposalRows=[];reviewProposal=null;$('#proposals-list').innerHTML='';$('#proposal-review-detail').innerHTML='';for(const id of ['proposals-dialog','proposal-review-dialog'])if($('#'+id).open)$('#'+id).close();}
function renderProposals(){
 const visible=proposalRows.filter(p=>$('#proposals-history').checked||proposalStatus(p)==='pending_approval');
 $('#proposals-list').innerHTML=visible.map(p=>{const n=p.purchase,status=proposalStatus(p);return `<article class="directory-item"><div><h3>${esc(n.description)}</h3><p>${esc(n.review.personName)} · ${esc(n.review.cardName)}</p><p>${money(n.totalAmountCents)} en total · ${esc(formatMonth(n.firstPaymentMonth))}</p><p>${esc(proposalLabels[status]||status)}</p></div>${status==='pending_approval'?`<button type="button" data-review-proposal="${esc(p.id)}">Revisar</button>`:''}</article>`;}).join('')||'<p>No hay propuestas por confirmar. Puedes actualizar la lista.</p>';
}
async function fetchProposals(){if(proposalBusy)return;proposalBusy=true;$('#proposals-refresh').disabled=true;$('#proposals-message').textContent='Consultando…';try{if(mode!=='cloud')throw Error('Inicia sesión en tu cuenta para revisar propuestas.');proposalRows=await cloud.proposals();renderProposals();$('#proposals-message').textContent='Las propuestas caducan a los 10 minutos. Actualiza para ver las más recientes.';}catch(error){$('#proposals-message').textContent=error.message;}finally{proposalBusy=false;$('#proposals-refresh').disabled=false;}}
$('#proposals-open').onclick=()=>{$('#proposals-dialog').showModal();fetchProposals();};$('#proposals-close').onclick=()=>$('#proposals-dialog').close();$('#proposals-refresh').onclick=fetchProposals;$('#proposals-history').onchange=renderProposals;
$('#proposals-list').addEventListener('click',e=>{const b=e.target.closest('[data-review-proposal]');if(!b||monthSaving)return;reviewProposal=proposalRows.find(p=>p.id===b.dataset.reviewProposal);if(!reviewProposal)return;const n=reviewProposal.purchase,regular=Math.round(n.totalAmountCents/n.terms),last=n.totalAmountCents-regular*(n.terms-1);$('#proposal-review-detail').innerHTML=`<dl><dt>Concepto</dt><dd>${esc(n.description)}</dd><dt>Persona</dt><dd>${esc(n.review.personName)}</dd><dt>Tarjeta</dt><dd>${esc(n.review.cardName)}</dd><dt>Importe total</dt><dd>${money(n.totalAmountCents)} MXN</dd><dt>Tipo</dt><dd>${n.kind==='msi'?'Meses sin intereses':'Compra normal'}</dd><dt>Cuotas</dt><dd>${n.terms}${n.kind==='msi'?' · '+money(regular)+' por cuota; última '+money(last):''}</dd><dt>Primer mes de pago</dt><dd>${esc(formatMonth(n.firstPaymentMonth))}</dd><dt>Vigente hasta</dt><dd>${esc(new Date(reviewProposal.expiresAt).toLocaleString('es-MX'))}</dd></dl>`;$('#proposal-review-message').textContent='';$('#proposal-review-dialog').showModal();});
$('#proposal-review-close').onclick=()=>$('#proposal-review-dialog').close();$('#proposal-review-dialog').addEventListener('cancel',e=>{if(monthSaving)e.preventDefault();});
async function decideProposal(decision){if(!reviewProposal||monthSaving)return;const p=reviewProposal;if(proposalStatus(p)!=='pending_approval'){$('#proposal-review-message').textContent='La propuesta expiró. Actualiza y pide una nueva.';return;}monthSaving=true;for(const id of ['proposal-approve','proposal-cancel','proposal-review-close'])$('#'+id).disabled=true;$('#proposal-review-message').textContent='Guardando decisión…';
 try{const saved=await cloud.decideProposal(p,decision);if(saved.id!==p.id)throw Error('No coincide la propuesta. Actualiza antes de continuar.');proposalRows=proposalRows.map(x=>x.id===saved.id?saved:x);renderProposals();if(saved.status==='committed'||saved.status==='cancelled'){$('#proposal-review-dialog').close();$('#proposals-message').textContent=saved.status==='committed'?'Compra registrada una sola vez.':'Propuesta cancelada; no se registró la compra.';reviewProposal=null;}else{$('#proposal-review-message').textContent='No se registró: '+(proposalLabels[saved.status]||saved.status)+'. Pide una nueva propuesta.';}
 }catch(error){$('#proposal-review-message').textContent=error.message+' Si se cortó la conexión, vuelve a consultar la propuesta antes de repetir.';}finally{monthSaving=false;for(const id of ['proposal-approve','proposal-cancel','proposal-review-close'])$('#'+id).disabled=false;}
 try{await loadCloud();}catch{ $('#proposals-message').textContent+=' No se pudo refrescar el resumen; pulsa actualizar en Mi cuenta.';}
}
$('#proposal-approve').onclick=()=>decideProposal('approve');$('#proposal-cancel').onclick=()=>decideProposal('cancel');

let connectionBusy=false;
function clearConnections(){if($('#connections-dialog').open)$('#connections-dialog').close();$('#connection-token').value='';$('#connection-secret').hidden=true;$('#connections-list').innerHTML='';}
function hideConnectionToken(){$('#connection-token').value='';$('#connection-secret').hidden=true;}
async function loadConnections(){if(mode!=='cloud'){$('#connections-status').textContent='Inicia sesión para administrar los accesos de tu cuenta.';return;}
 try{const list=await cloud.connections();$('#connections-list').innerHTML=list.map(c=>`<article class="directory-item"><div><h3>${esc(c.label)}</h3><p>${c.revoked?'Revocado':c.expiresAt?'Caduca: '+esc(new Date(c.expiresAt).toLocaleString('es-MX')):'Sin caducidad'}</p><small>Identificador: ${esc(c.id.slice(-8))}</small></div>${!c.revoked?`<button type="button" class="secondary" data-disconnect="${esc(c.id)}">Revocar acceso</button>`:''}</article>`).join('')||'<p>No hay accesos.</p>';}catch(error){$('#connections-status').textContent=error.code==='PGRST202'?'Falta activar la administración de accesos en Supabase.':error.message;}}
$('#connections-open').onclick=()=>{$('#connections-status').textContent='';hideConnectionToken();$('#connections-dialog').showModal();loadConnections();};$('#connections-close').onclick=()=>{hideConnectionToken();$('#connections-dialog').close();};$('#connections-dialog').addEventListener('close',hideConnectionToken);$('#connections-dialog').addEventListener('cancel',e=>{if(connectionBusy)e.preventDefault();});$('#connection-hide').onclick=hideConnectionToken;$('#connections-refresh').onclick=loadConnections;
$('#connection-create').onclick=async()=>{if(connectionBusy)return;if(mode!=='cloud'){$('#connections-status').textContent='Inicia sesión para generar un acceso.';return;}if(!$('#connection-secret').hidden){$('#connections-status').textContent='Guarda u oculta el token que acabas de generar antes de crear otro.';return;}
 connectionBusy=true;$('#connection-create').disabled=true;$('#connections-close').disabled=true;$('#connections-status').textContent='Generando…';
 try{const r=await cloud.createConnection($('#connection-profile').value);if(!/^ctr_[a-f0-9]{64}$/.test(r.token)||r.expiresAt!==null)throw Error('Respuesta inesperada: actualiza la lista antes de repetir.');$('#connection-token').value=r.token;$('#connection-secret').hidden=false;$('#connections-status').textContent='Acceso creado, sin caducidad automática. Su identificador termina en '+r.credentialId.slice(-8)+'.';await loadConnections();}catch(error){$('#connections-status').textContent=error.message+' Si no recibiste el token, actualiza la lista y revoca ese acceso antes de generar otro.';}finally{connectionBusy=false;$('#connection-create').disabled=false;$('#connections-close').disabled=false;}};
$('#connection-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('#connection-token').value);$('#connections-status').textContent='Token copiado. Pégalo en la página segura de Polilla.';}catch{$('#connection-token').select();$('#connections-status').textContent='Selecciona y copia el token manualmente.';}};
$('#connections-list').addEventListener('click',async e=>{const b=e.target.closest('[data-disconnect]');if(!b||connectionBusy)return;if(!confirm('¿Revocar este acceso? Polilla dejará de poder usarlo. No borra compras ni cancela propuestas ya creadas.'))return;connectionBusy=true;b.disabled=true;try{await cloud.disconnect(b.dataset.disconnect);hideConnectionToken();$('#connections-status').textContent='Acceso revocado.';await loadConnections();}catch(error){$('#connections-status').textContent=error.message;}finally{connectionBusy=false;b.disabled=false;}});
