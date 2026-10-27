import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {signature,scanStatements,renameCode} from '../src/ast.js';
import {adaptSource,mergePatterns} from '../src/adaptive.js';
import {applyPatch} from '../src/patch.js';
import {install,uninstall,status,statePaths} from '../src/installer.js';
import {resolveApp} from '../src/platform.js';
import {sample,template,adaptiveFixture} from '../fixtures/adaptive.js';
const identity={version:'9.0.0-next',commit:'new-build'};
test('移动位置和混淆变量改名后重定位，保留同名用户内容并执行搜索',()=>{
 const changed='// 新构建\n'+renameCode(sample,new Map([['value','z'],['rows','list'],['title','caption'],['nodes','items'],['label','needle'],['text','content'],['query','term'],['translated','list']]));
 const adapter=adaptSource(Buffer.from(changed),template('out/main.js'),identity),output=applyPatch(Buffer.from(changed),adapter).toString();
 assert.equal(adapter.adaptation.mode,'automatic');assert.match(output,/unrelated="Models"/);
 const context=vm.createContext({guard:()=>{}});vm.runInContext(output,context);
 assert.equal(vm.runInContext('normalize("模型 API-Key")',context),'模型 api key');
 assert.equal(vm.runInContext('match("探索子智能体模型","模型")',context),true);
 assert.equal(vm.runInContext('jump([{textContent:"模型"}],"Models").textContent',context),'模型');
 assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(index([{label:"模型"}],"Models"))',context)),['模型']);
});
test('结构发生变化的文案与歧义结构跳过，核心搜索缺失则停止',()=>{
 const changed=sample.replace('general:"General",models:"Models"','general:"General",models:"Models",newTab:"New"')+'function otherSection(){return {label:"Save"}}';
 assert.throws(()=>adaptSource(Buffer.from(changed),template('out/main.js'),identity),/文案/);
 const withUnchanged=sample+'function otherSection(){return {label:"Save"}}';
 const adapter=adaptSource(Buffer.from(withUnchanged),template('out/main.js'),identity);
 assert.ok(adapter.adaptation.ambiguous>0);assert.ok(!adapter.edits.some(e=>e.original==='"Save"'));
 assert.throws(()=>adaptSource(Buffer.from(sample.replace('text.startsWith(query)','text===query')),template('out/main.js'),identity),/search-matcher/);
 assert.throws(()=>adaptSource(Buffer.from(sample.replace('return Array.isArray(rows)','return true')),template('out/main.js'),identity),/搜索依赖结构变化/);
});
test('结构签名保留引用关系、公开属性名、正则和大整数，完整检查模块导出',()=>{
 const shape=code=>signature(parse(code,{ecmaVersion:'latest',sourceType:'module'})).hash;
 assert.equal(renameCode('const value=1;const object={value};',new Map([['value','renamed']])), 'const renamed=1;const object={value:renamed};');
 assert.notEqual(shape('x===x'),shape('x===y'));
 assert.notEqual(shape('x.label'),shape('x.value'));
 assert.notEqual(shape('/a/g'),shape('/b/g'));
 assert.doesNotThrow(()=>shape('12345678901234567890n'));
 assert.throws(()=>scanStatements('const value=1;export {missing};',()=>{}),/not defined/);
});
test('未知版本完整安装、重复安装、缓存删除后卸载，无需重新识别中文资源',t=>{
 const f=adaptiveFixture(t);assert.equal(status(f.target,f.options).adaptation.mode,'automatic');
 const result=install(f.target,f.options);assert.match(result.message,/自动适配/);
 const record=JSON.parse(fs.readFileSync(statePaths(f.target,f.options.stateDir).record));assert.ok(fs.existsSync(record.adapterPath));
 assert.match(install(f.target,{stateDir:f.options.stateDir,run:()=>''}).message,/无需重复/);
 assert.equal(status(f.target,{stateDir:f.options.stateDir}).state,'已安装');
 fs.unlinkSync(record.adapterPath);uninstall(f.target,{stateDir:f.options.stateDir,run:()=>''});
 assert.equal(fs.readFileSync(path.join(f.target.app,f.files[0]),'utf8'),sample);
});
test('status 仅在内存尝试适配，不创建目录；不识别资源返回失败且无修改',t=>{
 const f=adaptiveFixture(t);status(f.target,f.options);assert.equal(fs.existsSync(f.options.stateDir),false);
 f.reset(identity.version,identity.commit,sample.replace('text.startsWith(query)','text===query'));
 const before=fs.readFileSync(path.join(f.target.app,f.files[0]));
 const result=status(f.target,f.options);assert.equal(result.supported,false);assert.match(result.detail,/search-matcher/);assert.equal(fs.existsSync(f.options.stateDir),false);
 assert.throws(()=>install(f.target,f.options),/search-matcher/);assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.files[0])),before);
});
test('应用更新后可重新适配，保留旧备份与记录，禁止旧备份跨版本卸载',t=>{
 const f=adaptiveFixture(t);install(f.target,f.options);const paths=statePaths(f.target,f.options.stateDir),old=JSON.parse(fs.readFileSync(paths.record));
 f.reset('9.1.0-next','another-build','// 更新\n'+sample);
 assert.throws(()=>uninstall(f.target,{stateDir:f.options.stateDir,run:()=>''}),/不支持/);
 const bytes=fs.readFileSync(paths.record);assert.equal(status(f.target,f.options).state,'应用已更新，待重新安装');assert.deepEqual(fs.readFileSync(paths.record),bytes);
 install(f.target,f.options);const current=JSON.parse(fs.readFileSync(paths.record));assert.notEqual(old.backup,current.backup);assert.ok(fs.existsSync(path.join(old.backup,'state.json')));
 assert.equal(JSON.parse(fs.readFileSync(path.join(old.backup,'state.json'))).version,old.version);
 uninstall(f.target,{stateDir:f.options.stateDir,run:()=>''});assert.equal(fs.readFileSync(path.join(f.target.app,f.files[0]),'utf8'),'// 更新\n'+sample);
});
test('同版本 commit 更新可适配；相同身份的第三方修改与未完成事务不覆盖',t=>{
 const f=adaptiveFixture(t);install(f.target,f.options);f.reset(identity.version,'rebuilt-commit','// 重编译\n'+sample);install(f.target,f.options);
 const file=path.join(f.target.app,f.files[0]);fs.appendFileSync(file,'// 外部修改');assert.throws(()=>install(f.target,f.options),/拒绝覆盖/);
 const recordPath=statePaths(f.target,f.options.stateDir).record,record=JSON.parse(fs.readFileSync(recordPath));record.phase='applying';fs.writeFileSync(recordPath,JSON.stringify(record));
 f.reset('9.2.0-next','later');assert.throws(()=>install(f.target,f.options),/未完成操作/);
});
test('没有安装记录的未知版本卸载无需识别任何脚本',t=>{
 const f=adaptiveFixture(t);assert.match(uninstall(f.target,{stateDir:f.options.stateDir,run:()=>''}).message,/没有安装记录/);
});

