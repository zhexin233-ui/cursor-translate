import fs from 'node:fs';
import { parse } from 'acorn';
import {versions} from './versions.js';
import { ancestor } from 'acorn-walk';
export const APP = '/Applications/Cursor.app/Contents/Resources/app';
export function settingsRegion(source) {
  const config=Object.values(versions).find(v=>source.includes(v.desktop.start))?.desktop;
  if(!config)throw Error('未找到已适配的设置模块');
  const start = source.indexOf(config.start);
  const end = source.indexOf(config.end, start);
  if (start < 0 || end < 0) throw Error('未找到 3.27.14 设置模块边界');
  return { start, end, text: source.slice(start, end) };
}
export function collect(source) {
  const region = settingsRegion(source);
  const ast = parse(region.text, { ecmaVersion: 'latest', sourceType: 'module' });
  const rows = [];
  ancestor(ast, { Literal(node, ancestors) {
    if (typeof node.value !== 'string' || !/[A-Za-z]{2}/.test(node.value)) return;
    const property = ancestors.slice(0, -1).reverse().find(n => n.type === 'Property');
    const key = property?.key.name ?? property?.key.value;
    if (!['children', 'label', 'description', 'title', 'placeholder', 'searchPlaceholder', 'tooltip', 'content', 'message', 'aria-label'].includes(key)) return;
    if (/^(?:[a-z0-9_.:/-]+|[A-Z][a-z]+[A-Z][a-zA-Z]*)$/.test(node.value)) return;
    rows.push({ source: node.value, start: region.start + node.start, end: region.start + node.end, key });
  }});
  return rows;
}
if (process.argv[1]?.endsWith('/inspect.js')) {
  const source = fs.readFileSync(`${process.argv[2] ?? APP}/out/vs/workbench/workbench.desktop.main.js`, 'utf8');
  console.log(JSON.stringify([...new Set(collect(source).map(x => x.source))], null, 2));
}
