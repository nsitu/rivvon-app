# Slyce
Slyce implements [slit-scan-inspired](https://en.wikipedia.org/wiki/Slit-scan_photography) techniques to derive cross-sections from videos for the purpose of creating temporally-curious animated textures. 

## Cross Sections 
Cross-sections are created by stitching together rows (or columns) of pixels from a series of adjacent video frames. 

## Segments
Cross-sections are split into a series of square segments. All segments have an identical [power-of-two dimension](https://wikis.khronos.org/opengl/Texture#:~:text=stick%20to%20powers%2Dof%2Dtwo) (256px, 512px, 1024px, etc). This approach allows us to efficiently handle long duration videos "one piece at a time" without hitting arbitrary cielings (e.g. canvas dimensions or GPU texture size). Segments are re-assembled as GPU textures at rendering time to create a panoramic appearance.

## Animation Context
Slit scan tradition has often explored inversions of the time and space axis. This involves taking multiple cross sections and playing them as frames in an animation. We adapt this approach with a bit of strategy: Instead of making 1080 cross-sections, we only need a small subset of these to get good results. We can make an animation using only 60 cross sections. We can achieve this via one of two possible sampling strategies, that we call `Planes` and `Waves`.

## Planes Sampling Strategy
Instead of making a cross section for all 1080 rows in an HD video, we only sample 60 cross sections, and we only sample rows that fit a cosine distribution. with One can do this in a linear way by sampling every single row. However by sampling strategically we can sample only 60 rows instead of 1080, and do so at strategic locations. . We use two different sampling strategies to support the creation of  cyclical (looping) animations. 

These animations may repeat as a clean loop or via a ping-pong (back-and-forth) rendering. As an example, we may create 60 cross-sections in order to build a 2-second animation at 30fps. 

## Tiles
We don't animate the cross-section, but instead we animate the segments within it. To facilitate animation we collect multiple segments into "tiles". A single tile may include 60 segments, drawn from 60 different cross sections each spanning the same temporal duration.  that span the same set of frames. This "tile" holds the frames of a loopable animation. Each frame is encoded as a [KTX2](https://github.khronos.org/KTX-Specification/ktxspec.v2.html) texture via a [WebAssembly](https://webassembly.org/) build of [basis encoder](https://github.com/BinomialLLC/basis_universal/tree/master/webgl/encoder/build) from [Binomial](https://www.binomial.info/). These are further assembled via [ktx2-parse](https://github.com/donmccurdy/KTX-Parse) as [KTX2](https://github.khronos.org/KTX-Specification/ktxspec.v2.html) compressed texture arrays. In this way the GPU loads the entire animation into memory, and can dispaly any given frame instantly by addressing one of the (e.g 60) distinct layers within with texture. Shaders make it possible to achieve this addressing in a way that facilitates efficient synchronized playback via looping or "ping-pong" based rendering 

##
It uses [mediabunny](https://github.com/Vanilagy/mediabunny) to handle WebCodecs decoding. Encoding to [KTX2](https://github.khronos.org/KTX-Specification/ktxspec.v2.html) format is done with [basis encoder](https://github.com/BinomialLLC/basis_universal).  From each frame, we sample rows or columns of pixels depending on the settings. Canvas dimensions are set based on frame count and are also adjustable via settings.

## Points of view
When the camera is vertical and panning horizontally (e.g. out of a car window), sample rows and write rows, you'll get a nice sway out of it.

## Development
The project uses Vite as a build tool. During development, use `npm run dev` to launch the Vite server. This project includes a GitHub action that builds the frontend and deploys it to GitHub Pages. 

## TODO
Explore other ideal combinations for various points of view (e.g. horizontal orientation, camera stationary, moving forward towards the horizon, etc.)

Explore whether we could sample rows of pixels in a way that takes into account pixels in nearby frames. If we represent raw RGBA data as a kind of 3D space via a multidimensional array, we might be able to calculate the properties of theoretical points that exist somewhere within that space. These points might be derivable from the surrounding pixels in a way that should give us a more flexible and fluid result. 

## Limitations
Your mileage may vary on devices with limited memory (RAM). 

## Colour Space and Gamma in ThreeJS
ThreeJS defines colour space options such as `THREE.LinearSRGBColorSpace` and `THREE.SRGBColorSpace` via [core constants](https://threejs.org/docs/#api/en/constants/Core). Note that WebGPU and WebGL may have different default behaviours with respect to colour space. I found that by setting WebGL to `THREE.LinearSRGBColorSpace` the result is similar to what WebGPU produces. I also found that `THREE.SRGBColorSpace` yields dark-looking output. However there may be other ways to think about this, especially if we take gamma settings into account. I would like to research this problem space further.

## Related 
A related tool here is the python library numpy. Elsewhere I have explored using a numpy multidimensional array to, for example swap the time and space axes in a video. See also [https://numpy.org/doc/stable/reference/generated/numpy.swapaxes.html#numpy.swapaxes](https://numpy.org/doc/stable/reference/generated/numpy.swapaxes.html#numpy.swapaxes). In JavaScript land, *scijs* supports n-dimensional arrays as well, but I don't know if this is the right avenue. See also [https://scijs.net/packages/#scijs/ndarray](https://scijs.net/packages/#scijs/ndarray)


