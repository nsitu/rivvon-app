import { EventEmitter } from 'events';
import { getCached2dContext } from './samplingRuntime.js';

const CROSS_SECTION_PLANES = 'planes';
const SAMPLING_ROWS = 'rows';

function createCanvasSurface(width, height) {
    if (typeof OffscreenCanvas !== 'undefined') {
        try {
            return new OffscreenCanvas(width, height);
        } catch (error) {
            console.warn('[WebGLTileBuilder] OffscreenCanvas unavailable, falling back to DOM canvas:', error);
        }
    }

    if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    throw new Error('Canvas creation is unavailable in this environment.');
}

function buildAtlasLayout(tileWidth, tileHeight, layerCount, maxTextureSize) {
    if (!Number.isFinite(tileWidth) || !Number.isFinite(tileHeight) || !Number.isFinite(layerCount)) {
        return null;
    }

    if (tileWidth < 1 || tileHeight < 1 || layerCount < 1) {
        return null;
    }

    if (tileWidth > maxTextureSize || tileHeight > maxTextureSize) {
        return null;
    }

    const maxColumns = Math.max(1, Math.floor(maxTextureSize / tileWidth));
    const columns = Math.min(layerCount, maxColumns);
    const rows = Math.ceil(layerCount / columns);

    if (rows * tileHeight > maxTextureSize) {
        return null;
    }

    return {
        columns,
        rows,
        width: columns * tileWidth,
        height: rows * tileHeight,
    };
}

function getLayerCell(layout, layerIndex, tileWidth, tileHeight) {
    const column = layerIndex % layout.columns;
    const row = Math.floor(layerIndex / layout.columns);

    return {
        x: column * tileWidth,
        y: row * tileHeight,
    };
}

function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || 'Shader compilation failed.';
        gl.deleteShader(shader);
        throw new Error(message);
    }

    return shader;
}

function linkProgram(gl, vertexShader, fragmentShader) {
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(program) || 'Program linking failed.';
        gl.deleteProgram(program);
        throw new Error(message);
    }

    return program;
}

function createWebGLProgram(gl) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
precision highp float;

in vec2 aCorner;

uniform vec2 uAtlasSize;
uniform vec2 uTileSize;
uniform int uAtlasColumns;
uniform int uCrossSectionCount;
uniform int uCrossSectionType;
uniform float uDistributionRange;
uniform float uDrawRow;
uniform float uFrameIndex;
uniform float uFrameCount;

out vec2 vLocalCoord;
flat out float vSampleLocation;

const float PI = 3.1415926535897932384626433832795;

float resolveSampleLocation(int layerIndex) {
    if (uCrossSectionType == 0) {
        if (uCrossSectionCount <= 1) {
            return 0.5 * max(uDistributionRange - 1.0, 0.0);
        }

        float normalizedIndex = (float(layerIndex) / float(uCrossSectionCount - 1)) * PI;
        return ((cos(normalizedIndex) + 1.0) * 0.5) * max(uDistributionRange - 1.0, 0.0);
    }

    float halfRange = uDistributionRange * 0.5;
    float phaseShift = (2.0 * PI * float(layerIndex)) / float(max(uCrossSectionCount, 1));
    float omega = uFrameCount > 0.0 ? (2.0 * PI) / uFrameCount : 0.0;
    float globalIndex = min(uFrameIndex, uFrameCount) - 1.0;
    float sampleLocation = halfRange * sin(omega * globalIndex + phaseShift) + halfRange;

    return clamp(sampleLocation, 0.0, max(uDistributionRange - 1.0, 0.0));
}

