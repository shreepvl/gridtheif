import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";

const app = express(), server = createServer(app), io = new Server(server);
const PORT = process.env.PORT || 3000, W = 16, H = 12, GAME = 60000, DROP = 7500, DASH = 3600;
const COLORS = ["#ff5370", "#50a7ff", "#ffd166", "#70e5a3"], rooms = new Map();
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));
const cell = (x,y) => y * W + x;
const dirs = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
function code(){ const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let id; do id=Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join(""); while(rooms.has(id)); return id; }
function room(id){ return {id,players:[],grid:new Uint8Array(W*H),powerups:[],status:"lobby",endsAt:0,lastDrop:0,freeze:0,freezeBy:null,winner:null,event:{text:"Waiting for crew",kind:"quiet",at:Date.now()}}; }
function scores(r){ return r.players.map((p,i)=>({id:p.id,name:p.name,color:COLORS[i],tiles:r.grid.reduce((n,v)=>n+Number(v===i+1),0),chain:p.chain})); }
function state(r){ const now=Date.now(); return {code:r.id,status:r.status,width:W,height:H,grid:Buffer.from(r.grid).toString("base64"),players:r.players.map((p,i)=>({id:p.id,name:p.name,x:p.x,y:p.y,color:COLORS[i],chain:p.chain,frozen:r.freeze>now&&r.freezeBy!==p.id,dashReadyAt:p.dashReadyAt})),powerups:r.powerups,endsAt:r.endsAt,scores:scores(r),winner:r.winner,event:r.event}; }
function emit(r){ io.to(r.id).emit("state",state(r)); }
function note(r,text,kind="quiet"){ r.event={text,kind,at:Date.now()}; }
function open(r){ const used=new Set(r.players.map(p=>cell(p.x,p.y))), spaces=[]; for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(!used.has(cell(x,y)))spaces.push({x,y}); return spaces[Math.floor(Math.random()*spaces.length)]; }
function start(r){ if(r.status==="playing"||r.players.length<2)return; r.status="playing";r.endsAt=Date.now()+GAME;r.lastDrop=Date.now();r.grid.fill(0);r.powerups=[];const points=[{x:1,y:1},{x:W-2,y:H-2},{x:W-2,y:1},{x:1,y:H-2}];r.players.forEach((p,i)=>Object.assign(p,{...points[i],chain:0,lastCapture:0,dashReadyAt:Date.now()+900}));r.players.forEach((p,i)=>r.grid[cell(p.x,p.y)]=i+1);note(r,"The grid is live — take everything.","start");emit(r); }
function end(r){ if(r.status!=="playing")return;r.status="finished";const rank=scores(r).sort((a,b)=>b.tiles-a.tiles);r.winner=rank[0]?.tiles===rank[1]?.tiles?null:rank[0]?.id;note(r,r.winner?`${rank[0].name} controls the city.`:"No thief breaks the deadlock.","finish");emit(r); }
function drop(r){ const type=["freeze","steal","dash"][Math.floor(Math.random()*3)];r.powerups=[{...open(r),type}];note(r,{freeze:"Freeze charge dropped.",steal:"Block heist dropped.",dash:"Turbo charge dropped."}[type],"drop"); }
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){if(r.status!=="playing")continue;if(now>=r.endsAt)end(r);else if(now-r.lastDrop>=DROP){r.lastDrop=now;drop(r);emit(r);}}},200);
io.on("connection",socket=>{
 socket.on("create",({name},reply)=>{const r=room(code());rooms.set(r.id,r);join(r,socket,name,reply);});
 socket.on("join",({code:nameCode,name},reply)=>{const r=rooms.get(String(nameCode||"").trim().toUpperCase());if(!r)return reply?.({ok:false,message:"That room code doesn’t exist."});if(r.status==="playing"||r.players.length>=4)return reply?.({ok:false,message:"This crew is already in a match or full."});join(r,socket,name,reply);});
 socket.on("start",()=>{const r=rooms.get(socket.data.room);if(r?.players[0]?.id===socket.id)start(r);});
 socket.on("move",input=>move(socket,input));
 socket.on("disconnect",()=>{const r=rooms.get(socket.data.room);if(!r)return;r.players=r.players.filter(p=>p.id!==socket.id);if(!r.players.length)rooms.delete(r.id);else if(r.status==="playing")end(r);else emit(r);});
});
function join(r,socket,raw,reply){const name=String(raw||"Player").trim().slice(0,16)||"Player";r.players.push({id:socket.id,name,x:0,y:0,lastMove:0,lastCapture:0,chain:0,dashReadyAt:0});socket.data.room=r.id;socket.join(r.id);reply?.({ok:true,code:r.id,playerId:socket.id});emit(r);}
function move(socket,input){const r=rooms.get(socket.data.room),now=Date.now(),p=r?.players.find(x=>x.id===socket.id),dir=typeof input==="string"?input:input?.dir,dash=Boolean(input?.dash),v=dirs[dir];if(!r||r.status!=="playing"||!p||!v||now-p.lastMove<95||(r.freeze>now&&r.freezeBy!==p.id)||(dash&&now<p.dashReadyAt))return;const n=dash?2:1,steps=Array.from({length:n},(_,i)=>({x:p.x+v[0]*(i+1),y:p.y+v[1]*(i+1)}));if(steps.some(s=>s.x<0||s.x>=W||s.y<0||s.y>=H||r.players.some(o=>o!==p&&o.x===s.x&&o.y===s.y)))return;const owner=r.players.indexOf(p)+1;p.lastMove=now;Object.assign(p,steps.at(-1));if(dash){p.dashReadyAt=now+DASH;note(r,`${p.name} burst through the grid.`,"dash");}for(const s of steps){const neutral=r.grid[cell(s.x,s.y)]===0;r.grid[cell(s.x,s.y)]=owner;if(neutral)p.chain=now-p.lastCapture<900?p.chain+1:1;p.lastCapture=now;}const power=r.powerups.find(q=>q.x===p.x&&q.y===p.y);if(power){r.powerups=[];if(power.type==="freeze"){r.freeze=now+2400;r.freezeBy=p.id;note(r,`${p.name} froze every rival.`,"freeze");}if(power.type==="steal"){for(let y=Math.max(0,p.y-1);y<=Math.min(H-1,p.y+1);y++)for(let x=Math.max(0,p.x-1);x<=Math.min(W-1,p.x+1);x++)r.grid[cell(x,y)]=owner;note(r,`${p.name} stole a 3×3 block.`,"steal");}if(power.type==="dash"){p.dashReadyAt=now;note(r,`${p.name} recharged their dash.`,"dash");}}else if(p.chain>=5&&p.chain%5===0)note(r,`${p.name} is on a ${p.chain} tile run.`,"chain");emit(r);}
server.listen(PORT,()=>console.log(`Grid Thief running on http://localhost:${PORT}`));
