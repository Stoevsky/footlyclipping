import { setTimeout as delay } from 'node:timers/promises';

// Never include arbitrary upstream messages, URLs, request headers or response bodies.
export function safeError(error) {
  const code = String(error?.code || '');
  return /^[A-Z_0-9]{2,40}$/.test(code) ? code : ['TypeError','RangeError','AbortError','TimeoutError'].includes(error?.name) ? error.name : 'Error';
}
export function shouldRetryInitialSync(error) {
  const status=Number(/^VIRAL_HTTP_(\d{3})$/.exec(error?.code || '')?.[1]);
  return !status || status===408 || status===425 || status===429 || status>=500;
}
export async function retryUntilReady(task, {signal,baseMs=5000,maxMs=60000,sleep=ms=>delay(ms,undefined,{signal}),log=console.error}={}) {
  if(!Number.isFinite(baseMs) || baseMs <= 0) baseMs=5000;
  if(!Number.isFinite(maxMs) || maxMs < baseMs) maxMs=Math.max(baseMs,60000);
  let attempt=0;
  while(!signal?.aborted) {
    try { return await task(); }
    catch(error) {
      if(signal?.aborted) return false;
      const wait=Math.min(maxMs,baseMs*2**Math.min(attempt++,16));
      log(`[startup] Dependency unavailable (${safeError(error)}); retry in ${wait}ms`);
      try { await sleep(wait); } catch(error) { if(signal?.aborted) return false; throw error; }
    }
  }
  return false;
}
export function createJob(name,task,{log=console.error}={}) {
  let running=false;
  return async()=>{
    if(running) return false;
    running=true;
    try { await task(); return true; }
    catch(error) { log(`[${name}] Operation failed (${safeError(error)}); retry on next run`); return false; }
    finally { running=false; }
  };
}
