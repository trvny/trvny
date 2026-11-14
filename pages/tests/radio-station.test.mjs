import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/radio-station.js';

const request = station => ({ request:new Request(`https://travny.pages.dev/api/radio-station?station=${station}`) });

test('BBC returns a verified current track and safe artwork', async t => {
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({data:[{
    titles:{primary:'Artist',secondary:'Track'}, offset:{now_playing:true},
    image_url:'https://ichef.bbci.co.uk/images/ic/{recipe}/abc.jpg',
  }]})));
  const response=await onRequestGet(request('bbc1'));
  assert.deepEqual(await response.json(),{title:'Track',artist:'Artist',album:'',cover:'https://ichef.bbci.co.uk/images/ic/400x400/abc.jpg',kind:'track'});
});

test('BBC does not label an earlier track as current', async t => {
  t.mock.method(globalThis,'fetch',()=>Promise.resolve(Response.json({data:[{titles:{primary:'Old',secondary:'Song'},offset:{now_playing:false}}]})));
  assert.deepEqual(await (await onRequestGet(request('bbc1'))).json(),{kind:'station'});
});

test('Polish stations distinguish a current track, recent track and programme', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T23:56:23Z')});
  let data={data:[{title:'Night show',startTime:'2026-11-14T00:05:00',stopTime:'2026-11-14T02:00:00',playlistItems:[{title:'Song',artist:'Artist',startTime:'2026-11-14T00:55:00',duration:200,cover:null}]}]};
  t.mock.method(globalThis,'fetch',()=>Promise.resolve(Response.json(data)));
  let result=await (await onRequestGet(request('trojka'))).json();
  assert.equal(result.kind,'track');
  assert.equal(result.title,'Song');
  data.data[0].playlistItems[0].startTime='2026-11-14T00:30:00';
  result=await (await onRequestGet(request('trojka'))).json();
  assert.equal(result.kind,'programme');
  assert.equal(result.title,'Night show');
  data=[{Title:'Music',Start:'Sat, 14 Nov 2026 00:00:00',Stop:'Sat, 14 Nov 2026 01:00:00',Songs:[{Title:'Song',Artist:'Artist',Start:'Sat, 14 Nov 2026 00:50:00',Duration:30}]}];
  result=await (await onRequestGet(request('czworka'))).json();
  assert.equal(result.kind,'recent');
  assert.equal(result.title,'Song');
  data[0].Songs[0].Start='Sat, 14 Nov 2026 00:10:00';
  result=await (await onRequestGet(request('czworka'))).json();
  assert.equal(result.kind,'programme');
  assert.equal(result.title,'Music');
});

test('rejects unknown stations and bounds upstream responses', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T23:56:23Z')});
  assert.equal((await onRequestGet(request('other'))).status,400);
  t.mock.method(globalThis,'fetch',()=>Promise.resolve(new Response('x'.repeat(512*1024+1))));
  assert.equal((await onRequestGet(request('trojka'))).status,502);
});


test('Polish station metadata stays neutral during the repeated DST hour', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-25T00:30:00Z')});
  const fetchMock=t.mock.method(globalThis,'fetch',()=>Promise.reject(new Error('must not fetch')));
  for (const instant of ['2026-10-25T00:30:00Z','2026-10-25T01:30:00Z']) {
    t.mock.timers.setTime(Date.parse(instant));
    assert.deepEqual(await (await onRequestGet(request('trojka'))).json(),{kind:'station'});
  }
  assert.equal(fetchMock.mock.callCount(),0);
});


test('untrusted artwork is not exposed', async t => {
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({data:[{
    titles:{primary:'Artist',secondary:'Track'}, offset:{now_playing:true},
    image_url:'https://ichef.bbci.co.uk.evil.test/images/ic/{recipe}/abc.jpg',
  }]})));
  assert.equal((await (await onRequestGet(request('bbc1'))).json()).cover,'');
});


test('a previous programme track is not shown as current after a programme change', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T23:56:23Z')});
  const data={data:[
    {title:'Previous',startTime:'2026-11-14T00:00:00',stopTime:'2026-11-14T00:55:00',playlistItems:[{title:'Old song',artist:'Artist',startTime:'2026-11-14T00:54:00',duration:300}]},
    {title:'Next show',startTime:'2026-11-14T00:55:00',stopTime:'2026-11-14T02:00:00',playlistItems:[]},
  ]};
  t.mock.method(globalThis,'fetch',()=>Promise.resolve(Response.json(data)));
  const result=await (await onRequestGet(request('trojka'))).json();
  assert.equal(result.kind,'programme');
  assert.equal(result.title,'Next show');
});


test('a track assigned to the active programme can begin before its scheduled start', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T23:56:23Z')});
  const data={data:[{title:'Next show',startTime:'2026-11-14T00:55:00',stopTime:'2026-11-14T02:00:00',playlistItems:[{title:'Song',artist:'Artist',startTime:'2026-11-14T00:54:00',duration:300}]}]};
  t.mock.method(globalThis,'fetch',()=>Promise.resolve(Response.json(data)));
  assert.equal((await (await onRequestGet(request('trojka'))).json()).kind,'track');
});


test('overnight Polish programmes can continue from the previous day', async t => {
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-13T23:01:00Z')});
  const requested=[];
  const previous={data:[{title:'Night show',startTime:'2026-11-13T23:00:00',stopTime:'2026-11-14T02:00:00',playlistItems:[{title:'Song',artist:'Artist',startTime:'2026-11-13T23:59:00',duration:300}]}]};
  t.mock.method(globalThis,'fetch',url=>{requested.push(url); return Promise.resolve(Response.json(url.includes('2026-11-13') ? previous : {data:[]}));});
  const result=await (await onRequestGet(request('trojka'))).json();
  assert.equal(result.kind,'track');
  assert.equal(result.title,'Song');
  assert.equal(requested.length,2);
});
