import fs from 'node:fs';
import path from 'node:path';
import {signature,scanStatements,visitAst,ownerFor,moduleFor,nodeAt,encodeReplacement,decodeReplacement,collectDefinition,analyzeReferences} from './ast.js';
import {sha256,applyPatch,loadAdapter} from './patch.js';

const core=['search-normalizer','search-matcher','search-jump','search-aliases'];
const key=(type,module,hash)=>`${type}:${module}:${hash}`;
function markWrites(statement,definitions,supported){
  for(const write of analyzeReferences(statement).writes){
    if(supported.has(write.node.start))continue;
    const values=definitions.get(write.name)??[];
    values.push({type:'unverified-write',hash:String(write.node.start)});definitions.set(write.name,values);
  }
}
function dependencyGraph(owner,definitions,chain){
  if(chain.length>64)throw Error('搜索依赖链过深，无法确认');
  return owner.free.map(name=>{
    const candidates=definitions.get(name);
    if(candidates?.length!==1||!['function','constant'].includes(candidates[0].type))throw Error(`搜索依赖无法唯一确认：${name}`);
    const definition=candidates[0],edge={symbol:owner.names.indexOf(name),type:definition.type,hash:definition.hash};
    if(edge.symbol<0)throw Error('搜索依赖符号缺失');
    const loop=chain.indexOf(name);
    if(loop>=0)edge.cycle=loop;
    else edge.dependencies=definition.type==='function'?dependencyGraph(definition,definitions,[...chain,name]):[];
    return edge;
  });
}
function validateDependencies(edges,names,definitions,chain){
  for(const edge of edges){
    const name=names[edge.symbol],found=definitions.get(name);
    if(found?.length!==1||found[0].type!==edge.type||found[0].hash!==edge.hash||edge.cycle!==undefined&&chain[edge.cycle]!==name)throw Error(`搜索依赖结构变化，已停止适配：${name}`);
    if(edge.cycle===undefined)validateDependencies(edge.dependencies??[],found[0].names,definitions,[...chain,name]);
  }
}
export function compilePatterns(source,adapter){
  const patterns=new Map(),definitions=new Map(),edits=adapter.edits;let next=0;
  scanStatements(source,statement=>{
    const cache=new WeakMap(),routes=new WeakMap(),shapeOf=node=>{if(!cache.has(node))cache.set(node,signature(node));return cache.get(node);};
    const supportedWrites=new Set();
    visitAst(statement,(node,ancestors)=>{const position=collectDefinition(node,ancestors,definitions,shapeOf);if(position!==undefined)supportedWrites.add(position);});
    markWrites(statement,definitions,supportedWrites);
    const relevant=[];
    while(next<edits.length&&edits[next].start<statement.end){
      const edit=edits[next++];if(edit.start<statement.start||edit.end>statement.end)throw Error('模板修改不属于完整语句');relevant.push(edit);
    }
    if(!relevant.length)return;
    const nodes=new Map(),insertions=[];
    visitAst(statement,(node,ancestors,route)=>{
      nodes.set(`${node.start}:${node.end}`,{node,ancestors,route});routes.set(node,route);
      if(node.type==='FunctionDeclaration')insertions.push({node,ancestors,route});
    });
    for(const edit of relevant){
      let found;
      if(edit.kind==='search-aliases'){
        const fn=insertions.find(({node})=>node.body.start+1===edit.start||node.body.body[0]?.end===edit.start);
        if(!fn)throw Error('无法定位搜索别名插入点');
        found={...fn,edge:fn.node.body.start+1===edit.start?'body-start':'guard-end'};
      }else found=nodes.get(`${edit.start}:${edit.end}`);
      if(!found)throw Error(`无法定位原版 AST：${edit.context}`);
      const owner=edit.kind.startsWith('search-')?found.ancestors.find(n=>n.type==='FunctionDeclaration'):ownerFor(found.ancestors);
      if(!owner)throw Error(`无法确认文案所属结构：${edit.context}`);
      // 数组路径可能包含两个字段，实际位置由节点身份确定。
      const routeToOwner=routes.get(owner);
      const route=found.route.slice(routeToOwner.length),module=moduleFor(found.ancestors),shape=shapeOf(owner),id=key(owner.type,module,shape.hash);
      let pattern=patterns.get(id);
      if(!pattern){pattern={type:owner.type,module,hash:shape.hash,symbols:shape.names.length,names:shape.names,free:analyzeReferences(owner).free,entryName:owner.id?.name,edits:[]};patterns.set(id,pattern);}
      pattern.edits.push({route,edge:found.edge,kind:edit.kind,context:edit.context,
        value:edit.kind==='literal'?found.node.value:edit.kind==='template'?found.node.value.cooked:undefined,
        replacement:edit.kind.startsWith('search-')?encodeReplacement(edit.replacement,shape.names):edit.replacement});
    }
  });
  if(next!==edits.length)throw Error('原版模板存在未处理修改');
  for(const pattern of patterns.values()){
    pattern.dependencies=pattern.edits.some(e=>e.kind.startsWith('search-'))?dependencyGraph(pattern,definitions,[pattern.entryName]):[];
    delete pattern.names;delete pattern.free;delete pattern.entryName;
  }
  return {file:adapter.file,patterns:[...patterns.values()]};
}
export function mergePatterns(resources){
  const merged=new Map();
  for(const resource of resources){
    let target=merged.get(resource.file);if(!target){target={file:resource.file,patterns:[]};merged.set(resource.file,target);}
    for(const pattern of resource.patterns){
      let existing=target.patterns.find(p=>key(p.type,p.module,p.hash)===key(pattern.type,pattern.module,pattern.hash));
      if(!existing){existing={...pattern,edits:[]};target.patterns.push(existing);}
      for(const edit of pattern.edits){
        const id=JSON.stringify([edit.route,edit.edge,edit.kind]),previous=existing.edits.find(e=>JSON.stringify([e.route,e.edge,e.kind])===id);
        if(existing.conflicts?.includes(id))continue;
        if(previous&&previous.replacement!==edit.replacement){
          if(edit.kind.startsWith('search-'))throw Error(`搜索模板冲突：${edit.context}`);
          existing.edits=existing.edits.filter(e=>e!==previous);(existing.conflicts??=[]).push(id);continue;
        }
        if(!previous)existing.edits.push(edit);
      }
    }
  }
  return [...merged.values()];
}
export function adaptSource(bytes,template,{version,commit}){
  const source=bytes.toString('utf8'),patterns=new Map(template.patterns.map(p=>[key(p.type,p.module,p.hash),p]));
  const definitions=new Map(),hits=new Map(),values=new Set(template.patterns.flatMap(p=>p.edits.filter(e=>e.value!==undefined).map(e=>e.value)));
  scanStatements(source,statement=>{
    const candidates=new Map(),cache=new WeakMap(),shapeOf=node=>{if(!cache.has(node))cache.set(node,signature(node));return cache.get(node);};
    const supportedWrites=new Set();
    visitAst(statement,(node,ancestors)=>{
      const position=collectDefinition(node,ancestors,definitions,shapeOf);if(position!==undefined)supportedWrites.add(position);
      if(node.type==='FunctionDeclaration'&&!ancestors.slice(0,-1).some(n=>n.type==='FunctionDeclaration'))candidates.set(node,moduleFor(ancestors));
      const value=node.type==='Literal'?node.value:node.type==='TemplateElement'?node.value.cooked:undefined;
      if(!values.has(value))return;
      const owner=ownerFor(ancestors);if(owner)candidates.set(owner,moduleFor(ancestors));
    });
    markWrites(statement,definitions,supportedWrites);
    for(const [node,module] of candidates){
      const shape=shapeOf(node),id=key(node.type,module,shape.hash),pattern=patterns.get(id);
      if(!pattern)continue;
      const list=hits.get(id)??[];list.push({node,names:shape.names});hits.set(id,list);
    }
  });
  const edits=[],confirmed=new Set();let matched=0,ambiguous=0,skipped=0;
  for(const [id,pattern] of patterns){
    const candidates=hits.get(id)??[];
    if(candidates.length!==1){if(candidates.length>1)ambiguous++;else skipped++;continue;}
    const {node,names}=candidates[0];if(names.length!==pattern.symbols)throw Error('标识符绑定结构不一致');
    validateDependencies(pattern.dependencies??[],names,definitions,[node.id?.name]);
    matched++;
    for(const edit of pattern.edits){
      const target=nodeAt(node,edit.route);if(!target)throw Error('结构路径无效');
      let start=target.start,end=target.end;
      if(edit.edge){start=edit.edge==='body-start'?target.body.start+1:target.body.body[0].end;end=start;}
      if(edit.kind==='literal'&&target.value!==edit.value||edit.kind==='template'&&target.value.cooked!==edit.value)throw Error('定位后的原文不一致');
      const replacement=edit.kind.startsWith('search-')?decodeReplacement(edit.replacement,names):edit.replacement;
      edits.push({start,end,original:source.slice(start,end),replacement,kind:edit.kind,context:edit.context,expected:1});
      confirmed.add(edit.kind);
    }
  }
  for(const kind of core)if(!confirmed.has(kind))throw Error(`自动适配无法确认 ${kind}，已停止，应用未修改`);
  if(template.patterns.some(p=>p.edits.some(e=>e.kind==='search-keywords'))&&!confirmed.has('search-keywords'))throw Error('自动适配无法确认混合搜索逻辑，应用未修改');
  if(!edits.some(e=>e.kind==='literal'||e.kind==='template'))throw Error('自动适配未找到可确认的设置文案');
  edits.sort((a,b)=>a.start-b.start);
  const adapter={version,commit,file:template.file,sha256:sha256(bytes),edits,adaptation:{mode:'automatic',matched,ambiguous,skipped,translated:edits.filter(e=>e.kind==='literal'||e.kind==='template').length}};
  const output=applyPatch(bytes,adapter);
  scanStatements(output.toString('utf8'),()=>{});
  return adapter;
}
export function resolveAdapter(target,{patterns,onProgress}={}){
  const pkg=JSON.parse(fs.readFileSync(path.join(target.app,'package.json'))),product=JSON.parse(fs.readFileSync(path.join(target.app,'product.json')));
  if(typeof pkg.version!=='string'||pkg.version!==product.version||typeof product.commit!=='string'||!product.commit)throw Error('应用版本信息不一致，拒绝适配');
  const identity={version:pkg.version,commit:product.commit};
  const verified=['3.27.22','3.27.14'].map(version=>loadAdapter(version));
  for(const adapter of verified){
    const resources=[adapter,...adapter.additionalTargets];
    if(resources.every(resource=>fs.existsSync(path.join(target.app,resource.file))&&sha256(fs.readFileSync(path.join(target.app,resource.file)))===resource.sha256)){
      const automatic=adapter.version!==identity.version||adapter.commit!==identity.commit;
      const targets=resources.map(resource=>({...resource,...identity}));
      return {...targets[0],additionalTargets:targets.slice(1),adaptation:{mode:automatic?'automatic':'verified',strategy:automatic?'identical-resources':'verified-version',translated:resources.reduce((n,r)=>n+r.edits.filter(e=>e.kind==='literal'||e.kind==='template').length,0)}};
    }
  }
  const templates=patterns??JSON.parse(fs.readFileSync(new URL('../adapters/auto-patterns.json',import.meta.url),'utf8')).resources;
  const targets=templates.map(template=>{onProgress?.(`正在自动适配 ${template.file.includes('.glass.')?'Agents':'IDE'} 设置，请稍候…`);return adaptSource(fs.readFileSync(path.join(target.app,template.file)),template,identity);});
  const adaptation={mode:'automatic',strategy:'ast-structure',resources:targets.map(t=>({file:t.file,...t.adaptation}))};
  return {...targets[0],additionalTargets:targets.slice(1),platforms:{darwin:'自动结构适配，尚未实机验收',win32:'自动结构适配，尚未实机验收'},adaptation};
}
