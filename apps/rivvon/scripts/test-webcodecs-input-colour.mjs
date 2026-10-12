import {createServer} from 'vite';
import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {rgbaToBt709I420} from '../src/modules/viewer/exportColour.js';
import {createColourChartRgba} from '../src/modules/viewer/colourTestChart.js';
const root=fileURLToPath(new URL('..',import.meta.url)),out=resolve(process.env.COLOUR_OUTPUT_DIR || join(root,'colour-test-output/explicit-yuv'));
if(!process.env.BROWSER_BINARY || !process.env.FFMPEG_BINARY || !process.env.FFPROBE_BINARY)throw Error('Set BROWSER_BINARY, FFMPEG_BINARY and FFPROBE_BINARY for this experiment.');
await mkdir(out,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'rivvon-explicit-yuv-'));
const server=await createServer({root,server:{host:'127.0.0.1',port:0,open:false}});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let browser,ws,call;
try{
 await server.listen();
 browser=spawn(process.env.BROWSER_BINARY,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let port;for(let i=0;i<100;i++){try{port=(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
 const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){pending.get(m.id)?.(m);pending.delete(m.id);}});
 call=(method,params={})=>new Promise(r=>{const i=++id;pending.set(i,r);ws.send(JSON.stringify({id:i,method,params}));});
 await call('Page.navigate',{url:server.resolvedUrls.local[0]+'colour-test.html'});
 const r=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
 while(!window.colourLab)await new Promise(r=>setTimeout(r,100));
 const MB=await import('/node_modules/.vite/deps/mediabunny.js');
 const {rgbaToBt709I420,SDR_VIDEO_COLOUR}=await import('/src/modules/viewer/exportColour.js');
 const {inspectMp4Colour}=await import('/src/modules/viewer/videoColourMetadata.js');
 const {repairMissingSpsColour}=await import('/src/modules/viewer/repairWebCodecsColour.js');
 const canvas=colourLab.chart,w=canvas.width,h=canvas.height,frames=90,fps=30;
 const i420=rgbaToBt709I420(canvas.getContext('2d').getImageData(0,0,w,h).data,w,h);
 const nv12=new Uint8Array(i420.length),pixels=w*h;nv12.set(i420.subarray(0,pixels));
 for(let i=0;i<pixels/4;i++){nv12[pixels+2*i]=i420[pixels+i];nv12[pixels+2*i+1]=i420[pixels*5/4+i];}
 const results=[];
 for(const input of ['canvas','I420','NV12'])for(const hardwareAcceleration of ['no-preference','prefer-hardware','prefer-software']){
  let firstInput,decoderConfig,encoderConfig;const decoderColourSpaces=[];
  const config={codec:'avc',bitrate:MB.QUALITY_VERY_HIGH,hardwareAcceleration,
   onEncoderConfig(c){encoderConfig={...c};},
   onEncodedPacket(_packet,m){if(m?.decoderConfig?.colorSpace){if(!decoderConfig)decoderConfig={codec:m.decoderConfig.codec,colorSpace:{...m.decoderConfig.colorSpace}};decoderColourSpaces.push({...m.decoderConfig.colorSpace});}}};
  const source=input==='canvas'?new MB.CanvasSource(canvas,config):new MB.VideoSampleSource(config);
  const output=new MB.Output({format:new MB.Mp4OutputFormat(),target:new MB.BufferTarget()});output.addVideoTrack(source);await output.start();
  for(let n=0;n<frames;n++){
   if(input==='canvas'){if(!firstInput){const f=new VideoFrame(canvas,{timestamp:0});firstInput={format:f.format,colorSpace:f.colorSpace.toJSON()};f.close();}await source.add(n/fps,1/fps);}
   else{
    const f=new VideoFrame(input==='I420'?i420:nv12,{format:input,codedWidth:w,codedHeight:h,timestamp:Math.round(n/fps*1e6),duration:Math.round(1/fps*1e6),colorSpace:SDR_VIDEO_COLOUR});
    if(!firstInput)firstInput={format:f.format,colorSpace:f.colorSpace.toJSON()};
    const sample=new MB.VideoSample(f);try{await source.add(sample);}finally{sample.close();f.close();}
   }
  }
  await output.finalize();const original=new Uint8Array(output.target.buffer);const before=inspectMp4Colour(original);
  const fixed=await repairMissingSpsColour(original,{decoderColourSpaces});
  results.push({input,hardwareAcceleration,firstInput,decoderConfig,encoderConfig,before,after:inspectMp4Colour(fixed.data),repair:fixed.repair,original:Array.from(original),repaired:Array.from(fixed.data)});
 }
 return {environment:colourLab.environment,width:w,height:h,frames,fps,results};
})()`});
 if(r.error||r.result.exceptionDetails)throw Error(JSON.stringify(r));
 const result=r.result.result.value;
 const ffprobe=process.env.FFPROBE_BINARY;
 const ffmpeg=process.env.FFMPEG_BINARY;
 const expected=rgbaToBt709I420(createColourChartRgba(result.width,result.height),result.width,result.height);
 for(const entry of result.results){
  const name=entry.input.toLowerCase()+'-'+entry.hardwareAcceleration;
  for(const type of ['original','repaired'])await writeFile(join(out,name+'-'+type+'.mp4'),Buffer.from(entry[type]));
  delete entry.original;delete entry.repaired;
  const file=join(out,name+'-repaired.mp4');
  entry.ffprobe=JSON.parse(execFileSync(ffprobe,['-v','error','-select_streams','v:0','-count_frames','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true})).streams[0];
  const trace=spawnSync(ffmpeg,['-hide_banner','-i',file,'-map','0:v:0','-c:v','copy','-bsf:v','trace_headers','-frames:v','1','-f','null','-'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
  if(trace.status!==0)throw Error(trace.stderr);
  entry.traceHeaders=trace.stderr.split('\n').filter(line=>/video_full_range_flag|colour_primaries|transfer_characteristics|matrix_coefficients/.test(line));
  await writeFile(join(out,name+'-sps.txt'),entry.traceHeaders.join('\n'));
  if(entry.input!=='canvas')for(const [field,value] of [['video_full_range_flag',0],['colour_primaries',1],['transfer_characteristics',1],['matrix_coefficients',1]])if(!entry.traceHeaders.some(line=>line.includes(field)&&line.trim().endsWith('= '+value)))throw Error('SPS validation failed: '+field);
  const decoded=execFileSync(ffmpeg,['-v','error','-i',file,'-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','-'],{windowsHide:true,maxBuffer:16*1024*1024});
  let maxError=0;const pixels=result.width*result.height;
  for(let row=0;row<4;row++)for(let col=0;col<8;col++){
   const x=Math.floor((col+.5)*result.width/8),y=Math.floor((row+.5)*result.height/6);
   for(const index of [y*result.width+x,pixels+Math.floor(y/2)*result.width/2+Math.floor(x/2),pixels*5/4+Math.floor(y/2)*result.width/2+Math.floor(x/2)])maxError=Math.max(maxError,Math.abs(decoded[index]-expected[index]));
  }
  entry.patchMaxError=maxError;
  if(entry.input!=='canvas' && (maxError>4 || entry.ffprobe.color_range!=='tv' || entry.ffprobe.color_transfer!=='bt709' || entry.ffprobe.color_space!=='bt709' || entry.ffprobe.color_primaries!=='bt709' || entry.ffprobe.pix_fmt!=='yuv420p' || Number(entry.ffprobe.nb_read_frames)!==result.frames))throw Error('Converted-input colour/sample validation failed');
  console.log(JSON.stringify({input:entry.input,preference:entry.hardwareAcceleration,output:entry.ffprobe.color_range,transfer:entry.ffprobe.color_transfer,matrix:entry.ffprobe.color_space,sps:entry.after.sps,repair:entry.repair.status,patchMaxError:maxError}));
 }
 await writeFile(join(out,'report.json'),JSON.stringify(result,null,2));
}finally{
 if(ws?.readyState===WebSocket.OPEN){await Promise.race([call('Browser.close'),delay(500)]);ws.close();}browser?.kill();await server.close();
 const allowed=resolve(tmpdir());if(resolve(profile).startsWith(allowed+'\\')||resolve(profile).startsWith(allowed+'/'))await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}

