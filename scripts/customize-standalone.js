// Customize 的新建、状态及入口位于未命名编译区，按业务结构限定显示节点。
import {scanStatements,visitAst,moduleFor} from '../src/ast.js';

const key=n=>n?.name??n?.value;
const technical=new Set(['id','type','kind','value','key','noun','label','source','statusType','tone','className','kbs','initialPrompt']);
const labels={Skill:'技能',Subagent:'子智能体',skill:'技能',subagent:'子智能体',rule:'规则',command:'命令',MCP:'MCP'};
const nls=new Map([
 [7762,'Enter Command Name'],[7763,'e.g., my-custom-command'],[7764,'Please enter a name for the new command'],[7765,'Command name cannot be empty'],[7766,'Command name can only contain lowercase letters, numbers, and hyphens'],[7767,'A command with this name already exists'],
 [12439,'Enter Command Name'],[12440,'e.g., my-custom-command'],[12441,'Please enter a name for the new command'],[12442,'Command name cannot be empty'],[12443,'Command name can only contain lowercase letters, numbers, and hyphens'],[12444,'A command with this name already exists'],
 [12445,'New Rule'],[12446,'e.g. my-rule'],[12447,'Enter a name for the new rule'],[12448,'Rule name cannot be empty'],[12449,'Rule name can only contain lowercase letters, numbers, and hyphens'],[12450,'A rule with this name already exists']
]);
const texts=new Set([
 'New User Skill','e.g., my-custom-skill or npx skills add owner/repo','e.g., my-custom-skill','Enter a name, or paste an install command from skills.sh','Enter a name for the new skill',
 'New User Rule','Style request, response language, tone...','User Rules apply to all of your chats','User Rule','[Untitled]','Delete Rule','Could not update rule.','Could not delete rule.',
 'Use lowercase letters, numbers, and hyphens (must start with a letter or number)','Installing skills from a command is disabled by your team admin',
 'Needs Authentication','Needs attention','Needs authentication','Error - Show Output','Connected','Connecting…','Degraded','Error','Disconnected','Disabled','Loading','Ready',
 'Select a local marketplace folder','Select Folder','Confirm','Cancel','Prompt','Failed to validate input.','Customize','Local',
 'Plugins, MCPs, Skills, and Rules have moved to Customize',"We've introduced a new home for all the ways to customize Cursor.",'Dismiss','Open Customize',
 'Select workspace folder for MCP configuration','Cannot create workspace MCPs without a workspace. Please open a folder first.'
]);
const templates=new Map([
 ['New User {0}',e=>`"新建用户"+${display(e[0])}`],
 ['Enter a name for the new {0}',e=>`"请输入新"+${display(e[0])}+"的名称"`],
 ['{0} name cannot be empty',e=>`${display(e[0])}+"名称不能为空"`],
 ['A {0} with this name already exists',e=>`"同名"+${display(e[0])}+"已存在"`],
 ['Could not create {0}.',e=>`"无法创建"+${display(e[0])}+"。"`],
 ['Cannot create project {0}s without a workspace. Please open a folder first.',e=>`"没有工作区，无法创建项目"+${display(e[0])}+"。请先打开文件夹。"`],
 ['Are you sure you want to delete "{0}"? This action cannot be undone.',e=>`"确定要删除“"+(${e[0]})+"”吗？此操作无法撤销。"`]
]);
function display(expression){return `(Object.getOwnPropertyDescriptor(${JSON.stringify(labels)},${expression})?.value??${expression})`;}

