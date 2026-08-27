# Android video gallery handover

## Objective

Build Android client features that discover public Rivvon gallery videos and play them continuously on a photo frame or other kiosk-style display.

This is a read-only client. It must not contain Cloudflare credentials, create publications, or call authenticated management endpoints.

## Production services

- Gallery API: `https://api.rivvon.ca`
- Web gallery: `https://rivvon.ca/videos`
- Public media CDN: `https://cdn.rivvon.ca`
- All three services use HTTPS.

Public gallery reads require no cookie, bearer token, API key, or Google session. Native Android clients are not subject to browser CORS rules.

## Public API contract

### List public videos

```http
GET https://api.rivvon.ca/videos?limit=24&offset=0
Accept: application/json
```

The API returns only records where `status` is `complete` and `is_public` is `true`, ordered newest first by `created_at`.

- `limit` defaults to 24 and is clamped to 1–100.
- `offset` defaults to 0 and cannot be negative.
- Use `offset + videos.size < pagination.total` to determine whether another page exists.
- There is currently no cursor, `updated_since` filter, channel, tag, search, or server-selected playlist.

Example response, with identifying values replaced by placeholders:

```json
{
  "videos": [
    {
      "id": "public-video-id",
      "owner_id": "owner-id",
      "name": "rivvon-export",
      "description": null,
      "thumbnail_url": "https://cdn.rivvon.ca/video-thumbnails/public-video-id.webp",
      "format": "mp4",
      "mime_type": "video/mp4",
      "width": 2160,
      "height": 2160,
      "duration": 8,
      "fps": 30,
      "file_size": 24123575,
      "storage_provider": "r2",
      "playback_url": "https://cdn.rivvon.ca/videos/public-video-id/video.mp4",
      "drive_file_id": null,
      "status": "complete",
      "is_public": true,
      "created_at": 1787619194,
      "updated_at": 1787619195,
      "owner_name": "Artist name",
      "owner_picture": "https://example.com/profile-image",
      "export_settings": {
        "width": 2160,
        "height": 2160,
        "fps": 30,
        "format": "mp4",
        "resolvedDuration": 8
      }
    }
  ],
  "pagination": {
    "limit": 24,
    "offset": 0,
    "total": 1
  }
}
```

The following fields should be treated as nullable or optional in the Android DTO even when the current response usually includes them:

- `description`
- `thumbnail_url`
- `drive_file_id`
- `owner_name`
- `owner_picture`
- `export_settings` and all properties inside it

`created_at` and `updated_at` are Unix timestamps in seconds. `duration` is seconds and may be fractional. `file_size` is bytes. Do not use `owner_id` as a display name or assume the shape of `export_settings` is stable.

### Fetch one public video

```http
GET https://api.rivvon.ca/videos/{videoId}
Accept: application/json
```

Success response:

```json
{
  "video": {
    "id": "public-video-id",
    "name": "rivvon-export",
    "mime_type": "video/mp4",
    "playback_url": "https://cdn.rivvon.ca/videos/public-video-id/video.mp4",
    "is_public": true
  }
}
```

The actual `video` object has the same fields as list results. A missing, incomplete, deleted, or private video returns HTTP 404:

```json
{ "error": "Video not found" }
```

Private records deliberately look nonexistent to unauthenticated clients.

### Endpoints the Android display client must not use

- `GET /my-videos` requires an authenticated owner session.
- All methods under `/video` create, update, complete, or delete publications and require authentication. Creation is currently admin-only.

## Media delivery behavior

Use `playback_url` exactly as returned by the API; do not reconstruct R2 object keys in the app. Use `thumbnail_url` exactly as returned when it is present.

The CDN currently provides:

- `video/mp4` or `video/webm` content types.
- HTTP byte-range responses. A production probe for `Range: bytes=0-1023` returned `206 Partial Content` and a valid `Content-Range` header.
- `Cache-Control: public, max-age=31536000, immutable` for published video and thumbnail objects.
- Stable, version-like object URLs: replacing a publication should result in a new video ID and URL.

Published files may be as large as 2 GiB. Stream through the media player or use a bounded media cache; do not load an entire video into application memory.

The current API accepts MP4 and WebM containers but does not expose codec, profile, level, bitrate, audio-track, HDR, or rotation metadata. MP4 should be the most broadly compatible path, but the client must handle an unsupported file gracefully and advance to another item rather than becoming stuck.

## Recommended Android implementation

Use AndroidX Media3 with ExoPlayer. Feed each API result into a `MediaItem` using its `playback_url`, and set its MIME type when available. Use Coil or the app's existing image loader for `thumbnail_url`.

For a single selected video:

```kotlin
val mediaItem = MediaItem.Builder()
    .setMediaId(video.id)
    .setUri(video.playbackUrl)
    .setMimeType(video.mimeType)
    .build()

player.setMediaItem(mediaItem)
player.repeatMode = Player.REPEAT_MODE_ONE
player.prepare()
player.playWhenReady = true
```

For a gallery playlist, provide multiple `MediaItem` instances and use `Player.REPEAT_MODE_ALL`. ExoPlayer looping is best-effort gapless; validate the actual exported files and target hardware if seamless visual loops are a product requirement.

