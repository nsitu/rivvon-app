import L from 'leaflet';
import { KalmanFilter2D } from './kalmanFilter.js';
import { finalizeCapturedPaths } from './pathFinalizer.js';

const DEFAULT_CENTER = [20, 0];
const DEFAULT_ZOOM = 2;
const TRACKING_ZOOM = 17;
const MAX_ACCEPTED_ACCURACY_METERS = 60;
const MIN_SAMPLE_DISTANCE_METERS = 3;
const MAX_SAMPLE_DISTANCE_METERS = 12;
const EARTH_RADIUS = 6378137;
const MAX_MERCATOR_LAT = 85.05112878;
const DARK_TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

function clampLatitude(latitude) {
    return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude));
}

function latLngToMercator(latitude, longitude) {
    const lat = clampLatitude(latitude) * Math.PI / 180;
    const lng = longitude * Math.PI / 180;

    return {
        x: EARTH_RADIUS * lng,
        y: EARTH_RADIUS * Math.log(Math.tan((Math.PI / 4) + (lat / 2)))
    };
}

function mercatorToLatLng(x, y) {
    return {
        lat: (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - (Math.PI / 2)) * 180 / Math.PI,
        lng: (x / EARTH_RADIUS) * 180 / Math.PI
    };
}

function projectedDistance(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.hypot(dx, dy);
}

export class WalkingManager {
    constructor(mapElement, onPointCountChange = null, onStateChange = null) {
        this.mapElement = mapElement;
        this.onPointCountChange = onPointCountChange;
        this.onStateChange = onStateChange;

        this.map = null;
        this.tileLayer = null;
        this.pathPolyline = null;
        this.positionMarker = null;
        this.accuracyCircle = null;

        this.points = [];
        this.livePoint = null;
        this.totalDistance = 0;
        this.latestAccuracy = null;
        this.errorMessage = null;
        this.status = 'idle';
        this.isActive = false;
        this.isTracking = false;
        this.hasCenteredOnce = false;
        this.watchId = null;
        this.tileDebug = {
            started: 0,
            loaded: 0,
            errored: 0
        };

        this.kalmanFilter = new KalmanFilter2D({
            processNoise: 8,
            measurementNoise: 25
        });

        this.createMap();
        this.emitState();
    }

    applyTileDebugStyles(tile) {
        if (!tile) {
            return;
        }

        tile.style.setProperty('mix-blend-mode', 'normal', 'important');
        tile.style.setProperty('visibility', 'visible', 'important');
        tile.style.setProperty('opacity', '1', 'important');
        tile.style.setProperty('display', 'block', 'important');
        tile.style.setProperty('filter', 'brightness(3)', 'important');
    }

    createMap() {
        if (this.map) {
            return;
        }

        this.map = L.map(this.mapElement, {
            zoomControl: false,
            attributionControl: true,
            preferCanvas: true
        });

        this.map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);

        this.tileLayer = L.tileLayer(DARK_TILE_URL, {
            attribution: '&copy; OpenStreetMap &copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 20
        });

        this.bindTileLayerDebugEvents();
        this.tileLayer.addTo(this.map);

        this.map.whenReady(() => {
            console.log('[Walking] Leaflet map ready', {
                tileUrlTemplate: DARK_TILE_URL,
                center: this.map.getCenter(),
                zoom: this.map.getZoom()
            });
        });

