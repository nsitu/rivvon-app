create a rivvon wiki to document the project from an artistic, creative, historical dimensions.
https://rivvon.ca/wiki

Review the folder and file structure of the project. update naming conventions to reflect actual features instead of branding (e.g. references to "Slyce" could be replaced with "VideoProcessor"). Where applicable create subfolders that organize related code. Ensure that each file has a name that is sufficiently descriptive of purpose. refactor long files (1000+ lines) into manageable composable separate responsibilities.

it will be nice to create a grid of rendered sample videos that help to illustrate the behaviour of rivvon in terms of the various settings controls and modes. we could then ask targetted questions e.g. how does tile resolution affect aesthetics? and many other such questions, and we would enjoy a visual explanation of all the tradeoffs involved. one of those variables is of course the type of footage we are working with, so it may be interesting in this regard to draw from a variety of source videos that serve as examples of various kinds of shots e.g. panning, angular, moving to horizon, etc. It may be possible to find a common subject matter that is amenable to this kind of demo, or maybe you have a different subject to exemplify each type of shot.

introduce a testing framework that can be help us catch bugs.

Process notes for making videos that lend themselves to rivvon processing. If you have a video that is backlit, eg. smoke rising to cover the sun, then the shifts in lighting result in blips on the lighting spectrum. the camera adjusts for this with auto exposure. you could also set the exposure manually. or you could lean into the subtlety or those auto exposure shifts, and make those shifts the entire point. Similarly when shooting indoors there may be a flicker at high framerate due to the nature of household current. one would need to either compensate for this or roll with it.

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

i don't think we need to load the map tiles on pageload. we should delay this until the user actually goes into walk mode. also we can probably switch to a vector based map.
Carto publishes vector basemaps that can be used with maplibre GL
https://github.com/cartodb/basemap-styles

also, double check how the ort wasm is handled. are we using cdn for this? do we need to keep the wasm files areound?

Check whether we can patch the mjs to prevent these warnings: ort-wasm-simd-threaded.asyncify.mjs:83 2026-05-14 16:19:37.944325 [W:onnxruntime:, session_state.cc:1367 VerifyEachNodeIsAssignedToAnEp] Some nodes were not assigned to the preferred execution providers which may or may not have an negative impact on performance. e.g. ORT explicitly assigns shape related ops to CPU to improve perf.
