/* Cidade Sem Fim Alpha 1.0 — Vida na cidade, clima, entregas e DEV.
   A seed + coordenadas determinam TODOS os elementos do mundo.
   Biblioteca 3D: Three.js, hospedada em CDN com versão fixa. */
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js';
import * as CFG from './config.js';

const $ = (id) => document.getElementById(id);
const mobile = matchMedia('(pointer:coarse)').matches || window.innerWidth <= 700;
const CELL = 42, ROAD = 9, CELLS_PER_CHUNK = 3, CHUNK_SIZE = CELL * CELLS_PER_CHUNK;
const WORLD_COLORS = {
  'Centro': 0xa5b7ba, 'Bairro urbano': 0xc7c6ac,
  'Bairro residencial': 0xb4d1a0, 'Vilarejo': 0xe1bf86, 'Floresta': 0x729d72
};
const TAU = Math.PI * 2;
let seedString = 'CLT-2026', seedHash = 1, radius = mobile ? 1 : 2;
let lastChunkX = null, lastChunkZ = null, lastZone = '', toastTimer;
const chunks = new Map();
const keys = new Set();
const movementTouch = {x: 0, y: 0, running: false};
const cam = {yaw: 0.6, pitch: .35, distance: 6.6, dragging: false, lastX:0, lastY:0, pointerId:null};
// A câmera só começa a acompanhar depois de andar pelo menos 5 unidades.
// Enquanto acompanha a pé, os controles usam a direção em que o movimento
// começou, para impedir que a câmera faça o personagem descrever círculos.
const camFollow={distance:0,active:false,manualUntil:0,controlYaw:null,inputX:0,inputY:0,hadInput:false};
const CAMERA_FOLLOW_DISTANCE=Number.isFinite(CFG.distanciaAcompanhamentoCamera)?Math.max(0.5,CFG.distanciaAcompanhamentoCamera):5;
const CAMERA_FOLLOW_SPEED=Number.isFinite(CFG.suavidadeAcompanhamentoCamera)?Math.max(0.2,CFG.suavidadeAcompanhamentoCamera):1.8;
const CAMERA_MANUAL_GRACE_MS=1800;
function resetCameraFollow(manual=false){
  camFollow.distance=0;camFollow.active=false;camFollow.controlYaw=null;
  camFollow.hadInput=false;camFollow.inputX=0;camFollow.inputY=0;
  if(manual)camFollow.manualUntil=performance.now()+CAMERA_MANUAL_GRACE_MS;
}
function cameraMoveControls(){
  let x=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+movementTouch.x;
  let y=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-movementTouch.y;
  const norm=Math.max(1,Math.hypot(x,y));return {x:x/norm,y:y/norm};
}
function updateAutoCamera(dt,lastX,lastZ){
  if(cam.dragging || gamePaused || activityOpen || mapOpen || performance.now()<camFollow.manualUntil){resetCameraFollow(false);return;}
  const input=drivingCar? {x:0,y:vehicleSpeed>0.3?1:0}:cameraMoveControls();
  const moving=input.y>0.05 || (!drivingCar && Math.abs(input.x)>0.05);
  if(!moving){resetCameraFollow(false);return;}
  // Mudou o sentido do joystick ou mudou de tecla: começa uma nova trajetória.
  if(camFollow.hadInput && !drivingCar &&
    Math.hypot(input.x-camFollow.inputX,input.y-camFollow.inputY)>.40){
    resetCameraFollow(false);
  }
  camFollow.hadInput=true;camFollow.inputX=input.x;camFollow.inputY=input.y;
  const traveled=Math.hypot(playerPos.x-lastX,playerPos.z-lastZ);
  if(traveled<1e-5 || !Number.isFinite(traveled))return;
  camFollow.distance+=traveled;
  if(camFollow.distance<CAMERA_FOLLOW_DISTANCE)return;
  if(!camFollow.active){
    camFollow.active=true;
    camFollow.controlYaw=drivingCar?null:cam.yaw;
  }
  const targetYaw=drivingCar?drivingCar.group.rotation.y:playerGroup.rotation.y;
  if(!Number.isFinite(targetYaw))return;
  const diff=Math.atan2(Math.sin(targetYaw-cam.yaw),Math.cos(targetYaw-cam.yaw));
  cam.yaw+=diff*(1-Math.exp(-dt*CAMERA_FOLLOW_SPEED));
}

const playerPos = new THREE.Vector3(ROAD / 2, 0, ROAD / 2);
const smoothTarget = new THREE.Vector3();
// THREE.Clock foi depreciado em r183. Timer funciona com um update por frame.
const timer = new THREE.Timer();
let previousFrameTimestamp = null;
const movementStatus = { input: '-', delta: 0, block: 'não', keyEvent: '-', frames: 0, lastKeyAt: 0 };
const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();
let walkTime = 0, walkBob=0;
let playerGroup, leftLeg, rightLeg, leftArm, rightArm;
let renderer, scene, camera, sun, terrain, hemi, skyMesh, skyTexture, skyCanvas;
let timeHours=14, timeFlow=true, sunDirection=60, skyPreset='claro', skyUpload=null, lastSkyBucket=-1;
// Limites dos modelos ativos: ajustes de densidade afetam a quantidade em tempo real.
const carAgents=[]; const lightPool=[]; const CAR_LIMIT=mobile?13:28;
const pedestrians=[]; const PED_LIMIT=mobile?18:36;
let trafficDensity=70, pedestrianDensity=65;
function desiredCars(){return Math.round(CAR_LIMIT*trafficDensity/100);}
function desiredPeds(){return Math.round(PED_LIMIT*pedestrianDensity/100);}
function carEnabled(a){return a.isOwned || a.index<desiredCars() || a===drivingCar;}
function pedEnabled(p){return p.index<desiredPeds();}
let drivingCar=null, vehicleSpeed=0, vehicleTipTimer=0;
const DRIVING_MAX_SPEED=Number.isFinite(CFG.velocidadeMaximaJogador)?Math.max(4,CFG.velocidadeMaximaJogador):19;
const TRAFFIC_SPEED_MULT=Number.isFinite(CFG.velocidadeCarros)?Math.max(0.05,CFG.velocidadeCarros):.72;
const brokenLampKeys=new Set(); // postes derrubados nesta sessão por seed
const headlightPool=[];
let headlightsOn=false;
// V1.5: pontos de coleta e destinos pertencem aos lotes reais do mundo procedural.
const knownRestaurants=new Map(), knownDestinations=new Map();
let weatherMode='automatico', weatherVisual='ensolarado', weatherWet=0, weatherFog=0, rainParticles=null;
const weatherNames={automatico:'Automático',ensolarado:'Ensolarado',nublado:'Nublado',chuva:'Chuva',neblina:'Neblina'};
const ambientAudio=new Audio();ambientAudio.loop=true;ambientAudio.preload='none';
let audioSource='', audioBlocked=false, devUnlocked=false, devOpen=false, devCar=null, deliveryOffers=[];
const DEV_HIT_COUNT=7, DEV_HIT_WINDOW=3500;
let devHits=0,devFirstHit=0;
const SAVE_PREFIX='cidadeSemFim:entregas:v1:'; // Migração compatível com o save da versão 1.5.
const knownWorkshops=new Map(),knownClothingStores=new Map(),knownProperties=new Map();
const propertyStates={}; // id determinístico da propriedade -> 0 (disponível) ou 1 (comprada)
const CAR_CATALOG=[
 {id:'compacto',kind:0,name:'Compacto',price:0,speed:1},
 {id:'seda',kind:1,name:'Sedã',price:1200,speed:1.13},
 {id:'suv',kind:2,name:'SUV',price:2600,speed:1.04},
 {id:'van',kind:3,name:'Van',price:3800,speed:.90}
];
const CLOTHES={
 cap:{label:'Boné',cost:35,colors:[0xd4e5b0,0x313845,0xc84d45,0x56a2d7,0x62ad6c]},
 shirt:{label:'Camisa',cost:55,colors:[0x415f80,0xffffff,0xc94a4a,0x34aa8c,0xd7a448]},
 pants:{label:'Calça',cost:70,colors:[0x2b3a52,0x222222,0x7b9abe,0x847057,0x8a9a91]},
 shoes:{label:'Sapato',cost:40,colors:[0x252d3c,0xffffff,0x9a5d31,0x1d1e22,0xa82b39]}
};
let ownedCars=['compacto'],selectedCar='compacto',garageVehicle=null;
// Cores em hexadecimal. IDs antigos de paleta são convertidos ao ler saves 1.6.
const CLOTHING_PARTS=Object.keys(CLOTHES);
const PAINT_COST=120;
const hex6=v=>/^#[0-9a-fA-F]{6}$/.test(String(v))?String(v).toLowerCase():null;
function garmentHex(cat,value){
 if(typeof value==='number' && Number.isInteger(value))return '#'+(CLOTHES[cat].colors[value]??CLOTHES[cat].colors[0]).toString(16).padStart(6,'0');
 return hex6(value);
}
const initialClothes=()=>Object.fromEntries(CLOTHING_PARTS.map(cat=>[cat,[garmentHex(cat,0)]]));
let ownedColors=initialClothes();
let equippedColors=Object.fromEntries(CLOTHING_PARTS.map(cat=>[cat,garmentHex(cat,0)]));
let clothingDraft={...equippedColors};
let carPaints={},chosenCarPaints={};
let mapOpen=false,mapRotate=true,mapScale=.5,mapCenterX=0,mapCenterZ=0;
const miniScale=Number.isFinite(CFG.zoomMiniMapa)?THREE.MathUtils.clamp(CFG.zoomMiniMapa,.35,2):.92;
const paintDefault='#9dbec8';
function carPaintColor(id){return hex6(carPaints[id])||paintDefault;}
function chooseCarPaint(id){return hex6(chosenCarPaints[id])||carPaintColor(id);}
function paintOwnedCar(agent,color){if(!agent?.paintMaterial)return;const hex=hex6(color);if(!hex)return;agent.paintMaterial.color.set(hex);agent.paintHex=hex;}

const playerVisualMats={};
let activityOpen=false,activityPlace=null,activityView='';
const safeMoney=v=>Number.isFinite(v)?Math.max(0,Math.round(v*100)/100):0;

