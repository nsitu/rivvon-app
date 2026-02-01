import * as THREE from 'three';
import SvgPath from 'svgpath';

// Dynamic resolution configuration (exported for use in other modules)
export const POINTS_PER_UNIT = 1.5;      // Points per unit of path length (after normalization)
export const MIN_POINTS_PER_PATH = 50;   // Minimum points per subpath
export const MAX_POINTS_PER_PATH = 2000; // Maximum points per subpath

/**
 * Calculate the length of an SVG path element
 * @param {string} pathData - The SVG path data string
 * @returns {number} Path length in SVG units
 */
export function getPathLength(pathData) {
    if (!pathData) return 0;
    
    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);
    return path.getTotalLength();
}

/**
 * Calculate total path lengths from SVG content, accounting for subpaths
 * @param {string} svgContent - SVG content as string
 * @returns {{totalLength: number, subpathLengths: number[], scale: number}} Length info
 */
export function calculateSvgPathLengths(svgContent) {
    const result = { totalLength: 0, subpathLengths: [], scale: 1 };
    
    try {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
        
        const parserError = svgDoc.querySelector("parsererror");
        if (parserError) return result;
        
        const paths = svgDoc.querySelectorAll("path");
        if (!paths || paths.length === 0) return result;
        
        // Get scale from viewBox
        const svgElement = svgDoc.querySelector("svg");
        const viewBox = svgElement?.getAttribute("viewBox");
        if (viewBox) {
            const [, , width, height] = viewBox.split(" ").map(Number);
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
                result.scale = 1 / maxDimension;
            }
        }
        
        // Calculate lengths for each subpath
        paths.forEach((path) => {
            const pathData = path.getAttribute("d");
            if (!pathData) return;
            
            // Convert to absolute and split into subpaths
            let absolutePathData;
            try {
                absolutePathData = new SvgPath(pathData).abs().toString();
            } catch (e) {
                absolutePathData = pathData;
            }
            
            const regex = /(M\s*[\d\s.,eE+-]+(?:[^M]*)?)/g;
            let match;
            
            while ((match = regex.exec(absolutePathData)) !== null) {
                const subpath = match[1].trim();
                if (subpath) {
                    const length = getPathLength(subpath) * result.scale;
                    if (length > 0) {
                        result.subpathLengths.push(length);
                        result.totalLength += length;
                    }
                }
            }
        });
        
    } catch (error) {
        console.error("[SVG] Error calculating path lengths:", error);
    }
    
    return result;
}

/**
 * Calculate appropriate number of points for a given path length
 * @param {number} length - Path length (in normalized units)
 * @param {number} pointsPerUnit - Points per unit of length
 * @returns {number} Number of points to sample
 */
export function calculateDynamicResolution(length, pointsPerUnit = POINTS_PER_UNIT) {
    // Scale up since normalized paths are typically 0-8 units
    // We need to account for the fact that after normalization to targetSize=8,
    // the path lengths will be proportionally scaled
    const scaledPointsPerUnit = pointsPerUnit * 100; // Adjusted for normalized scale
    
    const points = Math.round(length * scaledPointsPerUnit);
    return Math.max(MIN_POINTS_PER_PATH, Math.min(MAX_POINTS_PER_PATH, points));
}

/**
 * Split SVG path data into subpaths at each M command
 * Converts to absolute coordinates first so each subpath is self-contained
 * @param {string} pathData - The SVG path data string
 * @returns {Array<string>} Array of path data strings (one per subpath, all absolute)
 */
export function splitPathIntoSubpaths(pathData) {
    if (!pathData) return [];
    
    // Convert to absolute coordinates first - this is critical!
    // When path has relative moveto (m) for subsequent subpaths,
    // splitting without converting would lose the absolute position
    let absolutePathData;
    try {
        absolutePathData = new SvgPath(pathData).abs().toString();
    } catch (e) {
        console.warn('[SVG] Failed to convert path to absolute, using original:', e);
        absolutePathData = pathData;
    }
    
    // Now split on M commands (all should be uppercase M after abs())
    // Match M followed by coordinates, then everything until next M or end
    const subpaths = [];
    const regex = /(M\s*[\d\s.,eE+-]+(?:[^M]*)?)/g;
    let match;
    
    while ((match = regex.exec(absolutePathData)) !== null) {
        const subpath = match[1].trim();
        if (subpath) {
            subpaths.push(subpath);
        }
    }
    
    return subpaths;
}

