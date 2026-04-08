maybe we can share shapes as well as textures. this gives us an svg library as well as a texture library. the svg would need to be simplified, so as to keep only the paths that will be used for the ribbon, and not retain any extra colour.

When adjusting settings for a given video prior to processing, we might offer the user some sensible defaults based on the type of motion in the video. to support this we could do some initial profiling or analysis so as to categorize whether th evideo shows a panning motion, or other kinds of motion

we can use 3d face detection via the webcam to allow control of the camera orbit via the user's head movements. We can get inspiration from https://github.com/nsitu/mirror which also uses threejs

We can likely remove non-square options from the settings area, and simplify the video processing pipeline to assume square tiles with powers-of-two dimensions.

we can develop a realtime mode, see realtime-mode-plan.md

There is a popular game called snake, (in MSDOS there was a varriant called "nibbles" that ran in QBASIC). We could build a browser based variant of this that gamifies the creation of ribbons. In multiplayer mode, each player would first upload a video to enable their ribbon to appear as intented. At any chosen moment, or at the moment the game ends, we capture the state of the ribbons, and export a commemorative video to highlight the spirit of the competition. the winner posts the result to their socials as a victorious work of art.

when we have an svg that contains a cusp, the current approach involves smoothing it into something more like a spline. however, another way to make this work is to break the path into multiple paths. thus, whenever we encounter a cusp, we might cut the path at the point of the cusp. the cusp node then splits into two nodes, each of which represents the endpoint for a subpath. Edit: this has been implemented, but it needs documentation.

When we render a cinematic camera flow to mp4, it sometimes results in unexpected jumps in perspective. research why this happens and fix it so that the rendered mp4 always shows smooth camera action. Update: I think this has been worked on and needs review. We added an overlaay for debuging