test('多个基线译文冲突时保留该词条原文',()=>{
 const first=template('out/main.js'),second=structuredClone(first);
 for(const p of second.patterns)for(const e of p.edits)if(e.value==='Models')e.replacement='"模型设置"';
 const merged=mergePatterns([first,second])[0],adapter=adaptSource(Buffer.from(sample),merged,identity);
 const output=applyPatch(Buffer.from(sample),adapter).toString();assert.match(output,/models:"Models"/);assert.match(output,/general:"通用"/);
});
test('自动适配的 macOS 目录交换中断，目标缺失及缓存删除后仍可卸载',t=>{
 const f=adaptiveFixture(t,'darwin');
 f.options.run=(command,args)=>{if(command==='/usr/bin/ditto')fs.cpSync(args.at(-2),args.at(-1),{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});if(command==='/usr/bin/du')return '1 app';return '';};
 install(f.target,f.options);const paths=statePaths(f.target,f.options.stateDir),record=JSON.parse(fs.readFileSync(paths.record));fs.unlinkSync(record.adapterPath);
 const original=fs.renameSync;let interrupted=false;
 fs.renameSync=(from,to)=>{const result=original(from,to);if(from===f.target.root&&!interrupted){interrupted=true;throw Error('模拟交换中断');}return result;};
 try{assert.throws(()=>uninstall(f.target,{stateDir:f.options.stateDir,run:f.options.run}),/模拟交换中断/);}finally{fs.renameSync=original;}
 assert.equal(fs.existsSync(f.target.root),false);
 const recovered=resolveApp(f.target.root,'darwin',f.options.stateDir);
 uninstall(recovered,{stateDir:f.options.stateDir,run:f.options.run});assert.equal(fs.readFileSync(path.join(recovered.app,f.files[0]),'utf8'),sample);
});

test('嵌套同名参数不掩盖外部搜索依赖，传递依赖和后续重写均须核验',()=>{
 const shadowed=sample.replace('rows.map(item=>item.label)','rows.map(guard=>guard.label)');
 assert.throws(()=>adaptSource(Buffer.from(shadowed.replace('return Array.isArray(rows)','throw Error("broken dependency")')),template('out/main.js',shadowed),identity),/搜索依赖结构变化/);
 const indirect=sample.replace('function guard(rows){return Array.isArray(rows)}','function helper(rows){return Array.isArray(rows)} function guard(rows){return helper(rows)}');
 assert.throws(()=>adaptSource(Buffer.from(indirect.replace('return Array.isArray(rows)','throw Error("changed transitive dependency")')),template('out/main.js',indirect),identity),/搜索依赖结构变化/);
 assert.throws(()=>adaptSource(Buffer.from(sample+'guard=()=>{throw Error("overridden dependency")};'),template('out/main.js'),identity),/搜索依赖结构变化/);
 assert.throws(()=>adaptSource(Buffer.from(sample+'function mutate(){guard=()=>false} mutate();'),template('out/main.js'),identity),/搜索依赖结构变化/);
});