/**
 * Converts a single SVG subpath to an array of THREE.Vector3 points
 * @param {string} pathData - The SVG path data string (single subpath)
 * @param {number} numPoints - Number of points to sample along the path
 * @param {number} scale - Scale factor for the resulting points
 * @param {number} z - Z position for all points
 * @returns {Array<THREE.Vector3>} Array of 3D points
 */
function subpathToPoints(pathData, numPoints, scale, z) {
    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);

    const pathLength = path.getTotalLength();
    if (pathLength < 1) return []; // Skip very short paths
    
    const points = [];

    for (let i = 0; i < numPoints; i++) {
        const distance = (i / (numPoints - 1)) * pathLength;
        const point = path.getPointAtLength(distance);
        points.push(new THREE.Vector3(point.x * scale, -point.y * scale, z));
    }

    return points;
}

/**
 * Converts SVG path data to an array of THREE.Vector3 points
 * Note: This treats the entire path as continuous. For multi-subpath handling,
 * use svgPathToPointsMulti instead.
 * @param {string} pathData - The SVG path data string
 * @param {number} numPoints - Number of points to sample along the path
 * @param {number} scale - Scale factor for the resulting points
 * @param {number} z - Z position for all points
 * @returns {Array<THREE.Vector3>} Array of 3D points
 */
export function svgPathToPoints(pathData, numPoints = 100, scale = 1, z = 0) {
    // Create an SVG path element to use the browser's path API
    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("d", pathData);

    // Get total path length to sample points evenly
    const pathLength = path.getTotalLength();
    const points = [];

    // Sample points evenly along path
    for (let i = 0; i < numPoints; i++) {
        const distance = (i / (numPoints - 1)) * pathLength;
        const point = path.getPointAtLength(distance);
        points.push(new THREE.Vector3(point.x * scale, -point.y * scale, z)); // Flip Y because SVG Y is down
    }

    return points;
}

/**
 * Converts SVG path data to multiple point arrays, splitting on M commands
 * Each subpath (starting with M) becomes a separate point array
 * @param {string} pathData - The SVG path data string
 * @param {number} numPoints - Number of points to sample per subpath
 * @param {number} scale - Scale factor for the resulting points
 * @param {number} z - Z position for all points
 * @returns {Array<Array<THREE.Vector3>>} Array of point arrays (one per subpath)
 */
export function svgPathToPointsMulti(pathData, numPoints = 100, scale = 1, z = 0) {
    const subpaths = splitPathIntoSubpaths(pathData);
    const result = [];
    
    for (const subpath of subpaths) {
        const points = subpathToPoints(subpath, numPoints, scale, z);
        if (points.length >= 2) {
            result.push(points);
        }
    }
    
    return result;
}

/**
 * Parses SVG content and extracts points from the first path
 * @param {string} svgContent - SVG content as string
 * @param {number} numPoints - Number of points to sample
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Array<THREE.Vector3>} Array of points or null if parsing fails
 */
export function parseSvgContent(svgContent, numPoints = 100, scale = 1, z = 0) {
    try {
        // Parse SVG content
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");

        // Check for parsing errors
        const parserError = svgDoc.querySelector("parsererror");
        if (parserError) {
            console.error("SVG parsing error:", parserError);
            console.error("SVG content preview:", svgContent.substring(0, 500)); // Add this
            return [];
        }

        // Get the first path element
        const path = svgDoc.querySelector("path");
        if (!path) {
            console.error("No path found in SVG");
            return null;
        }

        // Get path data
        const pathData = path.getAttribute("d");
        if (!pathData) {
            console.error("Path has no data attribute");
            return null;
        }

        // Calculate appropriate scale based on viewBox if present
        let adjustedScale = scale;
        const svgElement = svgDoc.querySelector("svg");
        const viewBox = svgElement?.getAttribute("viewBox");

        if (viewBox) {
            const [, , width, height] = viewBox.split(" ").map(Number);
            // Use the largest dimension to normalize
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
                adjustedScale = scale / maxDimension;
            }
        }

        // Convert path data to points
        return svgPathToPoints(pathData, numPoints, adjustedScale, z);
    } catch (error) {
        console.error("Error parsing SVG content:", error);
        return null;
    }
}