const DELIVERY_BASE=Number.isFinite(CFG.valorBaseEntrega)?Math.max(0,CFG.valorBaseEntrega):5;
const DELIVERY_PER_100=Number.isFinite(CFG.valorPor100Unidades)?Math.max(0,CFG.valorPor100Unidades):7.5;
const mission={stage:'pickup',wallet:0,completed:0,pickup:null,target:null,payment:0,lastTargetId:null};
let deliveryArrow,deliveryMarker,lastMissionUi=0,lastAutosave=0;
const moneyFormat=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
function distanceTo(place){return Math.hypot(place.x-playerPos.x,place.z-playerPos.z);}
function pointId(type,x,z){return `${type}:${Math.round(x*100)}:${Math.round(z*100)}`;}
function safePlace(o){
 if(!o||!Number.isFinite(o.x)||!Number.isFinite(o.z)||Math.abs(o.x)>1e8||Math.abs(o.z)>1e8)return null;
 return {id:String(o.id||pointId('local',o.x,o.z)).slice(0,96),x:o.x,z:o.z,name:String(o.name||'Endereço').slice(0,70),kind:String(o.kind||'residência').slice(0,30)};
}
function rememberDestination(x,z,name,kind){
 const item=safePlace({id:pointId('destino',x,z),x,z,name,kind});
 knownDestinations.set(item.id,item);
 if(knownDestinations.size>9000)knownDestinations.delete(knownDestinations.keys().next().value);
}
function rememberRestaurant(chunk,x,z,name){
 const item=safePlace({id:pointId('restaurante',x,z),x,z,name,kind:'restaurante'});
 chunk.restaurants.push(item);knownRestaurants.set(item.id,item);
 if(knownRestaurants.size>1200)knownRestaurants.delete(knownRestaurants.keys().next().value);
 // Um checkpoint verde na CALÇADA, em frente à entrada, não no meio da rua.
 const marker=new THREE.Group();marker.position.set(x,.16,z);
 const ring=new THREE.Mesh(checkpointRingGeometry,checkpointRingMaterial);
 ring.rotation.x=-Math.PI/2;marker.add(ring);
 const pillar=new THREE.Mesh(checkpointPillarGeometry,checkpointPillarMaterial);
 pillar.position.y=1.52;marker.add(pillar);
 const gem=new THREE.Mesh(checkpointGemGeometry,checkpointGemMaterial);
 gem.position.y=3.4;marker.add(gem);
 chunk.group.add(marker);chunk.checkpoints.push({item,marker,gem});
}
function rememberService(chunk,type,x,z,name){
 const item=safePlace({id:pointId(type,x,z),x,z,name,kind:type});
 const map=type==='oficina'?knownWorkshops:knownClothingStores;
 map.set(item.id,item);
 chunk.services.push(item);
 // Marcações são discretas; o minimapa identifica o tipo de loja.
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.86,.12,6,18),
   new THREE.MeshBasicMaterial({color:type==='oficina'?0x73b9ff:0xf8a0ff}));
 ring.rotation.x=-Math.PI/2;ring.position.set(x,.22,z);chunk.group.add(ring);
}
function rememberProperty(chunk,x,z,kind){
 // Cada ID usa as coordenadas reproduzíveis do lote: a seed mantém a mesma propriedade.
 const id=pointId('imovel',x,z);
 const select=randAt(Math.round(x*10),Math.round(z*10),930)>0.71;
 if(!select)return;
 const price=kind==='apartamento'?1500:950;
 const item=safePlace({id,x,z,name:kind==='apartamento'?'Apartamento disponível':'Casa disponível',kind});
 item.price=price;knownProperties.set(id,item);chunk.properties.push(item);
 if(propertyStates[id]!==1)propertyStates[id]=0;
 const marker=new THREE.Mesh(new THREE.TorusGeometry(.78,.12,6,18),
   new THREE.MeshBasicMaterial({color:propertyStates[id]===1?0x7fffa8:0xffd47e}));
 marker.rotation.x=-Math.PI/2;marker.position.set(x,.24,z);chunk.group.add(marker);
 chunk.propertyMarkers.push({material:marker.material,propertyId:id});
}
function nearbyPlace(){
 if(drivingCar)return null;
 let best=null,dist=8.8;
 for(const [kind,map] of [['oficina',knownWorkshops],['lojas',knownClothingStores],['imovel',knownProperties]]){
  for(const item of map.values()){
   const d=distanceTo(item);
   if(d<dist){best={...item,serviceKind:kind};dist=d;}
  }
 }
 return best;
}
function renderCoins(){return moneyFormat.format(mission.wallet);}
function purchase(price){
 if(mission.wallet<price){toast(`Saldo insuficiente: faltam ${moneyFormat.format(price-mission.wallet)}.`);return false;}
 mission.wallet=safeMoney(mission.wallet-price);return true;
}
function applyOutfit(){
 for(const cat of CLOTHING_PARTS){
  if(playerVisualMats[cat])playerVisualMats[cat].color.set(equippedColors[cat]||garmentHex(cat,0));
 }
}
function htmlEsc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function openActivity(place,view){
 if(drivingCar){toast('Estacione e saia do veículo para interagir.');return;}
 activityPlace=place;activityView=view;activityOpen=true;keys.clear();
 movementTouch.x=movementTouch.y=0;movementTouch.running=false;
 $('activity-modal').hidden=false;$('touch-ui').hidden=true;
 renderActivity();
}
function closeActivity(){
 activityOpen=false;activityPlace=null;activityView='';
 $('activity-modal').hidden=true;$('touch-ui').hidden=gamePaused;
 keys.clear();movementTouch.x=movementTouch.y=0;
 updateHUD();
}
function propertyOwned(item){return propertyStates[item.id]===1;}
function actionsForPlace(place){
 if(place.serviceKind==='oficina')return 'oficina';
 if(place.serviceKind==='lojas')return 'comprarRoupas';
 return propertyOwned(place)?'casa':'comprarCasa';
}
function renderActivity(){
 const container=$('activity-body');if(!container)return;
 const kind=activityView;
 $('activity-title').textContent=kind==='oficina'?'🚗 OFICINA':kind==='garagem'?'🚗 MINHA GARAGEM':kind==='comprarRoupas'?'👖 LOJA DE ROUPAS':kind==='roupas'?'👕 GUARDA-ROUPA':kind==='comprarCasa'?'🏠 COMPRAR IMÓVEL':'🏠 MINHA CASA';
 $('activity-wallet').textContent=`Saldo: ${renderCoins()}`;
 const btn=(action,label,disabled=false)=>`<button type="button" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
 let out='';
 if(kind==='oficina'||kind==='garagem'){
  out+='<p>Seus veículos ficam disponíveis em qualquer oficina ou imóvel comprado. Cada carro mantém sua própria pintura.</p>';
  out+=`<div class="activity-tabs">${activityPlace?.serviceKind==='oficina'?btn('tab:oficina','Comprar carros'):''}${btn('tab:garagem','Minha garagem')}</div>`;
  const workshop=activityPlace?.serviceKind==='oficina';
  for(const car of CAR_CATALOG.filter(c=>kind==='oficina'||ownedCars.includes(c.id))){
   const owned=ownedCars.includes(car.id);
   const paint=chooseCarPaint(car.id);
   out+=`<div class="activity-item vehicle-shop-item"><div><b>${htmlEsc(car.name)}</b><small>${owned?'Adquirido':moneyFormat.format(car.price)} · Desempenho ${Math.round(car.speed*100)}%</small></div>`;
   out+=workshop
    ?`<div class="vehicle-paint"><label>Cor <input type="color" aria-label="Cor do ${htmlEsc(car.name)}" data-car-paint="${car.id}" value="${paint}"></label>`
    :`<div class="vehicle-paint"><span class="vehicle-paint-readonly" style="background:${carPaintColor(car.id)}" aria-label="Pintura atual"></span><small>Cor atual</small>`;
   if(!owned){if(workshop)out+=btn('buycar:'+car.id,'COMPRAR');}
   else if(kind==='garagem'){
    out+=btn('spawncar:'+car.id,'RETIRAR');
    if(workshop)out+=btn('repaint:'+car.id,`PINTAR ${moneyFormat.format(PAINT_COST)}`);
   }else if(workshop)out+=btn('repaint:'+car.id,`PINTAR ${moneyFormat.format(PAINT_COST)}`);
   out+='</div></div>';
  }
 }else if(kind==='comprarCasa'){
  const p=activityPlace;
  out+=`<p>Imóvel fixo desta seed. Depois de comprado, poderá dormir, trocar de roupa e retirar veículos.</p><div class="activity-item"><div><b>${htmlEsc(p.name)}</b><small>${moneyFormat.format(p.price)}</small></div>${btn('buyproperty','COMPRAR')}</div>`;
 }else if(kind==='casa'){
  out+='<p>Seu endereço fica salvo nesta seed. Dormir avança oito horas e salva a partida.</p>';
  out+=`<div class="activity-actions">${btn('sleep','💤 DORMIR 8 HORAS')}${btn('tab:roupas','👕 TROCAR ROUPA')}${btn('tab:garagem','🚗 MINHA GARAGEM')}</div>`;
 }else if(kind==='roupas'||kind==='comprarRoupas'){
  const store=kind==='comprarRoupas';
  out+=`<p>${store?'Escolha qualquer cor RGB. Cada cor nova tem preço fixo e, depois da compra, pode ser usada gratuitamente.':'Selecione uma das cores que você já possui.'}</p>`;
  for(const [cat,definition] of Object.entries(CLOTHES)){
   out+=`<div class="clothing-category"><b>${definition.label}</b>`;
   if(store){
    out+=`<div class="rgb-picker"><label>Escolher cor <input type="color" data-clothing-picker="${cat}" value="${clothingDraft[cat]||equippedColors[cat]}"></label>${btn('buyrgb:'+cat,`COMPRAR / USAR · ${moneyFormat.format(definition.cost)}`)}</div>`;
   }
   out+='<div class="swatches">';
   for(const color of ownedColors[cat]){
    const active=equippedColors[cat]===color;
    out+=`<button type="button" class="swatch ${active?'chosen':''}" data-action="wearrgb:${cat}:${color}" title="${active?'Em uso':'Usar'} ${color}"><span style="background:${color}"></span><small>${active?'Em uso':color.toUpperCase()}</small></button>`;
   }
   out+='</div></div>';
  }
  if(store)out+=`<div class="activity-actions">${btn('tab:roupas','Ver minhas roupas')}</div>`;
  else if(activityPlace?.serviceKind==='lojas')out+=`<div class="activity-actions">${btn('tab:comprarRoupas','Ver catálogo')}</div>`;
 }
 container.innerHTML=out;
}
// Em casas e oficinas a fachada é voltada para -Z. A garagem procura
// vagas primeiro na rua imediatamente em frente à entrada do imóvel.
function garageParkingCandidates(place){
 const x0=Math.floor(place.x/CELL)*CELL;
 const z0=Math.floor(place.z/CELL)*CELL;
 const frontX=THREE.MathUtils.clamp(place.x,x0+ROAD+3.5,x0+CELL-4);
 const xOffsets=[0,4,-4,8,-8,12,-12];
 // Meio-fio da fachada, depois faixas vizinhas se o local estiver ocupado.
 const zOptions=[z0+ROAD+.4,z0+ROAD/2+2.5,z0+ROAD/2-2.5];
 const options=[],seen=new Set();
 for(const z of zOptions)for(const offset of xOffsets){
  const x=THREE.MathUtils.clamp(frontX+offset,x0+ROAD+3.5,x0+CELL-4);
  const key=x.toFixed(2)+','+z.toFixed(2);
  if(!seen.has(key)){
   seen.add(key);options.push({x,z,yaw:-Math.PI/2});
  }
 }
 return options;
}
function spawnOwnedCar(carId){
 const model=CAR_CATALOG.find(v=>v.id===carId);
 if(!model||!ownedCars.includes(carId))return;
 // Antes: null === null era verdadeiro e bloqueava toda retirada a pé.
 if(drivingCar){toast('Saia do carro antes de retirar outro.');return;}
 const place=activityPlace;
 const isHome=place?.serviceKind==='imovel' && propertyOwned(place);
 const isWorkshop=place?.serviceKind==='oficina';
 if(!place||(!isWorkshop&&!isHome)){
  toast('Acesse sua garagem em uma oficina ou em uma propriedade comprada.');return;
 }
 // Primeiro localiza uma vaga, sem remover o carro próprio já estacionado.
 const candidate=makeCarAgent(10001,model.kind);
 candidate.isOwned=true;candidate.catalogId=carId;candidate.parked=true;paintOwnedCar(candidate,carPaintColor(carId));
 let parking=null;
 for(const spot of garageParkingCandidates(place)){
  candidate.group.rotation.y=spot.yaw;
  // Ignora o carro que será substituído. Buscar vaga não derruba postes.
  if(vehicleCanAdvance(candidate,spot.x,spot.z,garageVehicle,false)){
   parking=spot;break;
  }
 }
 if(!parking){
  scene.remove(candidate.group);
  toast('Não há vaga livre em frente a este local. Tente novamente em outro ponto.');
  return;
 }
 if(garageVehicle){
  scene.remove(garageVehicle.group);
  const oldIndex=carAgents.indexOf(garageVehicle);
  if(oldIndex>=0)carAgents.splice(oldIndex,1);
 }
 garageVehicle=candidate;
 garageVehicle.group.position.set(parking.x,0,parking.z);
 garageVehicle.group.rotation.y=parking.yaw;
 garageVehicle.group.visible=true;
 carAgents.push(garageVehicle);
 selectedCar=carId;saveProgress();closeActivity();
 toast(`${model.name} retirado! Estacionado em frente ${isHome?'à sua propriedade':'à oficina'}.`);
}
function handleActivityAction(action){
 const [verb,a,b]=action.split(':');
 if(verb==='tab'){
  if(a==='oficina'&&activityPlace?.serviceKind!=='oficina')return;
  if(a==='comprarRoupas'&&activityPlace?.serviceKind!=='lojas')return;
  activityView=a;renderActivity();return;
 }
 if(verb==='buycar'){
  const car=CAR_CATALOG.find(c=>c.id===a);if(!car||ownedCars.includes(a))return;
  if(purchase(car.price)){ownedCars.push(a);carPaints[a]=chooseCarPaint(a);saveProgress();toast('Veículo adquirido na cor escolhida! Abra Minha garagem para retirá-lo.');}renderActivity();return;
 }
 if(verb==='spawncar'){spawnOwnedCar(a);return;}
 if(verb==='repaint'){
  if(activityPlace?.serviceKind!=='oficina'||!ownedCars.includes(a))return;
  const newColor=chooseCarPaint(a);
  if(newColor===carPaintColor(a)){toast('Este veículo já está nessa cor.');return;}
  if(!purchase(PAINT_COST)){renderActivity();return;}
  carPaints[a]=newColor;
  if(garageVehicle?.catalogId===a)paintOwnedCar(garageVehicle,newColor);
  saveProgress();toast('Pintura alterada e salva!');renderActivity();return;
 }
 if(verb==='buyproperty'){
  const place=activityPlace;if(!place||propertyOwned(place))return;
  if(purchase(place.price)){
   propertyStates[place.id]=1;
   for(const chunk of chunks.values())for(const marker of chunk.propertyMarkers||[])
    if(marker.propertyId===place.id)marker.material.color.setHex(0x7fffa8);
   saveProgress();activityView='casa';toast('Imóvel comprado! Agora você tem uma casa neste mundo.');
  }renderActivity();return;
 }
 if(verb==='sleep'){
  timeHours=(timeHours+8)%24;lastSkyBucket=-1;
  $('hours').value=String(timeHours);$('clock-time').textContent=timeLabel(timeHours);
  saveProgress();toast(`Você descansou 8 horas. Agora são ${timeLabel(timeHours)}. Progresso salvo.`);closeActivity();return;
 }
 if(verb==='buyrgb'||verb==='wearrgb'){
  const cat=a;if(!Object.hasOwn(CLOTHES,cat))return;
  const color=verb==='buyrgb'?hex6(clothingDraft[cat]):hex6(b);
  if(!color)return;
  if(!ownedColors[cat].includes(color)){
   if(verb!=='buyrgb'||activityPlace?.serviceKind!=='lojas')return;
   if(!purchase(CLOTHES[cat].cost)){renderActivity();return;}
   ownedColors[cat].push(color);
  }
  equippedColors[cat]=color;clothingDraft[cat]=color;
  applyOutfit();saveProgress();renderActivity();return;
 }

}
function currentPickup(){
 if(mission.pickup)return mission.pickup;
 let nearest=null,best=Infinity;
 for(const p of knownRestaurants.values()){
  const d=distanceTo(p);
  if(d<best){nearest=p;best=d;}
 }
 return nearest;
}
function currentWaypoint(){return mission.stage==='deliver'?mission.target:currentPickup();}
function storageKey(){return SAVE_PREFIX+encodeURIComponent(seedString);}
function readSeedSave(seed){
 try{
  const raw=localStorage.getItem(SAVE_PREFIX+encodeURIComponent(seed));
  if(!raw)return null;
  const data=JSON.parse(raw);
  return data&&([1,2,3].includes(data.version))?data:null;
 }catch(err){console.warn('[Entregas] Salvamento indisponível:',err);return null;}
}
function updateSavePreview(){
 const seed=String($('seed').value||'CLT-2026').trim().slice(0,48)||'CLT-2026';
 const d=readSeedSave(seed);const preview=$('save-preview');
 if(preview)preview.textContent=d?`Save desta seed: ${moneyFormat.format(Number(d.wallet)||0)} • ${Number(d.completed)||0} entregas`:'Nova partida nesta seed • saldo inicial R$ 0,00';
}
function saveProgress(){
 if(!gameStarted || !Number.isFinite(playerPos.x)||!Number.isFinite(playerPos.z))return;
 const data={version:2,seed:seedString,wallet:mission.wallet,completed:mission.completed,
  timeHours,weatherMode,properties:{...propertyStates},ownedCars:[...ownedCars],selectedCar,carPaints:{...carPaints},mapRotate,ownedColors:JSON.parse(JSON.stringify(ownedColors)),equippedColors:{...equippedColors},
  stage:mission.stage,pickup:mission.pickup,target:mission.target,payment:mission.payment,
  lastTargetId:mission.lastTargetId,position:{x:playerPos.x,z:playerPos.z},
  garageVehiclePos:garageVehicle?.group.visible?{x:garageVehicle.group.position.x,z:garageVehicle.group.position.z,yaw:garageVehicle.group.rotation.y,model:garageVehicle.catalogId}:null};
 try{
  // Backup automático do primeiro save encontrado na atualização para 1.7.
  const backupKey=storageKey()+':backup_pre17';
  const previous=localStorage.getItem(storageKey());
  if(previous && !localStorage.getItem(backupKey))localStorage.setItem(backupKey,previous);
  // Versão 2: mantém dinheiro, imóveis e veículos legíveis na antiga 1.6.1.
  localStorage.setItem(storageKey(),JSON.stringify(data));
 }catch(err){console.warn('[Entregas] Sem espaço para salvar:',err);}
 updateSavePreview();
}
function restoreSeedProgress(){
 const d=readSeedSave(seedString);
 Object.keys(propertyStates).forEach(k=>delete propertyStates[k]);
 for(const [key,value] of Object.entries(d?.properties||{})){
  if(/^imovel:-?\d+:-?\d+$/.test(key)&&Object.keys(propertyStates).length<3000)propertyStates[key]=value===1?1:0;
 }
 ownedCars=['compacto',...new Set((Array.isArray(d?.ownedCars)?d.ownedCars:[]).filter(id=>id!=='compacto'&&CAR_CATALOG.some(car=>car.id===id)))];
 selectedCar=ownedCars.includes(d?.selectedCar)?d.selectedCar:'compacto';
 carPaints={};chosenCarPaints={};
 for(const car of CAR_CATALOG){
  const c=hex6(d?.carPaints?.[car.id]);
  if(c)carPaints[car.id]=c;
 }
 mapRotate=typeof d?.mapRotate==='boolean'?d.mapRotate:true;
 $('map-rotate').checked=mapRotate;
 ownedColors=initialClothes();
 equippedColors=Object.fromEntries(CLOTHING_PARTS.map(cat=>[cat,garmentHex(cat,0)]));
 for(const cat of CLOTHING_PARTS){
  const unlocked=d?.ownedColors?.[cat];
  if(Array.isArray(unlocked))ownedColors[cat]=[...new Set([garmentHex(cat,0),...unlocked.map(c=>garmentHex(cat,c)).filter(Boolean)])].slice(0,500);
  const worn=garmentHex(cat,d?.equippedColors?.[cat]);
  if(worn&&ownedColors[cat].includes(worn))equippedColors[cat]=worn;
 }
 clothingDraft={...equippedColors};
 applyOutfit();
 if(Number.isFinite(d?.timeHours)&&d.timeHours>=0&&d.timeHours<24){
  timeHours=d.timeHours;$('hours').value=String(timeHours);$('clock-time').textContent=timeLabel(timeHours);lastSkyBucket=-1;
 }
 if(d?.weatherMode && weatherNames[d.weatherMode])weatherMode=d.weatherMode;
 $('weather-mode').value=weatherMode;
 mission.wallet=Number.isFinite(d?.wallet)?Math.max(0,d.wallet):0;
 mission.completed=Number.isSafeInteger(d?.completed)?Math.max(0,d.completed):0;
 mission.stage=d?.stage==='deliver'?'deliver':'pickup';
 mission.pickup=safePlace(d?.pickup);mission.target=safePlace(d?.target);
 mission.payment=Number.isFinite(d?.payment)?Math.max(0,d.payment):0;
 mission.lastTargetId=typeof d?.lastTargetId==='string'?d.lastTargetId:null;
 if(mission.stage==='deliver'&&!mission.target){mission.stage='pickup';mission.payment=0;}
 // Restaura a posição somente se há uma superfície caminhável e coordenadas finitas.
 if(d?.position&&Number.isFinite(d.position.x)&&Number.isFinite(d.position.z)
    &&Math.abs(d.position.x)<1e7&&Math.abs(d.position.z)<1e7){
   playerPos.set(d.position.x,terrainHeight(d.position.x,d.position.z),d.position.z);
   previousSafeX=playerPos.x;previousSafeZ=playerPos.z;
   playerGroup.position.set(playerPos.x,playerPos.y,playerPos.z);
   updateChunks(true);
   if(!canMove(playerPos.x,playerPos.z,false,false,false)){
     // Salva o progresso financeiro, mas não recupera o personagem dentro de um prédio.
     playerPos.set(ROAD/2,0,ROAD/2);playerGroup.position.set(playerPos.x,0,playerPos.z);
     previousSafeX=playerPos.x;previousSafeZ=playerPos.z;updateChunks(true);
   }
 }
 if(d?.garageVehiclePos&&ownedCars.includes(d.garageVehiclePos.model)){
  const v=d.garageVehiclePos;
  if(Number.isFinite(v.x)&&Number.isFinite(v.z)&&Math.abs(v.x)<1e7&&Math.abs(v.z)<1e7){
   const model=CAR_CATALOG.find(c=>c.id===v.model);
   if(model){garageVehicle=makeCarAgent(10001,model.kind);garageVehicle.isOwned=true;garageVehicle.catalogId=model.id;garageVehicle.parked=true;paintOwnedCar(garageVehicle,carPaintColor(model.id));carAgents.push(garageVehicle);
    garageVehicle.group.position.set(v.x,0,v.z);garageVehicle.group.rotation.y=Number.isFinite(v.yaw)?v.yaw:-Math.PI/2;garageVehicle.group.visible=true;
   }
  }
 }
 for(const item of knownProperties.values())if(!Object.hasOwn(propertyStates,item.id))propertyStates[item.id]=0;
 for(const chunk of chunks.values())for(const marker of chunk.propertyMarkers||[])
  marker.material.color.setHex(propertyStates[marker.propertyId]===1?0x7fffa8:0xffd47e);
 updateSavePreview();updateMissionUI(true);
}
function chooseDeliveryTarget(pickup){
 const candidates=[...knownDestinations.values()]
  .map(d=>({...d,dist:Math.hypot(d.x-pickup.x,d.z-pickup.z)}))
  .filter(d=>d.dist>55 && d.dist<850 && d.id!==mission.lastTargetId)
  .sort((a,b)=>a.id.localeCompare(b.id));
 if(!candidates.length)return null;
 // Distâncias variadas, seleção reproduzível por seed e número de entregas.
 const random=seededRandom(hashInt(mission.completed+1,Math.round(pickup.x+pickup.z),88513));
 const desired=75+random()*560;
 candidates.sort((a,b)=>Math.abs(a.dist-desired)-Math.abs(b.dist-desired));
 return candidates[Math.min(Math.floor(random()*Math.min(5,candidates.length)),candidates.length-1)];
}
function chooseDeliveryOffers(pickup){
  const pool=[...knownDestinations.values()].map(d=>({...d,dist:Math.hypot(d.x-pickup.x,d.z-pickup.z)}))
    .filter(d=>d.dist>55 && d.dist<850 && d.id!==mission.lastTargetId);
  if(!pool.length)return [];
  // A mesma seed, restaurante e número de entregas geram escolhas estáveis.
  const sortSeed=hashInt(mission.completed+1,Math.round(pickup.x+pickup.z),9182);
  pool.sort((a,b)=>hashString(a.id+'|'+sortSeed)-hashString(b.id+'|'+sortSeed));
  const ranges=[{title:'Curta',min:55,max:180},{title:'Média',min:180,max:380},{title:'Longa',min:380,max:850}];
  const result=[];
  for(const tier of ranges){
    const available=pool.filter(p=>p.dist>=tier.min&&p.dist<tier.max&&!result.some(r=>r.target.id===p.id));
    if(!available.length)continue;
    const target=available[0];result.push({title:tier.title,target,payment:moneyForDistance(target.dist)});
  }
  return result;
}
function openDeliveryOffers(pickup){
  deliveryOffers=chooseDeliveryOffers(pickup);
  if(!deliveryOffers.length){toast('Explore mais bairros para liberar novos destinos.');return;}
  $('delivery-offers').replaceChildren();
  deliveryOffers.forEach((o,i)=>{
    const button=document.createElement('button');button.type='button';button.dataset.offer=String(i);
    button.textContent=`${o.title}: ${Math.round(o.target.dist)} m · ${moneyFormat.format(o.payment)}`;
    $('delivery-offers').appendChild(button);
  });
  $('delivery-modal').hidden=false;keys.clear();
}
function acceptDelivery(pickup,target,payment){
  mission.stage='deliver';mission.pickup={...pickup};mission.target=safePlace(target);
  mission.payment=payment;saveProgress();updateMissionUI(true);
  toast(`Pedido coletado! ${Math.round(target.dist)} m · ${moneyFormat.format(payment)}`);
}
function moneyForDistance(d){return Math.round((DELIVERY_BASE+d*DELIVERY_PER_100/100)*2)/2;}
function nearbyDeliveryAction(){
 if(drivingCar)return null; // A pé: é necessário sair do veículo antes de coletar/entregar.
 const place=currentWaypoint();if(!place)return null;
 return distanceTo(place)<=5.6 ? (mission.stage==='deliver'?'deliver':'pickup'):null;
}
function interactWorld(){
 const action=nearbyDeliveryAction();
 if(!action){
  const place=nearbyPlace();
  if(place){openActivity(place,actionsForPlace(place));return;}
  toggleVehicle();return;
 }
 if(action==='pickup'){
  const pickup=currentPickup();
  if(!pickup)return toast('Procure um restaurante marcado no mapa.');
  if(mission.completed>=10){openDeliveryOffers(pickup);return;}
  const target=chooseDeliveryTarget(pickup);
  if(!target){toast('Ainda não há destinos nesta região. Explore outros quarteirões.');return;}
  acceptDelivery(pickup,target,moneyForDistance(target.dist));
 }else{
  mission.wallet=Math.round((mission.wallet+mission.payment)*100)/100;
  mission.completed+=1;mission.lastTargetId=mission.target.id;
  const paid=mission.payment;
  mission.stage='pickup';mission.target=null;mission.pickup=null;mission.payment=0;
  saveProgress();
  toast(`Entrega concluída! +${moneyFormat.format(paid)} · Total: ${moneyFormat.format(mission.wallet)}`);
 }
 updateMissionUI(true);
}
function updateMissionUI(force=false){
 if(!force&&performance.now()-lastMissionUi<230)return;
 lastMissionUi=performance.now();
 const waypoint=currentWaypoint(),distance=waypoint?distanceTo(waypoint):null;
 const label=mission.stage==='deliver'?'ENTREGAR PEDIDO':'PROCURE UM RESTAURANTE 🍕';
 $('mission-title').textContent=label;
 $('mission-detail').textContent=mission.stage==='deliver'&&waypoint
  ?`${waypoint.name} · ${Math.round(distance)} m · ${moneyFormat.format(mission.payment)}`
  :'Escolha um restaurante no minimapa para pegar um pedido.';
 $('mission-wallet').textContent=`${moneyFormat.format(mission.wallet)} · ${mission.completed} entregas · ${mission.completed<10?`Reputação ${mission.completed}/10`:'Pedidos liberados ⭐'}`;
 if(!drivingCar){
  const action=nearbyDeliveryAction();
  if(action)$('interact').textContent=action==='pickup'?'COLETAR':'ENTREGAR';
 }
 if(deliveryMarker){
  deliveryMarker.visible=mission.stage==='deliver'&&!!waypoint;
  if(waypoint){deliveryMarker.position.set(waypoint.x,.25,waypoint.z);}
 }
}
function setupDeliveryMarkers(){
 deliveryArrow=new THREE.Group();
 const poly=new THREE.Shape();poly.moveTo(0,1.55);poly.lineTo(.85,-.55);poly.lineTo(0,-.20);poly.lineTo(-.85,-.55);poly.closePath();
 const head=new THREE.Mesh(new THREE.ShapeGeometry(poly),new THREE.MeshBasicMaterial({color:0xffea69,side:THREE.DoubleSide,depthTest:false}));
 head.rotation.x=-Math.PI/2;deliveryArrow.add(head);
 const ring=new THREE.Mesh(new THREE.RingGeometry(1.3,1.44,28),new THREE.MeshBasicMaterial({color:0xffeb81,side:THREE.DoubleSide,depthTest:false}));
 ring.rotation.x=-Math.PI/2;deliveryArrow.add(ring);deliveryArrow.renderOrder=800;
 scene.add(deliveryArrow);
 deliveryMarker=new THREE.Group();
 const circle=new THREE.Mesh(new THREE.TorusGeometry(1.9,.17,8,30),new THREE.MeshBasicMaterial({color:0xffdb5d}));
 circle.rotation.x=-Math.PI/2;deliveryMarker.add(circle);
 const prism=new THREE.Mesh(new THREE.CylinderGeometry(.7,.7,3.8,12,1,true),new THREE.MeshBasicMaterial({color:0xffd147,transparent:true,opacity:.16,side:THREE.DoubleSide,depthWrite:false}));
 prism.position.y=2;deliveryMarker.add(prism);scene.add(deliveryMarker);
}
function updateDeliveryIndicators(timestamp=0){
 const target=currentWaypoint();
 if(!deliveryArrow)return;
 deliveryArrow.visible=mission.stage==='deliver'&&!!target&&!gamePaused&&!activityOpen;
 deliveryMarker.visible=mission.stage==='deliver'&&!!target&&!gamePaused&&!activityOpen;
 if(!target||gamePaused)return;
 const dx=target.x-playerPos.x,dz=target.z-playerPos.z;
 const bearing=Math.atan2(-dx,-dz);
 deliveryArrow.position.set(playerPos.x,drivingCar?4.4:3.2,playerPos.z);
 deliveryArrow.rotation.y=bearing;
 deliveryArrow.position.y+=Math.sin(timestamp*.002)*.13;
 deliveryMarker.position.set(target.x,.15,target.z);
 deliveryMarker.rotation.y=timestamp*.00045;
 for(const chunk of chunks.values())for(const c of chunk.checkpoints||[]){
  // Checkpoints só brilham perto do jogador; sem overhead perceptível.
  c.gem.rotation.y=timestamp*.0013;
  c.gem.position.y=3.4+Math.sin(timestamp*.003)*.19;
 }
}

function isNight(){return timeHours>=18 || timeHours<6;}
function lampKey(x,z){return `${Math.round(x*10)},${Math.round(z*10)}`;}


const DIRS=[{dx:1,dz:0,angle:-Math.PI/2},{dx:0,dz:1,angle:Math.PI},{dx:-1,dz:0,angle:Math.PI/2},{dx:0,dz:-1,angle:0}];
let previousSafeX=ROAD/2,previousSafeZ=ROAD/2;
let fpsCounter = 0, fpsStart = performance.now(), lastMini = 0;

function showError(message) {
  $('loading').classList.add('hidden');
  $('error').hidden = false;
  $('error-message').textContent = message;
}
window.addEventListener('error', (e) => { if (e.message?.includes('WebGL')) showError(e.message); });
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2500);
}
function hashString(text) {
  let h = 2166136261;
  for (let i=0; i<text.length; i++) {h ^= text.charCodeAt(i); h = Math.imul(h,16777619);}
  return h >>> 0;
}
function hashInt(x, z, salt=0) {
  let h = seedHash ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}
function randAt(x, z, salt=0) {return hashInt(x, z, salt) / 4294967296;}
function seededRandom(state) {
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function mix(a,b,t) {return a + (b-a)*t;}
function smooth(t) {return t*t*(3-2*t);}
function valueNoise(x,z,scale,salt) {
  x /= scale; z /= scale;
  const ix = Math.floor(x), iz = Math.floor(z), tx=smooth(x-ix), tz=smooth(z-iz);
  return mix(mix(randAt(ix,iz,salt),randAt(ix+1,iz,salt),tx),
             mix(randAt(ix,iz+1,salt),randAt(ix+1,iz+1,salt),tx),tz);
}
// Mundo 1.3: uma cidade de porte semelhante à inicial em cada região.
// A malha geográfica é determinística: a mesma seed sempre gera as mesmas cidades.
// As estradas rurais existentes conectam a grade urbana à próxima cidade.
// Relevo sutil: somente nos lotes florestais, até 0,5m. Vias continuam planas.
function terrainHeight(x,z){
  if(!Number.isFinite(x)||!Number.isFinite(z)||districtAt(x,z)!=='Floresta')return 0;
  const localX=((x%CELL)+CELL)%CELL,localZ=((z%CELL)+CELL)%CELL;
  const border=Math.min(localX-ROAD,CELL-localX,localZ-ROAD,CELL-localZ);
  if(border<=0)return 0;
  const fade=THREE.MathUtils.smoothstep(border,0,4);
  const rough=.42*valueNoise(x,z,48,2789)+.16*valueNoise(x,z,19,2790);
  return Math.min(.50,Math.max(0,rough*fade));
}
function makeForestFloor(chunk,x0,z0){
  const start=x0+ROAD,end=x0+CELL,steps=12,verts=[],tri=[];
  for(let iz=0;iz<=steps;iz++)for(let ix=0;ix<=steps;ix++){
    const x=start+(end-start)*ix/steps,z=z0+ROAD+(CELL-ROAD)*iz/steps;
    verts.push(x,terrainHeight(x,z)+.077,z);
  }
  for(let iz=0;iz<steps;iz++)for(let ix=0;ix<steps;ix++){
    const a=iz*(steps+1)+ix,b=a+1,c=a+steps+1,d=c+1;
    tri.push(a,c,b,b,c,d);
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex(tri);geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,mats.grass);mesh.receiveShadow=true;mesh.material.side=THREE.DoubleSide;
  mesh.userData.forestFloor=true;chunk.group.add(mesh);
}
const CITY_REGION = 1200;
function districtAt(x,z) {
  const originDist=Math.hypot(x,z);
  const organic=(valueNoise(x,z,260,19)-.5)*128+(valueNoise(x,z,100,31)-.5)*45;
  // Preserva integralmente os limites e a aparência da cidade onde o jogador nasce.
  if(originDist<125+organic)return 'Centro';
  if(originDist<260+organic)return 'Bairro urbano';
  if(originDist<430+organic)return 'Bairro residencial';

  // Todas as regiões têm uma cidade completa, e não somente uma chance de vila.
  // Aproximadamente 1,2 km de jogo entre centros; carregamento continua por setores.
  const gx=Math.round(x/CITY_REGION),gz=Math.round(z/CITY_REGION);
  let cityDistance=Infinity;
  for(let rz=gz-1;rz<=gz+1;rz++)for(let rx=gx-1;rx<=gx+1;rx++){
    if(rx===0&&rz===0)continue;
    const px=rx*CITY_REGION+(randAt(rx,rz,190)-.5)*180;
    const pz=rz*CITY_REGION+(randAt(rx,rz,191)-.5)*180;
    cityDistance=Math.min(cityDistance,Math.hypot(x-px,z-pz));
  }
  const variation=(valueNoise(x,z,260,19)-.5)*128+(valueNoise(x,z,100,31)-.5)*45;
  if(cityDistance<125+variation)return 'Centro';
  if(cityDistance<260+variation)return 'Bairro urbano';
  if(cityDistance<430+variation)return 'Bairro residencial';

  // Vilarejos menores aparecem ocasionalmente nos intervalos entre as cidades.
  const vx=Math.round((x-CITY_REGION/2)/CITY_REGION);
  const vz=Math.round((z-CITY_REGION/2)/CITY_REGION);
  let villageDistance=Infinity;
  for(let rz=vz-1;rz<=vz+1;rz++)for(let rx=vx-1;rx<=vx+1;rx++){
    if(randAt(rx,rz,193)>.44)continue;
    const px=(rx+.5)*CITY_REGION+(randAt(rx,rz,194)-.5)*90;
    const pz=(rz+.5)*CITY_REGION+(randAt(rx,rz,195)-.5)*90;
    villageDistance=Math.min(villageDistance,Math.hypot(x-px,z-pz));
  }
  const jagged=(valueNoise(x,z,180,29)-.5)*50;
  if(villageDistance<115+jagged)return 'Vilarejo';
  if(villageDistance<160+jagged)return 'Bairro residencial';
  return 'Floresta';
}
const boxGeometry = new THREE.BoxGeometry(1,1,1);
const ballGeometry = new THREE.IcosahedronGeometry(1,1);
const coneGeometry = new THREE.ConeGeometry(1,1,6);
const pyramidGeometry = new THREE.ConeGeometry(1,1,4);
const cylinderGeometry = new THREE.CylinderGeometry(1,1,1,6);
const signGeometry = new THREE.PlaneGeometry(1,1);
// Geometrias de checkpoints compartilhadas para não acumular memória ao viajar entre cidades.
const checkpointRingGeometry=new THREE.TorusGeometry(1.28,.15,8,24);
const checkpointPillarGeometry=new THREE.CylinderGeometry(.53,.53,3.0,12,1,true);
const checkpointGemGeometry=new THREE.OctahedronGeometry(.55,0);
const checkpointRingMaterial=new THREE.MeshBasicMaterial({color:0x78ffe3});
const checkpointPillarMaterial=new THREE.MeshBasicMaterial({color:0x58f7be,transparent:true,opacity:.13,depthWrite:false,side:THREE.DoubleSide});
const checkpointGemMaterial=new THREE.MeshBasicMaterial({color:0xc6ffdd});

const mats = {
  asphalt: new THREE.MeshStandardMaterial({color:0x3d4c55, roughness:.93}),
  dirt: new THREE.MeshStandardMaterial({color:0x9f9f7a, roughness:1}),
  pavement: new THREE.MeshStandardMaterial({color:0xd8d5c7, roughness:1}),
  lawn: new THREE.MeshStandardMaterial({color:0x83b77e, roughness:1}),
  grass: new THREE.MeshStandardMaterial({color:0x60916b, roughness:1}),
  parking: new THREE.MeshStandardMaterial({color:0x777f80, roughness:1}),
  water: new THREE.MeshStandardMaterial({color:0x64b7c8, roughness:.2, metalness:.08}),
  materialWindow: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.29,metalness:.24}),
  windowLit: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.34,metalness:.1,emissive:0xffb85a,emissiveIntensity:0}),
  materialPaint: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9}),
  materialRoad: new THREE.MeshBasicMaterial({color:0xffffff}),
  materialLeaf: new THREE.MeshStandardMaterial({color:0xffffff,roughness:1,flatShading:true}),
  materialTrunk: new THREE.MeshStandardMaterial({color:0xffffff,roughness:1}),
  materialLight: new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xffdc9c,emissiveIntensity:0}),
  materialWheel: new THREE.MeshStandardMaterial({color:0x222e35,roughness:.96}),
  materialPole: new THREE.MeshStandardMaterial({color:0x3f5158,metalness:.15,roughness:.65}),
  door: new THREE.MeshStandardMaterial({color:0x755a4b,roughness:.85}),
  windowHouse: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.3,metalness:.2}),
  wallHouse: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9}),
  wallBuilding: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9}),
  wallStore: new THREE.MeshStandardMaterial({color:0xffffff,roughness:.9}),
  stone: new THREE.MeshStandardMaterial({color:0x9baaa1,roughness:1}),
  bench: new THREE.MeshStandardMaterial({color:0x93755a,roughness:.9}),
  roof: new THREE.MeshStandardMaterial({color:0x52616d,roughness:.95}),
  roofRed: new THREE.MeshStandardMaterial({color:0x9b584e,roughness:1}),
  roofBlue: new THREE.MeshStandardMaterial({color:0x4b6d83,roughness:1}),
  roofOrange: new THREE.MeshStandardMaterial({color:0x9e7750,roughness:1}),
  shadow: new THREE.MeshBasicMaterial({color:0x172a27,transparent:true,opacity:.17,depthWrite:false})
};
// Texturas editáveis: erro 404/arquivo vazio sempre mantém a cor procedural.
const TEXTURE_SLOTS = [
  ['txdGrama','grass'],['txdGramado','lawn'],['txdAsfalto','asphalt'],
  ['txdEstradaTerra','dirt'],['txdCalcada','pavement'],['txdEstacionamento','parking'],
  ['txdTroncoArvore','materialTrunk'],['txdCopaArvore','materialLeaf'],
  ['txdPedra','stone'],['txdParedeCasa','wallHouse'],
  ['txdParedePredio','wallBuilding'],['txdParedeLoja','wallStore'],
  ['txdPortaCasa','door'],['txdJanelaCasa','windowHouse'],
  ['txdJanelaPredio','materialWindow'],['txdJanelaIluminada','windowLit'],
  ['txdTelhado','roof'],['txdPoste','materialPole'],['txdBanco','bench'],
  ['txdFaixaRua','materialRoad'],['txdAgua','water']
];
// Repetição individual configurada em config.js. Evita NaN, zero e valores negativos.
function textureRepeat(configName,tex){
  const suffix=configName.slice(3); // txdAsfalto -> Asfalto
  const x=Number(CFG['repetirX'+suffix]);
  const y=Number(CFG['repetirY'+suffix]);
  const repeatX=Number.isFinite(x) && x>0?Math.min(x,512):1;
  const repeatY=Number.isFinite(y) && y>0?Math.min(y,512):1;
  tex.wrapS=THREE.RepeatWrapping;
  tex.wrapT=THREE.RepeatWrapping;
  tex.repeat.set(repeatX,repeatY);
  tex.needsUpdate=true;
}
function setupCustomTextures(){
  const loader=new THREE.TextureLoader();
  for(const [configName,matName] of TEXTURE_SLOTS){
    const path=String(CFG[configName]||'').trim();
    if(!path)continue;
    loader.load(path,tex=>{
      tex.colorSpace=THREE.SRGBColorSpace;
      textureRepeat(configName,tex);
      if(renderer)tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
      mats[matName].map=tex;
      // Mantém instancing e cor de cada casa/folha, mas permite textura visível.
      if(['wallHouse','wallBuilding','wallStore','stone','door','bench','asphalt','pavement','lawn','grass'].includes(matName)) mats[matName].color.setHex(0xffffff);
      mats[matName].needsUpdate=true;
      // Update colored façade materials that were already constructed.
      for(const [key,m] of customColorMats){
        if(key.startsWith(matName+':')){m.map=tex;m.needsUpdate=true;}
      }
    },undefined,()=>console.warn('[Texturas] Não foi possível carregar',path,'— cor padrão mantida.'));
  }
}
function coloredSurface(color,source){
  // Reutiliza material e textura, sem alterar a pintura dos veículos.
  const base=mats[source];
  const key=`${source}:${color}`;
  if(!customColorMats.has(key)){
    const clone=base.clone();clone.color.setHex(color);
    customColorMats.set(key,clone);
  }
  return customColorMats.get(key);
}
const customColorMats=new Map();
const towerColors = [0xb1bdc0,0xbbb7a7,0x82979c,0xc6baa6,0x8ea6a6,0xc2ccc3,0x909ca4,0xcab19a];
const houseColors = [0xf5dfbe,0xe0dfc9,0xe8c0a9,0xb5c6c1,0xdacbb1,0xe9ce9a,0xd9d6cf];
const shopColors = [0x5b918f,0x9f7467,0x7c91a0,0xe2b270,0xc38371];
const carColors = [0xc3e3d1,0xefd58c,0xc17a74,0x6a919c,0xd5dfeb,0x4a6476,0x9e8fbb];
const treeColors = [0x4c8761,0x347554,0x629c68,0x73a76e,0x4e8a76,0x779a59];
const colorMatCache = new Map();
function material(hex) {
  if(!colorMatCache.has(hex)) colorMatCache.set(hex,new THREE.MeshStandardMaterial({color:hex,roughness:.86,metalness:.01,flatShading:true}));
  return colorMatCache.get(hex);
}
function box(parent,x,y,z,w,h,d,mat=material(0xffffff),cast=false) {
  const mesh = new THREE.Mesh(boxGeometry, mat);
  mesh.position.set(x,y,z); mesh.scale.set(w,h,d); mesh.castShadow=cast;
  mesh.receiveShadow=true; parent.add(mesh); return mesh;
}
function choose(arr,r){
  const n=typeof r==='function'?r():r;
  return arr[Math.min(arr.length-1,Math.max(0,Math.floor((Number.isFinite(n)?n:0)*arr.length)))];
}

// Instancing: centenas de janelas, árvores e detalhes com poucas chamadas à GPU.
class Batch {
  constructor(group) {this.group=group; this.items=new Map();}
  put(type,geom,mat,x,y,z,sx,sy,sz,color=0xffffff,rotY=0) {
    if(!this.items.has(type)) this.items.set(type,{geom,mat,items:[]});
    this.items.get(type).items.push({x,y,z,sx,sy,sz,color,rotY});
  }
  build() {
    for (const {geom,mat,items} of this.items.values()) {
      if (!items.length) continue;
      const inst = new THREE.InstancedMesh(geom,mat,items.length);
      inst.frustumCulled=false;
      inst.castShadow = geom===ballGeometry||geom===coneGeometry||geom===cylinderGeometry;
      inst.receiveShadow = true;
      for(let i=0;i<items.length;i++){
        const a=items[i];
        tmpObj.position.set(a.x,a.y,a.z);
        tmpObj.rotation.set(0,a.rotY,0);
        tmpObj.scale.set(a.sx,a.sy,a.sz);
        tmpObj.updateMatrix(); inst.setMatrixAt(i,tmpObj.matrix);
        inst.setColorAt(i,tmpColor.setHex(a.color));
      }
      inst.instanceMatrix.needsUpdate = true;
      if(inst.instanceColor) inst.instanceColor.needsUpdate=true;
      this.group.add(inst);
    }
    this.items.clear();
  }
}
function inst(b,type,x,y,z,sx,sy,sz,color,rot=0) {
  let geom=boxGeometry, mat=mats.materialPaint;
  switch(type) {
    case 'window':mat=mats.materialWindow;break;
    case 'window-house':mat=mats.windowHouse;break;
    case 'lit-window':mat=mats.windowLit;break;
    case 'mark':mat=mats.materialRoad;break;
    case 'trunk':geom=cylinderGeometry;mat=mats.materialTrunk;break;
    case 'leaf':geom=ballGeometry;mat=mats.materialLeaf;break;
    case 'pine':geom=coneGeometry;mat=mats.materialLeaf;break;
    case 'pole':mat=mats.materialPole;break;
    case 'bulb':mat=mats.materialLight;break;
    case 'wheel':mat=mats.materialWheel;break;
  }
  b.put(type,geom,mat,x,y,z,sx,sy,sz,color,rot);
}
function tree(b,r,x,z,s=1,pine=false,chunk=null) {
  const h=(pine?4.4:3.3) * s;
  const ground=terrainHeight(x,z);
  const leaf=choose(treeColors,r);
  inst(b,'trunk',x,h*.45+ground,z,.23*s,h*.9,.23*s,0x735947);
  if(chunk)addCollider(chunk,x,z,.7*s,.7*s);
  if(pine){
    inst(b,'pine',x,h*1.18+ground,z,2.2*s,4.7*s,2.2*s,leaf);
    inst(b,'pine',x,h*1.5+ground,z,1.6*s,3.5*s,1.6*s,leaf);
  }else{
    inst(b,'leaf',x,h*1.04+ground,z,1.8*s,1.5*s,1.8*s,leaf);
    inst(b,'leaf',x+0.7*s,h*1.1+ground,z+.3*s,1.25*s,1.1*s,1.25*s,leaf);
  }
}
function addWindows(b,r,x,y,z,w,h,d,floors=3,office=false) {
  const step=office?3.1:2.6;
  const rows=Math.max(1,Math.min(24,Math.floor((h-2.2)/step)));
  const nx=Math.min(12,Math.max(2,Math.floor(w/(office?3:3.8))));
  const nz=Math.min(12,Math.max(2,Math.floor(d/(office?3:3.8))));
  for(let row=0;row<rows;row++){
    const wy=y-h/2+2.6+row*step;
    if(wy>y+h/2-.8)break;
    for(let j=0;j<nx;j++){
      const wx=x-w/2+w*(j+.5)/nx;
      for(const side of [-1,1]) {
        const lit=r()<(office?.19:.13);
        const c=lit?0xffdfa2:choose(office?[0x547b86,0x7ea4a8,0xacc4bf]:[0x60899a,0x8db5b5,0xb5cfcd],r);
        inst(b,lit?'lit-window':'window',wx,wy,z+side*(d/2+.085),.96,office?1.65:1.26,.09,c,0);
      }
    }
    for(let j=0;j<nz;j++){
      const wz=z-d/2+d*(j+.5)/nz;
      for(const side of [-1,1]) {
        const lit=r()<(office?.19:.13);
        const c=lit?0xffdfa2:choose(office?[0x547b86,0x7ea4a8,0xacc4bf]:[0x60899a,0x8db5b5,0xb5cfcd],r);
        inst(b,lit?'lit-window':'window',x+side*(w/2+.085),wy,wz,.09,office?1.65:1.26,.96,c,0);
      }
    }
  }
}
function addCollider(chunk,x,z,w,d) {
  if(![x,z,w,d].every(Number.isFinite))return null;
  const collider={minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2};
  chunk.colliders.push(collider);return collider;
}
function buildingShadow(group,x,z,w,d) { /* sombra real pelo sol */ }
function rooftopDetails(group,r,x,z,w,d,h) {
  const n=1+Math.floor(r()*3);
  for(let i=0;i<n;i++){
    box(group,x+(r()-.5)*w*.65,h+.65,z+(r()-.5)*d*.65,1.7+r()*2,1.3,1.4+r()*1.6,mats.roof);
  }
}
function tower(chunk,b,r,x,z,w,d,height) {
  const h=height;
  const color=choose(towerColors,r),wallType="wallBuilding";
  buildingShadow(chunk.group,x,z,w,d);
  box(chunk.group,x,h/2,z,w,h,d,coloredSurface(color,wallType),true);
  box(chunk.group,x,h+.18,z,w+.35,.38,d+.35,mats.roof);
  addWindows(b,r,x,h/2,z,w,h,d,undefined,true);
  if(r()>.42){
    box(chunk.group,x,h-1,z-d/2-.22,w*.78,1.2,.48,material(0x425c67));
  }
  rooftopDetails(chunk.group,r,x,z,w,d,h);
  addCollider(chunk,x,z,w,d);
  rememberDestination(x,z-d/2-2.4,'Prédio comercial','prédio');
  rememberProperty(chunk,x,z-d/2-2.4,'apartamento');
}
const signs = ['PADARIA','CAFÉ','MERCADO','SORVETES','FARMÁCIA','LIVRARIA','LOJAS','RESTAURANTE','OFICINA','FLORICULTURA'];
const foodSigns=['RESTAURANTE','LANCHONETE','PIZZARIA','PADARIA'];
const signCache=new Map();
function signMaterial(name,hex) {
  const key=`${name}-${hex}`;
  if(signCache.has(key))return signCache.get(key);
  const cv=document.createElement('canvas');cv.width=512;cv.height=128;
  const ctx=cv.getContext('2d');ctx.fillStyle='#'+hex.toString(16).padStart(6,'0');ctx.fillRect(0,0,512,128);
  ctx.fillStyle='#f9f4db';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold 51px sans-serif';ctx.fillText(name,256,67,480);
  ctx.fillStyle='#ffffffbb';ctx.fillRect(28,104,456,5);
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;
  const mat=new THREE.MeshBasicMaterial({map:tex,side:THREE.DoubleSide});
  signCache.set(key,mat);return mat;
}
function storefront(chunk,b,r,x,z,w,d,forcedBusiness=null) {
  const h=4.8+r()*2.1;
  const color=choose(shopColors,r),wallType="wallStore";
  buildingShadow(chunk.group,x,z,w,d);
  box(chunk.group,x,h/2,z,w,h,d,coloredSurface(color,wallType),true);
  box(chunk.group,x,h+.2,z,w+.8,.4,d+.8,mats.roof);
  inst(b,'window',x,2,z-d/2-.1,w*.72,2.4,.11,0x8bc3c9,0);
  box(chunk.group,x,3.45,z-d/2-.5,w*.85,.28,.8,material(0xf7dfb1));
  const cellX=Math.floor(x/CELL),cellZ=Math.floor(z/CELL);
  const forced=(cellX===1&&cellZ===1);
  const sign=forcedBusiness || (forced?'RESTAURANTE':(cellX===2&&cellZ===1)?'OFICINA':(cellX===1&&cellZ===2)?'LOJAS':randAt(cellX,cellZ,410)>.47
    ?foodSigns[Math.floor(randAt(cellX,cellZ,411)*foodSigns.length)]
    :choose(signs,r));
  const sm=new THREE.Mesh(signGeometry,signMaterial(sign,color));
  sm.scale.set(w*.75,1.38,1);sm.position.set(x,h-.95,z-d/2-.14);sm.rotation.y=Math.PI;
  chunk.group.add(sm);
  box(chunk.group,x,h+.5,z,1.2,.6,1.2,mats.roof);
  addCollider(chunk,x,z,w,d);
  if(foodSigns.includes(sign))rememberRestaurant(chunk,x,z-d/2-2.35,sign);
  if(sign==='OFICINA')rememberService(chunk,'oficina',x,z-d/2-2.35,sign);
  if(sign==='LOJAS')rememberService(chunk,'lojas',x,z-d/2-2.35,sign);
}
function home(chunk,b,r,x,z,w,d,scale=1) {
  const h=(4.4+r()*1.2)*scale;
  const color=choose(houseColors,r),wallType="wallHouse";
  buildingShadow(chunk.group,x,z,w,d);
  box(chunk.group,x,h/2,z,w,h,d,coloredSurface(color,wallType),true);
  const roofMat=CFG.txdTelhado ? mats.roof : choose([mats.roofRed,mats.roofBlue,mats.roofOrange,mats.roof],r);
  const roof=new THREE.Mesh(pyramidGeometry,roofMat);
  roof.position.set(x,h+1.45*scale,z);
  roof.scale.set((w+1.5)/Math.SQRT2,2.9*scale,(d+1.5)/Math.SQRT2);
  roof.rotation.y=Math.PI/4;
  chunk.group.add(roof);
  // Fachada voltada para a rua: porta, varanda e janelas.
  box(chunk.group,x,1.38*scale,z-d/2-.12,1.3*scale,2.7*scale,.14,mats.door);
  inst(b,'window-house',x-w*.26,h*.55,z-d/2-.13,2.0*scale,1.65*scale,.11,0x81b7c2,0);
  inst(b,'window-house',x+w*.26,h*.55,z-d/2-.13,2.0*scale,1.65*scale,.11,0x81b7c2,0);
  inst(b,'window-house',x-w/2-.12,h*.55,z,.16,1.5*scale,2*scale,0xa5c9ce);
  inst(b,'window-house',x+w/2+.12,h*.55,z,.16,1.5*scale,2*scale,0xa5c9ce);
  addCollider(chunk,x,z,w,d);
  rememberDestination(x,z-d/2-2.3,'Casa residencial','casa');
  rememberProperty(chunk,x,z-d/2-2.3,'casa');
}
const carHeadlightMat=new THREE.MeshStandardMaterial({color:0xfff2c7,emissive:0xffe6ad,emissiveIntensity:.06});
const carTailMat=new THREE.MeshStandardMaterial({color:0xc44c44,emissive:0xff2020,emissiveIntensity:.05});
function makeCarAgent(index,kindOverride=null) {
  const rng=seededRandom(hashInt(index*53,17,index+13001));
  const group=new THREE.Group();
  const kind=kindOverride===null?Math.floor(rng()*4):kindOverride; // hatch, sedã, SUV, van
  const paint=new THREE.MeshStandardMaterial({color:choose(carColors,rng),roughness:.6,metalness:.12});
  const dark=material(0x263c46), glass=material(0x628d99);
  const chrome=material(0xc5cbcc), tail=carTailMat;
  const fullLength=[3.7,4.65,4.45,4.75][kind];
  const bodyHeight=[.77,.78,1.04,1.14][kind];
  const cabinHeight=[.68,.75,.83,1.12][kind];
  const wheelBase=fullLength*.31;
  // Local -Z é a dianteira: os detalhes acompanham a rotação do veículo.
  box(group,0,.74,0,1.92,bodyHeight,fullLength,paint,true);
  box(group,0,1.15+bodyHeight*.2,kind===0?.2:kind===1?.36:-.04,1.67,cabinHeight,fullLength*(kind===3?.68:.51),glass,true);
  // Teto na cor do carro, para a cabine não parecer um bloco de vidro.
  box(group,0,1.15+bodyHeight*.2+cabinHeight/2,kind===0?.2:kind===1?.36:-.04,1.73,.12,fullLength*(kind===3?.69:.52),paint,true);
  // Para-brisa, vidro traseiro, grade dianteira e para-choques.
  box(group,0,1.24,-fullLength*.255,1.53,.42,.045,glass);
  box(group,0,.84,-fullLength/2-.065,1.42,.27,.10,dark);
  box(group,0,.59,-fullLength/2-.12,1.78,.14,.17,chrome);
  box(group,0,.59,fullLength/2+.12,1.78,.14,.17,dark);
  box(group,0,1.0,fullLength/2+.04,1.5,.18,.06,tail);
  // Faróis e lanternas como materiais emissivos de baixo custo.
  const headlight=carHeadlightMat;
  for(const side of [-1,1]){
    box(group,side*.73,.98,-fullLength/2-.093,.37,.18,.045,headlight);
    box(group,side*.71,.98,fullLength/2+.095,.35,.17,.05,tail);
    box(group,side*1.04,1.33,-fullLength*.22,.23,.12,.27,dark); // retrovisores
    for(const dz of [-wheelBase,wheelBase]){
      const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.43,.43,.23,12),mats.materialWheel);
      wheel.rotation.z=Math.PI/2;wheel.position.set(side*1.02,.43,dz);wheel.castShadow=true;group.add(wheel);
      const rim=new THREE.Mesh(new THREE.CylinderGeometry(.23,.23,.245,10),chrome);
      rim.rotation.z=Math.PI/2;rim.position.set(side*1.025,.43,dz);group.add(rim);
    }
  }
  group.visible=false;
  scene.add(group);
  return {group,rng,paintMaterial:paint,paintHex:`#${paint.color.getHexString()}`,ix:0,iz:0,dir:0,nextDir:0,prevDir:0,p:0,speed:(5.5+rng()*3.5)*TRAFFIC_SPEED_MULT,halfWidth:1.08,halfLength:fullLength/2,index,occupied:false,parked:false};
}
function chooseCarDirection(agent,ix,iz,dir) {
  // A maioria segue reto; nas esquinas os carros podem virar, nunca dar meia-volta.
  const r=agent.rng();
  let proposed=r<.62?dir:r<.81?(dir+1)%4:(dir+3)%4;
  const nx=ix+DIRS[proposed].dx,nz=iz+DIRS[proposed].dz;
  if(districtAt(nx*CELL+ROAD/2,nz*CELL+ROAD/2)==='Floresta'){
    proposed=(dir+1)%4;
    if(districtAt((ix+DIRS[proposed].dx)*CELL,(iz+DIRS[proposed].dz)*CELL)==='Floresta') proposed=(dir+3)%4;
  }
  return proposed;
}
// Carros aparecem no entorno IMEDIATO do jogador (antes: espalhados por 11x11 quarteirões).
// Uma parcela fica estacionada junto ao meio-fio para ser fácil entrar e dirigir.
function spawnCar(agent,aroundX,aroundZ) {
  if(agent.occupied)return;
  agent.group.visible=false;
  const baseX=Math.floor(aroundX/CELL),baseZ=Math.floor(aroundZ/CELL);
  const parkedSlot=agent.index%5===0;
  for(let tries=0;tries<70;tries++){
    let ix=baseX+Math.floor(agent.rng()*5)-2;
    let iz=baseZ+Math.floor(agent.rng()*5)-2;
    if(tries<32){ix=baseX+Math.floor(agent.rng()*3)-1;iz=baseZ+Math.floor(agent.rng()*3)-1;}
    // O primeiro automóvel estacionado fica sempre acessível perto do ponto de spawn.
    if(agent.index===0 && Math.hypot(aroundX-ROAD/2,aroundZ-ROAD/2)<8){ix=0;iz=0;}
    if(districtAt(ix*CELL+CELL/2,iz*CELL+CELL/2)==='Floresta')continue;
    agent.ix=ix;agent.iz=iz;
    agent.dir=(agent.index===0 && ix===0 && iz===0)?3:Math.floor(agent.rng()*4);
    agent.prevDir=agent.dir;
    agent.nextDir=chooseCarDirection(agent,ix+DIRS[agent.dir].dx,iz+DIRS[agent.dir].dz,agent.dir);
    agent.p=parkedSlot?(agent.index===0&&ix===0&&iz===0?14:16+agent.rng()*9):7+agent.rng()*(CELL-14);
    agent.speed=(4.7+agent.rng()*4)*TRAFFIC_SPEED_MULT;
    positionCar(agent);
    if(parkedSlot){
      // Meio-fio: faixa lateral, fora do cruzamento.
      agent.group.position.x+=-DIRS[agent.dir].dz*1.25;
      agent.group.position.z+= DIRS[agent.dir].dx*1.25;
    }
    const distance=Math.hypot(agent.group.position.x-aroundX,agent.group.position.z-aroundZ);
    if(distance<(parkedSlot?8:9) ||
       carAgents.some(a=>a!==agent && a.group.visible && Math.hypot(a.group.position.x-agent.group.position.x,a.group.position.z-agent.group.position.z)<5.6)){
      agent.group.visible=false;continue;
    }
    agent.parked=parkedSlot;
    return;
  }
  agent.group.visible=false;
}
function positionCar(a) {
  const T=7, dir=DIRS[a.dir], prev=DIRS[a.prevDir], next=DIRS[a.nextDir];
  const ax=a.ix*CELL+ROAD/2,az=a.iz*CELL+ROAD/2;
  let x=ax+dir.dx*a.p,z=az+dir.dz*a.p,tx=dir.dx,tz=dir.dz;
  // Curva de Bézier entre as faixas. Uma metade antes da esquina e outra depois.
  let entry=null;
  if(a.p<T && a.prevDir!==a.dir){entry={bx:ax,bz:az,d0:prev,d1:dir,t:(a.p+T)/(2*T)};}
  else if(a.p>CELL-T && a.nextDir!==a.dir){entry={bx:ax+dir.dx*CELL,bz:az+dir.dz*CELL,d0:dir,d1:next,t:(a.p-(CELL-T))/(2*T)};}
  if(entry){
    const {bx,bz,d0,d1,t}=entry,u=1-t;
    x=u*u*(bx-d0.dx*T)+2*u*t*bx+t*t*(bx+d1.dx*T);
    z=u*u*(bz-d0.dz*T)+2*u*t*bz+t*t*(bz+d1.dz*T);
    tx=u*d0.dx+t*d1.dx;tz=u*d0.dz+t*d1.dz;
  }
  const len=Math.hypot(tx,tz)||1;tx/=len;tz/=len;
  // Trânsito pela faixa direita, respeitando a largura da rua.
  x += -tz*1.55; z += tx*1.55;
  a.group.position.set(x,0,z);
  a.group.rotation.y=Math.atan2(-tx,-tz);
  a.group.visible=true;
}
function updateCars(dt){
  for(const a of carAgents){
    if(a.isOwned||a.occupied)continue;
    if(!carEnabled(a)){a.group.visible=false;continue;}
    const distance=Math.hypot(a.group.position.x-playerPos.x,a.group.position.z-playerPos.z);
    if(!a.group.visible || distance>CHUNK_SIZE*(radius+.45))spawnCar(a,playerPos.x,playerPos.z);
    if(!a.group.visible)continue;
    if(a.parked)continue;
    const d=Math.hypot(a.group.position.x-playerPos.x,a.group.position.z-playerPos.z);
    if(d<3.8)continue; // Trânsito para perto do jogador.
    a.p+=a.speed*dt;
    if(a.p>=CELL){
      a.p-=CELL;
      a.ix+=DIRS[a.dir].dx;a.iz+=DIRS[a.dir].dz;
      a.prevDir=a.dir;a.dir=a.nextDir;
      a.nextDir=chooseCarDirection(a,a.ix+DIRS[a.dir].dx,a.iz+DIRS[a.dir].dz,a.dir);
    }
    if(districtAt(a.ix*CELL+CELL/2,a.iz*CELL+CELL/2)==='Floresta'){
      spawnCar(a,playerPos.x,playerPos.z);continue;
    }
    positionCar(a);
  }
}

