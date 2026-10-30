// Blend straight RGB; callers retain their alpha/color-space contracts.
export const BLEND_MODES_GLSL = /* glsl */ `
    // W3C Compositing Level 1 luminosity, saturation and gamut clipping.
    float rivvonBlendLum(vec3 color) { return dot(color, vec3(0.3, 0.59, 0.11)); }
    float rivvonBlendSat(vec3 color) { return max(max(color.r, color.g), color.b) - min(min(color.r, color.g), color.b); }
    vec3 rivvonBlendSetLum(vec3 color, float luminosity) {
        color += luminosity - rivvonBlendLum(color);
        float l = rivvonBlendLum(color);
        float n = min(min(color.r, color.g), color.b);
        float x = max(max(color.r, color.g), color.b);
        if (n < 0.0) color = l + (color - l) * l / (l - n);
        if (x > 1.0) color = l + (color - l) * (1.0 - l) / (x - l);
        return clamp(color, 0.0, 1.0);
    }
    vec3 rivvonBlendSetSat(vec3 color, float saturation) {
        float n = min(min(color.r, color.g), color.b);
        float range = max(max(color.r, color.g), color.b) - n;
        // Normalising the range is equivalent to sorting min/mid/max channels.
        return range > 0.0 ? (color - n) * saturation / range : vec3(0.0);
    }
    float rivvonBlendDodge(float base, float source) {
        if (base <= 0.0) return 0.0;
        if (source >= 1.0) return 1.0;
        return min(1.0, base / (1.0 - source));
    }
    float rivvonBlendBurn(float base, float source) {
        if (base >= 1.0) return 1.0;
        if (source <= 0.0) return 0.0;
        return 1.0 - min(1.0, (1.0 - base) / source);
    }
    vec3 rivvonBlend(vec3 base, vec3 source, float mode, float strength) {
        vec3 result = source;
        if (mode == 1.0) {
            // Preserve the existing Soft Light appearance for saved artwork.
            vec3 low = base - (1.0 - 2.0 * source) * base * (1.0 - base);
            vec3 high = base + (2.0 * source - 1.0) * (sqrt(max(base, vec3(0.0))) - base);
            result = mix(low, high, step(vec3(0.5), source));
        } else if (mode == 2.0) {
            result = base * source;
        } else if (mode == 3.0) {
            result = base + source - base * source;
        } else if (mode == 4.0) {
            vec3 low = 2.0 * base * source;
            vec3 high = 1.0 - 2.0 * (1.0 - base) * (1.0 - source);
            result = mix(low, high, step(vec3(0.5), base));
        } else if (mode == 5.0) {
            result = abs(base - source);
        } else if (mode == 6.0) {
            result = min(base, source);
        } else if (mode == 7.0) {
            result = max(base, source);
        } else if (mode == 8.0) {
            result = mix(2.0 * base * source, 1.0 - 2.0 * (1.0 - base) * (1.0 - source), step(vec3(0.5), source));
        } else if (mode == 9.0) {
            result = base + source - 2.0 * base * source;
        } else if (mode == 10.0) {
            result = vec3(rivvonBlendDodge(base.r, source.r), rivvonBlendDodge(base.g, source.g), rivvonBlendDodge(base.b, source.b));
        } else if (mode == 11.0) {
            result = vec3(rivvonBlendBurn(base.r, source.r), rivvonBlendBurn(base.g, source.g), rivvonBlendBurn(base.b, source.b));
        } else if (mode == 12.0) {
            result = rivvonBlendSetLum(rivvonBlendSetSat(source, rivvonBlendSat(base)), rivvonBlendLum(base));
        } else if (mode == 13.0) {
            result = rivvonBlendSetLum(rivvonBlendSetSat(base, rivvonBlendSat(source)), rivvonBlendLum(base));
        } else if (mode == 14.0) {
            result = rivvonBlendSetLum(source, rivvonBlendLum(base));
        } else if (mode == 15.0) {
            result = rivvonBlendSetLum(base, rivvonBlendLum(source));
        }
        return mix(source, result, strength);
    }
`;