/**
 * Parses SVG content and extracts points from ALL paths
 * @param {string} svgContent - SVG content as string
 * @param {number} numPoints - Number of points to sample per path
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Array<Array<THREE.Vector3>>} Array of point arrays (one per path), or empty array if parsing fails
 */
export function parseSvgContentMultiPath(svgContent, numPoints = 100, scale = 1, z = 0) {
    try {
        // Parse SVG content
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");

        // Check for parsing errors
        const parserError = svgDoc.querySelector("parsererror");
        if (parserError) {
            console.error("SVG parsing error:", parserError);
            return [];
        }

        // Get ALL path elements
        const paths = svgDoc.querySelectorAll("path");
        if (!paths || paths.length === 0) {
            console.error("No paths found in SVG");
            return [];
        }

        // Calculate appropriate scale based on viewBox if present
        let adjustedScale = scale;
        const svgElement = svgDoc.querySelector("svg");
        const viewBox = svgElement?.getAttribute("viewBox");

        if (viewBox) {
            const [, , width, height] = viewBox.split(" ").map(Number);
            // Use the largest dimension to normalize
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
                adjustedScale = scale / maxDimension;
            }
        }

        // Convert each path to points, splitting on M commands for subpaths
        const pathsPoints = [];
        paths.forEach((path, index) => {
            const pathData = path.getAttribute("d");
            if (!pathData) {
                console.warn(`Path ${index} has no data attribute, skipping`);
                return;
            }

            // Use svgPathToPointsMulti to split subpaths properly
            const subpathArrays = svgPathToPointsMulti(pathData, numPoints, adjustedScale, z);
            subpathArrays.forEach((points) => {
                if (points && points.length >= 2) {
                    pathsPoints.push(points);
                }
            });
        });

        console.log(`[SVG] Extracted ${pathsPoints.length} paths from SVG`);
        return pathsPoints;
    } catch (error) {
        console.error("Error parsing SVG content:", error);
        return [];
    }
}

/**
 * Parses SVG content with dynamic resolution based on path lengths
 * Each subpath gets a resolution proportional to its length
 * @param {string} svgContent - SVG content as string
 * @param {Object} options - Options for dynamic resolution
 * @param {number} options.pointsPerUnit - Points per unit of path length (default: 0.5)
 * @param {number} options.minPoints - Minimum points per subpath (default: 50)
 * @param {number} options.maxPoints - Maximum points per subpath (default: 2000)
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Array<Array<THREE.Vector3>>} Array of point arrays (one per path)
 */
export function parseSvgContentDynamicResolution(svgContent, options = {}, scale = 1, z = 0) {
    const {
        pointsPerUnit = POINTS_PER_UNIT,
        minPoints = MIN_POINTS_PER_PATH,
        maxPoints = MAX_POINTS_PER_PATH
    } = options;
    
    try {
        const parser = new DOMParser();
        const svgDoc = parser.parseFromString(svgContent, "image/svg+xml");
        
        const parserError = svgDoc.querySelector("parsererror");
        if (parserError) {
            console.error("SVG parsing error:", parserError);
            return [];
        }
        
        const paths = svgDoc.querySelectorAll("path");
        if (!paths || paths.length === 0) {
            console.error("No paths found in SVG");
            return [];
        }
        
        // Calculate scale from viewBox
        let adjustedScale = scale;
        const svgElement = svgDoc.querySelector("svg");
        const viewBox = svgElement?.getAttribute("viewBox");
        
        if (viewBox) {
            const [, , width, height] = viewBox.split(" ").map(Number);
            const maxDimension = Math.max(width, height);
            if (maxDimension > 0) {
                adjustedScale = scale / maxDimension;
            }
        }
        
        const pathsPoints = [];
        let totalPoints = 0;
        
        paths.forEach((pathEl, index) => {
            const pathData = pathEl.getAttribute("d");
            if (!pathData) return;
            
            // Convert to absolute for proper subpath splitting
            let absolutePathData;
            try {
                absolutePathData = new SvgPath(pathData).abs().toString();
            } catch (e) {
                absolutePathData = pathData;
            }
            
            // Split into subpaths
            const regex = /(M\s*[\d\s.,eE+-]+(?:[^M]*)?)/g;
            let match;
            
            while ((match = regex.exec(absolutePathData)) !== null) {
                const subpath = match[1].trim();
                if (!subpath) continue;
                
                // Calculate length for this subpath
                const svgNS = "http://www.w3.org/2000/svg";
                const tempPath = document.createElementNS(svgNS, "path");
                tempPath.setAttribute("d", subpath);
                const rawLength = tempPath.getTotalLength();
                
                if (rawLength < 1) continue; // Skip very short paths
                
                // Calculate dynamic resolution for this subpath
                // Scale the length by adjustedScale to match normalized output
                const scaledLength = rawLength * adjustedScale;
                // Use a base multiplier to get reasonable point counts
                const basePoints = scaledLength * pointsPerUnit * 100;
                const numPoints = Math.max(minPoints, Math.min(maxPoints, Math.round(basePoints)));
                
                // Sample points along the subpath
                const points = [];
                for (let i = 0; i < numPoints; i++) {
                    const distance = (i / (numPoints - 1)) * rawLength;
                    const point = tempPath.getPointAtLength(distance);
                    points.push(new THREE.Vector3(
                        point.x * adjustedScale,
                        -point.y * adjustedScale,
                        z
                    ));
                }
                
                if (points.length >= 2) {
                    pathsPoints.push(points);
                    totalPoints += points.length;
                }
            }
        });
        
        console.log(`[SVG] Dynamic resolution: ${pathsPoints.length} paths, ${totalPoints} total points`);
        return pathsPoints;
        
    } catch (error) {
        console.error("Error parsing SVG with dynamic resolution:", error);
        return [];
    }
}

