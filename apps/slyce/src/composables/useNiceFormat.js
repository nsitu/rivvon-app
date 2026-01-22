
export function useNiceFormat() {

    const niceDuration = (duration) => {
        const hours = Math.floor(duration / 3600)
        const minutes = Math.floor((duration % 3600) / 60).toString().padStart(2, '0')
        const seconds = Math.floor(duration % 60).toString().padStart(2, '0')
        const milliseconds = Math.floor((duration % 1) * 1000).toString().padStart(3, '0')

        let result = `${minutes}:${seconds}.${milliseconds}`

        if (hours > 0) {
            result = `${hours}:${result}`
        }

        return result
    }

    const niceBitRate = (bitRate) => {
        const kb = bitRate / 1000
        const mb = kb / 1000
        return `${mb.toFixed(2)} Mbps`
    }

    const niceFrameRate = (frameRate) => {
        if (!frameRate) return 0
        const [num, den] = frameRate.split('/').map(Number)
        const frameRateNum = num / den
        return frameRateNum.toFixed(2)
    }
    /**vp08		VP            WebM / Google
    vp09		VP            WebM / Google
    hvc1		HEVC          High Efficiency Video Coding / H.265
    avc1		AVC           Advanced Video Coding / H.264
    av01		AV            Alliance for Open Media / AOMedia Video 1 */
    const niceCodec = (codec) => {
        if (codec?.startsWith('avc')) {
            //(Advanced Video Coding)
            return 'H.264 / AVC'
        }
        else if (codec?.startsWith('av01')) {
            // (Alliance for Open Media)
            return 'AV1 / AOMedia Video 1'
        }
        else if (codec?.startsWith('hvc1') || codec?.startsWith('hev1')) {
            // (High Efficiency Video Coding)
            return 'H.265 / HEVC'
        }
        else if (codec?.startsWith('vp8')) {
            return 'VP8 / WebM / Google'
        }
        else if (codec?.startsWith('vp9') || codec?.startsWith('vp09')) {
            return 'VP9 / WebM / Google'
        }
        else {
            return codec
        }
    }

    return {
        niceDuration,
        niceBitRate,
        niceFrameRate,
        niceCodec
    }
}