// Calçadas: cada NPC segue um trajeto fechado em volta de um quarteirão.
// Os pontos ficam FORA da faixa de rodagem (ROAD=9) e das fachadas.
function sidewalkPath(cx,cz){
  const x=cx*CELL,z=cz*CELL;
  return [
    {x:x+ROAD+2.7,z:z+ROAD+.65},
    {x:x+CELL-2.5,z:z+ROAD+.65},
    {x:x+CELL-2.5,z:z+CELL-2.5},
    {x:x+ROAD+.65,z:z+CELL-2.5},
    {x:x+ROAD+.65,z:z+ROAD+3.5}
  ];
}
function makePedestrian(index){
  const r=seededRandom(hashInt(index*119,36,918));
  const group=new THREE.Group();
  const skin=material(choose([0xefc0a0,0xe7ab88,0xba7d5e,0x895840,0xe4b28e],r));
  const clothes=material(choose([0x4b7c8b,0x983f48,0x397d58,0xa9854e,0x7d69a0,0xb8c9ba],r));
  const pants=material(choose([0x304050,0x303d3a,0x575359,0x778c9c],r));
  const shoes=material(0x303338);
  box(group,0,1.52,0,.7,.91,.42,clothes,true);
  box(group,0,2.19,0,.48,.52,.48,skin,true);
  box(group,0,2.46,-.035,.51,.13,.50,material(choose([0x3e3634,0x4c3630,0x754c30,0xe0d4a5],r)),true);
  // Olhos discretos voltados para -Z (mesma orientação do rosto do jogador).
  const eyes=material(0x1d2530);
  box(group,-.125,2.215,-.252,.065,.065,.035,eyes);
  box(group,.125,2.215,-.252,.065,.065,.035,eyes);
  const limbs={};
  for(const side of [-1,1]){
    const leg=new THREE.Group();leg.position.set(side*.19,1.07,0);
    box(leg,0,-.43,0,.28,.86,.31,pants,true);
    box(leg,0,-.91,-.07,.32,.18,.49,shoes,true);
    const arm=new THREE.Group();arm.position.set(side*.5,1.88,0);
    box(arm,0,-.36,0,.24,.72,.3,clothes,true);
    box(arm,0,-.75,0,.22,.23,.26,skin,true);
    group.add(leg,arm);
    if(side<0){limbs.leftLeg=leg;limbs.leftArm=arm;}
    else {limbs.rightLeg=leg;limbs.rightArm=arm;}
  }
  group.visible=false;scene.add(group);
  return {index,rng:r,group,limbs,path:[],waypoint:1,step:1,speed:1.2+r()*.8,walk:r()*TAU,cellX:0,cellZ:0,respawnIn:0,stuckTime:0};
}
function spawnPedestrian(p,aroundX,aroundZ){
  const baseX=Math.floor(aroundX/CELL),baseZ=Math.floor(aroundZ/CELL);
  for(let tries=0;tries<60;tries++){
    // 3x3 quarteirões próximos primeiro; ao longe só depois de várias tentativas.
    const reach=tries<48?1:2;
    const cx=baseX+Math.floor(p.rng()*(reach*2+1))-reach;
    const cz=baseZ+Math.floor(p.rng()*(reach*2+1))-reach;
    if(districtAt(cx*CELL+CELL/2,cz*CELL+CELL/2)==='Floresta')continue;
    const path=sidewalkPath(cx,cz),index=Math.floor(p.rng()*path.length);
    const a=path[index],b=path[(index+1)%path.length],t=.2+p.rng()*.5;
    const x=mix(a.x,b.x,t),z=mix(a.z,b.z,t);
    if(!canMove(x,z,false,false,false))continue;
    if(Math.hypot(x-playerPos.x,z-playerPos.z)<6)continue;
    if(pedestrians.some(o=>o!==p&&o.group.visible&&Math.hypot(x-o.group.position.x,z-o.group.position.z)<2))continue;
    p.cellX=cx;p.cellZ=cz;p.path=path;p.step=1;p.waypoint=(index+1)%path.length;
    p.group.position.set(x,0,z);p.group.visible=true;p.stuckTime=0;
    return;
  }
  p.group.visible=false;p.respawnIn=1.5+p.rng()*1.5;
}
function updatePedestrians(dt){
  for(const p of pedestrians){
    const g=p.group;
    if(!pedEnabled(p)){g.visible=false;continue;}
    if(!g.visible||Math.hypot(g.position.x-playerPos.x,g.position.z-playerPos.z)>CHUNK_SIZE*(radius+.15)){
      if(p.respawnIn>0){p.respawnIn-=dt;continue;}
      spawnPedestrian(p,playerPos.x,playerPos.z);
      if(!g.visible)continue;
    }
    if(Math.hypot(g.position.x-playerPos.x,g.position.z-playerPos.z)<1.25&&!drivingCar)continue;
    const target=p.path[p.waypoint];if(!target)continue;
    const dx=target.x-g.position.x,dz=target.z-g.position.z;
    const dist=Math.hypot(dx,dz);
    if(dist<.24){p.waypoint=(p.waypoint+p.step+p.path.length)%p.path.length;continue;}
    const vx=dx/dist,vz=dz/dist,step=Math.min(dist,p.speed*dt);
    const nx=g.position.x+vx*step,nz=g.position.z+vz*step;
    if(!canMove(nx,nz,false,false,false)){
      // Se uma árvore bloquear o caminho, muda o sentido; se persistir, reaparece em outro trecho.
      p.step*=-1;
      p.waypoint=(p.waypoint+p.step+p.path.length)%p.path.length;
      p.stuckTime+=dt;
      if(p.stuckTime>2.5){p.group.visible=false;p.respawnIn=.15;p.stuckTime=0;}
      continue;
    }
    // Somente calçada: nunca perseguimos o player e não atravessamos a pista.
    g.position.x=nx;g.position.z=nz;p.stuckTime=0;
    const angle=Math.atan2(-vx,-vz);
    const turn=Math.atan2(Math.sin(angle-g.rotation.y),Math.cos(angle-g.rotation.y));
    g.rotation.y+=turn*(1-Math.exp(-dt*10));
    p.walk+=dt*9;
    const swing=Math.sin(p.walk)*.47;
    p.limbs.leftLeg.rotation.x=swing;p.limbs.rightLeg.rotation.x=-swing;
    p.limbs.leftArm.rotation.x=-swing*.7;p.limbs.rightArm.rotation.x=swing*.7;
  }
}
function updatePopulation(){
  for(const a of carAgents){
    if(a.isOwned)continue;
    if(carEnabled(a)){
      if(!a.occupied && !a.group.visible)spawnCar(a,playerPos.x,playerPos.z);
    }else a.group.visible=false;
  }
  for(const p of pedestrians){
    if(pedEnabled(p)){
      if(!p.group.visible){p.respawnIn=0;spawnPedestrian(p,playerPos.x,playerPos.z);}
    }else p.group.visible=false;
  }
  if($('traffic-value'))$('traffic-value').textContent=`${trafficDensity}% · ${desiredCars()} carros`;
  if($('ped-value'))$('ped-value').textContent=`${pedestrianDensity}% · ${desiredPeds()} pedestres`;
}

