import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {standaloneCustomizeEdits} from '../scripts/customize-standalone.js';
import {readDictionary} from '../src/dictionary.js';
import {applyPatch,sha256} from '../src/patch.js';
import {compilePatterns,adaptSource} from '../src/adaptive.js';
import {template,sample} from '../fixtures/adaptive.js';
const dictionary=readDictionary();
const sidebar='var actions={marketplace:{id:"marketplace",iconName:"extensions",label:"Customize",placeholderContent:"Cursor Marketplace",showsAgentSelector:!1,editorPanelType:"configuration"},other:{id:"other",label:"Customize"}};function render(){return actions.marketplace.label}';
const dialog='function market(service){const handlePickLocalFolder=()=>service.showOpenDialog({title:"Select a local marketplace folder",openLabel:"Select Folder",canSelectFiles:false,canSelectFolders:true,canSelectMany:false});return {handlePickLocalFolder}} const other="Select Folder";';
function patch(source){const edits=standaloneCustomizeEdits(source,dictionary);return {edits,output:applyPatch(Buffer.from(source),{sha256:sha256(source),edits}).toString()};}
test('真实侧栏动作配置只翻译市场标签，动作标识与其他同名内容不变',()=>{
 const {edits,output}=patch(sidebar);assert.equal(edits.length,1);
 const context=vm.createContext({});vm.runInContext(output,context);
 assert.equal(vm.runInContext('render()',context),'自定义');assert.equal(vm.runInContext('actions.marketplace.id',context),'marketplace');assert.equal(vm.runInContext('actions.other.label',context),'Customize');
});
test('本地市场对话框标题和按钮中文化，文件选择行为保持一致',()=>{
 const {edits,output}=patch(dialog);assert.equal(edits.length,2);
 const context=vm.createContext({});vm.runInContext(output,context);
 const options=vm.runInContext('market({showOpenDialog:x=>x}).handlePickLocalFolder()',context);
 assert.equal(options.title,'选择本地插件市场文件夹');assert.equal(options.openLabel,'选择文件夹');assert.equal(options.canSelectFiles,false);assert.equal(options.canSelectFolders,true);assert.equal(options.canSelectMany,false);assert.match(output,/other="Select Folder"/);
});
test('侧栏配置与本地市场对话框在位移和局部改名后仍自动定位',()=>{
 const source=sample+sidebar+dialog,base=template('out/main.js',source);
 base.patterns.push(...compilePatterns(source,{file:base.file,edits:standaloneCustomizeEdits(source,dictionary)}).patterns);
 const changed='// 位移\n'+source.replaceAll('actions','renamedActions').replaceAll('service','renamedService');
 const adapter=adaptSource(Buffer.from(changed),base,{version:'proof',commit:'proof'}),output=applyPatch(Buffer.from(changed),adapter).toString();
 assert.match(output,/label:"自定义"/);assert.match(output,/title:"选择本地插件市场文件夹"/);assert.match(output,/openLabel:"选择文件夹"/);
});
