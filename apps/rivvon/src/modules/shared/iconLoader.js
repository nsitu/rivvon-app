// Loads Material Symbols Outlined as a variable font from Google CDN.
// The font supports variable axes: opsz (20-48), wght (100-700), FILL (0-1), GRAD (-50-200).
// Since the full weight range is loaded, individual icons can use custom weights via CSS:
//   font-variation-settings: 'wght' 200;              /* thin */
//   font-variation-settings: 'wght' 700, 'FILL' 1;   /* bold + filled */
// Icon names are sorted as per Google requirements.

const loadMaterialSymbols = (iconNames = ['home']) => {
    const baseUrl = 'https://fonts.googleapis.com/css2';
    const fontFamily = 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';

    // Deduplicate icon names and warn about duplicates
    const seen = new Set();
    const duplicates = [];
    const uniqueIconNames = [];

    for (const name of iconNames) {
        if (seen.has(name)) {
            duplicates.push(name);
        } else {
            seen.add(name);
            uniqueIconNames.push(name);
        }
    }

    if (duplicates.length > 0) {
        console.error('[IconLoader] Duplicate icon names detected:', duplicates);
    }

    // Sort as per Google requirements
    uniqueIconNames.sort();

    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = `${baseUrl}?family=${fontFamily}&icon_names=${uniqueIconNames}&display=block`
    document.head.appendChild(linkElement);
}

export { loadMaterialSymbols }
