import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {install,uninstall,status,statePaths} from '../src/installer.js';
import {sha256,checksum} from '../src/patch.js';
import {assertClosed,candidates,resolveApp} from '../src/platform.js';
import {treeDigest} from '../src/tree.js';
function fixture(t,platform='win32'){
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'cursor-zh-test-')));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'Cursor'),app=path.join(root,platform==='darwin'?'Contents/Resources/app':'resources/app');fs.mkdirSync(path.join(app,'out'),{recursive:true});
 const source=Buffer.from('const label="Models";'),file='out/main.js',start=source.toString().indexOf('"Models"');
 const adapter={version:'3.27.14',commit:'test',file,sha256:sha256(source),edits:[{start,end:start+8,original:'"Models"',replacement:'"模型"',kind:'literal',expected:1,context:'label'}]};
 fs.writeFileSync(path.join(app,file),source);fs.writeFileSync(path.join(app,'package.json'),JSON.stringify({version:adapter.version}));
 fs.writeFileSync(path.join(app,'product.json'),JSON.stringify({version:adapter.version,commit:adapter.commit,checksums:{'main.js':checksum(source)}}));
 const target={root,app,platform},options={adapter,stateDir:path.join(dir,'state'),run:()=>''};
 return {dir,target,options,source,file,product:fs.readFileSync(path.join(app,'product.json'))};
}
test('安装、重复安装、状态和卸载完整往返',t=>{
 const f=fixture(t);assert.equal(status(f.target,f.options).state,'未安装');
 install(f.target,f.options);assert.equal(status(f.target,f.options).state,'已安装');assert.match(install(f.target,f.options).message,/无需重复/);
 uninstall(f.target,f.options);assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.file)),f.source);assert.deepEqual(fs.readFileSync(path.join(f.target.app,'product.json')),f.product);
 assert.match(uninstall(f.target,f.options).message,/无需重复/);
});
test('未知版本或资源、校验不符时无写入',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.target.app,'package.json'),'{"version":"next"}');
 assert.throws(()=>install(f.target,f.options),/不支持/);assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.file)),f.source);
 fs.writeFileSync(path.join(f.target.app,'package.json'),'{"version":"3.27.14"}');fs.writeFileSync(path.join(f.target.app,f.file),'changed');
 assert.throws(()=>install(f.target,f.options),/指纹/);
});
test('运行中的应用被拒绝，支持路径带空格和中文',()=>{
 assert.throws(()=>assertClosed({root:'/Applications/测试 Cursor.app',platform:'darwin'},()=>'/Applications/测试 Cursor.app/Contents/MacOS/Cursor\n'),/仍在运行/);
 assert.doesNotThrow(()=>assertClosed({root:'/Applications/Cursor.app',platform:'darwin'},()=>'/other/Cursor.app/Contents/MacOS/Cursor\n'));
 assert.throws(()=>assertClosed({platform:'win32'},()=>'"Cursor.exe","123","Console","1","100 K"'),/仍在运行/);
 assert.doesNotThrow(()=>assertClosed({platform:'win32'},()=>'"NotCursor.exe","123"'));
 assert.equal(candidates('win32',{LOCALAPPDATA:'C:/Users/中文',ProgramFiles:'C:/Program Files'}).length,2);
});
test('卸载拒绝跨版本、第三方修改及损坏备份',t=>{
 const f=fixture(t);install(f.target,f.options);fs.appendFileSync(path.join(f.target.app,f.file),'//third party');
 assert.throws(()=>uninstall(f.target,f.options),/拒绝覆盖/);
 const record=JSON.parse(fs.readFileSync(statePaths(f.target,f.options.stateDir).record));fs.appendFileSync(path.join(record.backup,'files',f.file),'corrupt');
 assert.throws(()=>uninstall(f.target,f.options),/备份文件已损坏/);
});
test('写入中失败会自动回滚；中断事务可以恢复',t=>{
 const f=fixture(t);let calls=0;
 const options={...f.options,run:()=>{calls++;if(calls===2){const product=path.join(f.target.app,'product.json');fs.chmodSync(product,0o600);}return '';}};
 // 模拟在写入第二个目标时失败：测试注入点位于原子替换前。
 const originalRename=fs.renameSync;let failed=false;
 fs.renameSync=(from,to)=>{if(!failed&&to===path.join(f.target.app,'product.json')){failed=true;throw Error('模拟磁盘错误');}return originalRename(from,to);};
 try{assert.throws(()=>install(f.target,options),/已回滚/);}finally{fs.renameSync=originalRename;}
 assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.file)),f.source);
 install(f.target,f.options);const paths=statePaths(f.target,f.options.stateDir),record=JSON.parse(fs.readFileSync(paths.record));record.phase='applying';fs.writeFileSync(paths.record,JSON.stringify(record));
 uninstall(f.target,f.options);assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.file)),f.source);
});
test('并发锁阻止重复操作，备份目录不可放入应用内部',t=>{
 const f=fixture(t),p=statePaths(f.target,f.options.stateDir);fs.mkdirSync(p.lock,{recursive:true});
 assert.throws(()=>install(f.target,f.options),/已有操作/);
 assert.throws(()=>statePaths(f.target,path.join(f.target.root,'state')),/不能位于/);
});
test('完整应用指纹识别额外文件修改和符号链接',t=>{
 const f=fixture(t);const before=treeDigest(f.target.root);fs.writeFileSync(path.join(f.target.root,'extra'),'a');assert.notEqual(treeDigest(f.target.root),before);
 if(process.platform!=='win32'){fs.symlinkSync('extra',path.join(f.target.root,'link'));const linked=treeDigest(f.target.root);fs.unlinkSync(path.join(f.target.root,'link'));fs.symlinkSync('other',path.join(f.target.root,'link'));assert.notEqual(treeDigest(f.target.root),linked);}
});

