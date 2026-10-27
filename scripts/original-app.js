// 安装后优先使用完整备份执行检查，避免把已汉化资源误判为原版。
import fs from 'node:fs';
import path from 'node:path';
import {loadAdapter,sha256} from '../src/patch.js';
import {statePaths} from '../src/installer.js';
export function originalApp(app){
 const product=JSON.parse(fs.readFileSync(path.join(app,'product.json'))),adapter=loadAdapter(product.version);
 if(sha256(fs.readFileSync(path.join(app,adapter.file)))===adapter.sha256)return app;
 const root=path.resolve(app,'../../..'),recordPath=statePaths({root}).record;
 if(fs.existsSync(recordPath)){
  const record=JSON.parse(fs.readFileSync(recordPath));
  const candidate=path.join(record.backup,'Cursor.app/Contents/Resources/app');
  if(record.version===product.version&&fs.existsSync(path.join(candidate,adapter.file))&&sha256(fs.readFileSync(path.join(candidate,adapter.file)))===adapter.sha256)return candidate;
 }
 throw Error('检查需要原版资源，请指定安装前的资源目录或完整应用备份中的 Contents/Resources/app');
}
