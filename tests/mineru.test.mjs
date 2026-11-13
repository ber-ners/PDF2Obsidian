import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchMineru } from '../packages/core/dist/storage/mineru-http.js';
import { runMineru } from '../packages/core/dist/storage/mineru-runner.js';
import { zipSync, strToU8 } from '../packages/core/node_modules/fflate/esm/index.mjs';

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('GET retries transient HTTP errors and honors retry limit', async t => {
  let calls = 0;
  const url = await serverFor(t, (req, res) => { calls++; res.writeHead(503); res.end('unavailable'); });
  const response = await fetchMineru(url, {}, { maxRetries: 2, retryDelayMs: 1 });
  assert.equal(response.status, 503);
  assert.equal(calls, 3);
});

test('POST submission is not replayed; auth failures are not retried', async t => {
  let calls = 0;
  const url = await serverFor(t, (req, res) => { calls++; res.writeHead(req.method === 'POST' ? 503 : 401); res.end(); });
  assert.equal((await fetchMineru(url, {method:'POST'})).status, 503);
  assert.equal((await fetchMineru(url)).status, 401);
  assert.equal(calls, 2);
});

test('PUT retries the same upload after connection reset', async t => {
  const bodies = [];
  const url = await serverFor(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    bodies.push(Buffer.concat(chunks).toString());
    if (bodies.length === 1) { req.socket.destroy(); return; }
    res.end('ok');
  });
  assert.equal(await (await fetchMineru(url, {method:'PUT', body:'PDF bytes'}, {retryDelayMs:1})).text(), 'ok');
  assert.deepEqual(bodies, ['PDF bytes', 'PDF bytes']);
});

test('timeout bounds a stalled response body and hides signed URL secrets', async t => {
  const url = await serverFor(t, (req, res) => { res.writeHead(200); res.write('partial'); });
  const start = Date.now();
  await assert.rejects(fetchMineru(`${url}/signed?secret=private-token`, {}, {requestTimeoutMs:40,maxRetries:0}), error => {
    assert.match(error.message, /请求超时/); assert.doesNotMatch(error.message, /private-token/); return true;
  });
  assert.ok(Date.now() - start < 2000);
});

test('overall deadline cancels retry backoff', async t => {
  const url = await serverFor(t, (req, res) => { res.writeHead(429, {'retry-after':'60'}); res.end(); });
  const start = Date.now();
  await assert.rejects(fetchMineru(url, {}, {signal:AbortSignal.timeout(50)}), /超时或已取消/);
  assert.ok(Date.now() - start < 2000);
});