function nearbyDriveableCar(maxDistance=8.5){
  let best=null,bestDist=maxDistance;
  for(const car of carAgents){
    if(!car.group.visible || car.occupied)continue;
    const d=Math.hypot(car.group.position.x-playerPos.x,car.group.position.z-playerPos.z);
    if(d<bestDist){best=car;bestDist=d;}
  }
  return best;
}
function toggleVehicle(){
  if(drivingCar){
    const car=drivingCar,angle=car.group.rotation.y;
    // Primeiro tenta sair pelo lado do motorista; depois pelo lado oposto.
    for(const side of [-1,1]){
      const x=car.group.position.x+side*2.7*Math.cos(angle);
      const z=car.group.position.z-side*2.7*Math.sin(angle);
      if(canMove(x,z,true)){
        car.occupied=false;car.parked=true;drivingCar=null;vehicleSpeed=0;resetCameraFollow(false);
        playerPos.set(x,terrainHeight(x,z),z);previousSafeX=x;previousSafeZ=z;
        playerGroup.position.set(x,0,z);playerGroup.visible=true;
        $('sprint').innerHTML='CORRER <b>»</b>';
        $('interact').textContent='ENTRAR';
        toast('Você saiu do veículo.');
        return;
      }
    }
    toast('Não há espaço seguro para sair. Mova o carro.');
    return;
  }
  const car=nearbyDriveableCar();
  if(!car){toast('Aproxime-se de um carro para dirigir.');return;}
  drivingCar=car;car.occupied=true;car.parked=false;resetCameraFollow(false);
  vehicleSpeed=0;
  playerGroup.visible=false;
  playerPos.set(car.group.position.x,car.group.position.y,car.group.position.z);
  previousSafeX=playerPos.x;previousSafeZ=playerPos.z;
  cam.distance=Math.max(cam.distance,8.8);
  $('sprint').textContent='FREIO';$('interact').textContent='SAIR';
  toast('Dirigindo! W/S aceleram ou dão ré; A/D viram; E sai.');
}
// SAT: retângulos orientados com as dimensões REAIS do carro, sem a margem
// do jogador. Reduz a falsa colisão quando dois carros passam lado a lado.
function carRectangle(x,z,yaw,halfW,halfL){
  const c=Math.cos(yaw),s=Math.sin(yaw);
  return {x,z,axes:[[c,-s],[s,c]],h:[halfW,halfL]};
}
function rectanglesOverlap(a,b){
  const dx=b.x-a.x,dz=b.z-a.z;
  for(const axis of [...a.axes,...b.axes]){
    const [ux,uz]=axis;
    const center=Math.abs(dx*ux+dz*uz);
    let ra=0,rb=0;
    for(let i=0;i<2;i++){
      ra+=a.h[i]*Math.abs(a.axes[i][0]*ux+a.axes[i][1]*uz);
      rb+=b.h[i]*Math.abs(b.axes[i][0]*ux+b.axes[i][1]*uz);
    }
    if(center>=ra+rb-.035)return false;
  }
  return true;
}
function vehicleCanAdvance(car,x,z,ignoreCar=null,allowBreakage=true){
  const my=carRectangle(x,z,car.group.rotation.y,car.halfWidth,car.halfLength);
  const cx=Math.floor(x/CHUNK_SIZE),cz=Math.floor(z/CHUNK_SIZE);
  const breakable=[];
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
    const ch=chunks.get((cx+dx)+','+(cz+dz));if(!ch)continue;
    for(const c of ch.colliders){
      const target=carRectangle((c.minX+c.maxX)/2,(c.minZ+c.maxZ)/2,0,(c.maxX-c.minX)/2,(c.maxZ-c.minZ)/2);
      if(!rectanglesOverlap(my,target))continue;
      if(c.type==='lamp'){breakable.push(c.lamp);continue;}
      return false;
    }
  }
  for(const p of pedestrians){
    if(!p.group.visible)continue;
    const dx=p.group.position.x-x,dz=p.group.position.z-z;
    const localX=dx*Math.cos(car.group.rotation.y)-dz*Math.sin(car.group.rotation.y);
    const localZ=dx*Math.sin(car.group.rotation.y)+dz*Math.cos(car.group.rotation.y);
    if(Math.abs(localX)<car.halfWidth+.3 && Math.abs(localZ)<car.halfLength+.3)return false;
  }
  for(const other of carAgents){
    if(other===car||other===ignoreCar||!other.group.visible)continue;
    if(Math.hypot(other.group.position.x-x,other.group.position.z-z)>car.halfLength+other.halfLength+1)continue;
    const target=carRectangle(other.group.position.x,other.group.position.z,other.group.rotation.y,other.halfWidth,other.halfLength);
    if(rectanglesOverlap(my,target))return false;
  }
  if(allowBreakage)for(const lamp of breakable)breakLamp(lamp);
  return true;
}
function driveVehicle(dt){
  const car=drivingCar;
  let throttle=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)-movementTouch.y;
  let steering=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)+movementTouch.x;
  throttle=THREE.MathUtils.clamp(throttle,-1,1);
  steering=THREE.MathUtils.clamp(steering,-1,1);
  const brake=keys.has('Space')||movementTouch.running;
  if(brake)vehicleSpeed*=Math.exp(-dt*7);
  else if(Math.abs(throttle)>.08)vehicleSpeed+=throttle*(vehicleSpeed*throttle<0?24:13)*dt;
  else vehicleSpeed*=Math.exp(-dt*1.35);
  const ownedModel=drivingCar?.isOwned?CAR_CATALOG.find(c=>c.id===drivingCar.catalogId):null;
  vehicleSpeed=THREE.MathUtils.clamp(vehicleSpeed,-9,DRIVING_MAX_SPEED*(ownedModel?.speed||1));
  if(Math.abs(vehicleSpeed)<.025)vehicleSpeed=0;
  if(Math.abs(vehicleSpeed)>.08)car.group.rotation.y-=steering*dt*1.4*Math.sign(vehicleSpeed)*(.24+.76*Math.min(1,Math.abs(vehicleSpeed)/9));
  const yaw=car.group.rotation.y;
  const x=car.group.position.x-Math.sin(yaw)*vehicleSpeed*dt;
  const z=car.group.position.z-Math.cos(yaw)*vehicleSpeed*dt;
  const total=Math.hypot(x-car.group.position.x,z-car.group.position.z);
  const steps=Math.max(1,Math.ceil(total/.55));
  const startX=car.group.position.x,startZ=car.group.position.z;
  let blocked=false;
  for(let step=1;step<=steps;step++){
    const nx=startX+(x-startX)*step/steps,nz=startZ+(z-startZ)*step/steps;
    if(!vehicleCanAdvance(car,nx,nz)){blocked=true;break;}
    car.group.position.set(nx,terrainHeight(nx,nz),nz);
  }
  if(blocked){vehicleSpeed=0;movementStatus.block='veículo / obstáculo';}
  else movementStatus.block='não';
  playerPos.set(car.group.position.x,car.group.position.y,car.group.position.z);
  previousSafeX=playerPos.x;previousSafeZ=playerPos.z;
  movementStatus.delta=dt;
  movementStatus.input=`Acel:${throttle.toFixed(1)} Direção:${steering.toFixed(1)}`;
}