Suggested DTO boundary:

```kotlin
@Serializable
data class GalleryResponse(
    val videos: List<GalleryVideo>,
    val pagination: GalleryPagination
)

@Serializable
data class GalleryPagination(
    val limit: Int,
    val offset: Int,
    val total: Int
)

@Serializable
data class GalleryVideo(
    val id: String,
    val name: String,
    val description: String? = null,
    @SerialName("thumbnail_url") val thumbnailUrl: String? = null,
    val format: String,
    @SerialName("mime_type") val mimeType: String,
    val width: Int,
    val height: Int,
    val duration: Double,
    val fps: Double,
    @SerialName("file_size") val fileSize: Long? = null,
    @SerialName("playback_url") val playbackUrl: String,
    @SerialName("created_at") val createdAt: Long,
    @SerialName("updated_at") val updatedAt: Long,
    @SerialName("owner_name") val ownerName: String? = null
)
```

Choose Retrofit/OkHttp, Ktor, or the Android app's established networking stack. Keep API and CDN base URLs in build configuration rather than scattering string constants through UI code.

## Suggested display modes

The server currently exposes a time-ordered gallery, not frame assignments. Implement the selection policy as a replaceable local abstraction. A practical first version is:

1. `Newest`: loop the first playable item returned by `GET /videos?limit=10&offset=0`.
2. `Gallery loop`: play all compatible items from the first page, newest first.
3. `Pinned video`: persist a chosen public video ID and refresh it through `GET /videos/{id}`.

Default to `Newest` only if product direction has not specified another policy. Persist the last known-good metadata and selected ID locally so the frame can resume playback after an app or device restart.

## Refresh and offline behavior

- Fetch on cold start and when connectivity returns.
- While the display is active, poll the list endpoint at a conservative interval such as 5–15 minutes with exponential backoff after failures.
- Do not restart a currently playing video merely because an unchanged gallery response arrived.
- Compare stable IDs and `updated_at` values before replacing a playlist.
- Retain the last known-good playlist and bounded cached media for offline playback.
- If a pinned record becomes 404, stop retrying it aggressively and fall back to the configured empty/deleted behavior.
- If a CDN request returns 404 or a decoder error occurs, mark that item failed for the current refresh cycle and advance.
- Avoid tight retry loops. Add jitter because many frames may reconnect simultaneously.

The gallery API does not currently advertise an `ETag` or delta token. Conditional refresh and incremental synchronization would require a backend enhancement.

## Kiosk/player behavior

- Keep the screen awake only while the display experience is active.
- Use immersive fullscreen appropriate to the target Android version.
- Provide configurable `FIT` versus `ZOOM` scaling; do not assume all exports match the frame aspect ratio.
- Show the thumbnail or a neutral background during player preparation and network recovery.
- Suppress player controls for unattended kiosk playback, but keep a service/debug path that exposes the current video ID and last error.
- Restore playback automatically after transient network, decoder, audio-focus, surface, or lifecycle interruptions.
- Decide explicitly whether audio should be muted. The API does not currently state whether a video has an audio track.
- Treat API text and image URLs as untrusted remote content. Render names/descriptions as text, and accept media only over HTTPS.

## Acceptance checklist

- A fresh install can fetch the public gallery without authentication.
- Empty galleries render a stable waiting state and continue polling.
- A public MP4 begins playing from its CDN URL and loops indefinitely.
- The player can seek through a range-enabled CDN response.
- A poster is shown while media is preparing when `thumbnail_url` exists.
- A missing thumbnail does not prevent playback.
- A deleted/private video and an unsupported codec do not trap the player in a retry loop.
- The frame recovers after losing and regaining network access.
- The last known-good selection can play after process/device restart and, when cached, offline.
- Playlist refresh does not interrupt an unchanged current item.
- Large videos are streamed or bounded by cache policy rather than read fully into memory.
- No Cloudflare, Google, session, or publishing credentials are present in the Android build.

## Likely follow-up API enhancements

The first Android client can ship against the current API. Multi-frame or curated installations will probably benefit from a later server-side concept such as a `channel` or `playlist`, with frame assignment independent of the global public gallery.

Other useful additions would be:

- Cursor pagination or `updated_since` synchronization.
- API `ETag`/`Last-Modified` support.
- Codec/profile/bitrate/audio metadata for device compatibility filtering.
- A publication deletion/change feed.
- An optional lightweight playback manifest containing only fields required by unattended clients.
- A remotely configurable fallback asset and display policy.

Do not block the initial Android work on these enhancements; isolate list selection and refresh logic so a future manifest or channel endpoint can replace the global gallery source cleanly.

## Source-of-truth files

- Public read routes: `apps/api/routes/videos.ts`
- Route mounts: `apps/api/index.ts`
- Publication/storage behavior: `apps/api/routes/videoUpload.ts`
- Database record: `apps/api/db/migrations/007_video_exports.sql`
- Existing web API client: `apps/rivvon/src/services/videoService.js`
- Existing web player behavior: `apps/rivvon/src/views/VideoPlayerView.vue`

The deployed contract was last verified on 2026-08-24 against `api.rivvon.ca` and `cdn.rivvon.ca`.
