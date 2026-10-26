// Backport https://github.com/ffmpegwasm/ffmpeg.wasm/pull/943 to @ffmpeg/core 0.12.10.
// FFmpeg exits by throwing through JS, leaving its WASM stack pointer lowered.
// Restore it on every exit, including nonzero exits and unexpected exceptions.
// This only changes the JS binding; the matching pinned WASM stays unchanged.
export function patchFfmpegCore(source) {
    for (const [name, entry, defaults] of [
        ['exec', '_ffmpeg', 'DEFAULT_ARGS'],
        ['ffprobe', '_ffprobe', 'DEFAULT_ARGS_FFPROBE'],
    ]) {
        const original = `function ${name}(..._args){const args=[...Module["${defaults}"],..._args];try{Module["${entry}"](args.length,stringsToPtr(args))}catch(e){if(!e.message.startsWith("Aborted")){throw e}}return Module["ret"]}`;
        const patched = original
            .replace(';try{', ';const sp=stackSave();try{')
            .replace('}return Module["ret"]}', '}finally{stackRestore(sp)}return Module["ret"]}');
        if (source.split(original).length !== 2) {
            throw new Error(`Cannot patch FFmpeg ${name}: expected the pinned @ffmpeg/core 0.12.10 binding exactly once. Review the stack fix before changing the core version.`);
        }
        source = source.replace(original, patched);
    }
    return source;
}
