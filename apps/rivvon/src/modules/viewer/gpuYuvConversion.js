import { srgbToBt709, validateSdrDimensions } from './exportColour.js';

const vertexSource = `#version 300 es
void main() {
    vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Pack four consecutive I420 bytes into each RGBA8 output texel. This is an
// internal readback surface, never a canvas passed to the encoder as RGB.
const fragmentSource = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D sourceRgb;
uniform sampler2D transferLut;
uniform ivec2 size;
uniform int packedWidth;
uniform bool fullRange;
out vec4 packed;

vec3 rgb709(ivec2 p) {
    ivec3 rgb = ivec3(floor(texelFetch(sourceRgb, p, 0).rgb * 255.0 + 0.5));
    return vec3(texelFetch(transferLut, ivec2(rgb.r, 0), 0).r,
                texelFetch(transferLut, ivec2(rgb.g, 0), 0).r,
                texelFetch(transferLut, ivec2(rgb.b, 0), 0).r);
}
float luma(vec3 rgb) { return dot(rgb, vec3(0.2126, 0.7152, 0.0722)); }
float encodeByte(int index) {
    int pixels = size.x * size.y;
    if (index >= pixels * 3 / 2) return 0.0;
    if (index < pixels) {
        vec3 rgb = rgb709(ivec2(index % size.x, index / size.x));
        float lo = fullRange ? 0.0 : 16.0;
        float scale = fullRange ? 255.0 : 219.0;
        return floor(clamp(lo + scale * luma(rgb), lo, lo + scale) + 0.5);
    }
    bool isU = index < pixels * 5 / 4;
    int chroma = index - (isU ? pixels : pixels * 5 / 4);
    ivec2 origin = ivec2(chroma % (size.x / 2), chroma / (size.x / 2)) * 2;
    float sum = 0.0;
    for (int y = 0; y < 2; ++y) for (int x = 0; x < 2; ++x) {
        vec3 rgb = rgb709(origin + ivec2(x, y));
        sum += isU ? (rgb.b - luma(rgb)) / 1.8556 : (rgb.r - luma(rgb)) / 1.5748;
    }
    float scale = fullRange ? 255.0 : 224.0;
    return floor(clamp(128.0 + scale * sum / 4.0, fullRange ? 0.0 : 16.0,
                       fullRange ? 255.0 : 240.0) + 0.5);
}
void main() {
    int index = (int(gl_FragCoord.y) * packedWidth + int(gl_FragCoord.x)) * 4;
    packed = vec4(encodeByte(index), encodeByte(index + 1),
                  encodeByte(index + 2), encodeByte(index + 3)) / 255.0;
}`;

// Export-owned WebGL2 context; never changes the scene renderer or its state.
// Source is the opaque sRGB export compositor, already including the logo.
export function createGpuYuvConversion(width, height, { fullRange = false } = {}) {
    validateSdrDimensions(width, height, 30);
    const surface = document.createElement('canvas');
    const packedWidth = Math.ceil(width / 4), bytes = width * height * 3 / 2;
    const packedHeight = Math.ceil(bytes / (packedWidth * 4));
    surface.width = packedWidth; surface.height = packedHeight;
    const gl = surface.getContext('webgl2', { alpha: false, antialias: false, depth: false,
        stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is unavailable for YUV conversion.');
    const textures = [], shaders = [];
    let program, framebuffer, vao, disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        textures.forEach(texture => gl.deleteTexture(texture));
        shaders.forEach(shader => gl.deleteShader(shader));
        if (program) gl.deleteProgram(program);
        if (framebuffer) gl.deleteFramebuffer(framebuffer);
        if (vao) gl.deleteVertexArray(vao);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        surface.width = surface.height = 1;
    };
    try {
        const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (Math.max(width, height, packedWidth, packedHeight) > maxSize) {
            throw new Error(`YUV conversion exceeds this GPU's ${maxSize}px texture limit.`);
        }
        const compile = (type, source) => {
            const shader = gl.createShader(type); shaders.push(shader);
            gl.shaderSource(shader, source); gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`YUV shader failed: ${gl.getShaderInfoLog(shader)}`);
            return shader;
        };
        program = gl.createProgram();
        gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
        gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`YUV shader link failed: ${gl.getProgramInfoLog(program)}`);
        gl.useProgram(program);
        vao = gl.createVertexArray(); gl.bindVertexArray(vao);
        const texture = (unit, internalFormat, w, h, format, type, data) => {
            const result = gl.createTexture(); textures.push(result);
            gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, result);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data);
            return result;
        };
        const rgb = texture(0, gl.RGBA8, width, height, gl.RGBA, gl.UNSIGNED_BYTE, null);
        texture(1, gl.R32F, 256, 1, gl.RED, gl.FLOAT,
            Float32Array.from({ length: 256 }, (_, i) => srgbToBt709(i / 255)));
        const output = texture(2, gl.RGBA8, packedWidth, packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, null);
        framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('YUV readback framebuffer is incomplete.');
        gl.uniform1i(gl.getUniformLocation(program, 'sourceRgb'), 0);
        gl.uniform1i(gl.getUniformLocation(program, 'transferLut'), 1);
        gl.uniform2i(gl.getUniformLocation(program, 'size'), width, height);
        gl.uniform1i(gl.getUniformLocation(program, 'packedWidth'), packedWidth);
        gl.uniform1i(gl.getUniformLocation(program, 'fullRange'), Number(fullRange));
        gl.viewport(0, 0, packedWidth, packedHeight);
        gl.disable(gl.DITHER); gl.disable(gl.BLEND);
        gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        if (gl.getError() !== gl.NO_ERROR) throw new Error('Failed to initialize GPU YUV conversion.');
        // Most dimensions pack exactly. A reusable tail buffer handles e.g. 2x2.
        const padded = packedWidth * packedHeight * 4 === bytes ? null : new Uint8Array(packedWidth * packedHeight * 4);
        return {
            readbackBytesPerFrame: packedWidth * packedHeight * 4,
            convert(canvas, target) {
                if (disposed || gl.isContextLost()) throw new Error('GPU YUV conversion context was lost.');
                if (target.length !== bytes) throw new Error('Invalid YUV target buffer size.');
                gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, rgb);
                // With flip disabled, texture row zero is the source's top row.
                // The shader writes I420 row zero to framebuffer/readPixels row zero.
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
                gl.readPixels(0, 0, packedWidth, packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, padded ?? target);
                if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw new Error('GPU YUV conversion or readback failed.');
                if (padded) target.set(padded.subarray(0, bytes));
                return target;
            },
            dispose,
        };
    } catch (error) { dispose(); throw error; }
}