        this.pathPolyline = L.polyline([], {
            color: '#16a34a',
            weight: 4,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(this.map);

        this.positionMarker = L.circleMarker(DEFAULT_CENTER, {
            radius: 6,
            color: '#052e16',
            weight: 2,
            fillColor: '#22c55e',
            fillOpacity: 0,
            opacity: 0
        }).addTo(this.map);

        this.accuracyCircle = L.circle(DEFAULT_CENTER, {
            radius: 0,
            color: '#22c55e',
            weight: 1,
            fillColor: '#86efac',
            fillOpacity: 0,
            opacity: 0
        }).addTo(this.map);
    }

    bindTileLayerDebugEvents() {
        if (!this.tileLayer) {
            return;
        }

        this.tileLayer.on('loading', () => {
            this.tileDebug.started = 0;
            this.tileDebug.loaded = 0;
            this.tileDebug.errored = 0;

            console.log('[Walking] Tile layer loading', {
                tileUrlTemplate: DARK_TILE_URL,
                subdomains: this.tileLayer.options.subdomains,
                maxZoom: this.tileLayer.options.maxZoom
            });
        });

        this.tileLayer.on('tileloadstart', (event) => {
            this.tileDebug.started += 1;
            this.applyTileDebugStyles(event.tile);

            if (this.tileDebug.started <= 3) {
                console.log('[Walking] Tile request started', {
                    count: this.tileDebug.started,
                    src: event.tile?.src,
                    coords: event.coords
                });
            }
        });

        this.tileLayer.on('tileload', (event) => {
            this.tileDebug.loaded += 1;
            this.applyTileDebugStyles(event.tile);

            if (this.tileDebug.loaded <= 3) {
                console.log('[Walking] Tile loaded', {
                    count: this.tileDebug.loaded,
                    src: event.tile?.src,
                    coords: event.coords
                });
            }

            if (this.tileDebug.loaded === 1 && event.tile) {
                const computedStyle = window.getComputedStyle(event.tile);

                console.log('[Walking] First tile visibility snapshot', {
                    src: event.tile.src,
                    naturalWidth: event.tile.naturalWidth,
                    naturalHeight: event.tile.naturalHeight,
                    clientWidth: event.tile.clientWidth,
                    clientHeight: event.tile.clientHeight,
                    display: computedStyle.display,
                    visibility: computedStyle.visibility,
                    opacity: computedStyle.opacity,
                    mixBlendMode: computedStyle.mixBlendMode,
                    filter: computedStyle.filter
                });
            }
        });

        this.tileLayer.on('load', () => {
            console.log('[Walking] Tile layer load complete', {
                started: this.tileDebug.started,
                loaded: this.tileDebug.loaded,
                errored: this.tileDebug.errored
            });
        });

        this.tileLayer.on('tileerror', (event) => {
            this.tileDebug.errored += 1;

            console.warn('[Walking] Tile failed to load', {
                count: this.tileDebug.errored,
                src: event.tile?.src,
                coords: event.coords,
                error: event.error
            });
        });
    }

    emitState() {
        if (this.onStateChange) {
            this.onStateChange({
                status: this.status,
                errorMessage: this.errorMessage,
                pointCount: this.points.length,
                distanceMeters: this.totalDistance,
                accuracyMeters: this.latestAccuracy,
                isTracking: this.isTracking,
                hasLocated: this.livePoint !== null
            });
        }
    }

    notifyPointCountChange() {
        if (this.onPointCountChange) {
            this.onPointCountChange(this.points.length);
        }
    }

    setActive(active) {
        this.isActive = active;

        if (active) {
            this.clearWalk({ resetView: false });
            requestAnimationFrame(() => this.map?.invalidateSize(false));
            this.startTracking();
            return;
        }

        this.clearWalk();
    }

    startTracking() {
        if (!navigator.geolocation) {
            this.status = 'error';
            this.errorMessage = 'Geolocation is not available in this browser.';
            this.isTracking = false;
            this.emitState();
            return;
        }

        this.stopTracking();

        this.status = 'locating';
        this.errorMessage = null;
        this.isTracking = true;
        this.emitState();

        this.watchId = navigator.geolocation.watchPosition(
            position => this.handlePosition(position),
            error => this.handleGeolocationError(error),
            {
                enableHighAccuracy: true,
                maximumAge: 1000,
                timeout: 10000
            }
        );
    }

    stopTracking() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        this.isTracking = false;
    }

    handleGeolocationError(error) {
        if (error.code === error.TIMEOUT) {
            this.status = this.points.length > 0 ? 'tracking' : 'locating';
            this.errorMessage = 'Waiting for a fresh location fix…';
            this.emitState();
            return;
        }

        this.stopTracking();
        this.status = 'error';

        if (error.code === error.PERMISSION_DENIED) {
            this.errorMessage = 'Location permission was denied.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
            this.errorMessage = 'Current position is unavailable.';
        } else {
            this.errorMessage = 'Location tracking failed.';
        }

        this.emitState();
    }

    handlePosition(position) {
        const { latitude, longitude, accuracy } = position.coords;

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            return;
        }

        const projectedPoint = latLngToMercator(latitude, longitude);
        const measurementNoise = Math.max(9, Math.pow(Math.max(accuracy || 3, 3), 2));
        const filteredProjectedPoint = this.kalmanFilter.update(projectedPoint, measurementNoise);
        const filteredLatLng = mercatorToLatLng(filteredProjectedPoint.x, filteredProjectedPoint.y);

        const nextPoint = {
            lat: filteredLatLng.lat,
            lng: filteredLatLng.lng,
            x: filteredProjectedPoint.x,
            y: filteredProjectedPoint.y,
            accuracy,
            timestamp: position.timestamp ?? Date.now()
        };

