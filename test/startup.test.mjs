import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function launch(databaseUrl){
 const port=await freePort(); const env={...process.env,PORT:String(port)};
 for(const key of Object.keys(env)) if(/^(DISCORD_|VIRAL_|CHANNEL_|OPENAI_|DATABASE_URL|DAILY_REPORT_CRON|WEEKLY_REPORT_CRON|REPORT_TIMEZONE|SYNC_INTERVAL|STARTUP_RETRY)/.test(key))delete env[key];
 if(databaseUrl)env.DATABASE_URL=databaseUrl;
 const child=spawn(process.execPath,['src/index.js'],{env,cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
 const exit=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
 const request=path=>fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(1000)});
 return {child,exit,request,get output(){return output;}};
}
async function until(fn, runtime){for(let i=0;i<100;i++){if(runtime.child.exitCode!==null)throw new Error(`Application exited during startup: ${runtime.output}`);try{if(await fn())return;}catch{}await delay(50);}throw new Error('Startup condition timed out');}
test('missing configuration leaves HTTP alive, safely unready, and shuts down cleanly',async()=>{
 const runtime=await launch();try{
 await until(async()=> (await runtime.request('/health')).status===200,runtime);
 const res=await runtime.request('/ready');assert.equal(res.status,503);const json=await res.json();assert.equal(json.ready,false);assert.equal(json.configuration,false);assert(!runtime.output.includes('Unhandled'));
 }finally{runtime.child.kill('SIGTERM');assert.equal((await runtime.exit).code,0);}
});
test('database migrates even while external credentials are pending', {skip:!process.env.TEST_DATABASE_URL},async()=>{
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});const schema=`runtime_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);const runtime=await launch(url.toString());
 try{await until(async()=>{const r=await runtime.request('/ready');return (await r.json()).database===true;},runtime);const status=await (await runtime.request('/ready')).json();assert.equal(status.ready,false);assert.equal(status.discord,false);assert.equal((await admin.query(`SELECT count(*) AS n FROM ${schema}.schema_migrations`)).rows[0].n,'2');}
 finally{runtime.child.kill('SIGTERM');await runtime.exit;await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