test('official pipeline: transient polling error resumes same batch, extracts markdown and images', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const root = await mkdtemp(join(tmpdir(), 'mineru-test-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const pdfPath = join(root, 'document.pdf'); await writeFile(pdfPath, '%PDF-test');
  const calls = {apply:0,upload:0,poll:0,download:0,fallback:0};
  const zip = zipSync({'full.md':strToU8('# Parsed paper'), 'images/fig.png':new Uint8Array([1,2,3])});
  globalThis.fetch = async (url, options) => {
    const u = new URL(url);
    if (u.pathname === '/api/v4/file-urls/batch') {
      calls.apply++; assert.equal(options.method,'POST');
      return Response.json({code:0,data:{batch_id:'same-batch',file_urls:['https://storage.test/upload']}});
    }
    if (u.pathname === '/upload') { calls.upload++; return new Response(null,{status:200}); }
    if (u.pathname.endsWith('/same-batch')) {
      calls.poll++;
      if(calls.poll===1) return new Response('temporary',{status:503});
      return Response.json({code:0,data:{extract_result:[{state:calls.poll===2?'pending':'done',full_zip_url:'https://cdn-mineru.openxlab.org.cn/pdf/result.zip'}]}});
    }
    if (u.hostname === 'cdn-mineru.openxlab.org.cn') { calls.download++; throw new TypeError('fetch failed'); }
    if (u.hostname === 'mineru.oss-cn-shanghai.aliyuncs.com') { calls.fallback++; assert.equal(u.pathname,'/pdf/result.zip'); return new Response(zip); }
    throw new Error('Unexpected request');
  };
  const progress=[];
  await runMineru({pdfPath,outputDir:join(root,'out'),command:'unused',mode:'official',backend:'pipeline',apiToken:'test',pollIntervalMs:1,onProgress:m=>{progress.push(m);}});
  assert.equal(await readFile(join(root,'out/document/full.md'),'utf8'), '# Parsed paper');
  assert.equal((await readFile(join(root,'out/document/images/fig.png'))).length,3);
  assert.deepEqual(calls,{apply:1,upload:1,poll:3,download:1,fallback:1});
  await runMineru({pdfPath,outputDir:join(root,'out'),command:'unused',mode:'official',backend:'pipeline',apiToken:'test',pollIntervalMs:1});
  assert.equal(calls.apply,1); assert.equal(calls.upload,1); assert.equal(calls.fallback,2);
  assert.ok(progress.some(m=>m.includes('pending')));
});

test('official semantic failure stops without creating another batch', async t => {
  const originalFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=originalFetch;});
  const root=await mkdtemp(join(tmpdir(),'mineru-auth-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const pdfPath=join(root,'document.pdf'); await writeFile(pdfPath,'%PDF-test');
  let calls=0;
  globalThis.fetch=async()=>{calls++; return Response.json({code:-1,msg:'Invalid token'});};
  await assert.rejects(runMineru({pdfPath,outputDir:join(root,'out'),command:'unused',mode:'official',backend:'pipeline',apiToken:'bad'}), /Invalid token/);
  assert.equal(calls,1);
});

test('local asynchronous API uploads once and preserves markdown and layout', async t => {
  const root=await mkdtemp(join(tmpdir(),'mineru-local-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const pdfPath=join(root,'document.pdf'); await writeFile(pdfPath,'%PDF-test');
  let posts=0;
  const url=await serverFor(t,(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.method==='POST'){posts++;res.writeHead(202);res.end(JSON.stringify({task_id:'task-1'}));}
    else if(req.url==='/tasks/task-1/result')res.end(JSON.stringify({markdown:'# Local paper', content_list: JSON.stringify([{page_idx:0,type:'text',text:'Local paper',bbox:[10,20,90,80]}])}));
    else res.end(JSON.stringify({status:'completed'}));
  });
  await runMineru({pdfPath,outputDir:join(root,'out'),command:'unused',mode:'local',apiUrl:url,backend:'pipeline'});
  assert.equal(posts,1);
  assert.equal(await readFile(join(root,'out/document/document.md'),'utf8'),'# Local paper');
  const blocks = JSON.parse(await readFile(join(root,'out/document/document_content_list.json'),'utf8'));
  assert.deepEqual(blocks[0].bbox,[10,20,90,80]);
});

test('failed signed result download resumes without reuploading and never rewrites the signed URL host', async t => {
  const originalFetch=globalThis.fetch; t.after(()=>{globalThis.fetch=originalFetch;});
  const root=await mkdtemp(join(tmpdir(),'mineru-resume-')); t.after(()=>rm(root,{recursive:true,force:true}));
  const pdfPath=join(root,'document.pdf'); await writeFile(pdfPath,'%PDF-test');
  const calls={apply:0,upload:0,download:0}; let available=false;
  const zip=zipSync({'full.md':strToU8('# Resumed')});
  globalThis.fetch=async(url)=>{
    const u=new URL(url);
    if(u.pathname==='/api/v4/file-urls/batch'){calls.apply++;return Response.json({code:0,data:{batch_id:'resume-batch',file_urls:['https://storage.test/upload']}});}
    if(u.pathname==='/upload'){calls.upload++;return new Response('');}
    if(u.pathname.endsWith('/resume-batch'))return Response.json({code:0,data:{extract_result:[{state:'done',full_zip_url:'https://cdn-mineru.openxlab.org.cn/pdf/private.zip?signature=secret'}]}});
    assert.equal(u.hostname,'cdn-mineru.openxlab.org.cn'); assert.equal(u.search,'?signature=secret');
    calls.download++;return available?new Response(zip):new Response('unavailable',{status:503});
  };
  const input={pdfPath,outputDir:join(root,'out'),command:'unused',mode:'official',backend:'pipeline',apiToken:'test',maxRetries:0};
  await assert.rejects(runMineru(input),/CDN.*503/);
  available=true;await runMineru(input);
  assert.deepEqual(calls,{apply:1,upload:1,download:2});
  assert.equal(await readFile(join(root,'out/document/full.md'),'utf8'),'# Resumed');
});