function lamp(b,x,z,chunk=null){
  if(!chunk)return;
  const pivot=new THREE.Group();pivot.position.set(x,0,z);
  const pole=box(pivot,0,2.45,0,.14,4.9,.14,mats.materialPole,true);
  box(pivot,.55,4.82,0,.99,.14,.15,mats.materialPole,true);
  box(pivot,1.02,4.76,0,.45,.15,.45,mats.materialLight);
  chunk.group.add(pivot);
  const lampObj={x,z,pivot,chunk,broken:brokenLampKeys.has(lampKey(x,z)),tilt:0};
  if(!chunk.lamps)chunk.lamps=[];
  chunk.lamps.push(lampObj);
  if(lampObj.broken){lampObj.tilt=1.54;pivot.rotation.z=1.54;}
  else{const collider=addCollider(chunk,x,z,.24,.24);collider.type='lamp';collider.lamp=lampObj;lampObj.collider=collider;}
}
function breakLamp(lampObj){
  if(!lampObj || lampObj.broken)return;
  lampObj.broken=true;
  brokenLampKeys.add(lampKey(lampObj.x,lampObj.z));
  const arr=lampObj.chunk.colliders;
  const i=arr.indexOf(lampObj.collider);
  if(i>=0)arr.splice(i,1);
  toast('Poste derrubado!');
}
function updateBrokenLamps(dt){
  for(const chunk of chunks.values())for(const l of chunk.lamps||[]){
    if(l.broken && l.tilt<1.53){
      l.tilt=Math.min(1.54,l.tilt+dt*2.5);
      l.pivot.rotation.z=l.tilt;
    }
  }
}
function bench(chunk,x,z,r) {
  addCollider(chunk,x,z,2.2,1);
  const m=mats.bench;
  box(chunk.group,x,.83,z,2.1,.24,.65,m);
  box(chunk.group,x,1.32,z+.35,2.1,.9,.17,m);
  box(chunk.group,x-.75,.43,z,.17,.65,.64,m);
  box(chunk.group,x+.75,.43,z,.17,.65,.64,m);
}
function park(chunk,b,r,x0,z0,size) {
  const cx=x0+ROAD+(CELL-ROAD)/2,cz=z0+ROAD+(CELL-ROAD)/2;
  box(chunk.group,cx,.07,cz,CELL-ROAD-1,.11,CELL-ROAD-1,mats.lawn);
  // Trilha central em praça urbana.
  box(chunk.group,cx,.14,cz,CELL-ROAD-2,.045,2,mats.pavement);
  box(chunk.group,cx,.14,cz,2,.045,CELL-ROAD-2,mats.pavement);
  const amount=5+Math.floor(r()*7);
  for(let i=0;i<amount;i++){
    const tx=cx+(r()-.5)*29,tz=cz+(r()-.5)*29;
    if(Math.abs(tx-cx)<2.7||Math.abs(tz-cz)<2.7)continue;
    if(Math.hypot(tx-(cx-7),tz-(cz-4))<3.8||Math.hypot(tx-(cx+6),tz-(cz+6))<3.8)continue;
    tree(b,r,tx,tz,.75+r()*.45,r()>.65,chunk);
  }
  bench(chunk,cx-7,cz-4,r);bench(chunk,cx+6,cz+6,r);
  if(r()>.5){
    const pool=new THREE.Mesh(new THREE.CircleGeometry(3.3,18),mats.water);
    pool.rotation.x=-Math.PI/2;pool.position.set(cx+8,.18,cz-8);chunk.group.add(pool);
  }
}
function forest(chunk,b,r,x0,z0) {
  const cx=x0+ROAD+(CELL-ROAD)/2,cz=z0+ROAD+(CELL-ROAD)/2;
  makeForestFloor(chunk,x0,z0);
  const density=12+Math.floor(r()*11);
  const positions=[];
  for(let i=0;i<density*3 && positions.length<density;i++){
    const x=x0+ROAD+1+r()*(CELL-ROAD-2), z=z0+ROAD+1+r()*(CELL-ROAD-2);
    if(positions.some(p=>Math.hypot(p.x-x,p.z-z)<3)) continue;
    positions.push({x,z});tree(b,r,x,z,.67+r()*.85,r()>.45,chunk);
  }
  if(r()>.72){ // Pedras e pequenas clareiras.
    for(let i=0;i<4;i++){
      const px=cx+(r()-.5)*27,pz=cz+(r()-.5)*27,pw=.8+r()*1.3,pd=.8+r()*1.5;
      if(!chunk.colliders.some(c=>px>c.minX-1&&px<c.maxX+1&&pz>c.minZ-1&&pz<c.maxZ+1)){
        box(chunk.group,px,.23+terrainHeight(px,pz),pz,pw,.5,pd,mats.stone);
        addCollider(chunk,px,pz,pw,pd);
      }
    }
  }
}
function residential(chunk,b,r,x0,z0,mixed=false) {
  const sx=x0+ROAD+1.5, sz=z0+ROAD+1.5, plot=CELL-ROAD-3;
  box(chunk.group,sx+plot/2,.10,sz+plot/2,plot,.12,plot,mats.lawn);
  if(mixed && r()>.55){
    home(chunk,b,r,sx+plot*.27,sz+plot*.53,10,11,.79);
    home(chunk,b,r,sx+plot*.75,sz+plot*.53,10,11,.79);
  }else{
    const w=12+r()*7,d=12+r()*6;
    home(chunk,b,r,sx+plot/2,sz+plot/2,w,d,1);
    // Entrada e caminho para a calçada.
    box(chunk.group,sx+plot/2,.22,sz+2,2.5,.04,7,mats.pavement);
    if(r()>.4)box(chunk.group,sx+plot-3,.22,sz+2,5.3,.04,7,mats.parking);
  }
  for(let i=0;i<3;i++){
    const tx=sx+2+(i%2)*(plot-4),tz=sz+4+Math.floor(i/2)*(plot-9);
    if(!chunk.colliders.some(c=>tx>c.minX-2&&tx<c.maxX+2&&tz>c.minZ-2&&tz<c.maxZ+2))
      tree(b,r,tx,tz,.45+r()*.25,r()>.8,chunk);
  }
}
function cityLot(chunk,b,r,x0,z0,zone) {
  const decision=r();
  const cx=x0+ROAD+(CELL-ROAD)/2,cz=z0+ROAD+(CELL-ROAD)/2;
  // Nas outras cidades, as oficinas e lojas antes dependiam apenas de sorteio.
  // Agora cada cidade regional possui UMA oficina e UMA loja em lotes fixos
  // derivados da seed, perto do centro. A cidade inicial mantém os seus.
  const regionX=Math.round((x0+CELL/2)/CITY_REGION);
  const regionZ=Math.round((z0+CELL/2)/CITY_REGION);
  if(regionX!==0 || regionZ!==0){
    const cityX=regionX*CITY_REGION+(randAt(regionX,regionZ,190)-.5)*180;
    const cityZ=regionZ*CITY_REGION+(randAt(regionX,regionZ,191)-.5)*180;
    const coreX=Math.floor(cityX/CELL),coreZ=Math.floor(cityZ/CELL);
    const lotX=Math.floor(x0/CELL),lotZ=Math.floor(z0/CELL);
    if(lotX===coreX+1 && lotZ===coreZ){storefront(chunk,b,r,cx,cz,21,19,'OFICINA');return;}
    if(lotX===coreX && lotZ===coreZ+1){storefront(chunk,b,r,cx,cz,21,19,'LOJAS');return;}
  }
  // Garante pelo menos um ponto de trabalho a poucos quarteirões do spawn.
  if((x0===CELL&&z0===CELL)||(x0===2*CELL&&z0===CELL)||(x0===CELL&&z0===2*CELL)){storefront(chunk,b,r,cx,cz,21,19);return;}
  if(zone==='Floresta') {
    if(decision<.84)forest(chunk,b,r,x0,z0);
    else if(decision<.96)residential(chunk,b,r,x0,z0,false);
    else park(chunk,b,r,x0,z0);
    return;
  }
  if((zone==='Centro'&&decision<.11)||(zone==='Bairro urbano'&&decision<.13)||(zone==='Bairro residencial'&&decision<.15)){
    park(chunk,b,r,x0,z0);return;
  }
  if(zone==='Centro'){
    if(decision<.79){tower(chunk,b,r,cx+(r()-.5)*3,cz+(r()-.5)*3,17+r()*9,16+r()*10,22+r()*58);}
    else storefront(chunk,b,r,cx,cz,21+r()*5,17+r()*8);
  }else if(zone==='Bairro urbano'){
    if(decision<.45) tower(chunk,b,r,cx,cz,18+r()*9,18+r()*9,11+r()*25);
    else if(decision<.72) storefront(chunk,b,r,cx,cz,18+r()*9,17+r()*8);
    else residential(chunk,b,r,x0,z0,true);
  }else if(zone==='Vilarejo'){
    if(decision<.3)storefront(chunk,b,r,cx,cz,16+r()*8,13+r()*6);
    else residential(chunk,b,r,x0,z0,true);
  }else{
    if(decision<.2) storefront(chunk,b,r,cx,cz,17+r()*8,15+r()*8);
    else residential(chunk,b,r,x0,z0,false);
  }
}
function roadAndDetails(chunk,b,r,x0,z0,zone,cx,cz){
  const wood=zone==='Floresta';
  // Estradas rurais em grade a cada três quarteirões conectam os núcleos urbanos.
  const showX=!wood || ((cx%3+3)%3===0), showZ=!wood || ((cz%3+3)%3===0);
  // Faixas viárias formam uma malha contínua entre chunks.
  if(showX) box(chunk.group,x0+ROAD/2,.013,z0+CELL/2,ROAD,.045,CELL,wood?mats.dirt:mats.asphalt);
  if(showZ) box(chunk.group,x0+CELL/2,.014,z0+ROAD/2,CELL,.045,ROAD,wood?mats.dirt:mats.asphalt);
  if(!wood){
    // Calçada elevada em torno de cada lote, abaixo dos edifícios.
    box(chunk.group,x0+(CELL+ROAD)/2,.027,z0+(CELL+ROAD)/2,CELL-ROAD,.053,CELL-ROAD,mats.pavement);
    for(let i=0;i<2;i++){
      inst(b,'mark',x0+ROAD/2,.048,z0+ROAD+10+i*14,.13,.01,3.6,0xf8e3b7);
      inst(b,'mark',x0+ROAD+10+i*14,.049,z0+ROAD/2,3.6,.01,.13,0xf8e3b7);
    }
    if((cx+cz)%2===0){
      for(let i=0;i<5;i++){
        inst(b,'mark',x0+1+i*1.7,.065,z0+ROAD+2,1.05,.01,1.9,0xe7ede5);
        inst(b,'mark',x0+ROAD+2,.066,z0+1+i*1.7,1.9,.01,1.05,0xe7ede5);
      }
    }
    lamp(b,x0+ROAD+1.1,z0+ROAD+1.1,chunk);
    // Árvores nas ruas residenciais.
    if(zone==='Bairro residencial'){
      tree(b,r,x0+ROAD+2,z0+CELL-3,.65,false,chunk);
      tree(b,r,x0+CELL-3,z0+ROAD+2,.65,false,chunk);
    }
  }
}
function createChunk(ix,iz){
  const chunk={group:new THREE.Group(),colliders:[],lamps:[],checkpoints:[],restaurants:[],services:[],properties:[],propertyMarkers:[],x:ix,z:iz};
  const b=new Batch(chunk.group);
  for(let dz=0;dz<CELLS_PER_CHUNK;dz++){
    for(let dx=0;dx<CELLS_PER_CHUNK;dx++){
      const cx=ix*CELLS_PER_CHUNK+dx,cz=iz*CELLS_PER_CHUNK+dz;
      const x0=cx*CELL,z0=cz*CELL;
      const r=seededRandom(hashInt(cx,cz,777));
      const zone=districtAt(x0+CELL/2,z0+CELL/2);
      roadAndDetails(chunk,b,r,x0,z0,zone,cx,cz);
      cityLot(chunk,b,r,x0,z0,zone);
    }
  }
  b.build(); scene.add(chunk.group); return chunk;
}
function updateChunks(force=false){
  if(!Number.isFinite(playerPos.x)||!Number.isFinite(playerPos.z))return;
  const cx=Math.floor(playerPos.x/CHUNK_SIZE),cz=Math.floor(playerPos.z/CHUNK_SIZE);
  if(!force && cx===lastChunkX && cz===lastChunkZ)return;
  lastChunkX=cx;lastChunkZ=cz;
  const required=new Set();
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
    const x=cx+dx,z=cz+dz,k=x+','+z; required.add(k);
    if(!chunks.has(k))chunks.set(k,createChunk(x,z));
  }
  for(const [k,chunk] of chunks){if(!required.has(k)){
    chunk.group.traverse(o=>{if(o.userData.forestFloor)o.geometry.dispose();});
    scene.remove(chunk.group);chunks.delete(k);
  }}

}
function canMove(x,z,includeCars=true,trace=false,includePed=true){
  if(!Number.isFinite(x)||!Number.isFinite(z)) {
    if(trace) movementStatus.block='coordenada inválida';
    return false;
  }
  const padding=.54;
  const chX=Math.floor(x/CHUNK_SIZE),chZ=Math.floor(z/CHUNK_SIZE);
  for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
    const ch=chunks.get((chX+dx)+','+(chZ+dz));
    if(!ch)continue;
    for(const c of ch.colliders)if(x>c.minX-padding&&x<c.maxX+padding&&z>c.minZ-padding&&z<c.maxZ+padding){
      if(trace) movementStatus.block='objeto / construção';
      return false;
    }
  }
  if(includePed)for(const p of pedestrians){
    if(!p.group.visible)continue;
    if(Math.hypot(x-p.group.position.x,z-p.group.position.z)<.72){
      if(trace) movementStatus.block='pedestre';
      return false;
    }
  }
  if(includeCars)for(const a of carAgents){
    if(!a.group.visible||a===drivingCar)continue;
    const dx=x-a.group.position.x,dz=z-a.group.position.z;
    const sy=Math.sin(a.group.rotation.y),cy=Math.cos(a.group.rotation.y);
    // Colisão orientada segundo a rotação real de cada carro.
    const localX=dx*cy-dz*sy,localZ=dx*sy+dz*cy;
    if(Math.abs(localX)<1.55 && Math.abs(localZ)<2.55){
      if(trace) movementStatus.block='veículo';
      return false;
    }
  }
  return true;
}

