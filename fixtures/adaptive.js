import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'acorn';
import {compilePatterns} from '../src/adaptive.js';
import {visitAst} from '../src/ast.js';
import {sha256,checksum} from '../src/patch.js';
export const sample=`const labels={general:"General",models:"Models"};
function section(){return {label:"Save"}}
function normalize(value){return value.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}
function match(text,query){return text.startsWith(query)}
function jump(nodes,label){return nodes.find(node=>node.textContent===label)}
function guard(rows){return Array.isArray(rows)}
function index(rows,title){guard(rows);return rows.map(item=>item.label)}
const unrelated="Models";const huge=12345678901234567890n;
`;
export function template(file,source=sample){
 const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
 const add=(start,end,replacement,kind,context)=>edits.push({start,end,original:source.slice(start,end),replacement,kind,context,expected:1});
 visitAst(ast,(n,a)=>{
  if(n.type==='Literal'&&a.at(-2)?.type==='Property'&&['General','Models','Save'].includes(n.value))add(n.start,n.end,JSON.stringify({General:'通用',Models:'模型',Save:'保存'}[n.value]),'literal','fixture/label');
  if(n.type!=='FunctionDeclaration')return;
  if(n.id.name==='normalize')add(n.start,n.end,'function normalize(value){return value.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu," ").trim()}','search-normalizer','fixture/normalize');
  if(n.id.name==='match')add(n.start,n.end,'function match(text,query){return text.includes(query)}','search-matcher','fixture/match');
  if(n.id.name==='jump')add(n.start,n.end,'function jump(nodes,label){const translated=label==="Models"?"模型":label;return nodes.find(node=>node.textContent===translated)}','search-jump','fixture/jump');
  if(n.id.name==='index')add(n.body.body[0].end,n.body.body[0].end,'const translated=title;rows=rows.map(item=>({...item,aliases:[translated]}));','search-aliases','fixture/aliases');
 });edits.sort((a,b)=>a.start-b.start);
 return compilePatterns(source,{file,sha256:sha256(source),edits});
}
export function adaptiveFixture(t,platform='win32'){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cursor-auto-test-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'Cursor'),app=path.join(root,platform==='darwin'?'Contents/Resources/app':'resources/app'),files=['out/vs/workbench/workbench.desktop.main.js','out/vs/workbench/workbench.glass.main.js'];
 const patterns=files.map(file=>template(file));
 function reset(version,commit,source=sample){
  for(const file of files){fs.mkdirSync(path.dirname(path.join(app,file)),{recursive:true});fs.writeFileSync(path.join(app,file),source);}
  fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version}));
  fs.writeFileSync(path.join(app,'product.json'),JSON.stringify({version,commit,checksums:{[files[0].slice(4)]:checksum(source)}}));
 }
 reset('9.0.0-next','new-build');
 return {dir,files,patterns,reset,target:{root,app,platform},options:{patterns,stateDir:path.join(dir,'state'),run:()=>''}};
}
