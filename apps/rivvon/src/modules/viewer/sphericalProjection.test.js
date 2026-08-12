import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
    deriveSphericalProjectionLatitudeBounds,
    normalizeSphericalProjectionLatitudeBounds,
    projectPathsToSphere,
} from './sphericalProjection.js';

function rectangle(width, height) {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    return [[
        new Vector3(-halfWidth, -halfHeight, 0),
        new Vector3(halfWidth, -halfHeight, 0),
        new Vector3(halfWidth, halfHeight, 0),
        new Vector3(-halfWidth, halfHeight, 0),
    ]];
}

describe('spherical projection wrapping', () => {
    it('derives symmetric latitude bounds from horizontal wrap and artwork aspect ratio', () => {
        expect(deriveSphericalProjectionLatitudeBounds(100, 0.5)).toEqual({
            lower: -25,
            upper: 25,
        });
        expect(deriveSphericalProjectionLatitudeBounds(100, 2)).toEqual({
            lower: -85,
            upper: 85,
        });
    });

    it('orders and clamps explicit latitude bounds', () => {
        expect(normalizeSphericalProjectionLatitudeBounds(120, -100)).toEqual({
            lower: -90,
            upper: 90,
        });
    });

    it('uses the artwork aspect ratio when vertical wrap is automatic', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
        });

        expect(result.horizontalWrapDegrees).toBe(120);
        expect(result.lowerLatitudeDegrees).toBe(-30);
        expect(result.upperLatitudeDegrees).toBe(30);
    });

    it('maps asymmetric latitude bounds independently from horizontal wrap', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
            lowerLatitudeDegrees: -20,
            upperLatitudeDegrees: 70,
        });
        const lowerLeft = result.paths[0][0].clone().normalize();
        const upperRight = result.paths[0][2].clone().normalize();

        expect(result.horizontalWrapDegrees).toBe(120);
        expect(result.lowerLatitudeDegrees).toBe(-20);
        expect(result.upperLatitudeDegrees).toBe(70);
        expect(Math.asin(lowerLeft.y) * 180 / Math.PI).toBeCloseTo(-20, 5);
        expect(Math.asin(upperRight.y) * 180 / Math.PI).toBeCloseTo(70, 5);
    });

    it('supports a range entirely within one hemisphere', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
            lowerLatitudeDegrees: 10,
            upperLatitudeDegrees: 60,
        });

        expect(result.paths.flat().every((point) => point.y > 0)).toBe(true);
    });

    it('supports a zero-span latitude range', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
            lowerLatitudeDegrees: 25,
            upperLatitudeDegrees: 25,
        });

        for (const point of result.paths.flat()) {
            expect(Math.asin(point.clone().normalize().y) * 180 / Math.PI)
                .toBeCloseTo(25, 5);
        }
    });

    it('keeps exact pole bounds finite', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
            lowerLatitudeDegrees: -90,
            upperLatitudeDegrees: 90,
        });

        expect(result.lowerLatitudeDegrees).toBe(-90);
        expect(result.upperLatitudeDegrees).toBe(90);
        for (const point of result.paths.flat()) {
            expect(point.toArray().every(Number.isFinite)).toBe(true);
        }
    });
});
