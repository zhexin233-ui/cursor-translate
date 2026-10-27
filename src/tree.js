import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
// 完整应用指纹包含新增/删除文件、符号链接、权限和内容，路径按相对位置记录。
export function treeDigest(root){
  const hash=createHash('sha256');
  const visit=(directory,relative='')=>{
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=path.join(directory,entry.name),name=path.posix.join(relative,entry.name),stat=fs.lstatSync(file);
      hash.update(JSON.stringify([name,stat.mode]));
      if(entry.isSymbolicLink())hash.update(fs.readlinkSync(file));
      else if(entry.isDirectory())visit(file,name);
      else if(entry.isFile()){
        const content=createHash('sha256');const fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);
        try{let length;while((length=fs.readSync(fd,buffer,0,buffer.length,null))>0)content.update(buffer.subarray(0,length));}finally{fs.closeSync(fd);}
        hash.update(content.digest());
      }else throw Error(`应用中包含不支持的文件类型：${name}`);
    }
  };
  visit(root);return hash.digest('hex');
}
