import test from 'node:test';
import assert from 'node:assert/strict';
const subject=await import('../src/runtime.js').catch(()=>({}));
test('dependency loop recovers transient failure with capped backoff',async()=>{
 assert.equal(typeof subject.retryUntilReady,'function'); let attempts=0; const delays=[];
 const result=await subject.retryUntilReady(async()=>{if(++attempts<4)throw new Error('secret');return true;},{baseMs:10,maxMs:25,sleep:async ms=>delays.push(ms),log:()=>{}});
 assert.equal(result,true);assert.deepEqual(delays,[10,20,25]);
});
test('dependency loop stops cleanly when shutdown requested',async()=>{assert.equal(typeof subject.retryUntilReady,'function');const controller=new AbortController(); let attempts=0;await subject.retryUntilReady(async()=>{attempts++;controller.abort();throw new Error('fail');},{signal:controller.signal,log:()=>{}});assert.equal(attempts,1);});
test('job runner isolates failures and prevents overlapping runs',async()=>{assert.equal(typeof subject.createJob,'function');let release;let calls=0;const logs=[];const job=subject.createJob('sync',()=>{calls++;return new Promise(r=>release=r)},{log:x=>logs.push(x)});const pending=job();assert.equal(await job(),false);release();await pending;assert.equal(calls,1);const failing=subject.createJob('bad',async()=>{throw new Error('sensitive-url');},{log:x=>logs.push(x)});assert.equal(await failing(),false);assert(!JSON.stringify(logs).includes('sensitive-url'));});
test('safe error description excludes arbitrary messages',()=>{assert.equal(typeof subject.safeError,'function');assert.equal(subject.safeError(Object.assign(new Error('token'),{code:'ECONNRESET'})),'ECONNRESET');assert.equal(subject.safeError(new Error('token')),'Error');});
test('invalid retry delay cannot create a tight failure loop',async()=>{const delays=[];let n=0;await subject.retryUntilReady(async()=>{if(n++===0)throw Error('fail');return true;},{baseMs:NaN,maxMs:NaN,sleep:async ms=>delays.push(ms),log:()=>{}});assert.deepEqual(delays,[5000]);});
test('rapid sync recovery retries transient outages but not rejected credentials',()=>{
 for(const status of [400,401,402,403,404,422]) assert.equal(subject.shouldRetryInitialSync({code:`VIRAL_HTTP_${status}`}),false);
 for(const status of [408,425,429,500,502,503]) assert.equal(subject.shouldRetryInitialSync({code:`VIRAL_HTTP_${status}`}),true);
 assert.equal(subject.shouldRetryInitialSync({code:'VIRAL_SYNC_FAILED'}),true);
});
