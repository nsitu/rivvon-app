const DESTINATIONS = [
    { value: 'google-drive', label: 'Google Drive', icon: '/google-drive.svg',
        description: 'Uploads to your Google Drive. Texture tiles are readable by anyone with their file links so presets can load them.' },
    { value: 'r2', label: 'Cloudflare R2', icon: '/cloudflare.svg',
        description: 'Uploads to Rivvon’s Cloudflare storage for delivery through its CDN.' },
];

export function getTextureStorageDestinations({ isLocal = true, storageProvider = null, isAuthenticated = false, isAdmin = false } = {}) {
    return DESTINATIONS.filter(destination => {
        if (!isAuthenticated) return false;
        if (destination.value === 'google-drive') return isLocal;
        return isAdmin && (isLocal || storageProvider === 'google-drive');
    });
}

export function getTextureStorageLabel(destination) {
    return DESTINATIONS.find(option => option.value === destination)?.label || 'your texture library';
}

export function resolveTextureUploader(destination, uploaders, access) {
    if (!getTextureStorageDestinations(access).some(option => option.value === destination)) {
        throw new Error('Choose an available upload destination.');
    }
    return destination === 'r2' ? uploaders.uploadTextureSetToR2 : uploaders.uploadTextureSet;
}
