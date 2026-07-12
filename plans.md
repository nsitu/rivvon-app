create a rivvon wiki to document the project from an artistic, creative, historical dimensions.
https://rivvon.ca/wiki

Review the folder and file structure of the project. update naming conventions to reflect actual features instead of branding (e.g. references to "Slyce" could be replaced with "VideoProcessor"). Where applicable create subfolders that organize related code. Ensure that each file has a name that is sufficiently descriptive of purpose. refactor long files (1000+ lines) into manageable composable separate responsibilities.

you may be able to adjust drawing mode so that it generates a ribbon continuously in 3d rather than as a separate upfront process. the wave pattern generator already updates the length of the ribbon in realtime, so we ought to be able to extend that logic to a drawing as well. this mode may have pros and cons. e.g. if would feel more immediate but might also feel less accurate

in realtime we may be able to separate the encoding use case from the realtime diisplay use case. if we remove the encod requirement, we could go straight from the camera into a texture atlas or a ktx2 array, we can also render that same texture in real time, assuming that we are actually able to render a texture atlas while simultaneously writing to it.

Detailed implementation plan: see `plan-webcamLiveTextureAndKtx2Capture.prompt.md`.

Prerequisite rendering-architecture plan for shared atlas/array ownership: see `plan-deviceScopedTextureCoordinator.prompt.md`.

On iPad The default tile builder can be webgl Atlas
However there remains memory pressure. So we should not be decoding too far ahead. On low memory devices a better approach is to alternate between encoding and decoding. The goal is no longer to avoid waiting for decoding in this context
Instead the goal should be reliability. The old iPad is capable of all these things but maybe not all at once.

Investigate whether we are waiting for all tiles to encode prior to persisting them to the browser. We could perhaps persist the tiles as soon as they are done. Otherwise it's a long wait at the end.

it will be nice to create a grid of rendered sample videos that help to illustrate the behaviour of rivvon in terms of the various settings controls and modes. we could then ask targetted questions e.g. how does tile resolution affect aesthetics? and many other such questions, and we would enjoy a visual explanation of all the tradeoffs involved. one of those variables is of course the type of footage we are working with, so it may be interesting in this regard to draw from a variety of source videos that serve as examples of various kinds of shots e.g. panning, angular, moving to horizon, etc. It may be possible to find a common subject matter that is amenable to this kind of demo, or maybe you have a different subject to exemplify each type of shot.

Process note: to make videos that lend themselves to rivvon processing-- If you have a video that is backlit, eg. smoke rising to cover the sun, then the shifts in lighting result in blips on the lighting spectrum. the camera adjusts for this with auto exposure. you could also set the exposure manually. or you could lean into the subtlety or those auto exposure shifts, and make those shifts the entire point. Similarly when shooting indoors there may be a flicker at high framerate due to the nature of household current. one would need to either compensate for this or roll with it.

Review whether you want emojii and text to appear in the drawing history. shouldn't they have their own history, given that they are unique modes?

Whenever an emoji is used we could increment its popularity value in a list of frequently used emoji. we can then add a tab to the emoji seciton to show the user's previous emoji in one place. Given that emoji are already also captured as drawings, there's some duplication of concept here.

We already have a drawing library. However within this context, there might be some particular shapes that we want to highlight. Review the publishing workflow here to see what can be done, e.g. marking a drawing as featured makes it special within the rivvon ecosystem. Maybe that is as simple as placing it in R2 as we already do for textures?

Future opportunity: reconcile the Cloudflare D1 database with Wrangler's tracked migration system so we can safely use `wrangler d1 migrations list/apply`. Current reference: migrations are applied as individual SQL files from `apps/api/db/migrations/` via direct `wrangler d1 execute ... --remote --file=...` commands because older schema changes were applied manually and are not recorded in `d1_migrations`.

When adjusting settings for a given video prior to processing, we might offer the user some sensible defaults based on the type of motion in the video. to support this we could do some initial profiling or analysis so as to categorize whether the video shows a panning motion, or other kinds of motion