function makePlayer(){
  playerGroup = new THREE.Group();
  const skin=material(0xe6ad83), clothes=new THREE.MeshStandardMaterial({color:0x415f80}),
    pants=new THREE.MeshStandardMaterial({color:0x2b3a52}),cap=new THREE.MeshStandardMaterial({color:0xd4e5b0}),
    shoes=new THREE.MeshStandardMaterial({color:0x252d3c});
  Object.assign(playerVisualMats,{shirt:clothes,pants,cap,shoes});
  // Boneco low-poly com articulações animadas.
  box(playerGroup,0,1.52,0,.74,.95,.42,clothes,true);
  box(playerGroup,0,2.2,0,.48,.52,.48,skin,true);
  box(playerGroup,0,2.48,-.035,.54,.15,.52,cap,true);
  box(playerGroup,0,2.44,-.28,.59,.05,.3,cap);
  box(playerGroup,-.12,2.25,-.25,.055,.05,.03,material(0x25323b));
  box(playerGroup,.12,2.25,-.25,.055,.05,.03,material(0x25323b));
  leftLeg=new THREE.Group();rightLeg=new THREE.Group();
  leftLeg.position.set(-.2,1.06,0);rightLeg.position.set(.2,1.06,0);
  box(leftLeg,0,-.43,0,.29,.87,.33,pants,true);
  box(rightLeg,0,-.43,0,.29,.87,.33,pants,true);
  box(leftLeg,0,-.91,-.07,.34,.18,.52,shoes,true);
  box(rightLeg,0,-.91,-.07,.34,.18,.52,shoes,true);
  leftArm=new THREE.Group();rightArm=new THREE.Group();
  leftArm.position.set(-.53,1.87,0);rightArm.position.set(.53,1.87,0);
  box(leftArm,0,-.38,0,.24,.75,.32,clothes,true);
  box(rightArm,0,-.38,0,.24,.75,.32,clothes,true);
  box(leftArm,0,-.76,0,.22,.24,.27,skin,true);
  box(rightArm,0,-.76,0,.22,.24,.27,skin,true);
  playerGroup.add(leftLeg,rightLeg,leftArm,rightArm);
  applyOutfit();
  playerGroup.position.copy(playerPos);
  scene.add(playerGroup);
}
// Skybox panorâmico 360° em uma esfera: texturas geradas localmente e upload opcional.
function rgb(hex){const c=new THREE.Color(hex);return [Math.round(c.r*255),Math.round(c.g*255),Math.round(c.b*255)];}
function skyColor(hex){return '#'+hex.toString(16).padStart(6,'0');}
function drawSkyTexture(){
  if(skyUpload) return;
  const canvas=skyCanvas,ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height;
  const daylight=Math.max(0,Math.sin((timeHours-6)/12*Math.PI));
  const twilight=Math.max(0,1-Math.abs(timeHours-6)/2.4,1-Math.abs(timeHours-18)/2.4);
  const night=1-daylight;
  const presets={claro:[0x448ac8,0x97cbe8,0xf3dfbc],nublado:[0x607989,0xabb8c0,0xd6d9d5],rosa:[0x43447f,0xc2748c,0xffcb93],estrelado:[0x090e29,0x1e2c50,0x4c5374]};
  const pal=presets[skyPreset]||presets.claro;
  const top=new THREE.Color(0x070d21).lerp(new THREE.Color(pal[0]),skyPreset==='estrelado'?.18:daylight*.94+twilight*.4);
  const middle=new THREE.Color(0x162646).lerp(new THREE.Color(pal[1]),skyPreset==='estrelado'?.12:daylight*.85+twilight*.48);
  const low=new THREE.Color(0x334463).lerp(new THREE.Color(pal[2]),skyPreset==='estrelado'?.15:daylight*.75+twilight*.62);
  const gradient=ctx.createLinearGradient(0,0,0,h);
  gradient.addColorStop(0,'#'+top.getHexString());gradient.addColorStop(.42,'#'+middle.getHexString());
  gradient.addColorStop(.68,'#'+low.getHexString());gradient.addColorStop(1,'#'+middle.getHexString());
  ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  // Nuvens em várias camadas; padronização por seed para um céu repetível.
  const r=seededRandom(hashInt(945,231,skyPreset.length*41));
  ctx.save();
  const cloudAlpha=skyPreset==='estrelado'?.035:skyPreset==='nublado'?.40:.25;
  for(let i=0;i<(skyPreset==='nublado'?125:80);i++){
    const cx=r()*w,cy=h*(.2+r()*.55),width=28+r()*108;
    ctx.globalAlpha=cloudAlpha*(.35+r()*.65)*(daylight*.6+twilight*.3+.1);
    const gr=ctx.createRadialGradient(cx,cy,0,cx,cy,width);
    gr.addColorStop(0,'rgba(255,255,255,.8)');gr.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=gr;ctx.save();ctx.translate(cx,cy);ctx.scale(1,.28+r()*.2);
    ctx.beginPath();ctx.arc(0,0,width,0,TAU);ctx.fill();ctx.restore();
  }
  ctx.restore();
  // Estrelas visíveis à noite.
  if(night>.38||skyPreset==='estrelado'){
    ctx.fillStyle='#f3f5ff';
    for(let i=0;i<420;i++){
      ctx.globalAlpha=(skyPreset==='estrelado'?.83:Math.max(0,(night-.38)*1.25))*(.25+r()*.75);
      ctx.beginPath();ctx.arc(r()*w,r()*h*.56,.35+r()*.95,0,TAU);ctx.fill();
    }
    ctx.globalAlpha=1;
  }
  skyTexture.needsUpdate=true;
}
function setupSky(){
  skyCanvas=document.createElement('canvas');skyCanvas.width=1024;skyCanvas.height=512;
  skyTexture=new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace=THREE.SRGBColorSpace;
  skyMesh=new THREE.Mesh(new THREE.SphereGeometry(490,36,18),new THREE.MeshBasicMaterial({map:skyTexture,side:THREE.BackSide,depthWrite:false,fog:false}));
  skyMesh.renderOrder=-2;skyMesh.frustumCulled=false;scene.add(skyMesh);
  drawSkyTexture();
}
function changeSkyTexture(texture){
  skyMesh.material.map=texture;
  skyMesh.material.needsUpdate=true;
  // O céu procedural já muda com o relógio. Imagens personalizadas
  // recebem um filtro de luminosidade para acompanhar o mesmo ciclo.
  updateCustomSkyBrightness();
}
function updateCustomSkyBrightness(){
  if(!skyMesh || !skyMesh.material)return;
  if(!skyUpload){const factor=1-.25*weatherWet;skyMesh.material.color.setRGB(factor,factor,factor);return;}
  // Transições graduais: amanhecer 05:00–07:00, entardecer 17:00–19:00.
  // À noite, reduzimos também o canal vermelho para um céu mais azulado.
  const morning=THREE.MathUtils.smoothstep(timeHours,5,7);
  const evening=1-THREE.MathUtils.smoothstep(timeHours,17,19);
  const day=Math.min(morning,evening);
  const nightBrightness=Number.isFinite(CFG.brilhoCeuNoturno)
    ? THREE.MathUtils.clamp(CFG.brilhoCeuNoturno,.02,1) : .12;
  const red=THREE.MathUtils.lerp(nightBrightness*.72,1,day);
  const green=THREE.MathUtils.lerp(nightBrightness*.86,1,day);
  const blue=THREE.MathUtils.lerp(nightBrightness*1.18,1,day);
  const cover=1-.32*weatherWet;skyMesh.material.color.setRGB(red*cover,green*cover,blue*cover);
}
function timeLabel(h){
  const hours=((Math.floor(h)%24)+24)%24,minutes=Math.floor((h%1)*60);
  return String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0');
}
function updateLighting(dt){
  if(timeFlow)timeHours=(timeHours+dt*.06)%24; // 1 dia ~ 6m40s
  const altitude=Math.sin((timeHours-6)/12*Math.PI);
  const strength=Math.max(0,altitude);
  const dark=THREE.MathUtils.smoothstep(strength,.015,.29);
  const theta=sunDirection*Math.PI/180;
  sun.position.set(playerPos.x+Math.cos(theta)*125,Math.max(18,Math.abs(altitude)*140),playerPos.z+Math.sin(theta)*125);
  sun.target.position.set(playerPos.x,0,playerPos.z);sun.target.updateMatrixWorld();
  const overcast=weatherWet;
  sun.intensity=(.03+2.65*dark)*(1-.52*overcast);
  hemi.intensity=(.14+1.7*dark)*(1-.18*overcast);
  mats.windowLit.emissiveIntensity=2.35*(1-dark);
  mats.materialLight.emissiveIntensity=3.4*(1-dark);
  for(const light of lightPool)light.intensity=(1-dark)*11;
  headlightsOn=isNight();
  carHeadlightMat.emissiveIntensity=headlightsOn?4.7:.05;
  carTailMat.emissiveIntensity=headlightsOn?2.2:.04;
  renderer.toneMappingExposure=.84+.48*dark;
  updateCustomSkyBrightness();
  const c=new THREE.Color(0x151d32).lerp(new THREE.Color(0xa5c3c0),dark);
  if(skyPreset==='rosa')c.lerp(new THREE.Color(0xb5909d),.20);
  if(weatherWet>0)c.lerp(new THREE.Color(0x79868b),.34*weatherWet);
  scene.fog.color.copy(c);scene.background.copy(c);
  scene.fog.near=THREE.MathUtils.lerp(mobile?110:140,18,weatherFog);
  scene.fog.far=THREE.MathUtils.lerp(mobile?295:360,88,weatherFog);
  const bucket=Math.floor(timeHours*4);
  if(bucket!==lastSkyBucket){lastSkyBucket=bucket;drawSkyTexture();}
  $('clock-time').textContent=timeLabel(timeHours);
  if(timeFlow)$('hours').value=String(timeHours);
}
function updateStreetLights(){
  const nearby=[];
  for(const chunk of chunks.values())for(const l of chunk.lamps||[]){
    if(l.broken)continue;
    const d=(l.x-playerPos.x)**2+(l.z-playerPos.z)**2;
    nearby.push({l,d});
  }
  nearby.sort((a,b)=>a.d-b.d);
  for(let i=0;i<lightPool.length;i++){
    const light=lightPool[i],lamp=nearby[i]?.l;
    light.visible=!!lamp;
    if(lamp)light.position.set(lamp.x+1.02,4.65,lamp.z);
  }
}
function updateHeadlights(){
  if(!headlightsOn){for(const pair of headlightPool)pair.spot.visible=false;return;}
  const candidates=carAgents.filter(c=>c.group.visible).map(c=>({c,d:(c.group.position.x-playerPos.x)**2+(c.group.position.z-playerPos.z)**2}));
  candidates.sort((a,b)=>(a.c===drivingCar?-999999:a.d)-(b.c===drivingCar?-999999:b.d));
  for(let i=0;i<headlightPool.length;i++){
    const unit=headlightPool[i],car=candidates[i]?.c;
    if(!car){unit.spot.visible=false;continue;}
    const yaw=car.group.rotation.y,fwX=-Math.sin(yaw),fwZ=-Math.cos(yaw);
    const px=car.group.position.x+fwX*(car.halfLength+.08),pz=car.group.position.z+fwZ*(car.halfLength+.08);
    unit.spot.position.set(px,1.02,pz);
    unit.target.position.set(px+fwX*18,.1,pz+fwZ*18);
    unit.target.updateMatrixWorld();
    unit.spot.visible=true;
  }
}
function initScene() {
  renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:!mobile,alpha:false,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.3:1.7));
  renderer.setSize(window.innerWidth,window.innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.35;
  scene=new THREE.Scene();
  scene.background=new THREE.Color(0xc0e0e8);
  scene.fog=new THREE.Fog(0xc0e0e8,mobile?110:140,mobile?295:360);
  camera=new THREE.PerspectiveCamera(68,window.innerWidth/window.innerHeight,.06,660);
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  hemi=new THREE.HemisphereLight(0xd5ebff,0x738e73,1.8);
  scene.add(hemi);
  sun=new THREE.DirectionalLight(0xffebca,2.55);
  sun.castShadow=true;sun.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);
  sun.shadow.camera.left=-86;sun.shadow.camera.right=86;
  sun.shadow.camera.top=86;sun.shadow.camera.bottom=-86;
  sun.shadow.camera.near=1;sun.shadow.camera.far=370;
  sun.shadow.bias=-.00015;sun.shadow.normalBias=.065;
  scene.add(sun,sun.target);
  for(let i=0;i<(mobile?4:9);i++){
    const p=new THREE.PointLight(0xffd29b,0,13,1.7);
    lightPool.push(p);scene.add(p);
  }
  for(let i=0;i<(mobile?2:5);i++){
    const target=new THREE.Object3D();scene.add(target);
    const spot=new THREE.SpotLight(0xfff2ce,115,40,Math.PI/6,.5,1.15);
    spot.target=target;spot.castShadow=false;spot.visible=false;
    scene.add(spot);headlightPool.push({spot,target});
  }
  setupSky();
  setupRain();
  setupCustomTextures();
  const customSky=String(CFG.txdCeu||'').trim();
  if(customSky){
    new THREE.TextureLoader().load(customSky,tex=>{
      tex.colorSpace=THREE.SRGBColorSpace;
      textureRepeat('txdCeu',tex);
      skyUpload=tex;changeSkyTexture(tex);
    },undefined,()=>console.warn('[Texturas] Céu não encontrado:',customSky,'— céu procedural mantido.'));
  }
  terrain=new THREE.Mesh(new THREE.PlaneGeometry(2200,2200),mats.grass);
  terrain.rotation.x=-Math.PI/2;terrain.position.y=-.11;terrain.receiveShadow=true;scene.add(terrain);
  makePlayer();
  setupDeliveryMarkers();
  for(let i=0;i<CAR_LIMIT;i++)carAgents.push(makeCarAgent(i));
  for(let i=0;i<PED_LIMIT;i++)pedestrians.push(makePedestrian(i));
  updateLighting(0);
  window.addEventListener('resize',()=>{
    renderer.setPixelRatio(Math.min(devicePixelRatio,mobile?1.3:1.7));
    renderer.setSize(window.innerWidth,window.innerHeight);
    camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();
  });
}
function cleanChunks(){
  for(const chunk of chunks.values()){
    chunk.group.traverse((obj)=>{if(obj.isInstancedMesh && typeof obj.dispose==='function')obj.dispose();});
    chunk.group.traverse(o=>{if(o.userData.forestFloor)o.geometry.dispose();});
    scene.remove(chunk.group);
  }
  chunks.clear();lastChunkX=null;lastChunkZ=null;
}
function setSeed(nextSeed,showMessage=true){
  const clean=String(nextSeed||'').trim().slice(0,48)||'CLT-2026';
  seedString=clean;seedHash=hashString(clean);
  if(devCar){scene.remove(devCar.group);const di=carAgents.indexOf(devCar);if(di>=0)carAgents.splice(di,1);devCar=null;}
  deliveryOffers=[];$('delivery-modal').hidden=true;
  brokenLampKeys.clear();
  knownRestaurants.clear();knownDestinations.clear();knownWorkshops.clear();knownClothingStores.clear();knownProperties.clear();
  if(garageVehicle){scene.remove(garageVehicle.group);const ix=carAgents.indexOf(garageVehicle);if(ix>=0)carAgents.splice(ix,1);garageVehicle=null;}
  Object.keys(propertyStates).forEach(k=>delete propertyStates[k]);
  lastSkyBucket=-1;
  $('seed').value=clean;
  try { const url=new URL(window.location.href);url.searchParams.set('seed',clean);window.history.replaceState({},'',url); } catch{}
  cleanChunks();
  if(drivingCar){drivingCar.occupied=false;drivingCar=null;vehicleSpeed=0;}
  playerGroup.visible=true;
  $('sprint').innerHTML='CORRER <b>»</b>';
  $('interact').textContent='ENTRAR';
  playerPos.set(ROAD/2,0,ROAD/2);
  previousSafeX=playerPos.x;previousSafeZ=playerPos.z;
  playerGroup.position.copy(playerPos); playerGroup.rotation.y=0;
  cam.yaw=.6;cam.pitch=.35;cam.distance=6.6;resetCameraFollow(false);
  placeCamera(true);
  updateChunks(true);
  carAgents.forEach(a=>{
    a.rng=seededRandom(hashInt(a.index*53,17,a.index+13001));
    a.parked=false;a.occupied=false;a.group.visible=false;
  });
  pedestrians.forEach(p=>{
    p.rng=seededRandom(hashInt(p.index*119,36,918));
    p.respawnIn=0;p.group.visible=false;
  });
  updatePopulation();
  restoreSeedProgress();
  updateHUD();updateMinimap();
  if(showMessage)toast(`Mundo carregado! Seed: ${clean}`);
}
function placeCamera(instant=false,dt=0.016){
  if(!Number.isFinite(cam.yaw)||!Number.isFinite(cam.pitch)||!Number.isFinite(cam.distance)){
    cam.yaw=.6;cam.pitch=.35;cam.distance=6.6;
  }
  const distance=cam.distance * Math.cos(cam.pitch);
  const height=(drivingCar?2.2:1.5) + cam.distance*Math.sin(cam.pitch);
  const desired=new THREE.Vector3(
    playerPos.x+Math.sin(cam.yaw)*distance,
    height+playerPos.y,
    playerPos.z+Math.cos(cam.yaw)*distance
  );
  // A câmera se aproxima quando uma construção bloqueia a visão.
  for(let f=1;f>=.35;f-=.12){
    const x=playerPos.x+(desired.x-playerPos.x)*f;
    const z=playerPos.z+(desired.z-playerPos.z)*f;
    if(!canMove(x,z,false)){
      const amount=Math.max(.25,f-.15);
      desired.x=playerPos.x+(desired.x-playerPos.x)*amount;
      desired.z=playerPos.z+(desired.z-playerPos.z)*amount;
      break;
    }
  }
  if(instant)camera.position.copy(desired);
  else camera.position.lerp(desired,1-Math.exp(-dt*9));
  smoothTarget.set(playerPos.x,(drivingCar?1.5:1.45)+playerPos.y,playerPos.z);
  camera.lookAt(smoothTarget);
}
function move(delta){
  if(drivingCar){driveVehicle(delta);return;}
  let inputX=0,inputY=0;
  if(keys.has('KeyW')||keys.has('ArrowUp'))inputY+=1;
  if(keys.has('KeyS')||keys.has('ArrowDown'))inputY-=1;
  if(keys.has('KeyD')||keys.has('ArrowRight'))inputX+=1;
  if(keys.has('KeyA')||keys.has('ArrowLeft'))inputX-=1;
  inputX+=movementTouch.x;inputY-=movementTouch.y;
  movementStatus.delta=delta;
  movementStatus.input=(Math.abs(inputX)>.05||Math.abs(inputY)>.05)
    ? `X:${inputX.toFixed(1)} Y:${inputY.toFixed(1)}` : 'nenhum';
  movementStatus.block='não';
  if(!Number.isFinite(inputX)||!Number.isFinite(inputY)){
    movementTouch.x=0;movementTouch.y=0;inputX=0;inputY=0;
  }
  const mag=Math.hypot(inputX,inputY);
  if(mag>.05){
    const normalized=Math.max(1,mag);
    inputX/=normalized;inputY/=normalized;
    const controlsYaw=camFollow.active && camFollow.controlYaw!==null?camFollow.controlYaw:cam.yaw;
    const fx=-Math.sin(controlsYaw),fz=-Math.cos(controlsYaw);
    const rx=Math.cos(controlsYaw),rz=-Math.sin(controlsYaw);
    const vx=fx*inputY+rx*inputX, vz=fz*inputY+rz*inputX;
    const speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')||movementTouch.running)?11.4:6.0;
    const dx=vx*speed*delta,dz=vz*speed*delta;
    if(!Number.isFinite(dx)||!Number.isFinite(dz))return;
    // Dois testes separados permitem deslizar junto das paredes.
    if(canMove(playerPos.x+dx,playerPos.z,true,true))playerPos.x+=dx;
    if(canMove(playerPos.x,playerPos.z+dz,true,true))playerPos.z+=dz;
    const targetAngle=Math.atan2(-vx,-vz);
    const turn=Math.atan2(Math.sin(targetAngle-playerGroup.rotation.y),Math.cos(targetAngle-playerGroup.rotation.y));
    playerGroup.rotation.y+=turn*(1-Math.exp(-delta*14));
    walkTime+=delta*(speed>7?14:9)*Math.min(mag,1);
    const swing=Math.sin(walkTime)*.58*Math.min(mag,1);
    leftLeg.rotation.x=swing;rightLeg.rotation.x=-swing;
    leftArm.rotation.x=-swing*.65;rightArm.rotation.x=swing*.65;
    walkBob=Math.abs(Math.sin(walkTime))*.045;
  }else{
    leftLeg.rotation.x*=Math.exp(-delta*10);rightLeg.rotation.x*=Math.exp(-delta*10);
    leftArm.rotation.x*=Math.exp(-delta*10);rightArm.rotation.x*=Math.exp(-delta*10);
    walkBob*=Math.exp(-delta*10);
  }
  if(!Number.isFinite(playerPos.x)||!Number.isFinite(playerPos.z)){
    playerPos.set(previousSafeX,0,previousSafeZ);
    movementTouch.x=movementTouch.y=0;keys.clear();
    toast('Movimento inválido detectado; posição recuperada.');
  }else{previousSafeX=playerPos.x;previousSafeZ=playerPos.z;}
  playerPos.y=terrainHeight(playerPos.x,playerPos.z);
  playerGroup.position.x=playerPos.x;playerGroup.position.z=playerPos.z;
  playerGroup.position.y=playerPos.y+walkBob;
}
function updateHUD(){
  // Fora do menu, apenas coordenadas discretas, minimapa e controles essenciais.
  $('coordinates').textContent=`X ${playerPos.x.toFixed(1)} · Y ${playerPos.y.toFixed(1)} · Z ${playerPos.z.toFixed(1)}`;
  const nearby=nearbyDriveableCar(),action=nearbyDeliveryAction();
  const place=nearbyPlace();
  $('interact').textContent=drivingCar?'SAIR':action==='pickup'?'COLETAR':action==='deliver'?'ENTREGAR':place?.serviceKind==='oficina'?'OFICINA':place?.serviceKind==='lojas'?'LOJA':place?.serviceKind==='imovel'?(propertyOwned(place)?'CASA':'COMPRAR'):nearby?'ENTRAR':'AÇÃO';
  $('interact').classList.toggle('available',!!drivingCar||!!nearby||!!action||!!place);
  $('vehicle-action').textContent=drivingCar?'SAIR 🚗':nearby?'ENTRAR 🚗':'CARRO 🚗';
  $('vehicle-action').classList.toggle('available',!!drivingCar||!!nearby);
  updateMissionUI();
}
function drawCityMap(canvas,centerX,centerZ,s,rotating=false,includePlayer=true){
 const ctx=canvas.getContext('2d');if(!ctx)return;
 const w=canvas.width,h=canvas.height;
 const rotation=rotating?(drivingCar?drivingCar.group.rotation.y:playerGroup.rotation.y):0;
 ctx.save();ctx.clearRect(0,0,w,h);ctx.fillStyle='#9fbd98';ctx.fillRect(0,0,w,h);
 ctx.translate(w/2,h/2);ctx.rotate(rotation);
 // Desenha apenas o quadrado necessário mesmo quando o mapa gira.
 const span=Math.hypot(w,h)/(2*s),left=Math.floor((centerX-span)/CELL)-1,top=Math.floor((centerZ-span)/CELL)-1;
 const right=Math.ceil((centerX+span)/CELL)+1,bottom=Math.ceil((centerZ+span)/CELL)+1;
 for(let cz=top;cz<=bottom;cz++)for(let cx=left;cx<=right;cx++){
  const x0=cx*CELL,z0=cz*CELL,x=(x0-centerX)*s,y=(z0-centerZ)*s;
  const zone=districtAt(x0+CELL/2,z0+CELL/2),wood=zone==='Floresta';
  ctx.fillStyle=`#${WORLD_COLORS[zone].toString(16).padStart(6,'0')}`;
  ctx.fillRect(x,y,CELL*s+1,CELL*s+1);
  ctx.fillStyle=wood?'#879d77':'#55666b';
  if(!wood||((cx%3+3)%3===0))ctx.fillRect(x,y,ROAD*s,CELL*s+.5);
  if(!wood||((cz%3+3)%3===0))ctx.fillRect(x,y,CELL*s+.5,ROAD*s);
  const b=randAt(cx,cz,233);ctx.fillStyle=wood?'#387451':'#6c7d7e';
  if(wood){for(let j=0;j<3;j++){
   const xx=x+(ROAD+3+randAt(cx,cz,j+555)*23)*s, yy=y+(ROAD+3+randAt(cx,cz,j+666)*23)*s;
   ctx.beginPath();ctx.arc(xx,yy,Math.max(1.1,2.5*s/.43),0,TAU);ctx.fill();
  }}else if(b>.15){ctx.fillRect(x+12*s,y+12*s,14*s,17*s);}
 }
 function icons(points,symbol,size=16){
  ctx.font=`${size}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  for(const point of points.values()){
   const x=(point.x-centerX)*s,y=(point.z-centerZ)*s;
   if(Math.abs(x)<w*.78&&Math.abs(y)<h*.78)ctx.fillText(symbol,x,y);
  }
 }
 icons(knownRestaurants,'🍕',includePlayer?15:17);icons(knownWorkshops,'🚗');icons(knownClothingStores,'👖');
 ctx.font='16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
 for(const property of knownProperties.values()){
   const x=(property.x-centerX)*s,y=(property.z-centerZ)*s;
   if(Math.abs(x)<w*.78&&Math.abs(y)<h*.78)ctx.fillText(propertyStates[property.id]===1?'🏡':'🏠',x,y);
 }
 if(mission.stage==='deliver'&&mission.target){
  const x=(mission.target.x-centerX)*s,y=(mission.target.z-centerZ)*s;
  const tx=THREE.MathUtils.clamp(x,-w/2+10,w/2-10),ty=THREE.MathUtils.clamp(y,-h/2+10,h/2-10);
  ctx.fillStyle='#ffdb48';ctx.strokeStyle='#513e15';ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(tx,ty,7,0,TAU);ctx.fill();ctx.stroke();
 }
 // Marcador da posição atual: independente do centro do mapa ampliado.
 const px=(playerPos.x-centerX)*s,py=(playerPos.z-centerZ)*s;
 if(Math.abs(px)<w*.7&&Math.abs(py)<h*.7){
  const heading=drivingCar?drivingCar.group.rotation.y:playerGroup.rotation.y;
  ctx.save();ctx.translate(px,py);ctx.rotate(rotating?-rotation:-heading); // cancela a rotação do minimapa; no mapa grande indica o rumo real
  ctx.shadowColor='#061a29';ctx.shadowBlur=6;ctx.fillStyle='#ffffff';ctx.strokeStyle='#145c8a';ctx.lineWidth=2;
  ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(8,9);ctx.lineTo(0,5);ctx.lineTo(-8,9);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 }
 ctx.restore();
 // Rosa dos ventos fixa no canto; norte acompanha a rotação do minimapa.
 ctx.save();ctx.translate(w-19,20);ctx.rotate(rotation);ctx.fillStyle='#f4fff6';ctx.strokeStyle='#132f37';ctx.lineWidth=3;
 ctx.font='bold 15px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.strokeText('N',0,0);ctx.fillText('N',0,0);ctx.restore();
 ctx.strokeStyle='#ffffff88';ctx.lineWidth=2;ctx.strokeRect(1,1,w-2,h-2);
}
function updateMinimap(){drawCityMap($('minimap'),playerPos.x,playerPos.z,miniScale,mapRotate);}
function drawExpandedMap(){
 if(!mapOpen)return;
 drawCityMap($('large-map'),mapCenterX,mapCenterZ,mapScale,false);
 $('map-scale-label').textContent=`ZOOM ${Math.round(mapScale*100)}%`;
}
function toggleExpandedMap(show){
 if(show&&(gamePaused||activityOpen))return;
 mapOpen=show;
 $('map-modal').hidden=!show;
 $('touch-ui').hidden=show||gamePaused;
 keys.clear();movementTouch.x=movementTouch.y=0;movementTouch.running=false;
 if(show){mapCenterX=playerPos.x;mapCenterZ=playerPos.z;mapScale=.55;drawExpandedMap();}
 else updateMinimap();
}
// === Alpha 1.0: clima, áudio e menu secreto de desenvolvimento ===
function autoWeather(){
  const bucket=Math.floor(timeHours/4);
  const r=randAt(bucket,Math.floor(timeHours/12),71220);
  return r<.17?'chuva':r<.30?'neblina':r<.52?'nublado':'ensolarado';
}
function setWeather(mode,announce=false){
  if(!weatherNames[mode])return;
  weatherMode=mode;$('weather-mode').value=mode;
  if(announce)toast('Clima: '+weatherNames[mode]);
  if(gameStarted)saveProgress();
}
function setupRain(){
  const count=mobile?85:180,vertices=new Float32Array(count*6);
  for(let i=0;i<count;i++){
    const x=(Math.random()-.5)*52,z=(Math.random()-.5)*52,y=2+Math.random()*22;
    vertices.set([x,y,z,x-.16,y-.65,z],i*6);
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(vertices,3));
  const mat=new THREE.LineBasicMaterial({color:0xbacfe5,transparent:true,opacity:.55,depthWrite:false});
  rainParticles=new THREE.LineSegments(g,mat);rainParticles.visible=false;scene.add(rainParticles);
}
function updateWeather(dt){
  weatherVisual=weatherMode==='automatico'?autoWeather():weatherMode;
  const wetTarget=weatherVisual==='chuva'?1:weatherVisual==='nublado'?.55:weatherVisual==='neblina'?.38:0;
  const fogTarget=weatherVisual==='neblina'?1:weatherVisual==='chuva'?.42:weatherVisual==='nublado'?.12:0;
  const alpha=1-Math.exp(-dt*.65);
  weatherWet=THREE.MathUtils.lerp(weatherWet,wetTarget,alpha);
  weatherFog=THREE.MathUtils.lerp(weatherFog,fogTarget,alpha);
  if(!rainParticles)return;
  rainParticles.visible=weatherVisual==='chuva' && weatherWet>.1 && !gamePaused;
  if(!rainParticles.visible)return;
  const pos=rainParticles.geometry.attributes.position;
  for(let i=0;i<pos.count;i+=2){
    let y=pos.getY(i)-dt*21;
    if(y<.25){y=14+Math.random()*11;const x=(Math.random()-.5)*50,z=(Math.random()-.5)*50;pos.setX(i,x);pos.setX(i+1,x-.16);pos.setZ(i,z);pos.setZ(i+1,z);}
    pos.setY(i,y);pos.setY(i+1,y-.65);
  }
  pos.needsUpdate=true;
  rainParticles.position.set(playerPos.x,playerPos.y,playerPos.z);
}
function updateAmbientAudio(){
  const isForest=districtAt(playerPos.x,playerPos.z)==='Floresta';
  const wanted=String((isForest?CFG.somAmbienteFloresta:CFG.somAmbienteCidade)||CFG.somAmbiente||'').trim();
  if(wanted!==audioSource){ambientAudio.pause();audioSource=wanted;audioBlocked=false;if(wanted)ambientAudio.src=wanted;else ambientAudio.removeAttribute('src');}
  ambientAudio.volume=Number.isFinite(CFG.volumeAmbiente)?THREE.MathUtils.clamp(CFG.volumeAmbiente,0,1):.28;
  if(gameStarted&&!gamePaused&&wanted){
    if(ambientAudio.paused&&!audioBlocked)ambientAudio.play().catch(()=>{audioBlocked=true;});
  }else ambientAudio.pause();
}
function devPanel(show){
  if(!devUnlocked&&show)devUnlocked=true;
  if(show && !$('delivery-modal').hidden)$('delivery-modal').hidden=true;
  devOpen=!!show;
  $('dev-overlay').hidden=!show;
  $('dev-fab').hidden=!devUnlocked || gamePaused;
  $('dev-hour').value=String(Math.floor(timeHours));
  $('dev-weather').value=weatherMode;
  keys.clear();
}
// Único comando necessário no console, mesmo com main.js em módulo.
window.DEVMENU=function(){devPanel(!devOpen);return devOpen?'Menu DEV aberto':'Menu DEV fechado';};
function teleportDev(item){
  if(!item){toast('Nenhum local encontrado. Explore mais quarteirões.');return;}
  if(drivingCar){drivingCar.occupied=false;drivingCar.parked=true;drivingCar=null;vehicleSpeed=0;playerGroup.visible=true;}
  const originalX=playerPos.x,originalZ=playerPos.z;
  playerPos.x=item.x;playerPos.z=item.z;updateChunks(true);
  const attempts=[[0,1.8],[1.8,0],[-1.8,0],[0,-1.8],[3,0],[-3,0],[0,3]];
  for(const [ox,oz] of attempts){
    const x=item.x+ox,z=item.z+oz;
    if(!canMove(x,z,false,false,false))continue;
    playerPos.set(x,terrainHeight(x,z),z);playerGroup.position.copy(playerPos);previousSafeX=x;previousSafeZ=z;
    resetCameraFollow(false);updateChunks(true);placeCamera(true);saveProgress();updateHUD();
    devPanel(false);toast('Teleporte: '+item.name);return;
  }
  playerPos.x=originalX;playerPos.z=originalZ;updateChunks(true);
  toast('Sem espaço para teleporte neste local.');
}
function nearestDev(map){
  return [...map.values()].sort((a,b)=>distanceTo(a)-distanceTo(b))[0]||null;
}
function spawnDevCar(){
  const id=$('dev-car').value,model=CAR_CATALOG.find(c=>c.id===id);
  if(!model)return;
  if(devCar){
    if(drivingCar===devCar){drivingCar=null;vehicleSpeed=0;playerGroup.visible=true;}
    const ix=carAgents.indexOf(devCar);if(ix>=0)carAgents.splice(ix,1);scene.remove(devCar.group);devCar=null;
  }
  const a=makeCarAgent(90001,model.kind);a.isOwned=true;a.parked=true;a.speed=0;
  const gx=Math.round(playerPos.x/CELL)*CELL+ROAD/2,gz=Math.round(playerPos.z/CELL)*CELL+ROAD/2;
  let parked=false;
  for(const [ox,oz,rot] of [[0,10,0],[10,0,-Math.PI/2],[0,-10,Math.PI],[-10,0,Math.PI/2],[0,17,0]]){
    a.group.rotation.y=rot;
    if(vehicleCanAdvance(a,gx+ox,gz+oz,null,false)){
      a.group.position.set(gx+ox,terrainHeight(gx+ox,gz+oz),gz+oz);parked=true;break;
    }
  }
  if(!parked){scene.remove(a.group);toast('Não há vaga livre para spawnar.');return;}
  a.group.visible=true;devCar=a;carAgents.push(a);toast('Veículo de teste criado.');
}
function performDevAction(action){
  if(action==='restaurant')teleportDev(nearestDev(knownRestaurants));
  else if(action==='workshop')teleportDev(nearestDev(knownWorkshops));
  else if(action==='house'){
    const houses=new Map([...knownProperties].filter(([id])=>propertyStates[id]===1));
    for(const [id,purchased] of Object.entries(propertyStates))if(purchased===1&&!houses.has(id)){
      const parts=id.split(':');const x=Number(parts[1])/100,z=Number(parts[2])/100;
      if(parts[0]==='imovel'&&Number.isFinite(x)&&Number.isFinite(z))houses.set(id,{id,x,z,name:'Sua propriedade'});
    }
    teleportDev(nearestDev(houses));
  }
  else if(action==='spawn')spawnDevCar();
  else if(action==='hour'){timeHours=(Number($('dev-hour').value)%24+24)%24;timeFlow=false;$('auto-time').checked=false;updateLighting(0);saveProgress();toast('Horário: '+timeLabel(timeHours));}
  else if(action==='weather')setWeather($('dev-weather').value,true);
  else if(action==='money'){const n=Number($('dev-money').value);if(!Number.isFinite(n)||n<0||n>1000000)return toast('Valor inválido.');mission.wallet=safeMoney(mission.wallet+n);saveProgress();updateMissionUI(true);toast('Saldo de teste atualizado.');}
  else if(action==='save'){saveProgress();toast('Progresso salvo!');}
}
let gameStarted=false;
let gamePaused=true;
function setMenuVisible(show){
  if(mapOpen)toggleExpandedMap(false);
  gamePaused=show;
  $('main-menu').hidden=!show;
  if(show&&devOpen)devPanel(false);
  $('dev-fab').hidden=show||!devUnlocked;
  if(show)ambientAudio.pause();
  $('play-hud').hidden=show;
  $('mission-hud').hidden=show;
  $('touch-ui').hidden=show;
  $('menu-open').hidden=show;
  $('resume-world').hidden=!gameStarted;
  if(activityOpen)closeActivity();
  $('start-world').textContent=gameStarted?'↻ REINICIAR MUNDO':'▶ JOGAR';
  keys.clear();
  movementTouch.x=movementTouch.y=0;
  movementTouch.running=false;
  $('joystick-knob').style.transform='translate(0,0)';
  $('sprint').classList.remove('active');
  cam.dragging=false;cam.pointerId=null;
  previousFrameTimestamp=null;
}
function beginWorld(){
  // Mantém a preferência selecionada no menu mesmo depois da restauração da seed.
  const rotationRequested=$('map-rotate').checked;
  const weatherRequested=$('weather-mode').value;
  if(gameStarted)saveProgress();
  setSeed($('seed').value,false);
  mapRotate=rotationRequested;$('map-rotate').checked=rotationRequested;
  weatherMode=weatherRequested;$('weather-mode').value=weatherRequested;
  gameStarted=true;
  setMenuVisible(false);
  saveProgress();updateMinimap();
  audioBlocked=false;updateAmbientAudio();
  toast(`Explorando a seed ${seedString}`);
}
function resumeWorld(){
  if(!gameStarted)return beginWorld();
  setMenuVisible(false);audioBlocked=false;updateAmbientAudio();
}
function wireInputs(){
  $('weather-mode').value=weatherMode;
  $('weather-mode').addEventListener('change',e=>setWeather(e.target.value));
  $('dev-secret-title').addEventListener('click',()=>{
    const now=performance.now();if(!devFirstHit || now-devFirstHit>DEV_HIT_WINDOW){devFirstHit=now;devHits=0;}
    devHits++;if(devHits>=DEV_HIT_COUNT){devHits=0;devFirstHit=0;devUnlocked=true;devPanel(true);toast('Menu DEV desbloqueado.');}
  });
  $('dev-close').addEventListener('click',()=>devPanel(false));
  $('dev-fab').addEventListener('click',()=>devPanel(!devOpen));
  $('dev-overlay').addEventListener('click',e=>{if(e.target===$('dev-overlay'))devPanel(false);});
  $('dev-overlay').addEventListener('click',e=>{const btn=e.target.closest('[data-dev]');if(btn)performDevAction(btn.dataset.dev);});
  $('delivery-cancel').addEventListener('click',()=>{$('delivery-modal').hidden=true;});
  $('delivery-offers').addEventListener('click',e=>{
    const btn=e.target.closest('[data-offer]');if(!btn)return;
    const offer=deliveryOffers[Number(btn.dataset.offer)],pickup=currentPickup();
    $('delivery-modal').hidden=true;if(offer&&pickup)acceptDelivery(pickup,offer.target,offer.payment);
  });
  $('traffic-density').value=trafficDensity;
  $('ped-density').value=pedestrianDensity;
  $('traffic-density').addEventListener('input',(e)=>{trafficDensity=Number(e.target.value);updatePopulation();});
  $('ped-density').addEventListener('input',(e)=>{pedestrianDensity=Number(e.target.value);updatePopulation();});
  const slider=$('hours');slider.value=String(timeHours);
  slider.addEventListener('input',()=>{timeHours=Number(slider.value);timeFlow=false;$('auto-time').checked=false;lastSkyBucket=-1;});
  $('auto-time').addEventListener('change',(e)=>{timeFlow=e.target.checked;});
  $('sun-angle').value=String(sunDirection);
  $('sun-angle').addEventListener('input',(e)=>{sunDirection=Number(e.target.value);$('sun-value').textContent=sunDirection+'°';});
  $('hours').addEventListener('change',()=>{$('clock-time').textContent=timeLabel(timeHours);});
  $('seed-form').addEventListener('submit',(e)=>{e.preventDefault();beginWorld();});
  $('seed').addEventListener('input',updateSavePreview);
  $('random').addEventListener('click',()=>{
    const bytes=new Uint32Array(1);
    if(window.crypto?.getRandomValues)crypto.getRandomValues(bytes);
    else bytes[0]=Math.floor(Math.random()*4294967295);
    $('seed').value='CIDADE-'+bytes[0].toString(36).toUpperCase();updateSavePreview();
  });
  $('share').addEventListener('click',async()=>{
    const url=new URL(location.href);url.searchParams.set('seed',String($('seed').value||'CLT-2026').trim());
    try {await navigator.clipboard.writeText(url.toString());toast('Link da cidade copiado!');}
    catch {window.prompt('Copie o link da cidade:',url.toString());}
  });
  $('menu-open').addEventListener('click',()=>{saveProgress();setMenuVisible(true);});
  window.addEventListener('pagehide',saveProgress);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveProgress();});
  $('resume-world').addEventListener('click',resumeWorld);
  // Captura no window para os controles funcionarem mesmo quando um botão estiver em foco.
  // Campos editáveis continuam recebendo texto normalmente (seed, configurações etc.).
  const controlCodes = new Set(['KeyW','KeyA','KeyS','KeyD','KeyE','KeyF','KeyM','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
  function eventCode(e){
    const fallback={w:'KeyW',a:'KeyA',s:'KeyS',d:'KeyD',e:'KeyE',f:'KeyF',W:'KeyW',A:'KeyA',S:'KeyS',D:'KeyD',E:'KeyE',F:'KeyF',' ':'Space',
                    ArrowUp:'ArrowUp',ArrowDown:'ArrowDown',ArrowLeft:'ArrowLeft',ArrowRight:'ArrowRight',Shift:'ShiftLeft'};
    return controlCodes.has(e.code)?e.code:(fallback[e.key]||e.code);
  }
  function typingInField(target){return (target instanceof HTMLInputElement && !['checkbox','radio','range','button','submit'].includes(target.type)) || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || !!target?.isContentEditable;}
  window.addEventListener('keydown',(e)=>{
    if(e.code==='F9'&&!e.repeat){e.preventDefault();devPanel(!devOpen);return;}
    if(e.code==='Escape'&&devOpen){e.preventDefault();devPanel(false);return;}
    if(e.code==='Escape'&&!$('delivery-modal').hidden){e.preventDefault();$('delivery-modal').hidden=true;return;}
    if(e.code==='Escape'&&mapOpen){e.preventDefault();if(!e.repeat)toggleExpandedMap(false);return;}
    if(e.code==='Escape'&&activityOpen){e.preventDefault();if(!e.repeat)closeActivity();return;}
    if(e.code==='Escape'){e.preventDefault();if(gameStarted&&!e.repeat){if(!gamePaused)saveProgress();setMenuVisible(!gamePaused);}return;}
    if(gamePaused||activityOpen||mapOpen||devOpen||!$('delivery-modal').hidden||typingInField(e.target))return;
    const code=eventCode(e);
    if(code==='KeyE'&&!e.repeat)interactWorld();
    if(code==='KeyF'&&!e.repeat)toggleVehicle();
    if(code==='KeyM'&&!e.repeat)toggleExpandedMap(true);
    if(controlCodes.has(code)){
      if(code.startsWith('Arrow')||code==='Space')e.preventDefault();
      keys.add(code);
      movementStatus.keyEvent=code;
      movementStatus.lastKeyAt=performance.now();
    }
  },true);
  window.addEventListener('keyup',(e)=>{keys.delete(eventCode(e));},true);
  window.addEventListener('blur',()=>{keys.clear();movementTouch.x=0;movementTouch.y=0;movementTouch.running=false;});
  const canvas=$('game');
  canvas.addEventListener('contextmenu',(e)=>e.preventDefault());
  canvas.addEventListener('pointerdown',()=>{
    const focused=document.activeElement;
    if(focused instanceof HTMLInputElement && focused.type==='text')focused.blur();
  });
  canvas.addEventListener('pointerdown',(e)=>{
    if(gamePaused)return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    cam.dragging=true;cam.pointerId=e.pointerId;cam.lastX=e.clientX;cam.lastY=e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove',(e)=>{
    if(!cam.dragging||e.pointerId!==cam.pointerId)return;
    const dx=e.clientX-cam.lastX,dy=e.clientY-cam.lastY;
    cam.lastX=e.clientX;cam.lastY=e.clientY;
    if(!Number.isFinite(dx)||!Number.isFinite(dy))return;
    resetCameraFollow(true);
    cam.yaw-=dx*.006;
    cam.pitch=THREE.MathUtils.clamp(cam.pitch+dy*.004,.12,1.04);
  });
  const stopDrag=(e)=>{if(e.pointerId===cam.pointerId){cam.dragging=false;cam.pointerId=null;}};
  canvas.addEventListener('pointerup',stopDrag);
  canvas.addEventListener('pointercancel',stopDrag);
  canvas.addEventListener('wheel',(e)=>{e.preventDefault();cam.distance=THREE.MathUtils.clamp(cam.distance+Math.sign(e.deltaY)*.6,3.6,13.5);},{passive:false});
  const joy=$('joystick'),knob=$('joystick-knob');
  let stickPointer=null;
  function setStick(e){
    const rect=joy.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
    const deltaX=e.clientX-cx,deltaY=e.clientY-cy,max=rect.width*.33;
    if(!Number.isFinite(deltaX)||!Number.isFinite(deltaY)||!Number.isFinite(max)||max<=0)return;
    const magnitude=Math.hypot(deltaX,deltaY),factor=magnitude>max?max/magnitude:1;
    movementTouch.x=deltaX*factor/max;movementTouch.y=deltaY*factor/max;
    knob.style.transform=`translate(${deltaX*factor}px,${deltaY*factor}px)`;
  }
  joy.addEventListener('pointerdown',(e)=>{e.preventDefault();stickPointer=e.pointerId;joy.setPointerCapture(e.pointerId);setStick(e);});
  joy.addEventListener('pointermove',(e)=>{if(e.pointerId===stickPointer)setStick(e);});
  function stopStick(e){if(e.pointerId!==stickPointer)return;stickPointer=null;movementTouch.x=0;movementTouch.y=0;knob.style.transform='translate(0,0)';}
  joy.addEventListener('pointerup',stopStick);joy.addEventListener('pointercancel',stopStick);
  $('interact').addEventListener('click',()=>{if(!gamePaused&&!activityOpen)interactWorld();});
  $('vehicle-action').addEventListener('click',()=>{if(!gamePaused&&!activityOpen)toggleVehicle();});
  $('activity-close').addEventListener('click',closeActivity);
  $('activity-body').addEventListener('input',e=>{
    if(e.target.matches('[data-car-paint]'))chosenCarPaints[e.target.dataset.carPaint]=e.target.value;
    if(e.target.matches('[data-clothing-picker]'))clothingDraft[e.target.dataset.clothingPicker]=e.target.value;
  });
  $('map-rotate').addEventListener('change',e=>{mapRotate=e.target.checked;updateMinimap();saveProgress();});
  $('minimap').addEventListener('click',()=>{if(!gamePaused&&!activityOpen)toggleExpandedMap(true);});
  $('minimap').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&!gamePaused){e.preventDefault();toggleExpandedMap(true);}});
  $('map-close').addEventListener('click',()=>toggleExpandedMap(false));
  $('map-center').addEventListener('click',()=>{mapCenterX=playerPos.x;mapCenterZ=playerPos.z;drawExpandedMap();});
  function setMapZoom(factor){mapScale=THREE.MathUtils.clamp(mapScale*factor,.22,3);drawExpandedMap();}
  $('map-zoom-in').addEventListener('click',()=>setMapZoom(1.35));
  $('map-zoom-out').addEventListener('click',()=>setMapZoom(1/1.35));
  const bigMap=$('large-map'),mapPointers=new Map();let previousPinch=0;
  bigMap.addEventListener('wheel',e=>{e.preventDefault();setMapZoom(e.deltaY<0?1.16:1/1.16);},{passive:false});
  bigMap.addEventListener('pointerdown',e=>{
    if(!mapOpen)return;
    e.preventDefault();bigMap.setPointerCapture(e.pointerId);mapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});previousPinch=0;
  });
  bigMap.addEventListener('pointermove',e=>{
    if(!mapPointers.has(e.pointerId)||!mapOpen)return;
    e.preventDefault();
    const old=mapPointers.get(e.pointerId),dx=e.clientX-old.x,dy=e.clientY-old.y;
    mapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(mapPointers.size===1){
      // CSS pode redimensionar o canvas; convertemos pixels reais em pixels do canvas.
      const r=bigMap.getBoundingClientRect();
      mapCenterX-=dx*bigMap.width/r.width/mapScale;
      mapCenterZ-=dy*bigMap.height/r.height/mapScale;
    }else if(mapPointers.size===2){
      const vals=[...mapPointers.values()],gap=Math.hypot(vals[0].x-vals[1].x,vals[0].y-vals[1].y);
      if(previousPinch>0)setMapZoom(gap/previousPinch);
      previousPinch=gap;
    }
    drawExpandedMap();
  });
  function removeMapPointer(e){mapPointers.delete(e.pointerId);previousPinch=0;}
  bigMap.addEventListener('pointerup',removeMapPointer);bigMap.addEventListener('pointercancel',removeMapPointer);
  $('activity-body').addEventListener('click',e=>{
    const button=e.target.closest('[data-action]');if(button&&!button.disabled)handleActivityAction(button.dataset.action);
  });
  const sprint=$('sprint');
  sprint.addEventListener('pointerdown',(e)=>{e.preventDefault();sprint.setPointerCapture(e.pointerId);movementTouch.running=true;sprint.classList.add('active');});
  const stopSprint=()=>{movementTouch.running=false;sprint.classList.remove('active');};
  sprint.addEventListener('pointerup',stopSprint);sprint.addEventListener('pointercancel',stopSprint);
}
function frame(timestamp){
  requestAnimationFrame(frame);
  // Three.Timer deve receber o timestamp antes de calcular o delta.
  timer.update(timestamp);
  const timerDelta=timer.getDelta();
  const fallbackDelta=previousFrameTimestamp===null?0:(timestamp-previousFrameTimestamp)/1000;
  previousFrameTimestamp=timestamp;
  const rawDelta=(Number.isFinite(timerDelta)&&timerDelta>0)?timerDelta:fallbackDelta;
  const delta=Number.isFinite(rawDelta)?Math.min(Math.max(rawDelta,0),.05):0;
  movementStatus.frames++;
  if(!gamePaused&&!activityOpen&&!mapOpen&&!devOpen&&$('delivery-modal').hidden){
    const lastX=playerPos.x,lastZ=playerPos.z;
    move(delta);
    updateAutoCamera(delta,lastX,lastZ);
    updateChunks();
    updateCars(delta);
    updatePedestrians(delta);
    updateBrokenLamps(delta);
    if(timestamp-lastAutosave>12000){lastAutosave=timestamp;saveProgress();}
  }
  updateWeather(delta);
  if(gameStarted&&Math.floor(timestamp/1200)!==Math.floor((timestamp-delta*1000)/1200))updateAmbientAudio();
  updateDeliveryIndicators(timestamp);
  placeCamera(false,delta);
  terrain.position.x=playerPos.x;terrain.position.z=playerPos.z;
  skyMesh.position.set(playerPos.x,0,playerPos.z);
  updateLighting(gamePaused||activityOpen||devOpen||!$('delivery-modal').hidden?0:delta);
  updateStreetLights();
  updateHeadlights();
  renderer.render(scene,camera);
  const now=performance.now();fpsCounter++;
  if(now-fpsStart>=1000){
    // FPS deixado fora da interface pública.
    fpsStart=now;fpsCounter=0;
  }
  if(!gamePaused&&!activityOpen&&!mapOpen&&now-lastMini>190){lastMini=now;updateHUD();updateMinimap();}
}
try {
  initScene();wireInputs();
  const querySeed=new URLSearchParams(location.search).get('seed');
  setSeed(querySeed||'CLT-2026',false);
  setMenuVisible(true);
  // A primeira renderização é feita antes de esconder a tela de carregamento.
  renderer.render(scene,camera);
  timer.connect(document);
  requestAnimationFrame((timestamp)=>{$('loading').classList.add('hidden');frame(timestamp);});
} catch (error) {
  console.error('Erro ao iniciar Cidade Sem Fim:',error);
  showError(error.message||String(error));
}
