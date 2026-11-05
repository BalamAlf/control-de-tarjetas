import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'.reader-release');
await fs.mkdir(out,{recursive:true});
const finance=await fs.readFile(path.join(root,'app/finance.js'),'utf8');
const core=(await fs.readFile(path.join(root,'supabase/functions/_shared/reader.mjs'),'utf8')).replace(/^import .*?;\r?\n/,'');
const entry=(await fs.readFile(path.join(root,'supabase/functions/reader/index.ts'),'utf8')).replace(/^import .*?;\r?\n/,'');
await fs.writeFile(path.join(out,'index.ts'),'// Generated from the shared frontend financial engine and reader sources.\n'+finance+'\n'+core+'\n'+entry);
for(const [source,target]of [['supabase/006_reader.sql','01-Habilitar-API.sql'],['docs/READER.md','LEEME.md'],['docs/reader-openapi.json','openapi.json'],['tests/fixtures/reader-bootstrap.sql','02-Datos-ficticios.sql']])await fs.copyFile(path.join(root,source),path.join(out,target));
console.log('Reader release ready: single-file function, migration, fictitious bootstrap, contract and guide. No credentials or personal purchases.');
