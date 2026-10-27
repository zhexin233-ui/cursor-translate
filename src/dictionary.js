import fs from 'node:fs';
export function readDictionary() {
  const lines = fs.readFileSync(new URL('../dictionaries/zh-CN.tsv', import.meta.url), 'utf8').split('\n');
  const map = new Map();
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw Error(`词典第 ${index + 1} 行无效`);
    if (map.has(parts[0])) throw Error(`词典原文重复：${parts[0]}`);
    map.set(...parts);
  }
  return map;
}