export function createBlendNode(tsl, base, source, mode, strength) {
    const { Fn, If, float, mix, vec3, dot, min, max } = tsl;
    const minChannel = color => min(min(color.r, color.g), color.b);
    const maxChannel = color => max(max(color.r, color.g), color.b);
    const lum = color => dot(color, vec3(0.3, 0.59, 0.11));
    const sat = color => maxChannel(color).sub(minChannel(color));
    const setLum = (color, luminosity) => Fn(() => {
        const adjusted = color.add(luminosity.sub(lum(color))).toVar();
        const l = lum(adjusted).toVar(), n = minChannel(adjusted).toVar(), x = maxChannel(adjusted).toVar();
        If(n.lessThan(0), () => { adjusted.assign(vec3(l).add(adjusted.sub(l).mul(l).div(l.sub(n)))); });
        If(x.greaterThan(1), () => { adjusted.assign(vec3(l).add(adjusted.sub(l).mul(float(1).sub(l)).div(x.sub(l)))); });
        return adjusted.clamp(0, 1);
    })();
    const setSat = (color, saturation) => {
        const n = minChannel(color), range = maxChannel(color).sub(n);
        return color.sub(n).mul(saturation).div(range.equal(0).select(float(1), range));
    };
    // Vector predicates must stay per-channel: TSL select reduces them to one boolean.
    const hardLight = (b, s) => mix(float(1).sub(float(1).sub(b).mul(float(1).sub(s)).mul(2)),
        b.mul(s).mul(2), s.lessThan(vec3(0.5)));

    return Fn(() => {
        const result = source.toVar();
        // Uniform branches avoid evaluating all colour conversions every pixel.
        If(mode.equal(1), () => {
            const low = base.sub(float(1).sub(source.mul(2)).mul(base).mul(float(1).sub(base)));
            const high = base.add(source.mul(2).sub(1).mul(base.max(0).sqrt().sub(base)));
            result.assign(mix(high, low, source.lessThan(vec3(0.5))));
        }).ElseIf(mode.equal(2), () => { result.assign(base.mul(source)); })
            .ElseIf(mode.equal(3), () => { result.assign(base.add(source).sub(base.mul(source))); })
            .ElseIf(mode.equal(4), () => { result.assign(hardLight(source, base)); })
            .ElseIf(mode.equal(5), () => { result.assign(base.sub(source).abs()); })
            .ElseIf(mode.equal(6), () => { result.assign(min(base, source)); })
            .ElseIf(mode.equal(7), () => { result.assign(max(base, source)); })
            .ElseIf(mode.equal(8), () => { result.assign(hardLight(base, source)); })
            .ElseIf(mode.equal(9), () => { result.assign(base.add(source).sub(base.mul(source).mul(2))); })
            .ElseIf(mode.equal(10), () => {
                const atWhite = source.greaterThanEqual(vec3(1));
                const divisor = mix(float(1).sub(source), vec3(1), atWhite);
                const dodge = mix(base.div(divisor).min(1), vec3(1), atWhite);
                result.assign(mix(dodge, vec3(0), base.lessThanEqual(vec3(0))));
            }).ElseIf(mode.equal(11), () => {
                const atBlack = source.lessThanEqual(vec3(0));
                const divisor = mix(source, vec3(1), atBlack);
                const burn = mix(float(1).sub(float(1).sub(base).div(divisor).min(1)), vec3(0), atBlack);
                result.assign(mix(burn, vec3(1), base.greaterThanEqual(vec3(1))));
            }).ElseIf(mode.equal(12), () => { result.assign(setLum(setSat(source, sat(base)), lum(base))); })
            .ElseIf(mode.equal(13), () => { result.assign(setLum(setSat(base, sat(source)), lum(base))); })
            .ElseIf(mode.equal(14), () => { result.assign(setLum(source, lum(base))); })
            .ElseIf(mode.equal(15), () => { result.assign(setLum(base, lum(source))); });
        return mix(source, result, strength);
    })();
}
