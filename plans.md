maybe we can share shapes as well as textures. this gives us an svg library as well as a texture library. the svg would need to be simplified, so as to keep only the paths that will be used for the ribbon, and not retain any extra colour.

When adjusting settings for a given video prior to processing, we might offer the user some sensible defaults based on the type of motion in the video. to support this we could do some initial profiling or analysis so as to categorize whether th evideo shows a panning motion, or other kinds of motion

when we have an svg that contains a cusp, the current approach involves smoothing it into something more like a spline. however, another way to make this work is to break the path into multiple paths. thus, whenever we encounter a cusp, we might cut the path at the point of the cusp. the cusp node then splits into two nodes, each of which represents the endpoint for a subpath

When we render a cinematic camera flow to mp4, it sometimes results in unexpected jumps in perspective. research why this happens and fix it so that the rendered mp4 always shows smooth camera action.
