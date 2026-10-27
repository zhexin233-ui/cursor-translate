// 维护者从已验证的原版资源生成可跨版本重定位的结构签名。
import fs from 'node:fs';
import path from 'node:path';
import {loadAdapter,sha256} from '../src/patch.js';
import {compilePatterns,mergePatterns} from '../src/adaptive.js';
import {originalApp} from './original-app.js';
import {APP} from './inspect.js';
const apps=process.argv.slice(2);if(!apps.length)apps.push(originalApp(APP));
const resources=[],baselines=[];
for(const app of apps){
 const product=JSON.parse(fs.readFileSync(path.join(app,'product.json'))),adapter=loadAdapter(product.version);
 if(product.commit!==adapter.commit)throw Error('模板必须来自已验证的原版构建');
 for(const target of [adapter,...adapter.additionalTargets]){
  const bytes=fs.readFileSync(path.join(app,target.file));if(sha256(bytes)!==target.sha256)throw Error('模板原版指纹不匹配');
  resources.push(compilePatterns(bytes.toString('utf8'),target));
  baselines.push({version:product.version,commit:product.commit,file:target.file,sha256:target.sha256});
 }
}
const result={schema:1,baselines,resources:mergePatterns(resources)};
fs.writeFileSync(new URL('../adapters/auto-patterns.json',import.meta.url),JSON.stringify(result)+'\n');
console.log(JSON.stringify(result.resources.map(r=>({file:r.file,patterns:r.patterns.length,edits:r.patterns.reduce((n,p)=>n+p.edits.length,0)}))));
