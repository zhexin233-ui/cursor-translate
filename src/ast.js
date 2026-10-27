import {Parser,parse,tokTypes} from 'acorn';
import {createHash} from 'node:crypto';

const metadata=new Set(['start','end','loc','range','raw']);
const globals=new Set(('undefined NaN Infinity Object Array String Number Boolean BigInt Symbol RegExp Math JSON Date Map Set WeakMap WeakSet Promise Reflect Proxy Error TypeError SyntaxError RangeError Node Element HTMLElement document window globalThis console process Buffer URL Intl Uint8Array TextEncoder TextDecoder').split(' '));
export function fixedIdentifier(node,parent,field){
  return globals.has(node.name)||parent?.type==='MemberExpression'&&field==='property'&&!parent.computed||parent?.type==='Property'&&field==='key'&&!parent.computed||parent?.type==='MethodDefinition'&&field==='key'&&!parent.computed||parent?.type==='ImportSpecifier'&&field==='imported'||parent?.type==='ExportSpecifier'&&field==='exported';
}
export function visitAst(node,callback,ancestors=[],route=[]){
  if(!node||typeof node.type!=='string')return;
  const chain=[...ancestors,node];callback(node,chain,route);
  for(const [field,value] of Object.entries(node)){
    if(metadata.has(field))continue;
    if(Array.isArray(value))value.forEach((child,index)=>{if(child?.type)visitAst(child,callback,chain,[...route,field,index]);});
    else if(value?.type)visitAst(value,callback,chain,[...route,field]);
  }
}
export function nodeAt(node,route){return route.reduce((value,field)=>value?.[field],node);}
export function signature(node){
  const names=[],symbols=new Map();
  function normalize(value,parent,field){
    if(typeof value==='bigint')return ['bigint',String(value)];
    if(value===null||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(child=>normalize(child,parent,field));
    if(value.type==='Identifier'){
      if(fixedIdentifier(value,parent,field))return ['Identifier',value.name];
      if(!symbols.has(value.name)){symbols.set(value.name,names.length);names.push(value.name);}
      return ['Identifier',symbols.get(value.name)];
    }
    const result={};
    for(const key of Object.keys(value).sort()){
      if(metadata.has(key)||key==='value'&&value.regex)continue;
      result[key]=normalize(value[key],value,key);
    }
    return result;
  }
  const hash=createHash('sha256').update(JSON.stringify(normalize(node))).digest('hex');
  return {hash,names};
}
// Acorn 8.15 的模块解析循环：逐条处理并释放 AST，同时保留完整语法和导出检查。
export function scanStatements(source,callback){
  class StreamParser extends Parser{
    parseTopLevel(node){
      const exports=Object.create(null);
      while(this.type!==tokTypes.eof)callback(this.parseStatement(null,true,exports));
      if(this.inModule)for(const name of Object.keys(this.undefinedExports))this.raiseRecoverable(this.undefinedExports[name].start,`Export '${name}' is not defined`);
      this.next();node.body=[];node.sourceType=this.options.sourceType;
      return this.finishNode(node,'Program');
    }
  }
  StreamParser.parse(source,{ecmaVersion:'latest',sourceType:'module'});
}
export function ownerFor(ancestors){
  const declaration=ancestors.find(node=>node.type==='FunctionDeclaration');
  if(declaration)return declaration;
  return ancestors.findLast(node=>node.type==='AssignmentExpression'&&node.operator==='='&&['ObjectExpression','ArrayExpression','Literal'].includes(node.right.type))
    ??ancestors.findLast(node=>node.type==='VariableDeclarator'&&node.init)
    ??ancestors.findLast(node=>['FunctionExpression','ArrowFunctionExpression'].includes(node.type));
}
export function moduleFor(ancestors){
  return ancestors.find(node=>node.type==='Property'&&node.method&&typeof node.key.value==='string'&&node.key.value.endsWith('.js'))?.key.value??'';
}
export function declaredNames(ast){
  const names=new Set();
  function binding(node){if(node?.type==='Identifier')names.add(node.name);else if(node?.type==='RestElement')binding(node.argument);else if(node?.type==='AssignmentPattern')binding(node.left);else if(node?.type==='ArrayPattern')node.elements.forEach(binding);else if(node?.type==='ObjectPattern')node.properties.forEach(p=>binding(p.type==='RestElement'?p.argument:p.value));}
  visitAst(ast,node=>{
    if(node.type==='VariableDeclarator')binding(node.id);
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){binding(node.id);node.params.forEach(binding);}
  });return names;
}
export function renameCode(code,mapping,extras=new Map()){
  const ast=parse(code,{ecmaVersion:'latest',sourceType:'module'}),edits=[];
  visitAst(ast,(node,ancestors)=>{
    if(node.type!=='Identifier')return;
    const parent=ancestors.at(-2),field=parent&&Object.keys(parent).find(k=>parent[k]===node);
    if(fixedIdentifier(node,parent,field))return;
    const replacement=mapping.get(node.name)??extras.get(node.name);
    if(replacement&&replacement!==node.name)edits.push({start:node.start,end:node.end,replacement:parent?.type==='Property'&&parent.shorthand&&field==='value'?`${node.name}:${replacement}`:replacement});
  });
  let result=code;for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.replacement+result.slice(edit.end);
  return result;
}
export function encodeReplacement(code,names){
  const mapping=new Map(names.map((name,index)=>[name,`__cza${index}`]));
  const extras=new Map();
  for(const name of declaredNames(parse(code,{ecmaVersion:'latest',sourceType:'module'})))if(!mapping.has(name)&&!globals.has(name))extras.set(name,`__czn${extras.size}`);
  return renameCode(code,mapping,extras);
}
export function decodeReplacement(code,names){
  const mapping=new Map(names.map((name,index)=>[`__cza${index}`,name])),reserved=new Set(names),extras=new Map();
  for(const name of declaredNames(parse(code,{ecmaVersion:'latest',sourceType:'module'}))){
    if(!/^__czn\d+$/.test(name))continue;
    let index=extras.size,fresh;do{fresh=`__cursorZhAdaptive${index++}`;}while(reserved.has(fresh));
    reserved.add(fresh);extras.set(name,fresh);
  }
  return renameCode(code,mapping,extras);
}
// 编译产物的模块初始化器与顶层声明共享作用域，排除业务函数内部的同名局部绑定。
export function collectDefinition(node,ancestors,index,shape=signature){
  const outer=ancestors.slice(0,-1);
  if(outer.some((n,i)=>['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(n.type)&&!(n.type==='FunctionExpression'&&outer[i-1]?.type==='Property'&&outer[i-1].method&&typeof outer[i-1].key.value==='string'&&outer[i-1].key.value.endsWith('.js'))))return;
  // 初始化器之外的块级绑定不能按全局名字索引；无法确认的全局写入另行拒绝。
  if(outer.some((n,i)=>n.type==='BlockStatement'&&!(outer[i-1]?.type==='FunctionExpression'&&outer[i-2]?.type==='Property'&&outer[i-2].method&&typeof outer[i-2].key.value==='string'&&outer[i-2].key.value.endsWith('.js'))||['ForStatement','ForOfStatement','ForInStatement','SwitchStatement','CatchClause','StaticBlock','ClassBody'].includes(n.type)))return;
  let name,type,value;
  if(node.type==='FunctionDeclaration'){name=node.id.name;type='function';value=node;}
  if(node.type==='VariableDeclarator'&&node.id.type==='Identifier'&&node.init?.type==='Literal'){name=node.id.name;type='constant';value=node.init;}
  if(node.type==='AssignmentExpression'&&node.operator==='='&&node.left.type==='Identifier'&&node.right.type==='Literal'){name=node.left.name;type='constant';value=node.right;}
  if(!name)return;
  const info=shape(value);
  const definition={type,hash:info.hash,names:info.names,free:type==='function'?analyzeReferences(value).free:[]};
  const values=index.get(name)??[];
  if(!values.some(v=>v.type===definition.type&&v.hash===definition.hash))values.push(definition);
  index.set(name,values);return node.start;
}

// 分作用域解析自由引用与全局写入，避免嵌套回调的同名参数掩盖真实依赖。
export function analyzeReferences(ast){
  const root={parent:null,bindings:new Set(),function:false,global:true},references=[],writes=[],bindingNodes=new WeakSet();
  const scope=(parent,isFunction=false,isGlobal=false)=>({parent,bindings:new Set(),function:isFunction,global:isGlobal});
  function bind(pattern,target){
    if(!pattern)return;
    if(pattern.type==='Identifier'){target.bindings.add(pattern.name);bindingNodes.add(pattern);}
    else if(pattern.type==='RestElement')bind(pattern.argument,target);
    else if(pattern.type==='AssignmentPattern')bind(pattern.left,target);
    else if(pattern.type==='ArrayPattern')pattern.elements.forEach(n=>bind(n,target));
    else if(pattern.type==='ObjectPattern')pattern.properties.forEach(n=>bind(n.type==='RestElement'?n.argument:n.value,target));
  }
  function targets(pattern){
    if(!pattern)return[];
    if(pattern.type==='Identifier')return[pattern.name];
    if(pattern.type==='RestElement')return targets(pattern.argument);
    if(pattern.type==='AssignmentPattern')return targets(pattern.left);
    if(pattern.type==='ArrayPattern')return pattern.elements.flatMap(targets);
    if(pattern.type==='ObjectPattern')return pattern.properties.flatMap(p=>targets(p.type==='RestElement'?p.argument:p.value));
    return[];
  }
  function descend(node,current,parent,field){
    if(!node?.type)return;
    if(['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)){
      if(node.type==='FunctionDeclaration')bind(node.id,current);
      const parameters=scope(current);
      if(node.type==='FunctionExpression')bind(node.id,parameters);
      node.params.forEach(p=>bind(p,parameters));node.params.forEach(p=>descend(p,parameters,node,'params'));
      const moduleInitializer=node.type==='FunctionExpression'&&parent?.type==='Property'&&parent.method&&typeof parent.key.value==='string'&&parent.key.value.endsWith('.js');
      descend(node.body,scope(parameters,true,moduleInitializer),node,'body');return;
    }
    if(node.type==='StaticBlock')current=scope(current,true);
    else if(['BlockStatement','CatchClause','ForStatement','ForInStatement','ForOfStatement','SwitchStatement','ClassBody'].includes(node.type))current=scope(current,false,node.type==='BlockStatement'&&field==='body'&&current.global);
    if(node.type==='CatchClause')bind(node.param,current);
    if(node.type==='ClassDeclaration')bind(node.id,current);
    if(node.type==='ClassExpression'){current=scope(current);bind(node.id,current);}
    if(node.type==='VariableDeclarator'){
      let target=current;
      if(parent?.kind==='var')while(target.parent&&!target.function)target=target.parent;
      bind(node.id,target);
    }
    if(node.type==='ImportDeclaration')for(const specifier of node.specifiers)bind(specifier.local,current);
    if(node.type==='Identifier'&&!bindingNodes.has(node)&&!fixedIdentifier(node,parent,field)&&!(['LabeledStatement','BreakStatement','ContinueStatement'].includes(parent?.type)&&field==='label'))references.push({name:node.name,scope:current});
    if(['ForInStatement','ForOfStatement'].includes(node.type)&&node.left.type!=='VariableDeclaration')for(const name of targets(node.left))writes.push({name,scope:current,node});
    if(node.type==='AssignmentExpression'||node.type==='UpdateExpression')for(const name of targets(node.type==='AssignmentExpression'?node.left:node.argument))writes.push({name,scope:current,node});
    for(const [key,value]of Object.entries(node)){
      if(metadata.has(key))continue;
      if(Array.isArray(value))value.forEach(n=>{if(n?.type)descend(n,current,node,key);});
      else if(value?.type)descend(value,current,node,key);
    }
  }
  descend(ast,root);
  function lookup(current,name){for(let s=current;s;s=s.parent)if(s.bindings.has(name))return s;}
  return {free:[...new Set(references.filter(r=>!lookup(r.scope,r.name)).map(r=>r.name))],writes:writes.filter(w=>{const binding=lookup(w.scope,w.name);return !binding||binding.global;})};
}
