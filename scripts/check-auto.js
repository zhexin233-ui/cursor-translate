// 对真实资源模拟重新构建：移动位置、重命名搜索函数局部变量，再验证自动适配及搜索行为。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {parse,parseExpressionAt} from 'acorn';
import {adaptSource} from '../src/adaptive.js';
import {applyPatch} from '../src/patch.js';
import {signature,scanStatements,visitAst,declaredNames,renameCode,moduleFor} from '../src/ast.js';
import {originalApp} from './original-app.js';
import {APP} from './inspect.js';
const app=process.argv[2]??originalApp(APP),templates=JSON.parse(fs.readFileSync(new URL('../adapters/auto-patterns.json',import.meta.url))).resources;
for(const template of templates){
 const original=fs.readFileSync(path.join(app,template.file),'utf8'),owners=new Map(),changes=[],core=new Set(template.patterns.filter(p=>p.type==='FunctionDeclaration'&&p.edits.some(e=>e.kind.startsWith('search-'))).map(p=>`${p.module}:${p.hash}`));
 scanStatements(original,statement=>visitAst(statement,(node,ancestors)=>{
  if(node.type!=='FunctionDeclaration')return;
  const shape=signature(node),id=`${moduleFor(ancestors)}:${shape.hash}`;
  if(!core.has(id))return;
  const pattern=template.patterns.find(p=>`${p.module}:${p.hash}`===id);
  for(const edit of pattern.edits)if(edit.kind.startsWith('search-'))owners.set(edit.kind,node.id.name);
  const locals=[...declaredNames(node)].filter(n=>n!==node.id.name),mapping=new Map(locals.map((name,index)=>[name,`__cursorProofLocal${index}`]));
  changes.push({start:node.start,end:node.end,replacement:renameCode(original.slice(node.start,node.end),mapping)});
 }));
 let source=original;for(const change of changes.sort((a,b)=>b.start-a.start))source=source.slice(0,change.start)+change.replacement+source.slice(change.end);
 source='// 自动适配验证：原文位置与局部变量名均已变化\n'+source;
 console.log(`正在验证 ${template.file} 的自动重定位…`);
 const adapter=adaptSource(Buffer.from(source),template,{version:'automatic-proof',commit:'rebuilt-resource-proof'}),output=applyPatch(Buffer.from(source),adapter).toString();
 const functions=new Map();
 function add(name){
  if(functions.has(name))return;
  const at=output.indexOf(`function ${name}(`);if(at<0)return;
  const node=parseExpressionAt(output,at,{ecmaVersion:'latest'});functions.set(name,node);
  visitAst(node,n=>{if(n.type==='CallExpression'&&n.callee.type==='Identifier')add(n.callee.name);});
 }
 for(const name of owners.values())add(name);
 const context=vm.createContext({Node:{TEXT_NODE:3}});
 const jumpNode=functions.get(owners.get('search-jump'));
 visitAst(jumpNode,n=>{if(n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&n.callee.property.name==='querySelectorAll')context[n.arguments[0].name]='.label';});
 vm.runInContext([...functions.values()].map(n=>output.slice(n.start,n.end)).join('\n'),context);
 const fn=kind=>vm.runInContext(owners.get(kind),context),normalize=fn('search-normalizer'),match=fn('search-matcher'),jump=fn('search-jump'),index=fn('search-aliases');
 assert.equal(normalize('模型 API-Key'),'模型 api key');
 const destination={kind:'label',tab:'models',fullText:'探索子智能体模型'},entry={id:'setting:models:proof',label:destination.fullText,description:'选择探索子智能体进行初步调研时使用的模型',destination};
 const row=template.file.includes('.glass.')?index({item:{tab:'models',fullNodeText:entry.label},itemKey:'proof',value:entry.label,description:entry.description,aliases:[],childKeywords:[],keywords:[entry.label,entry.description]}):index([entry],()=> '模型')[0];
 function score(text,query){const normalized=normalize(query);return match(text,{text:normalized,tokens:normalized.split(' ')});}
 assert.ok(score(row.normalizedLabel,'模型')>0);
 assert.ok(score(row.normalizedDescription,'初步调研')>0);
 assert.ok(row.normalizedAliases.some(alias=>score(alias,'Explore')>0));
 assert.ok(score(row.normalizedKeywords,'探索 Model')>=6800);
 const label={textContent:'模型'};assert.equal(jump({querySelectorAll:()=>[label]},'Models'),label);
 const mixed={textContent:'模型 新增',childNodes:[{nodeType:3,textContent:'模型'}]};assert.equal(jump({querySelectorAll:()=>[mixed]},'Models'),mixed);
 parse(adapter.edits.find(e=>e.kind==='search-jump').replacement,{ecmaVersion:'latest'});
 console.log(JSON.stringify({file:template.file,...adapter.adaptation,search:'中英文、混合查询及跳转通过'}));
}
