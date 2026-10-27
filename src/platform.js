import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sha256 } from './patch.js';
import { execFileSync } from 'node:child_process';
export function run(command, args) {
  try { return execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}); }
  catch(error){throw Error(`执行 ${command} 失败：${error.stderr?.toString().trim() || error.message}`);}
}
export function candidates(platform=process.platform,env=process.env,home=os.homedir()) {
  if(platform==='darwin')return ['/Applications/Cursor.app',path.join(home,'Applications/Cursor.app')];
  if(platform==='win32')return [env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Programs','cursor'),env.ProgramFiles&&path.join(env.ProgramFiles,'Cursor'),env['ProgramFiles(x86)']&&path.join(env['ProgramFiles(x86)'],'Cursor')].filter(Boolean);
  throw Error('仅支持 macOS 和 Windows');
}
export function resolveApp(given,platform=process.platform,recoveryStateDir) {
  for(const candidate of given?[given]:candidates(platform)) {
    const root=path.resolve(candidate);
    const app=platform==='darwin'?path.join(root,'Contents/Resources/app'):path.join(root,'resources/app');
    const exe=platform==='darwin'?path.join(root,'Contents/MacOS/Cursor'):path.join(root,'Cursor.exe');
    if(fs.existsSync(path.join(app,'product.json'))&&fs.existsSync(path.join(app,'package.json'))&&fs.existsSync(exe))return {root:fs.realpathSync(root),app:fs.realpathSync(app),exe,platform};
  }
  if(given&&platform==='darwin'){
    const absolute=path.resolve(given),root=path.join(fs.realpathSync(path.dirname(absolute)),path.basename(absolute)),stateDir=recoveryStateDir??path.join(os.homedir(),'.cursor-settings-zh');
    const recordPath=path.join(stateDir,sha256(root).slice(0,24),'state.json');
    if(fs.existsSync(recordPath)){
      const record=JSON.parse(fs.readFileSync(recordPath,'utf8'));
      if(record.root===root&&record.phase==='restoring'&&record.restore&&fs.existsSync(record.backup))return {root,app:path.join(root,'Contents/Resources/app'),exe:path.join(root,'Contents/MacOS/Cursor'),platform};
    }
  }
  throw Error('未找到 Cursor 安装目录。请用 --app-path 指定 Cursor.app 或包含 Cursor.exe 的目录');
}
export function assertClosed(target,execute=run) {
  if(target.platform==='darwin') {
    const output=execute('/bin/ps',['-axo','command=']);
    // 同时覆盖主进程和仍未退出的 Helper，只匹配此应用的绝对路径。
    if(output.split('\n').some(line=>line.trimStart().startsWith(`${target.root}/Contents/`)))throw Error('Cursor 仍在运行。请完全退出目标 Cursor 后重试');
  } else {
    const output=execute('tasklist',['/FO','CSV','/NH']);
    // tasklist 的首列为加引号的映像名，不依赖本地化表头。
    if(output.split(/\r?\n/).some(line=>/^"Cursor\.exe",/i.test(line.trim())))throw Error('Cursor 仍在运行。请完全退出所有 Cursor 窗口后重试');
  }
}
export function verifySignature(root,execute=run){execute('/usr/bin/codesign',['--verify','--deep','--strict',root]);}
export function copyMac(source,destination,execute=run){execute('/usr/bin/ditto',['--rsrc','--extattr','--acl',source,destination]);}
export function signMac(root,execute=run){
  const bundles=[root];
  function visit(directory){
    if(!fs.existsSync(directory))return;
    for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
      if(!entry.isDirectory())continue;
      const file=path.join(directory,entry.name);
      if(entry.name.endsWith('.app'))bundles.push(file);
      visit(file);
    }
  }
  visit(path.join(root,'Contents/Frameworks'));
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'cursor-zh-entitlements-'));
  try{
    // 先读取每个原始进程的权限，避免 --deep 统一覆盖 Helper 的专有权限。
    const entitlementFiles=new Map();
    for(const [index,bundle] of bundles.entries()){
      const original=execute('/usr/bin/codesign',['--display','--entitlements','-','--xml',bundle]);
      const file=path.join(temporary,`${index}.plist`);
      fs.writeFileSync(file,original.trim()||'<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
      // 临时签名没有 Team ID；保持 hardened runtime，同时允许加载已临时签名的 Electron 库。
      const exists=original.includes('<key>com.apple.security.cs.disable-library-validation</key>');
      execute('/usr/libexec/PlistBuddy',['-c',`${exists?'Set':'Add'} :com.apple.security.cs.disable-library-validation ${exists?'true':'bool true'}`,file]);
      entitlementFiles.set(bundle,file);
    }
    execute('/usr/bin/codesign',['--force','--deep','--sign','-','--preserve-metadata=entitlements,flags,runtime',root]);
    for(const bundle of [...bundles].sort((a,b)=>b.length-a.length)){
      execute('/usr/bin/codesign',['--force','--sign','-','--preserve-metadata=flags,runtime','--entitlements',entitlementFiles.get(bundle),bundle]);
    }
    verifySignature(root,execute);
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
}