function macFixture(t){
 const f=fixture(t,'darwin');
 f.options.run=(command,args)=>{
   if(command==='/usr/bin/ditto')fs.cpSync(args.at(-2),args.at(-1),{recursive:true,preserveTimestamps:true,verbatimSymlinks:true});
   if(command==='/usr/bin/du')return '1 app';
   return '';
 };
 return f;
}
test('Windows 卸载写入中断后可继续恢复',t=>{
 const f=fixture(t);install(f.target,f.options);
 const original=fs.renameSync;let failed=false;
 fs.renameSync=(from,to)=>{if(!failed&&to===path.join(f.target.app,'product.json')){failed=true;throw Error('模拟卸载中断');}return original(from,to);};
 try{assert.throws(()=>uninstall(f.target,f.options),/模拟卸载中断/);}finally{fs.renameSync=original;}
 assert.equal(JSON.parse(fs.readFileSync(statePaths(f.target,f.options.stateDir).record)).phase,'restoring');
 uninstall(f.target,f.options);assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.file)),f.source);
});
test('macOS 完整备份恢复、未知文件拒绝和备份完整性检查',t=>{
 const f=macFixture(t);const before=treeDigest(f.target.root);install(f.target,f.options);
 fs.writeFileSync(path.join(f.target.root,'third-party'),'unknown');assert.throws(()=>uninstall(f.target,f.options),/补丁之外/);fs.unlinkSync(path.join(f.target.root,'third-party'));
 uninstall(f.target,f.options);assert.equal(treeDigest(f.target.root),before);
 const record=JSON.parse(fs.readFileSync(statePaths(f.target,f.options.stateDir).record));assert.ok(fs.existsSync(record.restore.displaced));
});
test('macOS 目录交换中断导致原路径缺失时，可从持久化日志恢复',t=>{
 const f=macFixture(t);install(f.target,f.options);
 const original=fs.renameSync;let failed=false;
 fs.renameSync=(from,to)=>{const result=original(from,to);if(!failed&&from===f.target.root){failed=true;throw Error('模拟目录交换中断');}return result;};
 try{assert.throws(()=>uninstall(f.target,f.options),/模拟目录交换中断/);}finally{fs.renameSync=original;}
 assert.equal(fs.existsSync(f.target.root),false);
 const recovered=resolveApp(f.target.root,'darwin',f.options.stateDir);assert.equal(recovered.root,f.target.root);
 uninstall(recovered,f.options);assert.deepEqual(fs.readFileSync(path.join(recovered.app,f.file)),f.source);
});
test('macOS 中断状态含未知应用内容时拒绝自动覆盖',t=>{
 const f=macFixture(t);install(f.target,f.options);
 const state=statePaths(f.target,f.options.stateDir),record=JSON.parse(fs.readFileSync(state.record));record.phase='signing';fs.writeFileSync(state.record,JSON.stringify(record));fs.writeFileSync(path.join(f.target.root,'unknown'),'keep');
 assert.throws(()=>uninstall(f.target,f.options),/未知变化/);assert.equal(fs.readFileSync(path.join(f.target.root,'unknown'),'utf8'),'keep');
});
test('多资源补丁预检全部通过后才写入，卸载恢复未列入校验表的资源',t=>{
 const f=fixture(t),other=Buffer.from('const voice="Voice";'),start=other.toString().indexOf('"Voice"');
 const resource={version:'3.27.14',commit:'test',file:'out/glass.js',sha256:sha256(other),edits:[{start,end:start+7,original:'"Voice"',replacement:'"语音"',kind:'literal',expected:1,context:'glass/label'}]};
 f.options.adapter.additionalTargets=[resource];fs.writeFileSync(path.join(f.target.app,resource.file),'unknown');
 assert.throws(()=>install(f.target,f.options),/指纹/);assert.deepEqual(fs.readFileSync(path.join(f.target.app,f.file)),f.source);
 fs.writeFileSync(path.join(f.target.app,resource.file),other);install(f.target,f.options);
 assert.match(fs.readFileSync(path.join(f.target.app,resource.file),'utf8'),/语音/);
 uninstall(f.target,f.options);assert.deepEqual(fs.readFileSync(path.join(f.target.app,resource.file)),other);assert.deepEqual(fs.readFileSync(path.join(f.target.app,'product.json')),f.product);
});