test('自动适配中断状态保留恢复说明，预检要求主资源校验条目',t=>{
 const f=adaptiveFixture(t);install(f.target,f.options);const paths=statePaths(f.target,f.options.stateDir),record=JSON.parse(fs.readFileSync(paths.record));record.phase='prepared';fs.writeFileSync(paths.record,JSON.stringify(record));
 const interrupted=status(f.target,f.options);assert.equal(interrupted.state,'操作中断，需要恢复');assert.match(interrupted.detail,/备份与操作记录/);
 const other=adaptiveFixture(t),productPath=path.join(other.target.app,'product.json'),product=JSON.parse(fs.readFileSync(productPath));product.checksums={[other.files[1].slice(4)]:Object.values(product.checksums)[0]};fs.writeFileSync(productPath,JSON.stringify(product));
 assert.equal(status(other.target,other.options).supported,false);assert.throws(()=>install(other.target,other.options),/主目标文件不在/);
});
test('缓存、旧记录归档或新主记录持久化失败时应用保持原版且可重试',t=>{
 for(const boundary of ['cache','archive','prepared']){
  const f=adaptiveFixture(t);install(f.target,f.options);const paths=statePaths(f.target,f.options.stateDir),previous=JSON.parse(fs.readFileSync(paths.record)),stateBefore=fs.readFileSync(paths.record);
  f.reset('9.3.0-next','new-persistence-test','// B\n'+sample);
  const originals=[...f.files,'product.json'].map(file=>[file,fs.readFileSync(path.join(f.target.app,file))]);
  const write=fs.writeFileSync,rename=fs.renameSync;let failed=false;
  fs.writeFileSync=(file,...args)=>{if(!failed&&boundary==='cache'&&String(file).endsWith('/adapter.json')){failed=true;throw Error('模拟持久化失败');}return write(file,...args);};
  fs.renameSync=(from,to)=>{if(!failed&&(boundary==='archive'&&to===path.join(previous.backup,'state.json')||boundary==='prepared'&&to===paths.record)){failed=true;throw Error('模拟持久化失败');}return rename(from,to);};
  try{assert.throws(()=>install(f.target,f.options),/模拟持久化失败/);}finally{fs.writeFileSync=write;fs.renameSync=rename;}
  for(const[file,bytes]of originals)assert.deepEqual(fs.readFileSync(path.join(f.target.app,file)),bytes);
  assert.deepEqual(fs.readFileSync(paths.record),stateBefore);assert.equal(fs.existsSync(paths.lock),false);
  install(f.target,f.options);uninstall(f.target,{stateDir:f.options.stateDir,run:()=>''});
 }
});
test('更新后的安装写入失败，回滚到新版本原文并保留旧版本备份',t=>{
 const f=adaptiveFixture(t);install(f.target,f.options);const paths=statePaths(f.target,f.options.stateDir),old=JSON.parse(fs.readFileSync(paths.record));f.reset('9.4.0-next','new-rollback-test','// B\n'+sample);
 const originals=[...f.files,'product.json'].map(file=>[file,fs.readFileSync(path.join(f.target.app,file))]),rename=fs.renameSync;let failed=false;
 fs.renameSync=(from,to)=>{if(!failed&&to===path.join(f.target.app,f.files[1])){failed=true;throw Error('模拟第二资源写入失败');}return rename(from,to);};
 try{assert.throws(()=>install(f.target,f.options),/已回滚/);}finally{fs.renameSync=rename;}
 for(const[file,bytes]of originals)assert.deepEqual(fs.readFileSync(path.join(f.target.app,file)),bytes);
 assert.equal(JSON.parse(fs.readFileSync(paths.record)).phase,'restored');assert.ok(fs.existsSync(path.join(old.backup,'state.json')));
 install(f.target,f.options);uninstall(f.target,{stateDir:f.options.stateDir,run:()=>''});
});

test('模块初始化器覆盖、循环隐式赋值和类静态块均遵循词法作用域',()=>{
 const wrapped='const bundle={"module.js"(){'+sample+'}};',changed=wrapped.replace('const unrelated=','guard=()=>false;const unrelated=');
 assert.throws(()=>adaptSource(Buffer.from(changed),template('out/main.js',wrapped),identity),/搜索依赖结构变化/);
 assert.throws(()=>adaptSource(Buffer.from(sample+'for(guard of [()=>false]){}'),template('out/main.js'),identity),/搜索依赖结构变化/);
 assert.throws(()=>adaptSource(Buffer.from(sample+'for(guard in {bad:true}){}'),template('out/main.js'),identity),/搜索依赖结构变化/);
 const staticBlock=sample.replace('guard(rows);return rows.map','guard(rows);class Local {static {var guard=1}} return rows.map');
 assert.throws(()=>adaptSource(Buffer.from(staticBlock.replace('return Array.isArray(rows)','throw Error("broken")')),template('out/main.js',staticBlock),identity),/搜索依赖结构变化/);
});
