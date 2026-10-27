// 仅维护者运行：从已核验的原版资源生成逐节点清单，不修改 Cursor。
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
import { ancestor, simple } from 'acorn-walk';
import { readDictionary } from '../src/dictionary.js';
import {versions} from './versions.js';
import { APP, settingsRegion } from './inspect.js';
const app = process.argv[2] ?? APP;
const product = JSON.parse(fs.readFileSync(`${app}/product.json`));
const version=product.version,config=versions[version],cfg=config?.desktop;
if(!cfg||product.commit!==config.commit)throw Error('不是已适配目标原版');
const file = 'out/vs/workbench/workbench.desktop.main.js';
const buffer = fs.readFileSync(`${app}/${file}`), source = buffer.toString('utf8');
if(createHash('sha256').update(buffer).digest('hex')!==cfg.sha256)throw Error('IDE 原版指纹不匹配');
const region = settingsRegion(source), ast = parse(region.text, { ecmaVersion: 'latest', sourceType: 'module' });
const dict = readDictionary(), edits = [], pending = new Map(), seen = new Set();
const keyOf = n => n?.name ?? n?.value;
function add(start, end, replacement, kind, context, original) {
  if (seen.has(start)) throw Error(`重复节点 ${start}`);
  seen.add(start);
  edits.push({ start, end, original: original ?? source.slice(start,end), replacement, kind, context, expected: 1 });
}
const uiKeys = new Set(['children','label','description','title','placeholder','searchPlaceholder','tooltip','content','message','aria-label','ariaLabel','accessibleLabel','labelOutsidePicker','protectionDescription','showLocalhostLinks','openWebLinks','error','offerTitle','offerDescription','progressCancel','notReady','disabledByTeamAdmin','disabledByPrivacyMode','storeUnavailable','migrationRunning','actionTitle']);
function uiContext(ancestors) {
  const prop = ancestors.slice(0,-1).reverse().find(n => n.type === 'Property');
  if (!uiKeys.has(keyOf(prop?.key))) return null;
  // 比较值、配置键和事件处理函数中的行为字符串不属于可显示文案。
  const propIndex = ancestors.lastIndexOf(prop);
  if (ancestors.slice(propIndex+1).some(n => n.type === 'BinaryExpression' || n.type === 'SwitchCase')) return null;
  const fn = ancestors.findLast(n => n.type === 'FunctionDeclaration');
  const call = ancestors.findLast(n => n.type === 'CallExpression' && n.callee.name === 'Kl');
  return call ? `${call.arguments[0].value}/${call.arguments[1].value}/${keyOf(prop.key)}` : `${fn?.id?.name ?? 'settings'}/${keyOf(prop.key)}`;
}
ancestor(ast, {
  Literal(node, ancestors) {
    if (typeof node.value !== 'string') return;
    const context = uiContext(ancestors);
    const parent = ancestors.at(-2);
    if (!context || parent?.key === node) return;
    const translation = dict.get(node.value);
    if (translation && translation !== node.value) add(region.start+node.start,region.start+node.end,JSON.stringify(translation),'literal',context);
    else if (!translation && /[A-Za-z]{2}/.test(node.value)) pending.set(node.value, context);
  },
  TemplateLiteral(node, ancestors) {
    const context = uiContext(ancestors);
    if (!context) return;
    for (const quasi of node.quasis) {
      const text = quasi.value.cooked;
      let translated = dict.get(text);
      // 带快捷键的搜索提示使用相同术语，保留表达式原样。
      if (text === 'Search settings ') translated = '搜索设置 ';
      if (translated && translated !== text) add(region.start+quasi.start,region.start+quasi.end,translated.replaceAll('`','\\`').replaceAll('${','\\${'),'template',context);
      else if (!translated && /[A-Za-z]{2}/.test(text)) pending.set(text,context);
    }
  }
});
// 已逐项审查的设置局部常量和返回值，仍由 AST 核验确切字符串节点。
const literalNodes = new Map();
simple(ast,{Literal(n){literalNodes.set(region.start+n.start,n)}});
const extras=JSON.parse(fs.readFileSync(new URL('../dictionaries/approved-extra.json',import.meta.url)));
for(const row of version==='3.27.14'?extras:[]){
 const node=literalNodes.get(row.start);
 if(!node || node.value!==row.source || !dict.has(row.source))throw Error(`额外文案节点变化：${row.source}`);
 if(!seen.has(row.start))add(row.start,region.start+node.end,JSON.stringify(row.source==='OK'&&row.context==='RSw'?'成功':dict.get(row.source)),'literal',`${row.context}/approved-display`);
}
if(version!=='3.27.14'){
 const approved=new Set(extras.map(x=>x.source));
 ancestor(ast,{Literal(node,parents){
  if(typeof node.value!=='string'||!approved.has(node.value)||seen.has(region.start+node.start))return;
  const parent=parents.at(-2),prop=parents.slice(0,-1).findLast(n=>n.type==='Property');
  if(parent?.key===node||['BinaryExpression','MemberExpression','SwitchCase'].includes(parent?.type))return;
  if(prop&&!uiKeys.has(keyOf(prop.key))&&!['name','queue','bidi','automation','protection','section'].includes(keyOf(prop.key)))return;
  const fn=parents.findLast(n=>n.type==='FunctionDeclaration')?.id.name??'settings-constant';
  const zh=node.value==='OK'&&parents.some(n=>n.type==='TemplateLiteral')?'成功':dict.get(node.value);
  add(region.start+node.start,region.start+node.end,JSON.stringify(zh),'literal',`${fn}/approved-display`);
 }});
}
// 导航对象独立于设置组件区，单独解析并限定属性值。
const navStart = source.indexOf(`${cfg.nav}={general:"General"`);
if (navStart < 0) throw Error('导航对象缺失');
const navEnd = source.indexOf(`},${cfg.navNext}=`,navStart)+1;
const navText = source.slice(navStart+4,navEnd);
const navAst = parse(`(${navText})`,{ecmaVersion:'latest'});
simple(navAst, { Property(n) {
  const value=n.value;
  if (value.type !== 'Literal' || typeof value.value !== 'string') throw Error('导航结构变化');
  const translated=dict.get(value.value);
  if (!translated && value.value !== 'Tab') throw Error(`导航译文缺失：${value.value}`);
  if (translated && translated !== value.value) add(navStart+4+value.start-1,navStart+4+value.end-1,JSON.stringify(translated),'literal',`navigation/${keyOf(n.key)}`);
}});
// 页脚只替换已知对象中的可显示字段。
const footerStart=source.indexOf(`${cfg.footer}={docs:"Docs",contact:"Contact"}`);
if(footerStart<0) throw Error('页脚结构变化');
for(const text of ['Docs','Contact']) {
 const at=source.indexOf(JSON.stringify(text),footerStart);
 add(at,at+JSON.stringify(text).length,JSON.stringify(dict.get(text)),'literal',`footer/${text}`);
}
// 搜索原始关键词加入别名，保留原有排序、目的地和 feature 条件。
const reverse={};
for(const [en,zh] of dict) if(en!==zh) (reverse[zh]??=[]).push(en);
const functions=new Map();simple(ast,{FunctionDeclaration(n){functions.set(n.id.name,n)}});
const search=functions.get(cfg.index), norm=functions.get(cfg.normalizer), jump=functions.get(cfg.jump);
if(!search || !norm || !jump) throw Error('搜索函数缺失');
const searchText=region.text.slice(search.start,search.end);
if(!searchText.startsWith(`function ${cfg.index}(e,t){${cfg.indexGuard}(e);`))throw Error('搜索索引结构变化');
const injection=`const __cursorZhOriginal=${JSON.stringify(reverse)};e=e.map(i=>({...i,aliases:[...(i.aliases??[]),...[i.label,i.description,t(i.destination.tab)].flatMap(v=>Object.getOwnPropertyDescriptor(__cursorZhOriginal,v)?.value??[])]}));`;
const insertion=region.start+search.start+`function ${cfg.index}(e,t){${cfg.indexGuard}(e);`.length;
add(insertion,insertion,injection,'search-aliases','search/english-aliases','');
const oldNorm='function hBe(e){return e.toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}';
if(region.text.slice(norm.start,norm.end)!==oldNorm)throw Error('归一化结构变化');
add(region.start+norm.start,region.start+norm.end,'function hBe(e){return e.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu," ").trim()}','search-normalizer','search/chinese');
// 中文没有空格分词，允许汉字关键词出现在标签或说明中间；英文沿用原排序。
const matcher=functions.get(cfg.matcher);
if(!matcher)throw Error('搜索匹配函数缺失');
const matcherText=region.text.slice(matcher.start,matcher.end);
const matcherReplacement=matcherText.slice(0,-1)+';if(/\\p{Script=Han}/u.test(t.text)&&t.tokens.every(i=>/\\p{Script=Han}/u.test(i)?e.includes(i):n.some(r=>r.startsWith(i))))return 6800}';
add(region.start+matcher.start,region.start+matcher.end,matcherReplacement,'search-matcher','search/chinese-substring');
const labelMap=Object.fromEntries(dict);
const replacement=`function ${cfg.jump}(e,t){const z=Object.getOwnPropertyDescriptor(${JSON.stringify(labelMap)},t)?.value??t,n=e.querySelectorAll(${cfg.selector});let i;for(const r of n){const s=r.textContent?.trim();if(s===t||s===z)return r;const o=${cfg.direct}(r);i===void 0&&(o===t||o===z)&&(i=r)}return i}`;
add(region.start+jump.start,region.start+jump.end,replacement,'search-jump','search/label-target');
edits.sort((a,b)=>a.start-b.start);
for(let i=1;i<edits.length;i++)if(edits[i].start<edits[i-1].end)throw Error('补丁重叠');
const adapter={version:product.version,commit:product.commit,platforms:{darwin:version==='3.27.22'?'已完成安装、启动及 Agents 设置中英文搜索与结果跳转验收':'资源已核验，运行待验收',win32:'未完成安装包及运行验收，仅接受相同资源指纹'},file,sha256:createHash('sha256').update(buffer).digest('hex'),region:{start:region.start,end:region.end},edits};
fs.writeFileSync(new URL(`../adapters/${version}.json`,import.meta.url),JSON.stringify(adapter,null,2)+'\n');
const preserved=new Set(JSON.parse(fs.readFileSync(new URL('../dictionaries/preserved.json',import.meta.url))).map(x=>x.source));
const unknown=[...pending].filter(([source])=>!preserved.has(source)).map(([source,context])=>({source,context}));
fs.writeFileSync(new URL('../dictionaries/pending.json',import.meta.url),JSON.stringify(unknown,null,2)+'\n');
console.log(`已生成 ${edits.length} 处定点修改，${unknown.length} 项待审查文案。`);
