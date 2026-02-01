// let's use the CDN to import a list of icons from Google 
// icon names are sorted as per Google requirements 

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