export function standaloneCustomizeEdits(source,dictionary){
 const edits=new Map();
 const add=(node,replacement,kind,context)=>{
  const edit={start:node.start,end:node.end,original:source.slice(node.start,node.end),replacement,kind,context:`customize/standalone/${context}`,expected:1};
  const previous=edits.get(node.start);if(previous&&previous.replacement!==replacement)throw Error('Customize 独立文案冲突');edits.set(node.start,edit);
 };
 const translate=(node,text,kind,context)=>{
  const zh=dictionary.get(text);if(zh===undefined)throw Error(`Customize 独立译文缺失：${text}`);
  if(zh===text)return;
  add(node,kind==='template'?zh.replaceAll('\\','\\\\').replaceAll('`','\\`').replaceAll('${','\\${'):JSON.stringify(zh),kind,context);
 };
 scanStatements(source,statement=>{
  visitAst(statement,(fn,outer)=>{
   if(fn.type!=='FunctionDeclaration')return;
   const code=source.slice(fn.start,fn.end);
   const naming=code.includes('New User ')||code.includes('User Rules apply to all of your chats')||code.includes('Use lowercase letters, numbers, and hyphens (must start with a letter or number)');
   const status=code.includes('"Needs Authentication"')||code.includes('"Needs attention"')||code.includes('"Needs authentication"');
   const prompt=code.includes('confirmLabel??"Confirm"')||code.includes('"Failed to validate input."');
   const sidebar=code.includes('name:"Customize"')&&code.includes('agent_layout_browse_button');
   const localMarket=code.includes('handlePickLocalFolder')&&code.includes('Select a local marketplace folder');
   const banner=code.includes('cursor-settings-inline-banner__title');
   const environment=code.includes('return{id:"local",kind:"local",label:"Local"}');
   const command=/\.input\(\{title:[\w$]+\((?:7762|12439|12445),null\)/.test(code);
   if(!naming&&!status&&!prompt&&!sidebar&&!banner&&!environment&&!command&&!localMarket)return;
   const replaced=[];
   visitAst(fn,(node,parents)=>{
    if(replaced.some(n=>node.start>=n.start&&node.end<=n.end))return;
    const parent=parents.at(-2),property=parents.slice(0,-1).findLast(n=>n.type==='Property'),field=key(property?.key);
    if(parents.some(n=>n.type==='CallExpression'&&n.callee.type==='MemberExpression'&&['error','warn','log','debug'].includes(key(n.callee.property))))return;
    if(node.type==='CallExpression'&&command&&node.arguments.length===2&&node.arguments[1].type==='Literal'&&node.arguments[1].value===null&&nls.has(node.arguments[0].value)){
     const en=nls.get(node.arguments[0].value);translate(node,en,'display-expression','new-primitive/nls');replaced.push(node);return;
    }
    if(node.type==='TemplateLiteral'&&naming){
     const pattern=node.quasis.map((q,i)=>q.value.cooked+(i<node.expressions.length?`{${i}}`:'')).join(''),transform=templates.get(pattern);
     if(transform){add(node,`(${transform(node.expressions.map(n=>source.slice(n.start,n.end)))})`,'display-expression','new-primitive/template');replaced.push(node);return;}
     // 例子仍是合法标识符，只翻译前缀；不改 noun、路径和命令内容。
     if(pattern==='e.g., my-custom-{0}')translate(node.quasis[0],'e.g., my-custom-','template','new-primitive/placeholder');
    }
    if(node.type==='TemplateElement'&&status&&node.value.cooked===' in ')translate(node,' in ','template','mcp/status-summary');
    if(node.type!=='Literal'||typeof node.value!=='string'||!texts.has(node.value)||parent?.key===node)return;
    if(['BinaryExpression','MemberExpression'].includes(parent?.type)||parent?.type==='SwitchCase'&&parent.test===node)return;
    const displayField=field==='label'&&(environment||status)||field==='name'&&sidebar;
    if(technical.has(field)&&!displayField)return;
    translate(node,node.value,'literal',sidebar?'navigation':banner?'migration-banner':status||environment?'mcp/status':prompt?'prompt':'new-primitive');
   });
  });
  visitAst(statement,(node,parents)=>{
   // Agents 壳层从动作配置读取标签；只匹配市场动作完整的显示结构。
   if(node.type==='ObjectExpression'){
    const fields=new Map(node.properties.filter(p=>p.type==='Property').map(p=>[key(p.key),p.value]));
    if(fields.get('id')?.value==='marketplace'&&fields.get('iconName')?.value==='extensions'&&fields.get('label')?.value==='Customize'&&fields.get('editorPanelType')?.value==='configuration'&&(fields.get('showsAgentSelector')?.value===false||fields.get('showsAgentSelector')?.type==='UnaryExpression'&&fields.get('showsAgentSelector').operator==='!'&&fields.get('showsAgentSelector').argument.value===1)){
     translate(fields.get('label'),'Customize','literal','sidebar/action-label');
    }
   }
   if(node.type!=='Literal'||typeof node.value!=='string'||moduleFor(parents))return;
   const parent=parents.at(-2);
   if(['Plugins, MCPs, Skills, and Rules have moved to Customize','Installing skills from a command is disabled by your team admin'].includes(node.value)&&((parent?.type==='VariableDeclarator'&&parent.init===node)||(parent?.type==='AssignmentExpression'&&parent.right===node)))translate(node,node.value,'literal','migration-banner/title');
   if(node.value==='Customize'&&parent?.type==='ReturnStatement'){
    const method=parents.findLast(n=>n.type==='MethodDefinition'),owner=parents.findLast(n=>n.type==='ClassExpression'||n.type==='ClassDeclaration');
    if(key(method?.key)==='getName'&&owner&&source.slice(owner.start,owner.end).includes('path:"cursor/customize"'))translate(node,node.value,'literal','editor/title');
   }
  });
 });
 return [...edits.values()].sort((a,b)=>a.start-b.start);
}
