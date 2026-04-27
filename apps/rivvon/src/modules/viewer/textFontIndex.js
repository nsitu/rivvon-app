export const TEXT_FONT_INDEX = [
    {
        id: 'Custom-Script',
        fileName: 'Custom-Script.svg',
        fontName: 'Custom Script',
        format: 'svg-font',
        creator: 'Shriinivas / Khemadeva',
        url: 'https://github.com/Shriinivas/inkscapestrokefont',
        isDerived: true,
        basedOn: {
            fontName: 'Pinyon Script',
            creator: 'Nicole Fally',
            foundry: 'Sorkin Type Co.',
            license: 'OFL',
            url: 'https://fonts.google.com/specimen/Pinyon+Script'
        }
    },
    {
        id: 'CutlingsGeometricRound',
        fileName: 'CutlingsGeometricRound.svg',
        fontName: 'Cutlings Geometric Round',
        format: 'svg-font',
        creator: 'Ellen Wasbø',
        url: 'https://cutlings.datafil.no/single-line-font-geometric/',
        license: 'OFL'
    },
    {
        id: 'EMS_Allure_Smooth',
        fileName: 'EMS_Allure_Smooth.svg',
        fontName: 'EMS Allure Smooth',
        format: 'svg-font',
        creator: 'Windell H. Oskay',
        isDerived: true,
        basedOn: {
            fontName: 'Allura',
            creator: 'Rob Leuschke',
            foundry: 'TypeSETit',
            url: 'https://fonts.google.com/specimen/Allura',
            license: 'OFL'
        }
    },
    {
        id: 'HersheyScript1smooth',
        fileName: 'HersheyScript1smooth.svg',
        fontName: 'Hershey Script Smooth',
        format: 'svg-font',
        creator: 'Windell H. Oskay',
        isDerived: true,
        basedOn: {
            fontName: 'Hershey Script',
            creator: 'Dr. Allen V. Hershey',
            url: 'https://en.wikipedia.org/wiki/Hershey_fonts'
        }
    }, 
    {
        id: 'ReliefSingleLineOTF-SVG-Regular',
        fileName: 'ReliefSingleLineOTF-SVG-Regular.otf',
        fontName: 'Relief Single Line',
        format: 'opentype',
        creator: 'François Chastanet',
        foundry: 'isdaT-type / institut supérieur des arts et du design de Toulouse',
        url: 'https://github.com/isdat-type/Relief-SingleLine',
        license: 'OFL'
    },
    {
        id: 'MistralSingleLineOTF-SVG-Regular',
        fileName: 'MistralSingleLineOTF-SVG-Regular.otf',
        fontName: 'Mistral Single Line',
        format: 'opentype',
        foundry: 'isdaT-type / institut supérieur des arts et du design de Toulouse',
        url: 'https://github.com/isdat-type',
        license: 'OFL'
    }
    ,
    {
        id: 'ResamitzSL-s24w0',
        fileName: 'ResamitzSL-s24w0.ttf',
        fontName: 'Resamitz SL'
    }
];

export const TEXT_FONT_INDEX_BY_ID = new Map(TEXT_FONT_INDEX.map((font) => [font.id, font]));