/**
 * Loads an SVG file and returns points from the first path
 * @param {string} url - URL to SVG file
 * @param {number} numPoints - Number of points to sample
 * @param {number} scale - Scale factor for the points
 * @param {number} z - Z position for all points
 * @returns {Promise<Array<THREE.Vector3>>} Promise resolving to array of points
 */
export async function loadSvgPath(url, numPoints = 100, scale = 1, z = 0) {
    try {
        console.log('[SVG] Loading SVG from URL:', url);
        const response = await fetch(url);
        console.log('[SVG] Response status:', response.status, 'Content-Type:', response.headers.get('content-type'));
        const svgText = await response.text();
        console.log('[SVG] Loaded content length:', svgText.length, 'First 100 chars:', svgText.substring(0, 100));
        return parseSvgContent(svgText, numPoints, scale, z);
    } catch (error) {
        console.error("Error loading SVG from URL:", error);
        return null;
    }
}

/**
 * Normalizes a set of points to fit within a target size
 * @param {Array<THREE.Vector3>} points - Array of points to normalize
 * @param {number} targetSize - The desired maximum dimension size
 * @returns {Array<THREE.Vector3>} Scaled and centered points
 */
export function normalizePoints(points, targetSize = 8) {
    if (!points || points.length < 2) return points;

    // Calculate bounding box
    const box = new THREE.Box3().setFromPoints(points);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Calculate scale factor to fit within target size
    const maxDimension = Math.max(size.x, size.y);
    const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1;

    // Scale and center points
    return points.map(p => new THREE.Vector3(
        (p.x - center.x) * scaleFactor,
        (p.y - center.y) * scaleFactor,
        p.z
    ));
}

/**
 * Normalizes multiple point arrays to fit within a target size together
 * All paths share the same coordinate space (combined bounding box)
 * @param {Array<Array<THREE.Vector3>>} pathsPoints - Array of point arrays
 * @param {number} targetSize - The desired maximum dimension size
 * @returns {Array<Array<THREE.Vector3>>} Normalized paths
 */
export function normalizePointsMultiPath(pathsPoints, targetSize = 8) {
    if (!pathsPoints || pathsPoints.length === 0) return [];

    // Flatten all points to calculate combined bounding box
    const allPoints = pathsPoints.flat();
    if (allPoints.length < 2) return pathsPoints;

    // Calculate combined bounding box across ALL paths
    const box = new THREE.Box3().setFromPoints(allPoints);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Calculate scale factor to fit within target size
    const maxDimension = Math.max(size.x, size.y);
    const scaleFactor = maxDimension > 0 ? targetSize / maxDimension : 1;

    // Apply same transform to ALL paths
    return pathsPoints.map(points =>
        points.map(p => new THREE.Vector3(
            (p.x - center.x) * scaleFactor,
            (p.y - center.y) * scaleFactor,
            p.z
        ))
    );
}