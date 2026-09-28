// SPDX-License-Identifier: LGPL-2.1-or-later
// BWDIF derived from FFmpeg libavfilter/vf_bwdif.c (n4.1).
// Copyright (C) 2016 Thomas Mundt; 2006-2011 Michael Niedermayer;
// 2010 James Darnley; 2012 British Broadcasting Corporation.
// Weston three-field algorithm: Jim Easterbrook / Martin Weston, BBC R&D.
// See COPYING.LGPLv2.1 and NOTICE.md in this directory.
struct Params { width:u32, height:u32, field:u32, intra:u32 }
@group(0) @binding(0) var<storage, read> prev:array<u32>;
@group(0) @binding(1) var<storage, read> cur:array<u32>;
@group(0) @binding(2) var<storage, read> next:array<u32>;
@group(0) @binding(3) var<storage, read_write> dst:array<u32>;
@group(0) @binding(4) var<uniform> p:Params;

fn readPixel(frame:u32,x:i32,y:i32,w:u32,h:u32,offset:u32)->i32 {
    let index=offset+u32(clamp(y,0,i32(h)-1))*w+u32(x);
    if(frame==0u){return i32(prev[index]);}
    if(frame==1u){return i32(cur[index]);}
    return i32(next[index]);
}

@compute @workgroup_size(8,8,1)
fn main(@builtin(global_invocation_id) gid:vec3u){
    let plane=gid.z;
    let w=select(p.width,p.width/2u,plane>0u);
    let height=select(p.height,p.height/2u,plane>0u);
    if(gid.x>=w||gid.y>=height||plane>=3u){return;}
    let offset=select(0u,p.width*p.height+(plane-1u)*(p.width*p.height/4u),plane>0u);
    let x=i32(gid.x);let y=i32(gid.y);let h=i32(height);
    let index=offset+gid.y*w+gid.x;
    if(gid.y%2u==p.field){dst[index]=cur[index];return;}
    let a=p.field;let b=a+1u;
    let ym=select(y-1,y+1,y==0);let yp=select(y+1,y-1,y==h-1);
    let ym3=select(y-3,y+1,y<3);let yp3=select(y+3,y-1,y+3>=h);
    let c=readPixel(1u,x,ym,w,height,offset);let e=readPixel(1u,x,yp,w,height,offset);
    let far=readPixel(1u,x,ym3,w,height,offset)+readPixel(1u,x,yp3,w,height,offset);
    // At the first/last field, one temporal neighbor does not exist. Use the
    // reference BWDIF cubic spatial filter, never basic bob or line doubling.
    if(p.intra!=0u){dst[index]=u32(clamp((5077*(c+e)-981*far)>>13u,0,255));return;}
    let d=(readPixel(a,x,y,w,height,offset)+readPixel(b,x,y,w,height,offset))>>1u;
    let td0=abs(readPixel(a,x,y,w,height,offset)-readPixel(b,x,y,w,height,offset));
    let td1=(abs(readPixel(0u,x,ym,w,height,offset)-c)+abs(readPixel(0u,x,yp,w,height,offset)-e))>>1u;
    let td2=(abs(readPixel(2u,x,ym,w,height,offset)-c)+abs(readPixel(2u,x,yp,w,height,offset)-e))>>1u;
    var diff=max(td0>>1u,max(td1,td2));
    if(diff==0){dst[index]=u32(d);return;}
    if(y>=2&&y+3<=h){
        let bb=((readPixel(a,x,y-2,w,height,offset)+readPixel(b,x,y-2,w,height,offset))>>1u)-c;
        let ff=((readPixel(a,x,y+2,w,height,offset)+readPixel(b,x,y+2,w,height,offset))>>1u)-e;
        let dc=d-c;let de=d-e;
        diff=max(diff,max(min(de,min(dc,max(bb,ff))),-max(de,max(dc,min(bb,ff)))));
    }
    var value=(c+e)>>1u;
    if(y>=4&&y+5<=h){
        if(abs(c-e)>td0){
            let temporal=5570*(readPixel(a,x,y,w,height,offset)+readPixel(b,x,y,w,height,offset))
                -3801*(readPixel(a,x,y-2,w,height,offset)+readPixel(b,x,y-2,w,height,offset)+readPixel(a,x,y+2,w,height,offset)+readPixel(b,x,y+2,w,height,offset))
                +1016*(readPixel(a,x,y-4,w,height,offset)+readPixel(b,x,y-4,w,height,offset)+readPixel(a,x,y+4,w,height,offset)+readPixel(b,x,y+4,w,height,offset));
            value=((temporal>>2u)+4309*(c+e)-213*far)>>13u;
        }else{value=(5077*(c+e)-981*far)>>13u;}
    }
    dst[index]=u32(clamp(clamp(value,d-diff,d+diff),0,255));
}
