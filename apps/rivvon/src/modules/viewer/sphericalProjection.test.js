import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
    deriveSphericalProjectionVerticalWrapDegrees,
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
    it('derives vertical wrap from horizontal wrap and artwork aspect ratio', () => {
        expect(deriveSphericalProjectionVerticalWrapDegrees(100, 0.5)).toBe(50);
        expect(deriveSphericalProjectionVerticalWrapDegrees(100, 2)).toBe(170);
    });

    it('uses the artwork aspect ratio when vertical wrap is automatic', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
        });

        expect(result.horizontalWrapDegrees).toBe(120);
        expect(result.verticalWrapDegrees).toBe(60);
    });

    it('maps explicit horizontal and vertical spans independently', () => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
            verticalWrapDegrees: 80,
        });
        const lowerLeft = result.paths[0][0].clone().normalize();
        const upperRight = result.paths[0][2].clone().normalize();

        expect(result.horizontalWrapDegrees).toBe(120);
        expect(result.verticalWrapDegrees).toBe(80);
        expect(Math.asin(lowerLeft.y) * 180 / Math.PI).toBeCloseTo(-40, 5);
        expect(Math.asin(upperRight.y) * 180 / Math.PI).toBeCloseTo(40, 5);
    });

    it.each([0, 180])('keeps the %d degree boundary finite', (verticalWrapDegrees) => {
        const result = projectPathsToSphere(rectangle(4, 2), {
            wrapDegrees: 120,
            verticalWrapDegrees,
        });

        expect(result.verticalWrapDegrees).toBe(verticalWrapDegrees);
        for (const point of result.paths.flat()) {
            expect(point.toArray().every(Number.isFinite)).toBe(true);
        }
    });
});
