export const BACKUP_LIMIT=2_000_000;
export function parseBackup(text,ownerId){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>BACKUP_LIMIT)throw Error('El archivo supera el límite de 2 MB.');
 let backup;try{backup=JSON.parse(text);}catch{throw Error('No se pudo leer el archivo. Elige un respaldo JSON descargado de esta aplicación.');}
 const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
 if(!object(backup)||![1,2].includes(backup.version))throw Error('Versión de respaldo no compatible.');
 const allowed=backup.version===2?['version','ownerId','exportedAt','book']:['version','exportedAt','base','added'];
 if(Object.keys(backup).some(k=>!allowed.includes(k)))throw Error('El archivo contiene campos no compatibles.');
 let book;
 if(backup.version===2){if(!ownerId||backup.ownerId!==ownerId)throw Error('El respaldo pertenece a otra cuenta. Inicia sesión con la cuenta que lo creó.');book=backup.book;}
 else{if(!object(backup.base)||!Array.isArray(backup.added)||!Array.isArray(backup.base.purchases))throw Error('El respaldo antiguo está incompleto.');book={...backup.base,purchases:[...backup.base.purchases,...backup.added]};}
 if(!object(book)||!Array.isArray(book.people)||!Array.isArray(book.cards)||!Array.isArray(book.purchases))throw Error('Faltan personas, tarjetas o compras en el archivo.');
 for(const [key,limit]of [['people',1000],['cards',100],['purchases',2000]]){
  if(book[key].length>limit)throw Error('El respaldo supera el límite de '+key+'.');const ids=new Set();
  for(const row of book[key]){if(!object(row)||typeof row.id!=='string'||!row.id||ids.has(row.id))throw Error('Hay identificadores ausentes o duplicados en '+key+'.');ids.add(row.id);}
 }
 return {backup,book,identified:backup.version===2,counts:{people:book.people.length,cards:book.cards.length,purchases:book.purchases.length}};
}
export function localBackup(base,added,exportedAt=new Date().toISOString()){
 if(!base)throw Error('No hay datos locales para respaldar.');return {version:1,exportedAt,base,added};
}
export function downloadBackup(backup,prefix='respaldo-tarjetas'){
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));a.href=url;a.download=prefix+'-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
