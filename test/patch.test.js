import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {applyPatch,sha256,loadAdapter} from '../src/patch.js';
import {readDictionary} from '../src/dictionary.js';
const fixture=Buffer.from('const settings={label:"Models"}; const user="Models";');
const start=fixture.toString().indexOf('"Models"');
const adapter={sha256:sha256(fixture),edits:[{start,end:start+8,original:'"Models"',replacement:'"模型"',kind:'literal',expected:1,context:'settings/label'}]};
test('只替换指定 AST 字符串，不触及同名用户内容',()=>{
 const result=applyPatch(fixture,adapter).toString();assert.match(result,/label:"模型"/);assert.match(result,/user="Models"/);
});
test('拒绝错误指纹、错误原文和重叠位置',()=>{
 assert.throws(()=>applyPatch(Buffer.from('different'),adapter),/指纹/);
 assert.throws(()=>applyPatch(fixture,{...adapter,edits:[{...adapter.edits[0],original:'"Other"'}]}),/原文/);
 assert.throws(()=>applyPatch(fixture,{...adapter,edits:[adapter.edits[0],adapter.edits[0]]}),/重叠/);
});
test('词典没有重复项，技术标识与占位符保持一致',()=>{
 const dictionary=readDictionary();assert.ok(dictionary.size>600);
 for(const [en,zh] of dictionary){assert.deepEqual(en.match(/\$\{[^}]*\}|\{\d+\}|%[sd]/g),zh.match(/\$\{[^}]*\}|\{\d+\}|%[sd]/g),en);}
});
test('中文归一化保留汉字，英文标点和大小写兼容',()=>{
 const edit=loadAdapter('3.27.14').edits.find(e=>e.kind==='search-normalizer');
 const normalize=vm.runInNewContext(`(${edit.replacement})`);
 assert.equal(normalize('模型 API-Key'),'模型 api key');assert.equal(normalize('模型'),'模型');assert.equal(normalize(' Foo--BAR '),'foo bar');
});
test('搜索标签兼容中英文及混合文本节点',()=>{
 const edit=loadAdapter('3.27.14').edits.find(e=>e.kind==='search-jump');
 const find=vm.runInNewContext(`(${edit.replacement})`,{QEw:'.label',oIw:node=>node.direct??''});
 const chinese={textContent:'模型'},english={textContent:'Models'},mixed={textContent:'模型 新增',direct:'模型'};
 assert.equal(find({querySelectorAll:()=>[chinese]},'Models'),chinese);
 assert.equal(find({querySelectorAll:()=>[english]},'Models'),english);
 assert.equal(find({querySelectorAll:()=>[mixed]},'Models'),mixed);
 assert.equal(find({querySelectorAll:()=>[chinese]},'constructor'),undefined);
});
test('搜索别名同时保留原始关键词与中文，不修改目的地',()=>{
 const injection=loadAdapter('3.27.14').edits.find(e=>e.kind==='search-aliases').replacement;
 const enrich=vm.runInNewContext(`(function(e,t){${injection};return e})`);
 const destination={kind:'label',fullText:'编辑器设置',tab:'general'};
 const rows=enrich([{label:'编辑器设置',description:'配置字体、格式化、缩略图等设置',aliases:['font'],destination}],()=> '通用');
 assert.ok(rows[0].aliases.includes('Editor Settings'));assert.ok(rows[0].aliases.includes('General'));assert.ok(rows[0].aliases.includes('font'));
 assert.equal(rows[0].destination,destination);
 assert.doesNotThrow(()=>enrich([{label:'constructor',destination}],()=> 'toString'));
});
test('适配清单结构完整，所有独立替换片段语法有效',()=>{
 const adapter=loadAdapter('3.27.14');let end=0;
 for(const edit of adapter.edits){assert.ok(edit.start>=end,edit.context);end=edit.end;if(['search-jump','search-normalizer','search-matcher'].includes(edit.kind))parse(edit.replacement,{ecmaVersion:'latest'});}
 assert.equal(adapter.version,'3.27.14');assert.ok(adapter.edits.length>900);
});
test('两种版本的 IDE 与 Agents 清单均存在，搜索补丁语法有效',()=>{
 for(const version of ['3.27.14','3.27.22'])for(const resource of [loadAdapter(version),...loadAdapter(version).additionalTargets]){
  assert.equal(resource.version,version);assert.ok(resource.edits.length>900);
  for(const edit of resource.edits)if(edit.kind.startsWith('search-'))parse(edit.replacement,{ecmaVersion:'latest'});
 }
});
