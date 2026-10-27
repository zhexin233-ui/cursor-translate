import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'acorn';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const checksum = value => createHash('sha256').update(value).digest('base64').replace(/=+$/, '');
export function loadAdapter(version='3.27.22') {
  if(!['3.27.14','3.27.22'].includes(version))throw Error(`不支持的 Cursor 版本：${version}，需要重新适配`);
  const primary=JSON.parse(fs.readFileSync(new URL(`../adapters/${version}.json`, import.meta.url), 'utf8'));
  const glass=JSON.parse(fs.readFileSync(new URL(`../adapters/${version}-glass.json`, import.meta.url), 'utf8'));
  return {...primary,additionalTargets:[glass]};
}
export function applyPatch(bytes, adapter) {
  if (sha256(bytes) !== adapter.sha256) throw Error('资源指纹不匹配，拒绝应用补丁');
  const source = bytes.toString('utf8');
  let end = 0;
  for (const edit of adapter.edits) {
    if (edit.expected !== 1 || edit.start < end || edit.end < edit.start || edit.end > source.length) throw Error('补丁位置重叠或无效');
    if (source.slice(edit.start, edit.end) !== edit.original) throw Error(`原文不匹配：${edit.context}`);
    if (edit.kind === 'literal') {
      const before = parse(`(${edit.original})`, { ecmaVersion: 'latest' }).body[0].expression;
      const after = parse(`(${edit.replacement})`, { ecmaVersion: 'latest' }).body[0].expression;
      if (before.type !== 'Literal' || after.type !== 'Literal' || typeof before.value !== 'string' || typeof after.value !== 'string') throw Error('文案补丁必须是字符串 AST 节点');
    }
    if(['search-normalizer','search-matcher','search-jump','search-aliases','search-keywords'].includes(edit.kind))parse(edit.replacement,{ecmaVersion:'latest'});
    end = edit.end;
  }
  let result = source;
  for (const edit of [...adapter.edits].reverse()) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  if (adapter.region) {
    const delta = adapter.edits.filter(e => e.start >= adapter.region.start && e.end <= adapter.region.end).reduce((n,e) => n+e.replacement.length-e.original.length,0);
    const prefixDelta=adapter.edits.filter(e=>e.end<=adapter.region.start).reduce((n,e)=>n+e.replacement.length-e.original.length,0);
    parse(result.slice(adapter.region.start+prefixDelta,adapter.region.end+prefixDelta+delta),{ecmaVersion:'latest',sourceType:'module'});
  }
  return Buffer.from(result);
}
