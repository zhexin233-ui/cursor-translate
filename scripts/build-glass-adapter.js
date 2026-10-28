import {standaloneCustomizeEdits} from './customize-standalone.js';
import {customizeEdits} from './customize.js';
// Glass 与标准 IDE 独立编译，在已核验的设置区间、函数及 Customize 模块中生成 AST 补丁。
import fs from 'node:fs';
import {parse,parseExpressionAt} from 'acorn';
import {ancestor,simple} from 'acorn-walk';
import {sha256} from '../src/patch.js';
import {readDictionary} from '../src/dictionary.js';
import {versions} from './versions.js';
import {APP} from './inspect.js';
const app=process.argv[2]??APP,file='out/vs/workbench/workbench.glass.main.js';
const buffer=fs.readFileSync(`${app}/${file}`),source=buffer.toString('utf8');
const product=JSON.parse(fs.readFileSync(`${app}/product.json`)),version=product.version,cfg=versions[version]?.glass;
if(!cfg||product.commit!==versions[version].commit||sha256(buffer)!==cfg.sha256)throw Error('Glass 原版指纹不匹配');
const dict=readDictionary(),edits=[],seen=new Set(),functions=new Map(),unknown=new Map();
const approved=new Set(JSON.parse(fs.readFileSync(new URL('../dictionaries/approved-extra.json',import.meta.url))).map(x=>x.source));
const uiKeys=new Set(['children','label','description','title','placeholder','searchPlaceholder','tooltip','content','message','aria-label','ariaLabel','accessibleLabel','labelOutsidePicker','protectionDescription','showLocalhostLinks','openWebLinks','error','offerTitle','offerDescription','offerAction','offerDismiss','progressTitle','progressCancel','notReady','disabledByTeamAdmin','disabledByPrivacyMode','storeUnavailable','migrationRunning','actionTitle','automation','protection','section']);
const key=n=>n?.name??n?.value;
function expressionAt(at){const n=parseExpressionAt(source,at,{ecmaVersion:'latest'});return n.type==='SequenceExpression'?n.expressions[0]:n;}
function add(node,replacement,kind,context){
 if(seen.has(node.start))return;seen.add(node.start);edits.push({start:node.start,end:node.end,original:source.slice(node.start,node.end),replacement,kind,context,expected:1});
}
function translate(node,context,kind='literal'){
 const en=kind==='template'?node.value.cooked:node.value,zh=context==='glass/aDC/approved-display'&&en==='OK'?'成功':dict.get(en);
 if(zh&&zh!==en)add(node,kind==='template'?zh.replaceAll('`','\\`').replaceAll('${','\\${'):JSON.stringify(zh),kind,context);
 else if(!zh&&/[A-Za-z]{2}/.test(en))unknown.set(en,context);
}
function collect(ast,offset=0,allowApproved=true){
 ancestor(ast,{
  FunctionDeclaration(n){functions.set(n.id.name,{...n,start:n.start+offset,end:n.end+offset});},
  Literal(n,a){
   if(typeof n.value!=='string'||a.at(-2)?.key===n)return;
   const prop=a.slice(0,-1).findLast(p=>p.type==='Property');
   const inDisplay=uiKeys.has(key(prop?.key));
   const approvedDisplay=allowApproved&&approved.has(n.value)&&!['BinaryExpression','MemberExpression','SwitchCase'].includes(a.at(-2)?.type);
   if(!inDisplay&&!approvedDisplay)return;
   if(prop&&a.slice(a.lastIndexOf(prop)+1).some(p=>p.type==='BinaryExpression'||p.type==='SwitchCase'))return;
   translate({...n,start:n.start+offset,end:n.end+offset},`glass/${a.findLast(p=>p.type==='FunctionDeclaration')?.id?.name??'settings'}/${inDisplay?key(prop?.key):'approved-display'}`);
  },
  TemplateLiteral(n,a){
   const prop=a.slice(0,-1).findLast(p=>p.type==='Property');
   if(!uiKeys.has(key(prop?.key)))return;
   for(const q of n.quasis)translate({...q,start:q.start+offset,end:q.end+offset},`glass/template/${key(prop.key)}`,'template');
  }
 });
}
// 主设置组：目录、搜索引擎、各页组件及其专用 UI 辅助模块。
const start=source.indexOf(cfg.start),end=source.indexOf(cfg.end,start);
if(start<0||end<0)throw Error('Glass 设置模块边界缺失');
collect(parse(source.slice(start,end),{ecmaVersion:'latest',sourceType:'module'}),start);
// 外观、智能体专属设置和隐藏 DOM 搜索目录，与主设置组独立编译。
const secondStart=source.indexOf('function VtE(');
const secondCall=source.indexOf(`${cfg.wrapper}({"glass-settings-search-index.react.js"()`,secondStart);
if(secondStart<0||secondCall<0)throw Error('Glass 扩展设置模块边界缺失');
const secondEnd=expressionAt(secondCall).end;
collect(parse(source.slice(secondStart,secondEnd)+';',{ecmaVersion:'latest',sourceType:'module'}),secondStart);
// 只读解析已知初始化器，补齐共享的设置标题常量。
for(const name of ['browserIntegrationSettings.js','agentAppearanceSettings.js']){
 const at=source.indexOf(`${cfg.wrapper}({"${name}"()`);if(at<0)throw Error(`模块缺失：${name}`);
 collect(expressionAt(at));
}
const navAt=source.indexOf('N8n={general:"General"')+4;
if(navAt<4)throw Error('Glass 导航缺失');
const nav=expressionAt(navAt);
for(const property of nav.properties)translate(property.value,`glass/navigation/${key(property.key)}`);
for(const symbol of [cfg.footer]){
 const at=source.indexOf(`${symbol}={`)+symbol.length+1;
 if(at<=symbol.length)throw Error(`标题常量缺失：${symbol}`);
 const node=expressionAt(at);
 for(const property of node.properties)if(property.value.type==='Literal')translate(property.value,`glass/${symbol}/${key(property.key)}`);
}
function getFunction(name){
 if(functions.has(name))return functions.get(name);
 const at=source.indexOf(`function ${name}(`);if(at<0)throw Error(`Glass 函数缺失：${name}`);
 const node=expressionAt(at);functions.set(name,node);return node;
}
// 设置侧栏是专用函数，账户菜单仅允许其设置标签进入清单。
collect(getFunction(cfg.sidebar),0,false);
const menu=getFunction(cfg.menu);simple(menu,{Literal(n){if(['Close Settings','Settings'].includes(n.value))translate(n,'glass/account/settings-label');}});
const placeholderAt=source.indexOf(`var ${cfg.placeholder}="Search Settings"`)+`var ${cfg.placeholder}=`.length;
if(placeholderAt<`var ${cfg.placeholder}=`.length)throw Error('Glass 搜索框缺失');
translate(expressionAt(placeholderAt),'glass/search/placeholder');
// mY 的标签和说明是显式显示参数，不能把 tab、配置键或 aliases 当文案。
const indexAst=parse(source.slice(secondStart,secondEnd)+';',{ecmaVersion:'latest',sourceType:'module'});
simple(indexAst,{CallExpression(n){if(n.callee.name==='mY')for(const argument of n.arguments.slice(1,3))if(argument.type==='Literal'&&typeof argument.value==='string')translate({...argument,start:secondStart+argument.start,end:secondStart+argument.end},'glass/search/supplement');}});
const norm=getFunction(cfg.normalizer);
if(source.slice(norm.start,norm.end)!=='function Age(t){return t.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}')throw Error('Glass 归一化函数变化');
add(norm,'function Age(t){return t.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu," ").trim()}','search-normalizer','glass/search/chinese');
const matcher=getFunction(cfg.matcher);
add(matcher,source.slice(matcher.start,matcher.end-1)+';if(/\\p{Script=Han}/u.test(e.text)&&e.tokens.every(i=>/\\p{Script=Han}/u.test(i)?t.includes(i):n.some(r=>r.startsWith(i))))return 6800}','search-matcher','glass/search/substring');
const reverse={};for(const[en,zh]of dict)if(en!==zh)(reverse[zh]??=[]).push(en);
const row=getFunction(cfg.row),rowStart=source.indexOf('{',row.start)+1;
add({start:rowStart,end:rowStart},`const __cursorZhOriginal=${JSON.stringify(reverse)};t={...t,aliases:[...t.aliases,...[t.value,t.description].flatMap(v=>Object.getOwnPropertyDescriptor(__cursorZhOriginal,v)?.value??[])]};`,'search-aliases','glass/search/english-aliases');
const keywordStart=source.indexOf('t.keywords.join(" ")',row.start);
if(keywordStart<row.start||keywordStart>row.end)throw Error('Glass 搜索关键词结构变化');
add({start:keywordStart,end:keywordStart+'t.keywords.join(" ")'.length},'[...t.keywords,...t.aliases].join(" ")','search-keywords','glass/search/mixed-keywords');
const jump=getFunction(cfg.jump);
add(jump,`function ${cfg.jump}(t,e){const z=Object.getOwnPropertyDescriptor(${JSON.stringify(Object.fromEntries(dict))},e)?.value??e,n=t.querySelectorAll(${cfg.selector});let i;for(const r of n){const s=r.textContent?.trim();if(s===e||s===z)return r;const o=${cfg.direct}(r);i===void 0&&(o===e||o===z)&&(i=r)}return i}`,'search-jump','glass/search/label-target');
// Customize 与设置区分别收集，固定版本与自动适配共用同一份定点清单。
for(const edit of [...customizeEdits(source,dict),...standaloneCustomizeEdits(source,dict)]){
 const existing=edits.find(e=>e.start===edit.start);
 if(existing){if(existing.end!==edit.end||existing.replacement!==edit.replacement)throw Error(`Customize 节点冲突：${edit.context}`);continue;}
 seen.add(edit.start);edits.push(edit);
}
edits.sort((a,b)=>a.start-b.start);
for(let i=1;i<edits.length;i++)if(edits[i].start<edits[i-1].end)throw Error(`Glass 补丁重叠：${edits[i].context}`);
// 生成时对所有修改后的专属区间重新解析；运行时另做完整脚本语法验证。
const adapter={version,commit:product.commit,file,sha256:sha256(buffer),edits};
fs.writeFileSync(new URL(`../adapters/${version}-glass.json`,import.meta.url),JSON.stringify(adapter,null,2)+'\n');
fs.writeFileSync(new URL('../dictionaries/glass-pending.json',import.meta.url),JSON.stringify([...unknown].filter(([s])=>!/^glass-|^div$|^span$|^svg$|^path$/.test(s)).map(([source,context])=>({source,context})),null,2)+'\n');
console.log(`Glass 已生成 ${edits.length} 处修改。`);