void main() {
    int layerIndex = gl_InstanceID;
    int column = layerIndex % uAtlasColumns;
    int row = layerIndex / uAtlasColumns;
    float readbackRow = (uTileSize.y - 1.0) - uDrawRow;

    vec2 cellOrigin = vec2(float(column) * uTileSize.x, float(row) * uTileSize.y + readbackRow);
    vec2 pixelPosition = cellOrigin + vec2(aCorner.x * uTileSize.x, aCorner.y);
    vec2 normalizedPosition = pixelPosition / uAtlasSize;

    gl_Position = vec4(
        normalizedPosition.x * 2.0 - 1.0,
        1.0 - normalizedPosition.y * 2.0,
        0.0,
        1.0
    );

    vLocalCoord = aCorner;
    vSampleLocation = resolveSampleLocation(layerIndex);
}
`);

    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
precision highp float;

uniform sampler2D uSourceTexture;
uniform vec2 uSourceSize;
uniform int uSamplingMode;

in vec2 vLocalCoord;
flat in float vSampleLocation;

out vec4 outColor;

void main() {
    vec2 sourcePixel;

    if (uSamplingMode == 1) {
        sourcePixel = vec2(
            vSampleLocation,
            (1.0 - vLocalCoord.x) * max(uSourceSize.y - 1.0, 0.0)
        );
    } else {
        sourcePixel = vec2(
            vLocalCoord.x * max(uSourceSize.x - 1.0, 0.0),
            vSampleLocation
        );
    }

    vec2 sourceUv = (sourcePixel + vec2(0.5, 0.5)) / uSourceSize;
    outColor = texture(uSourceTexture, sourceUv);
}
`);

    const program = linkProgram(gl, vertexShader, fragmentShader);

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return {
        program,
        attributes: {
            corner: gl.getAttribLocation(program, 'aCorner'),
        },
        uniforms: {
            atlasSize: gl.getUniformLocation(program, 'uAtlasSize'),
            tileSize: gl.getUniformLocation(program, 'uTileSize'),
            atlasColumns: gl.getUniformLocation(program, 'uAtlasColumns'),
            crossSectionCount: gl.getUniformLocation(program, 'uCrossSectionCount'),
            crossSectionType: gl.getUniformLocation(program, 'uCrossSectionType'),
            distributionRange: gl.getUniformLocation(program, 'uDistributionRange'),
            drawRow: gl.getUniformLocation(program, 'uDrawRow'),
            frameIndex: gl.getUniformLocation(program, 'uFrameIndex'),
            frameCount: gl.getUniformLocation(program, 'uFrameCount'),
            sourceTexture: gl.getUniformLocation(program, 'uSourceTexture'),
            sourceSize: gl.getUniformLocation(program, 'uSourceSize'),
            samplingMode: gl.getUniformLocation(program, 'uSamplingMode'),
        },
    };
}

function disposeCanvas(canvas) {
    if (!canvas) {
        return;
    }

    if (typeof canvas.width === 'number') {
        canvas.width = 1;
    }

    if (typeof canvas.height === 'number') {
        canvas.height = 1;
    }
}

export class WebGLTileBuilder extends EventEmitter {
    static getSupportReport(settings) {
        if (typeof WebGL2RenderingContext === 'undefined') {
            return {
                supported: false,
                reason: 'WebGL2RenderingContext is unavailable.',
            };
        }

        let canvas = null;
        let gl = null;

        try {
            canvas = createCanvasSurface(1, 1);
            gl = canvas.getContext('webgl2', {
                alpha: true,
                antialias: false,
                depth: false,
                preserveDrawingBuffer: false,
                premultipliedAlpha: false,
            });

            if (!gl) {
                return {
                    supported: false,
                    reason: 'Unable to create a WebGL2 context.',
                };
            }

            const maxTextureSize = Math.min(
                gl.getParameter(gl.MAX_TEXTURE_SIZE),
                gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
            );

            const layout = buildAtlasLayout(
                settings.tilePlan?.width,
                settings.tilePlan?.height,
                settings.crossSectionCount,
                maxTextureSize
            );

            if (!layout) {
                return {
                    supported: false,
                    reason: `Layer atlas would exceed the GPU texture size limit (${maxTextureSize}px).`,
                };
            }

            const sourceWidth = settings.fileInfo?.width ?? 0;
            const sourceHeight = settings.fileInfo?.height ?? 0;
            if (sourceWidth > maxTextureSize || sourceHeight > maxTextureSize) {
                return {
                    supported: false,
                    reason: `Scaled source frame ${sourceWidth}x${sourceHeight} exceeds the GPU texture size limit (${maxTextureSize}px).`,
                };
            }

            return {
                supported: true,
                reason: `Atlas ${layout.width}x${layout.height} within ${maxTextureSize}px limit.`,
                maxTextureSize,
                layout,
            };
        } catch (error) {
            return {
                supported: false,
                reason: error?.message || 'WebGL2 support check failed.',
            };
        } finally {
            if (gl) {
                const loseContext = gl.getExtension('WEBGL_lose_context');
                loseContext?.loseContext();
            }
            disposeCanvas(canvas);
        }
    }

