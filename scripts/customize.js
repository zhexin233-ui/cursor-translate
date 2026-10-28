// Customize 独立编译模块：包含初始化器之前的组件声明，只处理逐项批准的显示文案。
import fs from 'node:fs';
import {scanStatements,visitAst,moduleFor} from '../src/ast.js';

const approved=JSON.parse(fs.readFileSync(new URL('../dictionaries/customize-approved.json',import.meta.url)));
const technicalKeys=new Set(['id','key','name','type','kind','value','className','displayName','commandId','keywords','href','url','rel','target','surface','color','onKeyDown','onSelect','kbs']);
const detailLabels=['Skills','Subagents','Rules','Commands','Hooks'];
const keyOf=n=>n?.name??n?.value;

export function customizeNodes(source,manifest=approved){
 const result=[],found=new Set();let pending=[];
 scanStatements(source,statement=>{
  pending.push(statement);
  const names=[];
  visitAst(statement,n=>{if(n.type==='Property'&&n.method&&typeof n.key.value==='string'&&n.key.value.endsWith('.js'))names.push(n.key.value);});
  if(!names.length)return;
  const modules=names.filter(name=>Object.hasOwn(manifest,name));
  for(const module of modules){
   found.add(module);const allowed=new Set(manifest[module]);
   for(const part of pending)visitAst(part,(node,ancestors)=>{
    const actual=moduleFor(ancestors);
    if(actual?actual!==module:module!==names[0])return;
    const parent=ancestors.at(-2);
    // 分组 label 也是打开源码回调的技术类型；只翻译最终标题渲染。
    if(module==='PluginDetailView.js'&&node.type==='MemberExpression'&&!node.computed&&node.property.name==='label'&&parent?.type==='Property'&&keyOf(parent.key)==='children'&&parent.value===node){
     result.push({node,kind:'display-expression',context:'customize/PluginDetailView.js/group-title'});return;
    }
    const text=node.type==='Literal'?node.value:node.type==='TemplateElement'?node.value.cooked:undefined;
    if(typeof text!=='string'||!allowed.has(text))return;
    const property=ancestors.slice(0,-1).findLast(n=>n.type==='Property');
    if(parent?.key===node||technicalKeys.has(keyOf(property?.key)))return;
    if(parent?.type==='MemberExpression'||parent?.type==='BinaryExpression'||parent?.type==='SwitchCase'&&parent.test===node)return;
    if(ancestors.some(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['debug','log','warn','error'].includes(keyOf(n.callee.property))))return;
    if(ancestors.some(n=>n.type==='NewExpression'&&['Error','TypeError'].includes(n.callee.name)))return;
    result.push({node,text,kind:node.type==='TemplateElement'?'template':'literal',context:`customize/${module}/${keyOf(property?.key)??'approved-display'}`});
   });
  }
  pending=[];
 });
 for(const module of Object.keys(manifest))if(!found.has(module))throw Error(`Customize 模块缺失：${module}`);
 return result;
}

export function customizeEdits(source,dictionary,manifest=approved){
 return customizeNodes(source,manifest).flatMap(({node,text,kind,context})=>{
  if(kind==='display-expression'){
   const labels=Object.fromEntries(detailLabels.map(label=>{const zh=dictionary.get(label);if(!zh)throw Error(`Customize 分组译文缺失：${label}`);return[label,zh];}));
   const original=source.slice(node.start,node.end);
   return[{start:node.start,end:node.end,original,replacement:`(${JSON.stringify(labels)}[${original}]??${original})`,kind,context,expected:1}];
  }
  // 英文复数后缀在中文计数文案中省略，仅允许白名单中的两个模块。
  const plural=text==='s'&&['customize/CustomizeManage.utils.js/','customize/AddPluginsToMarketplaceMenu.js/'].some(prefix=>context.startsWith(prefix));
  const translated=dictionary.get(text)??(plural?'':undefined);
  if(translated===undefined)throw Error(`Customize 译文缺失：${text}`);
  if(translated===text)return[];
  const replacement=kind==='template'?translated.replaceAll('\\','\\\\').replaceAll('`','\\`').replaceAll('${','\\${'):JSON.stringify(translated);
  return[{start:node.start,end:node.end,original:source.slice(node.start,node.end),replacement,kind,context,expected:1}];
 });
}
