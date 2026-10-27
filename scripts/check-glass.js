import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseExpressionAt} from 'acorn';
import {simple} from 'acorn-walk';
import {loadAdapter,applyPatch} from '../src/patch.js';
import {versions} from './versions.js';
import {originalApp} from './original-app.js';
import {APP} from './inspect.js';
const app=originalApp(process.argv[2]??APP),version=JSON.parse(fs.readFileSync(path.join(app,'package.json'))).version,adapter=loadAdapter(version).additionalTargets[0],symbols=versions[version].glass;
const bytes=applyPatch(fs.readFileSync(path.join(app,adapter.file)),adapter),source=bytes.toString();
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cursor-glass-check-'));
try{
 const file=path.join(temporary,'glass.mjs');fs.writeFileSync(file,bytes);execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
 const nodes=new Map();
 function add(name){
  if(nodes.has(name))return;
  const at=source.indexOf(`function ${name}(`);if(at<0)return;
  const node=parseExpressionAt(source,at,{ecmaVersion:'latest'});nodes.set(name,node);
  simple(node,{CallExpression(n){if(n.callee.type==='Identifier')add(n.callee.name);}});
 }
 add(symbols.row);
 const engine=source.indexOf(`function ${symbols.normalizer}(`);
 const before=source.slice(engine-4000,engine);
 const entryName=[...before.matchAll(/function ([\w$]+)\(t,e,n\)\{const i=e\.trim\(\)/g)].at(-1)?.[1];
 if(!entryName)throw Error('未找到 Glass 搜索入口');add(entryName);
 const context=vm.createContext({console});
 vm.runInContext('var je_=12;'+[...nodes.values()].map(n=>source.slice(n.start,n.end)).join('\n'),context);
 const results=vm.runInContext(`(()=>{const row=${symbols.row}({item:{tab:'models',fullNodeText:'探索子智能体模型'},itemKey:'explore',value:'探索子智能体模型',description:'选择探索子智能体进行初步调研时使用的模型',aliases:[],childKeywords:[],keywords:['探索子智能体模型','选择探索子智能体进行初步调研时使用的模型']});return ['探索','子智能体','模型','初步调研','Explore','subagent','探索 Model'].map(query=>({query,count:${entryName}([row],query,{limit:12}).length}));})()`,context);
 assert.ok(results.every(r=>r.count===1),JSON.stringify(results));
 console.log(`Glass ${adapter.edits.length} 处补丁通过完整脚本语法及真实搜索函数验证。`);
 console.log(JSON.stringify(results));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
