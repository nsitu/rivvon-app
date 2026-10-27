import {createServer} from 'vite';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {rgbaToBt709I420} from '../src/modules/viewer/exportColour.js';
import {createColourChartRgba} from '../src/modules/viewer/colourTestChart.js';
// Compare actual decoded YUV samples, including full-range samples without
// asking FFmpeg to rescale them. COLOUR_PRODUCTION=1 exercises the app writer,
// logo compositor and per-frame temporal markers instead of the raw input lab.
const root=fileURLToPath(new URL('..',import.meta.url)),out=resolve(process.env.COLOUR_OUTPUT_DIR || join(root,'colour-test-output/explicit-yuv'));
const repeats=Number(process.env.COLOUR_REPEATS || 3);
if(!Number.isSafeInteger(repeats)||repeats<1)throw Error('COLOUR_REPEATS must be a positive integer.');
if(!process.env.BROWSER_BINARY || !process.env.FFMPEG_BINARY || !process.env.FFPROBE_BINARY)throw Error('Set BROWSER_BINARY, FFMPEG_BINARY and FFPROBE_BINARY for this experiment.');
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'rivvon-explicit-yuv-'));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,open:false}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let browser,ws,call;
const traceEvents=[];let finishTrace;
try{
 await server.listen();
 browser=spawn(process.env.BROWSER_BINARY,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
 const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}if(m.method==='Tracing.dataCollected')traceEvents.push(...m.params.value);if(m.method==='Tracing.tracingComplete')finishTrace?.();});
 call=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
 const query=new URLSearchParams({width:process.env.COLOUR_WIDTH||'960',height:process.env.COLOUR_HEIGHT||'540',fps:process.env.COLOUR_FPS||'30',frames:process.env.COLOUR_FRAMES||'90'});
 await call('Page.navigate',{url:server.resolvedUrls.local[0]+'colour-test.html?'+query});
 await call('Tracing.start',{categories:'media,blink.user_timing',transferMode:'ReportEvents'});
 const r=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 for(let attempt=0;!window.colourLab&&attempt<200;attempt++)await new Promise(r=>setTimeout(r,100));
 if(!window.colourLab)throw Error('Colour lab failed to initialize. Avoid concurrent Vite instances sharing the dependency cache.');
 const MB=await import('/node_modules/.vite/deps/mediabunny.js');
 const {rgbaToBt709I420,SDR_VIDEO_COLOUR}=await import('/src/modules/viewer/exportColour.js');
 const {inspectMp4Colour}=await import('/src/modules/viewer/videoColourMetadata.js');
 const {repairMissingSpsColour}=await import('/src/modules/viewer/repairWebCodecsColour.js');
 const {createCanvasVideoExport}=await import('/src/modules/viewer/canvasVideoExport.js');
 const canvas=colourLab.chart,w=canvas.width,h=canvas.height,{frames,fps}=colourLab.environment;
 const rgba=canvas.getContext('2d').getImageData(0,0,w,h).data;
 const results=[];
 for(let repeat=1;repeat<=${repeats};repeat++)for(const range of ['limited','full']){
 const fullRange=range==='full';
 const i420=rgbaToBt709I420(rgba,w,h,undefined,{fullRange});
 const nv12=new Uint8Array(i420.length),pixels=w*h;nv12.set(i420.subarray(0,pixels));
 for(let i=0;i<pixels/4;i++){nv12[pixels+2*i]=i420[pixels+i];nv12[pixels+2*i+1]=i420[pixels*5/4+i];}
 for(const input of ${JSON.stringify(process.env.COLOUR_PRODUCTION==='1'?['production']:['canvas','I420','NV12'])})for(const hardwareAcceleration of ['no-preference','prefer-hardware','prefer-software'])for(const logo of (input==='production'?[false,true]:[false])){
  if(input==='canvas'&&(range==='full'||repeat>1))continue;
  const started=performance.now();
  const caseId=[input,range,hardwareAcceleration,repeat,logo].join('-');performance.mark(caseId+':start');
  if(input==='production'){
   let original,report;
   const writer=await createCanvasVideoExport(canvas,{width:w,height:h,fps,format:'mp4',encodingMethod:'webcodecs',hardwareAcceleration,videoRange:range,yuvConversion:${JSON.stringify(process.env.COLOUR_CONVERSION || 'gpu')},quality:'very-high',logoOverlayEnabled:logo,
    onBeforeSpsRepair:async blob=>{original=new Uint8Array(await blob.arrayBuffer());},onColourMetadata:r=>{report=r;}});
   try{
    const ctx=canvas.getContext('2d');
    for(let n=0;n<frames;n++){
     for(let bit=0;bit<7;bit++){ctx.fillStyle=n&(1<<bit)?'#fff':'#000';ctx.fillRect(w-112+bit*16,h-16,16,16);}
     await writer.add(n/fps,1/fps);
    }
    const repaired=new Uint8Array(await(await writer.finalize()).arrayBuffer());
    if (${JSON.stringify(process.env.COLOUR_CONVERSION || 'gpu')} === 'gpu' && report.yuvConversion?.method !== 'gpu') throw Error('GPU production test fell back to CPU: '+JSON.stringify(report.yuvConversion));
    results.push({input,range,repeat,logo,caseId,hardwareAcceleration,firstInput:report.videoFrame,decoderConfig:report.decoderConfig,encoderConfig:report.encoderConfig,before:inspectMp4Colour(original),after:inspectMp4Colour(repaired),repair:report.spsRepair,report,elapsedMs:performance.now()-started,original:Array.from(original),repaired:Array.from(repaired)});
   }finally{await writer.dispose();performance.mark(caseId+':end');}
   continue;
  }
  let firstInput,decoderConfig,encoderConfig;const decoderColourSpaces=[];
  const config={codec:'avc',bitrate:MB.QUALITY_VERY_HIGH,hardwareAcceleration,
   onEncoderConfig(c){encoderConfig={...c};},
   onEncodedPacket(_packet,m){if(m?.decoderConfig?.colorSpace){if(!decoderConfig)decoderConfig={codec:m.decoderConfig.codec,colorSpace:{...m.decoderConfig.colorSpace}};decoderColourSpaces.push({...m.decoderConfig.colorSpace});}}};
  const source=input==='canvas'?new MB.CanvasSource(canvas,config):new MB.VideoSampleSource(config);
  const output=new MB.Output({format:new MB.Mp4OutputFormat(),target:new MB.BufferTarget()});output.addVideoTrack(source);await output.start();
  for(let n=0;n<frames;n++){
   if(input==='canvas'){if(!firstInput){const f=new VideoFrame(canvas,{timestamp:0});firstInput={format:f.format,colorSpace:f.colorSpace.toJSON()};f.close();}await source.add(n/fps,1/fps);}
   else{
    const f=new VideoFrame(input==='I420'?i420:nv12,{format:input,codedWidth:w,codedHeight:h,timestamp:Math.round(n/fps*1e6),duration:Math.round(1/fps*1e6),colorSpace:{...SDR_VIDEO_COLOUR,fullRange}});
    if(!firstInput)firstInput={format:f.format,colorSpace:f.colorSpace.toJSON()};
    const sample=new MB.VideoSample(f);try{await source.add(sample);}finally{sample.close();f.close();}
   }
  }
  await output.finalize();const original=new Uint8Array(output.target.buffer);const before=inspectMp4Colour(original);
  const fixed=await repairMissingSpsColour(original,{decoderColourSpaces});
  results.push({input,range:input==='canvas'?'auto':range,repeat,logo,caseId,hardwareAcceleration,firstInput,decoderConfig,encoderConfig,before,after:inspectMp4Colour(fixed.data),repair:fixed.repair,elapsedMs:performance.now()-started,original:Array.from(original),repaired:Array.from(fixed.data)});
  performance.mark(caseId+':end');
 }
 }
 return {environment:colourLab.environment,width:w,height:h,frames,fps,results};
})()`});
 if(r.error||r.result.exceptionDetails)throw Error(JSON.stringify(r));
 const traceFinished=new Promise(resolve=>{finishTrace=resolve;});await call('Tracing.end');await traceFinished;
 const result=r.result.result.value;
 const encoderTrace=traceEvents.filter(e=>/encoder|encodeaccelerator/i.test(e.name));
 await writeFile(join(out,'encoder-trace.json'),JSON.stringify(encoderTrace,null,2));
 const ffprobe=process.env.FFPROBE_BINARY;
 const ffmpeg=process.env.FFMPEG_BINARY;
 const errors=[];
 for(const entry of result.results){
  const name=entry.input.toLowerCase()+'-'+entry.range+'-'+entry.hardwareAcceleration+'-'+entry.repeat+(entry.logo?'-logo':'');
  const start=traceEvents.find(e=>e.name===entry.caseId+':start')?.ts,end=traceEvents.find(e=>e.name===entry.caseId+':end')?.ts;
  const caseEvents=encoderTrace.filter(e=>e.ts>=start&&e.ts<=end);
  entry.encoderTrace={eventNames:[...new Set(caseEvents.map(e=>e.name))],initializations:caseEvents.filter(e=>/Initialize/.test(e.name)).map(e=>e.args)};
  entry.encoderTrace.hardwarePathObserved=caseEvents.some(e=>/MediaFoundationVideoEncodeAccelerator::ProcessInput/.test(e.name))&&entry.encoderTrace.initializations.some(e=>e.config?.includes('required_encoder_type: hardware'));
  if(process.env.COLOUR_REQUIRE_HARDWARE==='1'&&entry.hardwareAcceleration==='prefer-hardware'&&!entry.encoderTrace.hardwarePathObserved)errors.push(name+': Windows hardware encoder trace was not observed');
  const expected=rgbaToBt709I420(createColourChartRgba(result.width,result.height),result.width,result.height,undefined,{fullRange:entry.range==='full'});
  for(const type of ['original','repaired'])await writeFile(join(out,name+'-'+type+'.mp4'),Buffer.from(entry[type]));
  delete entry.original;delete entry.repaired;
  const file=join(out,name+'-repaired.mp4');
  entry.ffprobe=JSON.parse(execFileSync(ffprobe,['-v','error','-select_streams','v:0','-count_frames','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true})).streams[0];
  const trace=spawnSync(ffmpeg,['-hide_banner','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','trace_headers','-frames:v','1','-f','null','-'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  if(trace.status!==0)throw Error(trace.stderr);
  entry.traceHeaders=trace.stderr.split('\n').filter(line=>/video_full_range_flag|colour_primaries|transfer_characteristics|matrix_coefficients/.test(line));
  await writeFile(join(out,name+'-sps.txt'),entry.traceHeaders.join('\n'));
  if(entry.input!=='canvas')for(const [field,value] of [['video_full_range_flag',Number(entry.range==='full')],['colour_primaries',1],['transfer_characteristics',1],['matrix_coefficients',1]])if(!entry.traceHeaders.some(line=>line.includes(field)&&line.trim().endsWith('= '+value)))errors.push(name+': SPS validation failed: '+field);
  const decode=path=>execFileSync(ffmpeg,['-v','error','-i',path,'-vf',`select=eq(n\\,0)+eq(n\\,${Math.floor(result.frames/2)})+eq(n\\,${result.frames-1})`,'-fps_mode','passthrough','-pix_fmt',entry.ffprobe.pix_fmt,'-f','rawvideo','-'],{windowsHide:true,maxBuffer:32*1024*1024});
  const decoded=decode(file);
  const sampledFrames=new Set([0,Math.floor(result.frames/2),result.frames-1]).size;
  if(decoded.length!==result.width*result.height*3/2*sampledFrames)errors.push(name+': wrong decoded sample count');
  entry.repairSamplesUnchanged=decoded.equals(decode(join(out,name+'-original.mp4')));
  if(!entry.repairSamplesUnchanged)errors.push(name+': repair changed decoded samples');
  let maxError=0;const pixels=result.width*result.height;
  for(let offset=0;offset<decoded.length;offset+=pixels*3/2)for(let row=0;row<4;row++)for(let col=0;col<8;col++){
   const x=Math.floor((col+.5)*result.width/8),y=Math.floor((row+.5)*result.height/6);
   for(const index of [y*result.width+x,pixels+Math.floor(y/2)*result.width/2+Math.floor(x/2),pixels*5/4+Math.floor(y/2)*result.width/2+Math.floor(x/2)])maxError=Math.max(maxError,Math.abs(decoded[offset+index]-expected[index]));
  }
  entry.patchMaxError=maxError;
  if(entry.input!=='canvas'){
   const declarations=[...entry.after.container,...entry.after.sps];
   if(!entry.after.container.length||!entry.after.sps.length||declarations.some(c=>c.primaries!==1||c.transfer!==1||c.matrix!==1||c.fullRange!==(entry.range==='full')))errors.push(name+': container/SPS do not match requested colour');
  }
  if(entry.input==='production'){
   const markers=execFileSync(ffmpeg,['-v','error','-i',file,'-vf',`crop=112:16:${result.width-112}:${result.height-16}`,'-fps_mode','passthrough','-pix_fmt',entry.ffprobe.pix_fmt,'-f','rawvideo','-'],{windowsHide:true,maxBuffer:2*1024*1024});
   entry.temporalMarkers=[];
   for(let n=0;n<result.frames;n++){
    let value=0;for(let bit=0;bit<7;bit++)if(markers[n*112*16*3/2+8*112+bit*16+8]>128)value|=1<<bit;
    entry.temporalMarkers.push(value);
    if(value!==(n%128))errors.push(name+': temporal marker mismatch at frame '+n);
   }
  }
  if(entry.input!=='canvas' && (maxError>4 || entry.ffprobe.color_range!==(entry.range==='full'?'pc':'tv') || entry.ffprobe.color_transfer!=='bt709' || entry.ffprobe.color_space!=='bt709' || entry.ffprobe.color_primaries!=='bt709' || !['yuv420p','yuvj420p'].includes(entry.ffprobe.pix_fmt) || Number(entry.ffprobe.nb_read_frames)!==result.frames || Math.abs(Number(entry.ffprobe.duration)-result.frames/result.fps)>0.00001))errors.push(name+': converted-input colour/sample/timing validation failed');
  console.log(JSON.stringify({input:entry.input,range:entry.range,repeat:entry.repeat,preference:entry.hardwareAcceleration,output:entry.ffprobe.color_range,repair:entry.repair.status,patchMaxError:maxError}));
 }
 result.errors=errors;
 await writeFile(join(out,'report.json'),JSON.stringify(result,null,2));
 if(errors.length)throw Error(errors.join('\n'));
}finally{
 if(ws?.readyState===WebSocket.OPEN){await Promise.race([call('Browser.close'),delay(500)]);ws.close();}browser?.kill();await server.close();
 const allowed=resolve(tmpdir());if(resolve(profile).startsWith(allowed+'\\')||resolve(profile).startsWith(allowed+'/'))await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}

