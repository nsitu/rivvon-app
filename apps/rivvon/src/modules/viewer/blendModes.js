// Blend straight RGB; callers retain their alpha/color-space contracts.
export const BLEND_MODES_GLSL = /* glsl */ `
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
        }
        return mix(source, result, strength);
    }
`;

export function createBlendNode(tsl, base, source, mode, strength) {
    const { float, mix, vec3 } = tsl;
    const low = base.sub(float(1).sub(source.mul(2)).mul(base).mul(float(1).sub(base)));
    const high = base.add(source.mul(2).sub(1).mul(base.max(0).sqrt().sub(base)));
    // Vector predicates must stay per-channel: TSL select reduces them to one boolean.
    const softLight = mix(high, low, source.lessThan(vec3(0.5)));
    const multiply = base.mul(source);
    const screen = base.add(source).sub(multiply);
    const overlay = mix(float(1).sub(float(1).sub(base).mul(float(1).sub(source)).mul(2)),
        multiply.mul(2), base.lessThan(vec3(0.5)));
    const result = mode.equal(1).select(softLight,
        mode.equal(2).select(multiply,
            mode.equal(3).select(screen,
                mode.equal(4).select(overlay, mode.equal(5).select(base.sub(source).abs(), source)))));
    return mix(source, result, strength);
}