        this.latestAccuracy = accuracy;
        this.errorMessage = null;
        this.status = 'locating';

        this.updateLivePosition(nextPoint);

        if (Number.isFinite(accuracy) && accuracy > MAX_ACCEPTED_ACCURACY_METERS) {
            this.errorMessage = `Location accuracy low. Check GPS.`;
            this.emitState();
            return;
        }

        if (this.shouldSamplePoint(nextPoint)) {
            this.addPoint(nextPoint);
        }

        this.status = 'tracking';
        this.emitState();
    }

    shouldSamplePoint(point) {
        if (this.points.length === 0) {
            return true;
        }

        const lastPoint = this.points[this.points.length - 1];
        const distance = projectedDistance(lastPoint, point);
        const accuracyBuffer = Number.isFinite(point.accuracy)
            ? Math.min(point.accuracy * 0.25, MAX_SAMPLE_DISTANCE_METERS)
            : 0;
        const minimumDistance = Math.max(MIN_SAMPLE_DISTANCE_METERS, accuracyBuffer);

        return distance >= minimumDistance;
    }

    addPoint(point) {
        if (this.points.length > 0) {
            this.totalDistance += projectedDistance(this.points[this.points.length - 1], point);
        }

        this.points.push(point);
        this.notifyPointCountChange();
        this.renderPath();
    }

    updateLivePosition(point) {
        this.livePoint = point;

        this.positionMarker.setLatLng([point.lat, point.lng]);
        this.positionMarker.setStyle({
            opacity: 1,
            fillOpacity: 1
        });

        if (Number.isFinite(point.accuracy) && point.accuracy > 0) {
            this.accuracyCircle.setLatLng([point.lat, point.lng]);
            this.accuracyCircle.setRadius(point.accuracy);
            this.accuracyCircle.setStyle({
                opacity: 0.45,
                fillOpacity: 0.08
            });
        }

        this.renderPath(point);

        if (!this.hasCenteredOnce) {
            this.map.setView([point.lat, point.lng], TRACKING_ZOOM);
            this.hasCenteredOnce = true;
            return;
        }

        const paddedBounds = this.map.getBounds().pad(-0.35);
        if (!paddedBounds.contains([point.lat, point.lng])) {
            this.map.panTo([point.lat, point.lng], {
                animate: true,
                duration: 0.4
            });
        }
    }

    renderPath(livePoint = this.livePoint) {
        const latLngs = this.points.map(point => [point.lat, point.lng]);

        if (livePoint) {
            const lastAcceptedPoint = this.points[this.points.length - 1];
            const shouldShowLivePoint = !lastAcceptedPoint || projectedDistance(lastAcceptedPoint, livePoint) > 0.5;

            if (shouldShowLivePoint) {
                latLngs.push([livePoint.lat, livePoint.lng]);
            }
        }

        this.pathPolyline.setLatLngs(latLngs);
    }

    resetRoute() {
        this.points = [];
        this.livePoint = null;
        this.totalDistance = 0;
        this.latestAccuracy = null;
        this.errorMessage = null;
        this.hasCenteredOnce = false;
        this.kalmanFilter.reset();

        this.pathPolyline?.setLatLngs([]);
        this.positionMarker?.setStyle({ opacity: 0, fillOpacity: 0 });
        this.accuracyCircle?.setRadius(0);
        this.accuracyCircle?.setStyle({ opacity: 0, fillOpacity: 0 });

        this.notifyPointCountChange();
    }

    clearWalk({ resetView = true } = {}) {
        this.stopTracking();
        this.resetRoute();

        if (resetView) {
            this.map?.setView(DEFAULT_CENTER, DEFAULT_ZOOM, { animate: false });
        }

        this.status = this.isActive ? 'locating' : 'idle';
        this.emitState();
    }

    finalizeWalk() {
        if (this.points.length < 2) {
            console.warn('[Walking] Not enough points to finalize');
            return null;
        }

        this.stopTracking();

        const rawPaths = [this.points.map(point => ({ x: point.x, y: point.y }))];
        const rawPointCount = rawPaths[0].length;
        const result = finalizeCapturedPaths(rawPaths);
        const smoothedPointCount = result?.reduce((sum, path) => sum + path.length, 0) ?? 0;

        console.log('[Walking] Finalizing walk', {
            rawPointCount,
            smoothedPointCount
        });

        this.resetRoute();
        this.status = 'idle';
        this.emitState();

        return result;
    }

    destroy() {
        this.stopTracking();
        this.map?.remove();
        this.map = null;
    }
}