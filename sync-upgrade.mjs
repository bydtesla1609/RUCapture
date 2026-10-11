import {mkdir,writeFile} from "node:fs/promises";
import {syncSchema} from "./sync.mjs";
await mkdir("dist",{recursive:true});
for(const [name,start,end] of [["trial",1,30],["store-a",31,120],["store-b",121,210],["store-c",211,300]])
  await writeFile(`dist/sync-upgrade-${name}.sql`,Array.from({length:end-start+1},(_,i)=>syncSchema(`u${start+i}_`)).join("\n"));
await writeFile("dist/sync-upgrade-personal.sql",syncSchema());
console.log("Prepared atomic sync markers; no remote data or services changed.");
