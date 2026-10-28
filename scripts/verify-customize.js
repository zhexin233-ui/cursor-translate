// 核验真实编译产物：详情分组的技术类型不变，标题映射单独显示中文。
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseExpressionAt} from 'acorn';
import {simple} from 'acorn-walk';

export function verifyCustomize(source,adapter){
 const edits=adapter.edits.filter(e=>e.context.startsWith('customize/'));
 assert.ok(edits.length>450,'Customize 文案覆盖不足');
 const anchor=source.indexOf('return[{label:"MCPs",items:');
 assert.ok(anchor>=0,'详情分组结构缺失');
 const group=parseExpressionAt(source,source.lastIndexOf('function ',anchor),{ecmaVersion:'latest'});
 assert.ok(!edits.some(e=>e.start>=group.start&&e.end<=group.end),'详情分组的技术类型不能汉化');
 const dependencies=new Set();simple(group,{CallExpression(n){if(n.callee.type==='Identifier')dependencies.add(n.callee.name);}});
 const snippets=[...dependencies].map(name=>{
  const start=source.indexOf(`function ${name}(`);assert.ok(start>=0,`详情分组依赖缺失：${name}`);
  const node=parseExpressionAt(source,start,{ecmaVersion:'latest'});return source.slice(node.start,node.end);
 });
 const groups=vm.runInNewContext(snippets.join('\n')+`;(${source.slice(group.start,group.end)})({mcpServers:[{name:'mcp'}],skills:[{name:'skill'}],subagents:[{name:'agent'}],rules:[{name:'rule'}],commands:[{name:'command'}],hooks:[{name:'hook'}]})`);
 assert.deepEqual(Array.from(groups,g=>g.label),['MCPs','Skills','Subagents','Rules','Commands','Hooks']);
 const display=edits.filter(e=>e.context==='customize/PluginDetailView.js/group-title');assert.equal(display.length,1);
 const original=parseExpressionAt(display[0].original,0,{ecmaVersion:'latest'});assert.equal(original.object.type,'Identifier');
 const titles=Array.from(groups,g=>vm.runInNewContext(display[0].replacement,{[original.object.name]:g}));
 assert.deepEqual(titles,['MCPs','技能','子智能体','规则','命令','钩子']);
 for(const text of ['Search Plugins, Skills, MCPs...','New MCP Server','Marketplace Settings','Import Marketplace','Try in Chat'])assert.ok(edits.some(e=>e.original===JSON.stringify(text)),text);
 return edits.length;
}
