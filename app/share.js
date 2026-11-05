// Draw only the selected person's breakdown. No account data or source totals.
export function paymentImage({person,month,cards,lines,skipped=[],unknownCount=0,historical=false}){
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),width=900,pad=56;
 const money=v=>new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(v/100);
 const wrap=(text,max,font)=>{ctx.font=font;const words=String(text).split(/\s+/),rows=[];let row='';for(const word of words){let part=word;while(ctx.measureText(part).width>max){let cut=part.length;while(cut>1&&ctx.measureText(part.slice(0,cut)).width>max)cut--;if(row){rows.push(row);row='';}rows.push(part.slice(0,cut));part=part.slice(cut);}const next=row?row+' '+part:part;if(ctx.measureText(next).width>max&&row){rows.push(row);row=part;}else row=next;}if(row)rows.push(row);return rows;};
 const operations=[];let y=60;
 const text=(value,font,color='#233f38',max=width-pad*2)=>{const rows=wrap(value,max,font);for(const line of rows){operations.push({type:'text',line,font,color,y});y+=Number(font.match(/(\d+)px/)[1])*1.4;}return rows.length;};
 const rule=()=>{operations.push({type:'rule',y});y+=28;};
 text('MIS TARJETAS · RESUMEN DEL MES','18px sans-serif','#607258');y+=18;
 text(person,'bold 38px sans-serif');text(month,'24px sans-serif','#607258');y+=24;
 const total=lines.reduce((sum,p)=>sum+p.value,0);
 text(historical?'SIN HISTORIAL CONFIRMADO':'TOTAL PREVISTO','18px sans-serif','#607258');
 text(historical?'Sin determinar':money(total),'bold 48px sans-serif');y+=24;rule();
 for(const card of cards){const items=lines.filter(p=>p.card===card.id);if(!items.length)continue;
 text(card.name,'bold 27px sans-serif');text('Subtotal: '+money(items.reduce((sum,p)=>sum+p.value,0)),'bold 23px sans-serif');y+=12;
 for(const item of items){const start=y;const rows=wrap(item.description,width-pad*2-225,'23px sans-serif');for(const line of rows){operations.push({type:'text',line,font:'23px sans-serif',color:'#233f38',y});y+=32;}
 operations.push({type:'amount',line:money(item.value),font:'bold 24px sans-serif',color:'#233f38',y:start});
 text((item.kind==='msi'?'MSI'+(item.sequence?' · Mensualidad '+item.sequence+' de '+item.terms:''):item.kind==='recurring'?'Recurrente':'Compra o cuota')+(item.adjusted?' · Importe ajustado este mes':''),'18px sans-serif','#607258');y+=20;
 }rule();}
 if(!lines.length)text(historical?'Falta el historial para determinar este mes.':'No hay cargos incluidos para esta selección.','22px sans-serif');
 if(skipped.length){text('NO APLICAN ESTE MES · NO SUMAN','bold 19px sans-serif','#78664e');for(const p of skipped)text(p.description+' · '+(cards.find(c=>c.id===p.card)?.name||p.card),'20px sans-serif','#78664e');y+=18;}
 if(unknownCount)text(unknownCount+' registros fuera del plan o por confirmar. No se incluyen en el total.','18px sans-serif','#78664e');
 if(lines.some(p=>p.estimate))text('Incluye recurrentes de referencia: confirma su importe y vigencia.','18px sans-serif','#78664e');
 y+=20;text('Resumen de cargos previstos. No confirma pagos recibidos ni pagos al banco.','18px sans-serif','#607258');y+=30;
 canvas.width=width;canvas.height=Math.ceil(y);ctx.fillStyle='#fffef8';ctx.fillRect(0,0,width,canvas.height);
 for(const op of operations){if(op.type==='rule'){ctx.strokeStyle='#dbe3d5';ctx.beginPath();ctx.moveTo(pad,op.y);ctx.lineTo(width-pad,op.y);ctx.stroke();}else{ctx.font=op.font;ctx.fillStyle=op.color;ctx.textBaseline='top';ctx.textAlign=op.type==='amount'?'right':'left';ctx.fillText(op.line,op.type==='amount'?width-pad:pad,op.y);}}
 return {canvas,total};
}
