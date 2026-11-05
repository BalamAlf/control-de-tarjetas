export function monthDiff(a,b){return (Number(a.slice(0,4))-Number(b.slice(0,4)))*12+Number(a.slice(5))-Number(b.slice(5));}
export function cents(n){return Math.round(Number(n)*100);}
export function validateMonthAdjustment(change){
 if(!change.id||typeof change.id!=='string'||change.id.length>100)throw Error('Selecciona una compra válida.');
 if(!/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(change.month||''))throw Error('Selecciona un mes válido.');
 if(typeof change.skipped!=='boolean')throw Error('Confirma si aplica este mes.');
 if(change.amountCents!==null&&(!Number.isSafeInteger(change.amountCents)||change.amountCents<0||change.amountCents>10000000000))throw Error('Usa un importe entre $0.00 y $100,000,000.00, con máximo dos decimales.');
 return change;
}
export function withMonthAdjustment(data,change,adjustment){
 const months={...(data.monthAdjustments||{})},items={...(months[change.month]||{})};
 if(adjustment===null)delete items[change.id];else items[change.id]=adjustment;
 months[change.month]=items;return {...data,monthAdjustments:months};
}
export function validatePurchase(p){
 if(!p.person||!p.card||!p.description?.trim())throw Error('Completa persona, tarjeta y concepto.');
 if(!Number.isFinite(p.amount)||p.amount<=0)throw Error('El importe debe ser mayor a cero.');
 if(!Number.isInteger(p.terms)||p.terms<1||p.terms>120)throw Error('Usa entre 1 y 120 mensualidades.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.start||''))throw Error('Selecciona el primer mes de cobro.');
 if(cents(p.amount)-Math.round(cents(p.amount)/p.terms)*(p.terms-1)<0)throw Error('El importe es demasiado pequeño para ese número de mensualidades.');
 return p;
}
export function sourceMonth(data){
 return data.snapshotMonth||(data.baseline==='2026-12'&&data.paidThrough==='2026-11'?'2026-11':null);
}
export function charge(p,month,baseline,snapshotMonth=null){
 // A confirmed first-payment month assigns a normal imported purchase once.
 if(p.legacy&&!p.msi&&!p.recurring&&p.start)return {value:month===p.start?cents(p.installment):0,kind:'normal'};
 // The owner confirmed these imported monthly amounts are November charges.
 // This does not alter installment progress or prove an individual payment.
 if(p.legacy&&month===snapshotMonth)return {value:cents(p.installment),kind:p.msi?'msi':p.recurring?'recurring':'normal',snapshot:true};
 if(p.legacy&&monthDiff(month,baseline)<0)return {value:0,unknown:true,kind:'history'};
 const offset=monthDiff(month,p.legacy?baseline:p.start);
 if(offset<0)return {value:0,kind:'future'};
 // A historical recurring flag does not document its frequency or continued use.
 if(p.recurring&&!p.msi){return {value:cents(p.installment),estimate:!!p.legacy,kind:'recurring'};}
 const remaining=p.legacy?p.remaining:p.terms;
 if(p.legacy&&!p.msi&&snapshotMonth){
  if(p.terms>1&&remaining>0)return {value:0,unknown:true,kind:'review',reason:'Tiene cuotas pero no está marcada como MSI. Se conserva sin sumarla al próximo mes hasta confirmar su tipo.'};
  return {value:0,kind:'charged-in-source-month'};
 }
 if(p.legacy&&!p.msi&&p.terms===1)return {value:0,unknown:true,kind:'unassigned'};
 if(offset>=remaining)return {value:0,kind:'finished'};
 const regular=cents(p.installment);
 return {value:offset===remaining-1?cents(p.lastInstallment):regular,kind:p.msi?'msi':'normal'};
}
export function report(data,month,added=[]){
 const cells=new Map(),lines=[],unknown=[],skipped=[];
 const monthAdjustments=data.monthAdjustments?.[month]||{};
 for(const p of [...data.purchases,...added]){
  const control=data.purchaseControls?.[p.id];
  if(control?.deleted|| (p.recurring&&control?.endMonth&&month>=control.endMonth))continue;
  if(p.legacy&&!p.msi&&!p.recurring&&!p.start&&month===sourceMonth(data)){unknown.push({...p,reviewReason:'Compra no recurrente conservada del Excel; fuera del plan de recurrentes y MSI de noviembre.'});continue;}
  let result=charge(p,month,data.baseline,sourceMonth(data));
  const adjustment=monthAdjustments[p.id],baseValue=result.unknown?null:result.value;
  if(adjustment){
   validateMonthAdjustment({id:p.id,month,amountCents:adjustment.amountCents,skipped:adjustment.skipped});
   const kind=p.msi?'msi':p.recurring?'recurring':'normal';
   if(adjustment.skipped){skipped.push({...p,...result,kind,baseValue,value:0,adjustment,adjusted:true});continue;}
   if(adjustment.amountCents!==null)result={...result,unknown:false,value:adjustment.amountCents,kind,estimate:false,adjusted:true};
  }
  if(result.unknown){unknown.push({...p,reviewReason:result.reason});continue;}
  if(!result.value&&!result.adjusted)continue;
  const key=p.person+'|'+p.card;
  cells.set(key,(cells.get(key)||0)+result.value);lines.push({...p,...result,baseValue,adjustment:adjustment||null});
 }
 return {cells,lines,skipped,unknown,adjustmentCount:Object.keys(monthAdjustments).length,isSnapshot:month===sourceMonth(data),total:lines.reduce((s,p)=>s+p.value,0),estimated:lines.filter(p=>p.estimate).reduce((s,p)=>s+p.value,0)};
}
export function bankPeriod(data,month,result){
 if(month!=='2026-11'||month!==sourceMonth(data))return [];
 return data.cards.map(card=>{
  const lines=result.lines.filter(p=>p.card===card.id);
  // Owner-confirmed November bank status, independent of planned charge edits.
  return {card:card.id,total:lines.reduce((s,p)=>s+p.value,0),status:card.id==='TAR-PlatinoAMEX-AMEX-06'?'paid':'pending'};
 });
}
export function paymentBreakdown(data,month,added,person,card=''){
 const result=report(data,month,added);
 const matches=p=>p.person===person&&(!card||p.card===card);
 const sequence=p=>({...p,sequence:p.kind==='recurring'?null:p.snapshot?(p.paid>0?p.paid:null):(p.paid??0)+monthDiff(month,p.legacy?data.baseline:p.start)+1});
 const lines=result.lines.filter(matches).map(sequence),skipped=result.skipped.filter(matches).map(sequence);
 return {lines,skipped,isSnapshot:result.isSnapshot,total:lines.reduce((s,p)=>s+p.value,0),estimated:lines.filter(p=>p.estimate).reduce((s,p)=>s+p.value,0),unknown:result.unknown.filter(matches)};
}