    constructor(settings) {
        super();
        this.settings = settings;

        const {
            fileInfo,
            samplingMode,
            crossSectionCount,
            crossSectionType,
            frameCount,
            tilePlan,
            supportReport = null,
        } = settings;

        this._distributionRange = samplingMode === SAMPLING_ROWS ? fileInfo.height : fileInfo.width;
        this._frameCount = Number(frameCount) || 0;
        this._samplingMode = samplingMode;
        this._crossSectionType = crossSectionType;
        this._crossSectionCount = crossSectionCount;
        this._tileWidth = tilePlan.width;
        this._tileHeight = tilePlan.height;
        this._tileNumber = settings.tileNumber;
        this._tileEndFrame = tilePlan.tiles[this._tileNumber].end;

        if (crossSectionType === CROSS_SECTION_PLANES) {
            this._cosineIndices = new Float64Array(crossSectionCount);
            if (crossSectionCount === 1) {
                this._cosineIndices[0] = 0.5;
            } else {
                for (let i = 0; i < crossSectionCount; i++) {
                    const normalizedIndex = (i / (crossSectionCount - 1)) * Math.PI;
                    this._cosineIndices[i] = (Math.cos(normalizedIndex) + 1) / 2;
                }
            }
        } else {
            this._phaseShifts = new Float64Array(crossSectionCount);
            for (let i = 0; i < crossSectionCount; i++) {
                this._phaseShifts[i] = (2 * Math.PI * i) / crossSectionCount;
            }
            this._waveAmplitude = this._distributionRange / 2;
            this._waveOffset = this._distributionRange / 2;
            this._omega = this._frameCount ? (2 * Math.PI) / this._frameCount : 0;
        }

        const report = supportReport || WebGLTileBuilder.getSupportReport(settings);
        if (!report.supported || !report.layout) {
            throw new Error(report.reason || 'WebGL2 tile builder is unavailable.');
        }

        this._layout = report.layout;
        this._canvas = createCanvasSurface(this._layout.width, this._layout.height);
        this._gl = this._canvas.getContext('webgl2', {
            alpha: true,
            antialias: false,
            depth: false,
            preserveDrawingBuffer: false,
            premultipliedAlpha: false,
        });

        if (!this._gl) {
            throw new Error('Unable to create the WebGL2 tile builder context.');
        }

        this._previewCanvas = createCanvasSurface(tilePlan.width, tilePlan.height);
        this._previewCtx = getCached2dContext(this._previewCanvas);
        if (!this._previewCtx) {
            throw new Error('Unable to acquire a 2D context for the layer preview canvas.');
        }

        this._uploadCanvas = createCanvasSurface(fileInfo.width, fileInfo.height);
        this._uploadCtx = getCached2dContext(this._uploadCanvas);
        if (!this._uploadCtx) {
            throw new Error('Unable to acquire a 2D context for the WebGL2 upload canvas.');
        }

        if (tilePlan.rotate !== 0) {
            this._previewCtx.translate(tilePlan.width / 2, tilePlan.height / 2);
            this._previewCtx.rotate(tilePlan.rotate * Math.PI / 180);
            this._previewCtx.translate(-tilePlan.height / 2, -tilePlan.width / 2);
        }

        this._program = createWebGLProgram(this._gl);
        this._framebuffer = this._createFramebufferTexture(this._layout.width, this._layout.height);
        this._sourceTexture = this._createSourceTexture(fileInfo.width, fileInfo.height);
        this._vertexArray = this._createVertexArray();

        this._gl.viewport(0, 0, this._layout.width, this._layout.height);
        this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, this._framebuffer);
        this._gl.clearColor(0, 0, 0, 0);
        this._gl.clear(this._gl.COLOR_BUFFER_BIT);
        this._gl.bindFramebuffer(this._gl.FRAMEBUFFER, null);

