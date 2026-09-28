/** Restore historical inputs from the compressed replay archive, without overwriting local work. */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
const input=JSON.parse(gunzipSync(readFileSync('scripts/data/gov-round2-input.json.gz')).toString());
mkdirSync('analysis',{recursive:true});
for(const [name,value] of Object.entries(input)){
 if(name==='baseline')continue;
 const path=`analysis/${name}.json`;
 if(!existsSync(path))writeFileSync(path,JSON.stringify(value,null,2)+'\n');
}
for(const name of ['gov-round2-browser','gov-round2-replacements']){
 const path=`analysis/${name}.json`;const archive=`scripts/data/${name}.json.gz`;
 if(!existsSync(path)&&existsSync(archive))writeFileSync(path,gunzipSync(readFileSync(archive)));
}
console.log('Missing local evidence restored; existing files left intact.');
