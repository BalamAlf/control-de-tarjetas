import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist=path.join(root,'dist');
// A fresh staging directory prevents accidentally shipping an old private seed.
const staging=path.join(root,'.build-staging');
await fs.mkdir(staging,{recursive:true});
await fs.cp(path.join(root,'app'),path.join(staging,'app'),{recursive:true});
await fs.copyFile(path.join(root,'index.html'),path.join(staging,'index.html'));
const {supabaseConfig:configured}=await import('../app/config.js');
const config={url:process.env.PUBLIC_SUPABASE_URL||configured.url,publishableKey:process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY||configured.publishableKey};
if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.url)||!config.publishableKey.startsWith('sb_publishable_'))throw Error('Usa la URL y la clave publicable. Nunca uses una clave secret o service_role.');
await fs.writeFile(path.join(staging,'app/config.js'),'export const supabaseConfig = Object.freeze('+JSON.stringify(config)+');\n');
// Only these public application files can reach dist, never data/ or referencias/.
await fs.mkdir(dist,{recursive:true});
await fs.copyFile(path.join(staging,'index.html'),path.join(dist,'index.html'));
await fs.cp(path.join(staging,'app'),path.join(dist,'app'),{recursive:true});
await fs.writeFile(path.join(dist,'_headers'),`/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${config.url}; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
  Cache-Control: no-store
`);
const names=await fs.readdir(dist);
if(names.some(n=>n!=='index.html'&&n!=='app'&&n!=='_headers'))throw Error('La carpeta dist contiene archivos ajenos a la aplicación. Revisar antes de publicar.');
console.log('Build listo. Sin archivo de compras, Excel, SQL ni respaldos en dist.');