        this._configureProgramUniforms(fileInfo);
    }

    _createFramebufferTexture(width, height) {
        const gl = this._gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.deleteFramebuffer(framebuffer);
            gl.deleteTexture(texture);
            throw new Error(`WebGL framebuffer is incomplete (status ${status}).`);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this._atlasTexture = texture;
        return framebuffer;
    }

    _createSourceTexture(width, height) {
        const gl = this._gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return texture;
    }

    _createVertexArray() {
        const gl = this._gl;
        const vao = gl.createVertexArray();
        const quadBuffer = gl.createBuffer();

        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            0, 1,
            1, 0,
            1, 1,
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this._program.attributes.corner);
        gl.vertexAttribPointer(this._program.attributes.corner, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);

        this._quadBuffer = quadBuffer;
        return vao;
    }

    _configureProgramUniforms(fileInfo) {
        const gl = this._gl;
        const { uniforms, program } = this._program;

        gl.useProgram(program);
        gl.uniform2f(uniforms.atlasSize, this._layout.width, this._layout.height);
        gl.uniform2f(uniforms.tileSize, this._tileWidth, this._tileHeight);
        gl.uniform1i(uniforms.atlasColumns, this._layout.columns);
        gl.uniform1i(uniforms.crossSectionCount, this._crossSectionCount);
        gl.uniform1i(uniforms.crossSectionType, this._crossSectionType === CROSS_SECTION_PLANES ? 0 : 1);
        gl.uniform1f(uniforms.distributionRange, this._distributionRange);
        gl.uniform1f(uniforms.frameCount, this._frameCount);
        gl.uniform1i(uniforms.sourceTexture, 0);
        gl.uniform2f(uniforms.sourceSize, fileInfo.width, fileInfo.height);
        gl.uniform1i(uniforms.samplingMode, this._samplingMode === SAMPLING_ROWS ? 0 : 1);
        gl.useProgram(null);
    }

    _resolvePreviewSampleLocation(frameNumber) {
        if (this._crossSectionType === CROSS_SECTION_PLANES) {
            return this._cosineIndices[0] * (this._distributionRange - 1);
        }

        const globalIndex = Math.min(frameNumber, this._frameCount) - 1;
        const sampleLocation = this._waveAmplitude * Math.sin(this._omega * globalIndex + this._phaseShifts[0]) + this._waveOffset;
        return Math.max(0, Math.min(this._distributionRange - 1, sampleLocation));
    }

    _updatePreview(videoFrame, drawLocation, frameNumber) {
        const { fileInfo, tilePlan } = this.settings;
        const sampleLocation = this._resolvePreviewSampleLocation(frameNumber);

        if (this._samplingMode === 'columns') {
            this._previewCtx.drawImage(
                videoFrame,
                sampleLocation,
                0,
                1,
                fileInfo.height,
                drawLocation,
                0,
                1,
                tilePlan.width
            );
            return;
        }

        this._previewCtx.drawImage(
            videoFrame,
            0,
            sampleLocation,
            fileInfo.width,
            1,
            0,
            drawLocation,
            tilePlan.width,
            1
        );
    }

    _uploadSourceFrame(videoFrame) {
        const gl = this._gl;

        this._uploadCtx.clearRect(0, 0, this.settings.fileInfo.width, this.settings.fileInfo.height);
        this._uploadCtx.drawImage(videoFrame, 0, 0, this.settings.fileInfo.width, this.settings.fileInfo.height);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._sourceTexture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this._uploadCanvas);
    }

    _drawFrame(drawLocation, frameNumber) {
        const gl = this._gl;
        const { uniforms, program } = this._program;

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffer);
        gl.viewport(0, 0, this._layout.width, this._layout.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.useProgram(program);
        gl.uniform1f(uniforms.drawRow, drawLocation);
        gl.uniform1f(uniforms.frameIndex, frameNumber);
        gl.bindVertexArray(this._vertexArray);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this._crossSectionCount);
        gl.bindVertexArray(null);
        gl.useProgram(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    async _readImages() {
        const gl = this._gl;
        const images = [];

        gl.bindFramebuffer(gl.FRAMEBUFFER, this._framebuffer);
        gl.readBuffer(gl.COLOR_ATTACHMENT0);

        for (let layerIndex = 0; layerIndex < this._crossSectionCount; layerIndex++) {
            const cell = getLayerCell(this._layout, layerIndex, this._tileWidth, this._tileHeight);
            const readY = this._layout.height - (cell.y + this._tileHeight);
            const rgba = new Uint8Array(this._tileWidth * this._tileHeight * 4);

            gl.readPixels(cell.x, readY, this._tileWidth, this._tileHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
            images.push({
                rgba,
                width: this._tileWidth,
                height: this._tileHeight,
            });
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return images;
    }

    releaseCanvasSet() {
        // File-mode WebGL2 tiles don't pool preview surfaces yet.
    }

    getCurrentPreviewCanvas() {
        return this._previewCanvas ?? null;
    }

    dispose() {
        const gl = this._gl;

        if (gl) {
            if (this._quadBuffer) {
                gl.deleteBuffer(this._quadBuffer);
            }
            if (this._vertexArray) {
                gl.deleteVertexArray(this._vertexArray);
            }
            if (this._sourceTexture) {
                gl.deleteTexture(this._sourceTexture);
            }
            if (this._atlasTexture) {
                gl.deleteTexture(this._atlasTexture);
            }
            if (this._framebuffer) {
                gl.deleteFramebuffer(this._framebuffer);
            }
            if (this._program?.program) {
                gl.deleteProgram(this._program.program);
            }

            const loseContext = gl.getExtension('WEBGL_lose_context');
            loseContext?.loseContext();
        }

        this._quadBuffer = null;
        this._vertexArray = null;
        this._sourceTexture = null;
        this._atlasTexture = null;
        this._framebuffer = null;
        this._program = null;
        this._gl = null;
        disposeCanvas(this._canvas);
        disposeCanvas(this._previewCanvas);
        disposeCanvas(this._uploadCanvas);
        this._canvas = null;
        this._previewCanvas = null;
        this._previewCtx = null;
        this._uploadCanvas = null;
        this._uploadCtx = null;
        this.removeAllListeners();
    }

    processFrame(data) {
        const {
            videoFrame,
            frameNumber,
        } = data;

        const drawLocation = frameNumber - this.settings.tilePlan.tiles[this._tileNumber].start;

        try {
            this._uploadSourceFrame(videoFrame);
            this._drawFrame(drawLocation, frameNumber);
            this._updatePreview(videoFrame, drawLocation, frameNumber);
        } finally {
            videoFrame.close?.();
        }

        if (frameNumber === this._tileEndFrame) {
            this.emit('complete', {
                tileId: this._tileNumber,
                readImages: () => this._readImages(),
            });
        }
    }
}