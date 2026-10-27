#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolveApp } from './platform.js';
import { install, uninstall, status } from './installer.js';
try {
  const {values,positionals}=parseArgs({allowPositionals:true,options:{'app-path':{type:'string'},'state-dir':{type:'string'},json:{type:'boolean'},help:{type:'boolean',short:'h'}}});
  if(values.help){console.log('用法：node src/cli.js <status|install|uninstall> [--app-path 应用路径] [--state-dir 备份目录] [--json]\n安装和卸载前请完全退出 Cursor。已验证 3.27.22 和 3.27.14；其他版本自动尝试结构适配。');}
  else {
    const command=positionals[0]??'status';
    if(positionals.length>1||!['status','install','uninstall'].includes(command))throw Error('命令无效，请使用 status、install 或 uninstall');
    const target=resolveApp(values['app-path'],process.platform,values['state-dir']),options={stateDir:values['state-dir'],onProgress:values.json?undefined:message=>console.error(message)};
    const result={status,install,uninstall}[command](target,options);
    if(values.json)console.log(JSON.stringify(result,null,2));
    else if(command==='status')console.log(`Cursor ${result.version}\n位置：${result.path}\n状态：${result.state}\n适配方式：${result.adaptation?.mode==='automatic'?'自动结构适配':result.adaptation?.mode==='verified'?'已验证版本':'未确认'}\n平台验收：${result.platformValidation}${result.detail?'\n说明：'+result.detail:''}${result.record?'\n操作记录：'+result.record:''}`);
    else console.log(`${result.message}${result.record?'\n操作记录：'+result.record:''}`);
    if(command==='status'&&!result.supported)process.exitCode=1;
  }
}catch(error){console.error(`操作失败：${error.message}`);process.exitCode=1;}
