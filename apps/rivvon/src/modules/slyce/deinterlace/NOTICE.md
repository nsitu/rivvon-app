# BWDIF attribution

`bwdif.wgsl` is a WGSL adaptation of FFmpeg's BWDIF implementation:
https://github.com/FFmpeg/FFmpeg/blob/n4.1/libavfilter/vf_bwdif.c

Copyright (C) 2016 Thomas Mundt; 2006–2011 Michael Niedermayer;
2010 James Darnley; 2012 British Broadcasting Corporation.
The Weston three-field filter was developed by Jim Easterbrook and Martin
Weston at BBC Research & Development.

This shader is distributed under the GNU Lesser General Public License,
version 2.1 or (at your option) any later version. See `COPYING.LGPLv2.1`.
It is provided without any warranty, including implied warranties of
merchantability or fitness for a particular purpose.

Rivvon modifications: planar buffer bindings, WebGPU dispatch, two-field
scheduling, and adaptation of reference integer arithmetic to WGSL.
