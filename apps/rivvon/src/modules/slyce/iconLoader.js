// let's use the CDN to import a list of icons from Google 
// icon names are sorted as per Google requirements 

const loadMaterialSymbols = (iconNames = ['home']) => {
    const baseUrl = 'https://fonts.googleapis.com/css2';
    const fontFamily = 'Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200';

    iconNames = iconNames.sort();
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = `${baseUrl}?family=${fontFamily}&icon_names=${iconNames}&display=block`
    document.head.appendChild(linkElement);
}

export { loadMaterialSymbols }
