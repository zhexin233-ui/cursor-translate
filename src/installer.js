import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadAdapter, applyPatch, sha256, checksum } from './patch.js';
import { assertClosed, copyMac, signMac, verifySignature, run } from './platform.js';
import {resolveAdapter} from './adaptive.js';
import { treeDigest } from './tree.js';
const PRODUCT='product.json';
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function atomic(file,bytes){
  const temporary=`${file}.cursor-zh-${randomUUID()}.tmp`;
  try{fs.writeFileSync(temporary,bytes,{mode:fs.existsSync(file)?fs.statSync(file).mode:0o600,flag:'wx'});fs.renameSync(temporary,file);}
  finally{fs.rmSync(temporary,{force:true});}
}
export function statePaths(target,stateDir=path.join(os.homedir(),'.cursor-settings-zh')) {
  const directory=path.join(path.resolve(stateDir),sha256(target.root).slice(0,24));
  if(directory===target.root||directory.startsWith(target.root+path.sep))throw Error('备份目录不能位于 Cursor 应用内部');
  return {directory,record:path.join(directory,'state.json'),lock:path.join(directory,'lock')};
}
function withLock(paths,callback){
  fs.mkdirSync(paths.directory,{recursive:true,mode:0o700});
  try{fs.mkdirSync(paths.lock);}catch{throw Error(`已有操作或上次操作中断。请检查 ${paths.record}；确认无进程后移除 ${paths.lock} 再重试`);}
  try{return callback();}finally{fs.rmdirSync(paths.lock);}
}
function verifyChecksums(app,product){
  if(!product.checksums || !Object.keys(product.checksums).length)throw Error('完整性校验配置缺失');
  for(const [relative,expected] of Object.entries(product.checksums)){
    const file=path.resolve(app,'out',relative);
    if(!file.startsWith(path.join(app,'out')+path.sep))throw Error('完整性校验路径无效');
    if(checksum(fs.readFileSync(file))!==expected)throw Error(`完整性校验失败：${relative}`);
  }
}
function versionMatches(target,adapter){
  const product=json(path.join(target.app,PRODUCT)),pkg=json(path.join(target.app,'package.json'));
  if(pkg.version!==adapter.version||product.version!==adapter.version||product.commit!==adapter.commit)throw Error(`不支持的 Cursor 版本：${pkg.version} / ${product.commit}，仅适配 ${adapter.version} / ${adapter.commit}`);
  return product;
}
function checkFiles(target,record,which){
  for(const file of record.files)if(sha256(fs.readFileSync(path.join(target.app,file.path)))!==file[which])throw Error(`文件已变化，拒绝覆盖：${file.path}。可能发生更新或第三方修改；请使用原版安装包恢复应用`);
}
function checkBackup(record){
  for(const file of record.files)if(sha256(fs.readFileSync(path.join(record.backup,'files',file.path)))!==file.before)throw Error(`备份文件已损坏：${file.path}`);
}
function writeState(paths,record){atomic(paths.record,JSON.stringify(record,null,2)+'\n');}
function preflightWritable(target,files){
  for(const file of files){fs.accessSync(path.dirname(path.join(target.app,file)),fs.constants.W_OK);fs.accessSync(path.join(target.app,file),fs.constants.W_OK);}
  if(target.platform==='darwin')fs.accessSync(path.dirname(target.root),fs.constants.W_OK);
}
function restoreMac(target,record,paths,execute){
  const backup=path.join(record.backup,'Cursor.app');
  verifySignature(backup,execute);
  if(record.beforeTree && treeDigest(backup)!==record.beforeTree)throw Error('完整应用备份指纹不匹配');
  // 交换路径先写入日志；即使在两次 rename 之间退出，也可以定位并继续。
  record.restore??={staged:`${target.root}.cursor-zh-restore-${randomUUID()}`,displaced:`${target.root}.cursor-zh-displaced-${randomUUID()}`};
  record.phase='restoring';writeState(paths,record);
  const {staged,displaced}=record.restore;
  if(fs.existsSync(target.root)&&treeDigest(target.root)===record.beforeTree){verifySignature(target.root,execute);return;}
  if(!fs.existsSync(staged)||treeDigest(staged)!==record.beforeTree){
    fs.rmSync(staged,{recursive:true,force:true});
    copyMac(backup,staged,execute);
  }
  verifySignature(staged,execute);
  if(treeDigest(staged)!==record.beforeTree)throw Error('恢复副本指纹不匹配');
  if(fs.existsSync(target.root)){
    if(fs.existsSync(displaced))throw Error(`存在上次交换的应用，拒绝覆盖：${displaced}`);
    fs.renameSync(target.root,displaced);
  }
  fs.renameSync(staged,target.root);
  verifySignature(target.root,execute);
  // 保留交换前的完整应用，避免中断恢复时丢失任何未知文件。
}
function restoreFiles(target,record){
  for(const file of record.files)atomic(path.join(target.app,file.path),fs.readFileSync(path.join(record.backup,'files',file.path)));
}
export function status(target,options={}) {
  const paths=statePaths(target,options.stateDir),pkg=json(path.join(target.app,'package.json')),product=json(path.join(target.app,PRODUCT));
  let state='未安装',supported=false,detail,adaptation,platformValidation='未验收';
  try{
    const record=fs.existsSync(paths.record)?json(paths.record):undefined;
    if(record&&record.root!==target.root)throw Error('安装记录与目标不匹配');
    const same=record&&record.version===pkg.version&&record.commit===product.commit;
    if(same){
      versionMatches(target,options.adapter??record);adaptation=record.adaptation??{mode:'verified'};
      let verified;try{verified=loadAdapter(pkg.version);}catch{}
      platformValidation=record.platforms?.[target.platform]??verified?.platforms?.[target.platform]??platformValidation;
      if(record.phase==='installed'){
        checkFiles(target,record,'after');if(record.afterTree&&treeDigest(target.root)!==record.afterTree)throw Error('应用中存在补丁之外的修改，拒绝覆盖');
        state='已安装';supported=true;
      }else if(record.phase==='restored'){checkFiles(target,record,'before');state='已卸载';supported=true;}
      else{state='操作中断，需要恢复';detail=`备份与操作记录：${paths.record}`;}
    }else{
      if(record&&!['installed','restored'].includes(record.phase))throw Error('旧版本存在未完成操作，请先处理原操作记录');
      verifyChecksums(target.app,product);
      const adapter=options.adapter??resolveAdapter(target,options);versionMatches(target,adapter);
      if(!Object.hasOwn(product.checksums,adapter.file.replace(/^out\//,'')))throw Error('主目标文件不在完整性清单中');
      for(const resource of [adapter,...adapter.additionalTargets??[]])applyPatch(fs.readFileSync(path.join(target.app,resource.file)),resource);
      adaptation=adapter.adaptation??{mode:'verified'};platformValidation=adapter.platforms?.[target.platform]??platformValidation;
      state=record?'应用已更新，待重新安装':'未安装';supported=true;
    }
    if(adaptation?.mode==='automatic')platformValidation='自动适配：结构与语法检查通过，当前构建尚未实机验收';
    if(!detail&&adaptation?.resources)detail=adaptation.resources.map(r=>`${r.file}：确认 ${r.translated} 处文案，跳过 ${r.skipped} 个未匹配结构和 ${r.ambiguous} 个歧义结构`).join('；');
  }catch(error){state='不兼容或文件已变化';detail=error.message;}
  return {path:target.root,version:pkg.version,commit:product.commit,state,supported,adaptation,platformValidation,detail,record:fs.existsSync(paths.record)?paths.record:undefined};
}
export function install(target,options={}) {
  const execute=options.run??run,paths=statePaths(target,options.stateDir);
  return withLock(paths,()=>{
    assertClosed(target,execute);
    const identity=json(path.join(target.app,PRODUCT));versionMatches(target,options.adapter??identity);
    const previous=fs.existsSync(paths.record)?json(paths.record):undefined;
    if(previous){
      if(previous.root!==target.root)throw Error('安装记录与目标不匹配');
      const same=previous.version===identity.version&&previous.commit===identity.commit;
      if(same&&previous.phase==='installed'){
        let expected=options.adapter;try{expected??=loadAdapter(identity.version);}catch{}
        if(expected&&[expected,...expected.additionalTargets??[]].some(item=>!previous.files.some(file=>file.path===item.file)))throw Error('已安装旧版补丁，请先运行 uninstall 再安装以补全资源');
        checkFiles(target,previous,'after');if(previous.afterTree&&treeDigest(target.root)!==previous.afterTree)throw Error('应用中存在补丁之外的修改');
        return {message:'已安装相同版本的中文补丁，无需重复安装',record:paths.record,adaptation:previous.adaptation};
      }
      if(!['installed','restored'].includes(previous.phase))throw Error('存在未完成操作，请先运行 uninstall 恢复');
      if(same)checkFiles(target,previous,'before');
    }
    // 更新后的应用先按当前原版校验，再生成新适配；旧版本备份不会参与覆盖。
    verifyChecksums(target.app,identity);
    const adapter=options.adapter??resolveAdapter(target,options),product=versionMatches(target,adapter);
    const resources=[adapter,...adapter.additionalTargets??[]];
    const entries=resources.map(resource=>{
      const original=fs.readFileSync(path.join(target.app,resource.file));
      return {path:resource.file,before:original,after:applyPatch(original,resource)};
    });
    const originalProduct=fs.readFileSync(path.join(target.app,PRODUCT));
    verifyChecksums(target.app,product);
    if(!Object.hasOwn(product.checksums,adapter.file.replace(/^out\//,'')))throw Error('主目标文件不在完整性清单中');
    for(const entry of entries){const key=entry.path.replace(/^out\//,'');if(Object.hasOwn(product.checksums,key))product.checksums[key]=checksum(entry.after);}
    entries.push({path:PRODUCT,before:originalProduct,after:Buffer.from(JSON.stringify(product,null,'\t')+'\n')});
    preflightWritable(target,entries.map(x=>x.path));
    if(target.platform==='darwin')verifySignature(target.root,execute);
    const beforeTree=target.platform==='darwin'?treeDigest(target.root):undefined;
    const backup=path.join(paths.directory,`backup-${Date.now()}-${randomUUID()}`);
    const record={schema:2,platforms:adapter.platforms,adaptation:adapter.adaptation??{mode:'verified'},adapterPath:path.join(backup,'adapter.json'),beforeTree,phase:'backing-up',root:target.root,version:adapter.version,commit:adapter.commit,backup,files:entries.map(e=>({path:e.path,before:sha256(e.before),after:sha256(e.after)}))};
    fs.mkdirSync(backup,{recursive:true,mode:0o700});
    for(const entry of entries){const dest=path.join(backup,'files',entry.path);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,entry.before,{mode:0o600});}
    // 完整备份及签名验证成功前不修改目标。失败时只遗留可检查的备份目录。
    if(target.platform==='darwin'){
      const sizeKB=Number(execute('/usr/bin/du',['-sk',target.root]).trim().split(/\s+/)[0]);
      const disk=fs.statfsSync(paths.directory);
      if(Number.isFinite(sizeKB)&&disk.bavail*disk.bsize<sizeKB*1024*1.15)throw Error('备份目录磁盘空间不足');
      copyMac(target.root,path.join(backup,'Cursor.app'),execute);
      verifySignature(path.join(backup,'Cursor.app'),execute);
      if(treeDigest(path.join(backup,'Cursor.app'))!==beforeTree)throw Error('完整应用备份与源应用不一致');
    }
    checkBackup(record);
    fs.writeFileSync(record.adapterPath,JSON.stringify(adapter),{mode:0o600,flag:'wx'});
    if(previous)atomic(path.join(previous.backup,'state.json'),JSON.stringify(previous,null,2)+'\n');
    record.phase='prepared';writeState(paths,record);
    try{
      assertClosed(target,execute);
      // 备份期间若有自动更新，拒绝将补丁写入新资源。
      versionMatches(target,adapter);checkFiles(target,record,'before');
      if(beforeTree && treeDigest(target.root)!==beforeTree)throw Error('备份期间应用发生变化');
      record.phase='applying';writeState(paths,record);
      for(const entry of entries)atomic(path.join(target.app,entry.path),entry.after);
      if(target.platform==='darwin'){record.unsignedTree=treeDigest(target.root);record.phase='signing';writeState(paths,record);signMac(target.root,execute);}
      checkFiles(target,record,'after');verifyChecksums(target.app,product);
      if(target.platform==='darwin')record.afterTree=treeDigest(target.root);
      record.phase='installed';writeState(paths,record);
    }catch(error){
      if(record.phase==='prepared')throw error;
      try{
        assertClosed(target,execute);versionMatches(target,adapter);
        if(target.platform==='darwin')restoreMac(target,record,paths,execute);else restoreFiles(target,record);
        checkFiles(target,record,'before');record.phase='restored';writeState(paths,record);
      }catch(rollbackError){record.phase='recovery-required';writeState(paths,record);throw Error(`${error.message}；自动回滚失败：${rollbackError.message}。备份：${backup}`);}
      throw Error(`${error.message}；已回滚到原版`);
    }
    return {message:`已安装 ${adapter.version} 中文补丁（${resources.reduce((count,item)=>count+item.edits.length,0)} 处修改）${adapter.adaptation?.mode==='automatic'?'；已自动适配，未确认的文案保留原文':''}`,record:paths.record,adaptation:record.adaptation};
  });
}
export function uninstall(target,options={}) {
  const paths=statePaths(target,options.stateDir),execute=options.run??run;
  return withLock(paths,()=>{
    assertClosed(target,execute);
    if(!fs.existsSync(paths.record))return {message:'没有安装记录，无需卸载'};
    const record=json(paths.record),adapter=options.adapter??{version:record.version,commit:record.commit};
    if(record.root!==target.root||record.version!==adapter.version||record.commit!==adapter.commit)throw Error('安装记录与目标不匹配');
    checkBackup(record);
    if(target.platform==='darwin'&&record.restore&&record.phase==='restoring'){
      assertClosed(target,execute);restoreMac(target,record,paths,execute);
      checkFiles(target,record,'before');record.phase='restored';writeState(paths,record);
      return {message:'已继续完成中断的应用恢复，交换前应用已保留',record:paths.record};
    }
    versionMatches(target,adapter);
    if(record.phase==='restored'){checkFiles(target,record,'before');return {message:'已恢复原版，无需重复卸载'};}
    if(record.phase==='installed'){checkFiles(target,record,'after');if(record.afterTree&&treeDigest(target.root)!==record.afterTree)throw Error('应用中存在补丁之外的修改，拒绝覆盖；请保留备份并使用原版安装包恢复');}
    else {
      // 支持进程中断后重试，只接受本次事务的原始或补丁内容。
      for(const file of record.files){const actual=sha256(fs.readFileSync(path.join(target.app,file.path)));if(actual!==file.before&&actual!==file.after)throw Error(`中断后的文件含未知修改，拒绝覆盖：${file.path}`);}
    }
    if(target.platform==='darwin'&&record.phase!=='installed'){
      const current=treeDigest(target.root);
      if(![record.beforeTree,record.afterTree,record.unsignedTree].includes(current))throw Error(`中断后的完整应用含未知变化，拒绝自动覆盖。原版备份：${path.join(record.backup,'Cursor.app')}`);
    }
    preflightWritable(target,record.files.map(x=>x.path));
    record.phase='restoring';writeState(paths,record);
    if(target.platform==='darwin')restoreMac(target,record,paths,execute);else restoreFiles(target,record);
    checkFiles(target,record,'before');verifyChecksums(target.app,json(path.join(target.app,PRODUCT)));
    record.phase='restored';writeState(paths,record);
    return {message:'已恢复对应版本的原始应用，备份已保留',record:paths.record};
  });
}
