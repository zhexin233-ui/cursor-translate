// 安装后优先使用原版备份执行检查，兼容自动适配及 Windows 文件级备份。
import fs from 'node:fs';
import path from 'node:path';
import {loadAdapter,sha256} from '../src/patch.js';
import {statePaths} from '../src/installer.js';
export function originalApp(app){
 const product=JSON.parse(fs.readFileSync(path.join(app,'product.json')));let adapter;
 try{adapter=loadAdapter(product.version);}catch{}
 const primary=adapter?.file??'out/vs/workbench/workbench.desktop.main.js';
 if(adapter&&sha256(fs.readFileSync(path.join(app,primary)))===adapter.sha256)return app;
 const insideContents=path.basename(path.dirname(path.dirname(app)))==='Contents';
 const root=fs.realpathSync(path.resolve(app,insideContents?'../../..':'../..')),recordPath=statePaths({root}).record;
 if(fs.existsSync(recordPath)){
  const record=JSON.parse(fs.readFileSync(recordPath)),original=record.files.find(f=>f.path===primary);
  for(const candidate of [path.join(record.backup,'Cursor.app/Contents/Resources/app'),path.join(record.backup,'files')]){
   if(record.version===product.version&&record.commit===product.commit&&original&&fs.existsSync(path.join(candidate,primary))&&sha256(fs.readFileSync(path.join(candidate,primary)))===original.before)return candidate;
  }
 }
 if(!adapter)return app;
 throw Error('检查需要原版资源，请指定安装前的资源目录或原版备份目录');
}
