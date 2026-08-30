const ws=new WebSocket('ws://localhost:7331'); let id=1; const pend=new Map();
ws.onerror=()=>{console.log('motorul nu răspunde');process.exit(1)};
ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.type==='result'&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
const call=(cmd,params={})=>new Promise((r,j)=>{const i=id++;pend.set(i,m=>m.error?j(new Error(m.error)):r(m));ws.send(JSON.stringify({id:i,cmd,params}))});
ws.onopen=async()=>{
  await call('hello',{role:'claude'});
  let st=(await call('state')).state;
  const they=st.nodes.find(n=>n.text.trim()==='They' && st.nodes.some(s=>s.parent_id===n.parent_id&&s.text.trim()==='This'));
  if(!they){console.log('nu găsesc răscrucea They/This');process.exit(1)}
  await call('settings',{temperature:1.6,top_p:1,min_p:0.04});
  await call('goto',{id:they.id});
  const used=new Set();
  for(let k=0;k<18;k++){
    let r=await call('step'); st=r.state;
    let me=st.nodes.find(n=>n.id===st.active);
    // lărgește: du-te la capătul listei și mai cere 2
    let fan=st.nodes.filter(n=>n.parent_id===me.parent_id&&!n.hidden);
    await call('goto',{id:fan[fan.length-1].id});
    for(let e=0;e<2;e++) r=await call('sibling',{dir:1});
    st=r.state; fan=st.nodes.filter(n=>n.parent_id===me.parent_id&&!n.hidden);
    // alege: cel mai lung cuvânt nefolosit încă
    const sorted=fan.slice().sort((a,b)=>b.text.trim().length-a.text.trim().length);
    const best=sorted.find(s=>!used.has(s.text.trim().toLowerCase()))||sorted[0];
    used.add(best.text.trim().toLowerCase());
    r=await call('goto',{id:best.id}); st=r.state;
    console.log(`+${JSON.stringify(best.text)}   [${fan.map(s=>s.text.trim()).join(' · ')}]`);
  }
  await call('bookmark',{bookmarked:true});
  await call('settings',{temperature:1.0,top_p:0.9,min_p:0});
  console.log('---'); console.log(JSON.stringify(st.pathText.slice(-330)));
  process.exit(0);
};
setTimeout(()=>{console.log('timeout');process.exit(1)},280000);
