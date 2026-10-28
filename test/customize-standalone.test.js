import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {standaloneCustomizeEdits} from '../scripts/customize-standalone.js';
import {readDictionary} from '../src/dictionary.js';
import {applyPatch,sha256} from '../src/patch.js';
import {compilePatterns,adaptSource} from '../src/adaptive.js';
import {template,sample} from '../fixtures/adaptive.js';

const dictionary=readDictionary();
function patch(source){const edits=standaloneCustomizeEdits(source,dictionary);return {edits,output:applyPatch(Buffer.from(source),{sha256:sha256(source),edits}).toString()};}

test('新建弹窗仅翻译显示表达式，技能类型和标识符保持原样',()=>{
 const source=[
  'async function input(e,t){return e.input({title:`New User ${t.label}`,placeHolder:`e.g., my-custom-${t.noun}`,prompt:`Enter a name for the new ${t.noun}`})}',
  'async function validate(e,t,n){if(!t)return `${n.label} name cannot be empty`;if(t==="bad")return "Use lowercase letters, numbers, and hyphens (must start with a letter or number)";return `A ${n.noun} with this name already exists`}',
  'const kind={noun:"subagent",label:"Subagent"};'
 ].join('\n');
 const {output}=patch(source),context=vm.createContext({});vm.runInContext(output,context);
 const options=vm.runInContext('input({input:x=>x},kind)',context);
 return Promise.resolve(options).then(async actual=>{
  assert.equal(actual.title,'新建用户子智能体');assert.equal(actual.prompt,'请输入新子智能体的名称');assert.equal(actual.placeHolder,'例如：my-custom-subagent');
  assert.equal(vm.runInContext('kind.noun',context),'subagent');assert.equal(vm.runInContext('kind.label',context),'Subagent');
  assert.equal(await vm.runInContext('validate(null,"",kind)',context),'子智能体名称不能为空');
 });
});

test('MCP 环境仅翻译默认本地标签，不改变环境类型和自定义远程名称',()=>{
 const source='function environment(e){if(e===undefined)return{id:"local",kind:"local",label:"Local"};return{id:"remote:x",kind:"remote",label:e}} function state(e){if(e==="needsAuth")return "Needs Authentication";return "Connected"}';
 const {output}=patch(source),context=vm.createContext({});vm.runInContext(output,context);
 assert.equal(vm.runInContext('environment().label',context),'本地');assert.equal(vm.runInContext('environment().kind',context),'local');
 assert.equal(vm.runInContext('environment("Local").label',context),'Local');assert.equal(vm.runInContext('state("needsAuth")',context),'需要身份验证');
});

test('命名输入的 NLS 显示调用改为中文，命令模板和路径保留原文',()=>{
 const source='async function command(e){return e.input({title:k(7762,null),placeHolder:k(7763,null),prompt:k(7764,null),validateInput:v=>v?null:k(7765,null)})} const file="my-custom-command.md";';
 const {output}=patch(source),context=vm.createContext({});vm.runInContext(output,context);
 return vm.runInContext('command({input:x=>x})',context).then(options=>{
  assert.equal(options.title,'输入命令名称');assert.equal(options.validateInput(''),'命令名称不能为空');assert.match(output,/my-custom-command\.md/);
 });
});

test('共享输入弹窗翻译默认按钮，保留 Esc 和行为字段',()=>{
 const source='function prompt(n){return {title:n.options.title??"Prompt",confirm:n.options.confirmLabel??"Confirm",cancel:n.options.cancelLabel??"Cancel",kbs:"Esc"}}';
 const {output}=patch(source),context=vm.createContext({});vm.runInContext(output,context);
 assert.equal(vm.runInContext('prompt({options:{}}).confirm',context),'确认');assert.equal(vm.runInContext('prompt({options:{}}).cancel',context),'取消');assert.match(output,/kbs:"Esc"/);
});

test('独立显示表达式在函数及局部变量改名后仍可自动适配',()=>{
 const extra='async function input(e,t){return e.input({title:`New User ${t.label}`,prompt:`Enter a name for the new ${t.noun}`})}';
 const source=sample+extra,base=template('out/main.js',source);
 base.patterns.push(...compilePatterns(source,{file:'out/main.js',edits:standaloneCustomizeEdits(source,dictionary)}).patterns);
 const changed='// 位移\n'+source.replace('function input(e,t)','function renamed(service,descriptor)').replaceAll('e.input','service.input').replaceAll('t.label','descriptor.label').replaceAll('t.noun','descriptor.noun');
 const adapter=adaptSource(Buffer.from(changed),base,{version:'proof',commit:'proof'}),output=applyPatch(Buffer.from(changed),adapter).toString();
 const context=vm.createContext({});vm.runInContext(output,context);
 return vm.runInContext('renamed({input:x=>x},{label:"Subagent",noun:"subagent"})',context).then(options=>assert.equal(options.title,'新建用户子智能体'));
});
