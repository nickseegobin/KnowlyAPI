const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
let calls=[],records=[];
function mock(file,exports){const id=require.resolve(file);require.cache[id]={id,filename:id,loaded:true,exports};}
mock('../src/services/embeddings',{getEmbeddings:async texts=>{calls.push(texts);return texts.map((_,i)=>[i]);}});
mock('../src/services/pinecone',{getIndex:()=>({upsert:async batch=>records.push(...batch.records)})});
process.env.AEP_SERVER_KEY='training-import-test-key';
const app=express();app.use(express.json());app.use('/training',require('../src/routes/training'));
test('training import batches embeddings and preserves matching metadata',async()=>{
 const server=app.listen(0);try{
  const rows=Array.from({length:12},(_,i)=>({curriculum:'tt_primary',level:'std_4',period:'term_1',subject:'math',module_title:'Number Patterns',topic:'Topic '+i,content:'Source '+i}));
  const r=await fetch(`http://localhost:${server.address().port}/training/import`,{method:'POST',headers:{'Content-Type':'application/json','X-AEP-Server-Key':process.env.AEP_SERVER_KEY},body:JSON.stringify({rows})});
  assert.equal(r.status,200);assert.deepEqual(await r.json(),{synced:12,failed:0,total:12,errors:[]});
  assert.deepEqual(calls.map(x=>x.length),[10,2]);assert.equal(records.length,12);assert.equal(records[11].metadata.text,'Source 11');assert.equal(records[11].metadata.module_title,'Number Patterns');assert.deepEqual(records[11].values,[1]);
 }finally{server.close();}
});
