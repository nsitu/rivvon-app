## Notes about the purpose and approach of Use Tile Plan

Given a combination of settings and the file's metadata, calculate
the dimensions and frame ranges for each tile in a tile series.

Output is always in row orientation:

- Tile width = spatial side (sample pixel count or scaled POT resolution)
- Tile height = temporal side (number of frames)
  When samplingMode is 'columns', the canvas is rotated 90° so that
  column data is written as rows. This avoids needing a separate
  'columns' output path — rotation is handled during tile building.

When tile mode is 'full' there is only one tile.
We map effectiveFrameCount onto tile height (temporal)
and spatialSide onto tile width (spatial).

When tile mode is 'tile' there are multiple square POT tiles.
Both width and height equal potResolution, and framesPerTile = potResolution.

We are using "sample" to refer to a 1D array of pixels
sampled from one frame of video. This could be either:

- a row of pixels, when samplingMode == rows
  samplePixelCount is then width of the input video
- a column of pixels, when samplingMode == columns
  samplePixelCount is then height of the input video

Tiles have:

1.  A spatial side (width) corresponding to sample pixel count
2.  A temporal side (height) corresponding to frames

For square POT tiles, width = height = potResolution.
The number of constructable tiles is frameCount ÷ framesPerTile.
Leftover frames that don't fill a complete tile are skipped.

Tile frame ranges: each tile's start frame =
index × framesPerTile + 1, end frame = (index + 1) × framesPerTile.
