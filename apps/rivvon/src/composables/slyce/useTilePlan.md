## Notes about the purpose and approach of Use Tile Plan

   given a combination of settings
     and the file's metadata, calculate
     the dimensions and frame ranges
     for each tile in a tile series

     When tile mode is 'full' there is only one tile
     and things are relatively simple.
     we only need to map app.frameCount onto tile height or width
     depending on the samplingMode
     and also map samplePixelCount onto the other dimension.

     When tile mode is 'tile' there are multiple tiles
     that break up the otherwise full output into smaller parts
     the dimensions of the tiles are constrained by various settings

     For square tiles, the width and height are the same
     and therefore outputMode may be less relevant
     when it comes to calculating tile dimensions.

     We are using "sample" to refer to 1D array of pixels 
     sampled from one frame of video. This could be either:
     - a row of pixels, when samplingMode == rows
       samplePixelCount is then width of the input video
     - a column of pixels, when samplingMode == columns
       samplePixelCount is then height of the input video

     It may be useful to think about tiles as having:
     1. A spatial side that corresponds to the width or height of a source frame
     - if outputMode is rows, the width of the tile is the spatial side
     - if outputMode is columns, the height of the tile is the spatial side
     2. A temporal side that corresponds to multiple frames in the source video
     - if outputMode is rows, the height of the tile is the temporal side
     - if outputMode is columns, the width of the tile is the temporal side

     When quality is prioritized, 
     We try to preserve the full sample resolution i.e. samplePixelCount
         NOTE: this will have been derived from either rows or columns 
         depending on the chosen samplingMode
     Tile dimensions are then as follows:
     - First dimension: samplePixelCount 
     - Second dimension: calculated based on tileProportion and outputMode
     If outputMode is 'rows', samplePixelCount becomes the width of the tile
      in landscape the height is 9/16 of the width
      in portrait the height is 16/9 of the width
      for square tiles, the width and height are the same
     If outputMode is 'columns', samplePixelCount becomes the height of the tile
      in landscape the width is 16/9 of the height
      in portrait the width is 9/16 of the height
      for square tiles, the width and height are the same 
     Having thus calculated the tile dimensions
     we know how many pixels are needed for the temporal side of each tile
     we will need the same number of frames in order to fully populate the tile with pixels.
     we may have sufficient frames to construct multiple tiles
     to check the maximum number of constructable tiles
     We take the number of available samples (i.e. app.frameCount)
     and divide by the number of pixels needed for the temporal side of each tile
     this will tell us how many tiles are possible.
     we might have some frames left over but we will discard them since
     we are prioritizing quality over quantity.
     it's also possible that there are insufficient frames to construct a single tile
     in which case it may be better to priotitize quantity over quality.
 
     when quantity is prioritized,
     We downsample the sampled pixels to such a dimension
     as would allow for one extra tile to fit within app.frameCount
     We must therefore first determine how many tiles could be constructed
     if we were using the full sample resolution.
     We might need to borrow some initial logic from the "quality" case
     so as to have a point of reference.
     whatever the maximum number of possible tiles is for "quality"
     we will add one to it,
     and this becomes the target number of tiles for "quantity" case.
     Once we have the target number of tiles, 
     we can calculate the actual dimensions of the tiles
     we would take app.frameCount and divide by the target number of tiles
     this will give us the number of frames that can be allocated to each tile
     on its temporal side. 
     if outputMode is 'rows', the height of the tile is the temporal side
     -in this case we would need to calculate the width of the tile
     -if the tileProportion is square, the width and height are the same
     -if the tileProportion is landscape, the width is 16/9 of the height
     -if the tileProportion is portrait, the width is 9/16 of the height
     if outputMode is 'columns', the width of the tile is the temporal side
     -in this case we would need to calculate the height of the tile
     -if the tileProportion is square, the width and height are the same
     -if the tileProportion is landscape, the height is 9/16 of the width
     -if the tileProportion is portrait, the height is 16/9 of the width
     
     regarding the tile ranges, we need to know the start and end frame numbers
     for each tile. 
     we would need to iterate over the number of tiles
     and for each tile, calculate the start and end frame numbers
     the start frame number is the index of the tile 
     multiplied by the number of frames per tile (i.e. the number pixels on the temporal side)
     plus one (because frame numbers are not zero indexed but start from 1)
     the end frame number is the index of the tile plus one
     multiplied by the number of frames per tile (i.e. the number of pixels on the temporal side)
    