There is a popular game called snake, (in MSDOS there was a varriant called "nibbles" that ran in QBASIC). We could build a browser based variant of this that gamifies the creation of ribbons. In multiplayer mode, each player would first upload a video to enable their ribbon to appear as intented. At any chosen moment, or at the moment the game ends, we capture the state of the ribbons, and export a commemorative video to highlight the spirit of the competition. the winner posts the result to their socials as a victorious work of art.

Support gif
Make camera on off easier and safer
Make cinematic export more intuitive and guided, it likely needs a separate workflow overlay.
Or maybe research better patterns for the use case?

Make the drawing canvas composable
So you can add multiple elements to it including emoji text and hand drawn elements and walks. And then also make it so you can move them around and scale them

Some workflows do well with the full screen but others could be improved by treating them as an overlay. The difference is when we need to see the result in the renderer in real-time.

we may benefit from switching to a vector based map.
Carto publishes vector basemaps that can be used with maplibre GL
https://github.com/cartodb/basemap-styles
maplibre is a bit heavier and uses webgl, while leaflet is quite light. it may be possible to get leaflet to render vector tiles with a plugin?
there is also protomaps which is open source, look into it.

also, double check how the ort wasm is handled. are we using cdn for this? do we need to keep the wasm files around?

Check whether we can patch the mjs to prevent these warnings: ort-wasm-simd-threaded.asyncify.mjs:83 2026-05-14 16:19:37.944325 [W:onnxruntime:, session_state.cc:1367 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance. e.g. ORT explicitly assigns shape related ops to CPU to improve perf.

some current animation targets the geometry and other animation targets texture / transparency
look into adding a geometry animation as follows.
instead of creating a ribbon from an input drawing we would have an input signal (e.g. a sine wave) that animates over time, the effective drawing is the plot of that function, and it would change on every frame. the implication is that the tiles would flow along that plot line instead of along a fixed drawing. place it in the draw menu as a "Sine Wave" option.

given the input drawing, use a cyclical noise to cause the lines to vibrate (this is similar to what we already do with edge noise / edge drift). The result is that on every frame we get a different variation on the drawing, but it these variations are loopable such that we will always return to our starting point. we may need to recalculate tiles as the input artwork evolves. this is where it gets tricky because it's an open question what continuity should look like here. if there's an index of tiles, and they map onto the drawing in a given way, then on the subsequent frame, all the tiles will shift in their position, and we might also gain or loose tiles as the vibrating drawing expands and contracts. when the number of tiles that are needed to fill the ribbon. add a feture that animates the geometry itself rather than the textures

explore using the webcam to generate an animating ribbon based on the user's profile. inspiration via https://github.com/nsitu/bodychalk
note that the pose landmarker is likely different from the face landmarker which we are already using.

Check if you can Get Bliss Symbols to work as a Single Line font.
https://en.wikipedia.org/wiki/Blissymbols

the logo corner select dropdown can include icons for the positions.
'north_west' for Top Left
'north_east' for Top Right
etc.

the contrast and saturation sliders are smooth now.This is owing to having shifted the behaviour of the UI so as to not have to refresh continually during the slide. I think there is a data bus involved that sidesteps prop drilling. I wonder if the bus is uniquely suited to the sliders here because of their frequent updates? or should we use that pattern more broadly? I want to understand the architecture.

There remain other sliders that still cause fps dips. maybe for the same reason or maybe for different reasons.

on mobile after texture is 100% saved to the browser we still end up waiting for a quite a while before it is actually done. so review the progress indicator here.

we can construct a cinematic by defining a series of points of interest and then sweeping through them. however we might in addition have a separate mode that can record the user's manual orbit controls, and then play them back in the viewer itself as well as during rendering and exporting. The captured movements in the scene might also be tweaked prior to export so as to make them appear smoother than what a manual click and drag might normally accomplish. this smoothing could be explored as a later add on.
