import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {customizeEdits} from '../scripts/customize.js';
import {readDictionary} from '../src/dictionary.js';
import {applyPatch,sha256,loadAdapter} from '../src/patch.js';
import {compilePatterns,adaptSource} from '../src/adaptive.js';
import {template,sample} from '../fixtures/adaptive.js';

const dictionary=readDictionary();
const patch=(source,edits)=>applyPatch(Buffer.from(source),{sha256:sha256(source),edits:edits.sort((a,b)=>a.start-b.start)}).toString();

test('Customize 包含初始化器前的组件，保护模块外内容、配置键与行为字符串',()=>{
 const source=`const earlier={"outside.js"(){return {children:"Skills"}}};
 function page(value){console.log("Skills");if(value==="Skills")throw new Error("Skills");return {id:"Skills",name:"Skills",value:"Skills",label:"Skills",children:\`Search \${value} for \${value}...\`};}
 const init={"CustomizeEngine.js"(){const labels={Skills:"Skills"};}};
 function unrelated(){return {children:"Skills"}}const other={"other.js"(){}};`;
 const edits=customizeEdits(source,dictionary,{'CustomizeEngine.js':['Skills','Search ',' for ','...']});
 const output=patch(source,edits);parse(output,{ecmaVersion:'latest'});
 assert.match(output,/label:"技能"/);assert.match(output,/Skills:"技能"/);
 assert.match(output,/children:`搜索 \$\{value\}，范围：\$\{value\}…`/);
 for(const original of ['id:"Skills"','name:"Skills"','value:"Skills"','value==="Skills"','console.log("Skills")','new Error("Skills")'])assert.ok(output.includes(original),original);
 assert.equal((output.match(/children:"Skills"/g)??[]).length,2);
 assert.throws(()=>customizeEdits(source,dictionary,{'missing.js':['Skills']}),/模块缺失/);
});

test('详情标题显示中文，图标与源码回调继续使用英文技术类型',()=>{
 const source=`function groups(){return [{label:"Skills"},{label:"MCPs"}]};const helpers={"PluginDetailView.helpers.js"(){}};
 function icon(label){switch(label){case "Skills":return "lightning";case "MCPs":return "mcp";default:return "terminal"}};
 function render(group,onOpen){onOpen(group.label);return {children:group.label}};
 const detail={"PluginDetailView.js"(){}};`;
 const output=patch(source,customizeEdits(source,dictionary,{'PluginDetailView.helpers.js':[],'PluginDetailView.js':[]}));
 const result=vm.runInNewContext(output+';const opened=[];[groups().map(g=>icon(g.label)),groups().map(g=>render(g,t=>opened.push(t)).children),opened]');
 assert.deepEqual(JSON.parse(JSON.stringify(result)),[['lightning','mcp'],['技能','MCPs'],['Skills','MCPs']]);
});

test('同一顶层语句中的其他模块不能借用显示白名单',()=>{
 const source='const bundle={"CustomizeEngine.js"(){const a={label:"Skills"}},"unrelated.js"(){const b={label:"Skills"}}};';
 const edits=customizeEdits(source,dictionary,{'CustomizeEngine.js':['Skills']});
 assert.equal(edits.length,1);const output=patch(source,edits);
 assert.match(output,/a=\{label:"技能"\}/);assert.match(output,/b=\{label:"Skills"\}/);
});

test('Customize 文案随结构模板跨位置重定位，不修改模块外的同名文本',()=>{
 const extra=`function customize(){return {id:"skills",label:"Skills",children:\`Search \${1}...\`}}const init={"CustomizeEngine.js"(){}};const user="Skills";`;
 const detail='function detail(group){return {children:group.label}}const detailInit={"PluginDetailView.js"(){}};';
 const source=sample+extra+detail,custom=customizeEdits(source,dictionary,{'CustomizeEngine.js':['Skills','Search ','...'],'PluginDetailView.js':[]});
 const merged=template('out/main.js',source);merged.patterns.push(...compilePatterns(source,{file:'out/main.js',edits:custom}).patterns);
 const changed='// 移动位置\n'+source.replaceAll('function customize()','function renamed()').replaceAll('group','renamedGroup');
 const adapter=adaptSource(Buffer.from(changed),merged,{version:'next',commit:'proof'}),output=applyPatch(Buffer.from(changed),adapter).toString();
 assert.match(output,/label:"技能"/);assert.match(output,/children:`搜索 \$\{1\}…`/);assert.match(output,/const user="Skills"/);
 const context=vm.createContext({});vm.runInContext(output,context);assert.equal(vm.runInContext('detail({label:"Skills"}).children',context),'技能');
});

test('两版本双窗口均包含 Customize 主界面、详情和团队市场补丁',()=>{
 for(const version of ['3.27.14','3.27.22'])for(const resource of [loadAdapter(version),...loadAdapter(version).additionalTargets]){
  const edits=resource.edits.filter(e=>e.context.startsWith('customize/'));
  assert.ok(edits.length>450,`${version}/${resource.file}`);
  for(const text of ['Search Plugins, Skills, MCPs...','Extend Cursor with Plugins','New MCP Server','Marketplace Settings','Import Marketplace','Try in Chat'])assert.ok(edits.some(e=>e.original===JSON.stringify(text)),text);
  assert.equal(edits.filter(e=>e.context==='customize/PluginDetailView.js/group-title').length,1);
  assert.ok(!edits.some(e=>e.context.startsWith('customize/PluginDetailView.helpers.js/')&&e.original==='"Skills"'));
  for(const edit of edits)assert.ok(!['"plugins"','"skills"','"needsAuth"','"Enter"','"enabledTools"','"envFile"'].includes(edit.original),edit.original);
 }
});
