export const CAP_STYLE_SQUARE = 'square';
export const CAP_STYLE_ROUNDED = 'rounded';
export const CAP_STYLE_POINTED = 'pointed';
export const CAP_STYLE_SWALLOWTAIL = 'swallowtail';
export const CAP_STYLE_ORGANIC = 'organic';
export const DEFAULT_CAP_STYLE = CAP_STYLE_SQUARE;

const KNOWN_CAP_STYLES = new Set([
    CAP_STYLE_SQUARE,
    CAP_STYLE_ROUNDED,
    CAP_STYLE_POINTED,
    CAP_STYLE_SWALLOWTAIL,
    CAP_STYLE_ORGANIC,
]);

export function normalizeCapStyle(capStyle, roundedCaps = false) {
    if (capStyle && KNOWN_CAP_STYLES.has(capStyle)) {
        return capStyle;
    }

    return roundedCaps ? CAP_STYLE_ROUNDED : DEFAULT_CAP_STYLE;
}