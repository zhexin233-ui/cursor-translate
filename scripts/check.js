// 只读核验实际原版资源；补丁只写入临时目录供语法检查。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {loadAdapter,applyPatch} from '../src/patch.js';
import {originalApp} from './original-app.js';
import {APP,settingsRegion} from './inspect.js';
import {versions} from './versions.js';
const app=originalApp(process.argv[2]??APP),version=JSON.parse(fs.readFileSync(path.join(app,'product.json'))).version,adapter=loadAdapter(version);
const symbols=versions[version].desktop;
const original=fs.readFileSync(path.join(app,adapter.file));
const patched=applyPatch(original,adapter),source=patched.toString();
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cursor-zh-check-'));
try{
 const file=path.join(temporary,'bundle.mjs');fs.writeFileSync(file,patched);execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
 // 在 VM 中执行真实搜索函数和目录构造器，避免测试仅复述补丁。
 const region=settingsRegion(source),ast=parse(region.text,{ecmaVersion:'latest',sourceType:'module'}),functions=new Map(),vars=new Map();
 simple(ast,{FunctionDeclaration(n){functions.set(n.id.name,n)},VariableDeclarator(n){if(n.id.type==='Identifier')vars.set(n.id.name,n)}});
 const names=[symbols.index];
 const code=region.text;const searchName=[...functions].find(([name,n])=>code.slice(n.start,n.end).includes('const i=t.trim();if(i.length===0)'))?.[0];
 if(!searchName)throw Error('未找到设置搜索入口');names.push(searchName);
 // 从真实搜索函数递归收集依赖函数，不加载应用其余模块。
 const selected=new Set(),externals=new Set();
 function add(name){if(selected.has(name))return;const node=functions.get(name);if(!node){externals.add(name);return;}selected.add(name);simple(node,{CallExpression(n){if(n.callee.type==='Identifier'&&functions.has(n.callee.name))add(n.callee.name);}});}
 for(const name of names)add(name);
 const snippets=[...selected].map(name=>{const node=functions.get(name);return region.text.slice(node.start,node.end)}).join('\n');
 const context=vm.createContext({console});
 // 常量只有默认结果数量，其余所需常量按实际初始化表达式加载。
 const neededVars=['Nvw','Lvw'];
 const declarations=neededVars.filter(n=>vars.has(n)).map(name=>{const n=vars.get(name);return `var ${region.text.slice(n.start,n.end)};`}).join('\n');
 vm.runInContext(declarations+'\n'+snippets,context);
 const result=vm.runInContext(`(()=>{const destination={kind:'label',tab:'models',fullText:'探索子智能体模型'};const entries=[{id:'setting:models:explore',label:'探索子智能体模型',description:'选择探索子智能体进行初步调研时使用的模型',destination}];const rows=${symbols.index}(entries,()=> '模型');return ['探索','模型','子智能体','初步调研','Explore','subagent','探索 Model'].map(query=>({query,count:${searchName}(rows,query,{limit:12}).length}));})()`,context);
 assert.ok(result.every(x=>x.count===1),JSON.stringify(result));
 console.log(`实际 ${version} 资源通过 ${adapter.edits.length} 处原文核验、完整脚本语法检查及真实中英文搜索函数验证。`);
 console.log(JSON.stringify(result));
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
