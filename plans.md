it will be nice to create a grid of rendered sample videos that help to illustrate the behaviour of rivvon in terms of the various settings controls and modes. we could then ask targetted questions e.g. how does tile resolution affect aesthetics? and many other such questions, and we would enjoy a visual explanation of all the tradeoffs involved. one of those variables is of course the type of footage we are working with, so it may be interesting in this regard to draw from a variety of source videos that serve as examples of various kinds of shots e.g. panning, angular, moving to horizon, etc. It may be possible to find a common subject matter that is amenable to this kind of demo, or maybe you have a different subject to exemplify each type of shot.

add a duotone filter mechanism with a colour picker that leverages the shader pipeline to render textures in a duotone instead of using their default hue.

during the creation of tiles, the bottleneck seems not to be encoding or decoding, but rather the assembling of the tiles by copying many rows from the source onto the marshalling canvasses. it's possible that we can instead do this by putting all the pixels we need for a given tile directly into ram, and then performing the rearranging all at once. this might be similar to what we've done with numpy previosuly, but let's look into it.

if you have a shot that is backlit, eg. smoke rising to cover the sun, then the shifts in lighting result in blips on the lighting spectrum. the camera adjusts for this with auto exposure. you could also set the exposure manually. or you could lean into the subtlety or those auto exposure shifts, and make those shifts the entire point.

Whenever an emoji is used we should increment its popularity value in a list of frequently used emoji. we can then add a tab to the emoji seciton to show the user's previous emoji in one place.

maybe we can share shapes as well as textures. this gives us an svg library as well as a texture library. the svg would need to be simplified, so as to keep only the paths that will be used for the ribbon, and not retain any extra colour.

Future opportunity: reconcile the Cloudflare D1 database with Wrangler's tracked migration system so we can safely use `wrangler d1 migrations list/apply`. Current reference: migrations are applied as individual SQL files from `apps/api/db/migrations/` via direct `wrangler d1 execute ... --remote --file=...` commands because older schema changes were applied manually and are not recorded in `d1_migrations`.

When adjusting settings for a given video prior to processing, we might offer the user some sensible defaults based on the type of motion in the video. to support this we could do some initial profiling or analysis so as to categorize whether the video shows a panning motion, or other kinds of motion

There is a popular game called snake, (in MSDOS there was a varriant called "nibbles" that ran in QBASIC). We could build a browser based variant of this that gamifies the creation of ribbons. In multiplayer mode, each player would first upload a video to enable their ribbon to appear as intented. At any chosen moment, or at the moment the game ends, we capture the state of the ribbons, and export a commemorative video to highlight the spirit of the competition. the winner posts the result to their socials as a victorious work of art.

currently when i have a texture loaded in the main robbon, and then I visit the texture overview for that texture, it appears to re-load the same texture again. this seems redundant. it would be more efficient and safe download time, to share textures between the two renderers or otherwise use cached resources instead of duplicating them.
