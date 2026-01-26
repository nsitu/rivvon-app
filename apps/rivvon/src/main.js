import './style.css'

// Material Icons 
import { loadMaterialSymbols } from './modules/iconLoader';
// Pass an array icon names to be loaded via Google Fonts CDN
loadMaterialSymbols([
    'sprint','upload','grid_view','text_fields','fullscreen','logout','login'
])

import { initThree } from './modules/threeSetup.js';
import { chooseRenderer } from './utils/renderer-utils.js';
import {
  importSvgBtn,
  browseTexturesBtn,
  drawToggleBtn,
  backendToggleBtn,
  materialModeToggleBtn,
  finishDrawingBtn,
  fullscreenBtn,
  flowToggleBtn,
  countdownSecondsSpan,
  fileInput,
  checkerboardDiv,
  drawCanvas,
  rendererIndicator,
  blurredBackground,
  textToSvgBtn,
  textInputPanel,
  textInputField,
  fontSelector,
  generateTextBtn,
  closeTextPanelBtn,
  loginBtn,
  userInfo,
  userName,
  logoutBtn
} from './modules/domElements.js';
import { loadSvgPath, parseSvgContent, normalizePoints, parseSvgContentMultiPath, normalizePointsMultiPath } from './modules/svgPathToPoints.js';
import { Ribbon } from './modules/ribbon.js';
import { RibbonSeries } from './modules/ribbonSeries.js';
import { DrawingManager } from './modules/drawing.js';
import { TileManager } from './modules/tileManager.js';
import { TextureBrowser } from './modules/textureBrowser.js';
import { fetchTextureSet } from './modules/textureService.js';
import { TextToSvg } from './modules/textToSvg.js';
import { initAuth, onAuthStateChange, login, logout, isAuthenticated } from './modules/auth.js';
import * as THREE from 'three';

// Configuration
const RIBBON_RESOLUTION = 500; // Number of points per path - higher = smoother ribbon

let scene, camera, renderer, controls, resetCamera, rendererType;


let tileManager;
let textureBrowser; // Texture browser UI component
let textToSvg; // Text to SVG converter
let isDrawingMode = false;
let ribbon = null;
let ribbonSeries = null; // For multi-path SVG support
let drawingManager;
let currentRenderLoop = null; // for restartable WebGL loop

// Initialize auth UI
function setupAuthUI() {
  // Listen for auth state changes
  onAuthStateChange((user, authenticated) => {
    if (authenticated && user) {
      // Show user info, hide login button
      loginBtn.style.display = 'none';
      userInfo.style.display = 'flex';
      userName.textContent = user.name || user.email || 'User';
    } else {
      // Show login button, hide user info
      loginBtn.style.display = 'flex';
      userInfo.style.display = 'none';
    }
  });

  // Wire up login button
  loginBtn.addEventListener('click', () => {
    login();
  });

  // Wire up logout button
  logoutBtn.addEventListener('click', async () => {
    await logout();
  });
}

// Initialize app automatically on page load
async function initApp() {
  try {
    // Initialize auth first (non-blocking)
    initAuth().catch(err => console.warn('[App] Auth init failed:', err));
    setupAuthUI();

    // Choose renderer type (WebGPU preferred, WebGL fallback)
    rendererType = await chooseRenderer();
    console.log(`[App] Using renderer: ${rendererType}`);

    // Initialize Three.js with chosen renderer
    const threeContext = await initThree(rendererType);
    scene = threeContext.scene;
    camera = threeContext.camera;
    renderer = threeContext.renderer;
    controls = threeContext.controls;
    resetCamera = threeContext.resetCamera;
    rendererType = threeContext.rendererType; // Actual renderer used (may differ if fallback occurred)

    // Set initial state to view mode
    setDrawingMode(false);

    console.log(`[App] Three.js initialized with ${rendererType}`);

    // Update renderer indicator (only visible in debug mode)
    rendererIndicator.textContent = rendererType.toUpperCase();
    rendererIndicator.className = `renderer-indicator ${rendererType}`;

    // Enable debug mode if #debug hash is present
    if (window.location.hash === '#debug') {
      document.body.classList.add('debug-mode');
    }

    // Initialize tile manager 
    // Default: load from CDN using default texture ID
    // Other options: 'ktx2-planes', 'ktx2-waves', 'jpg', or any zip filename
    tileManager = new TileManager({
      // source: null means load from CDN (default behavior)
      renderer,
      rendererType,
      rotate90: true,
      webgpuMaterialMode: 'node'
    });
    await tileManager.loadAllTiles();

    // Set blurred background from default texture thumbnail
    const thumbnailUrl = tileManager.getThumbnailUrl();
    if (thumbnailUrl) {
      setBlurredBackground(thumbnailUrl);
    }

    // Show app buttons by adding a class to body
    document.body.classList.add('app-active');
    // Initialize ribbon
    await initializeRibbon();
    // Initialize drawing manager with multi-stroke callbacks
    drawingManager = new DrawingManager(
      drawCanvas,
      handleDrawingComplete,
      handleStrokeCountChange
    );
    // Set up auto-finalize countdown callback
    drawingManager.onAutoFinalizeCountdown = handleAutoFinalizeCountdown;

    // Initialize text to SVG converter
    textToSvg = new TextToSvg();
    await initializeTextToSvg();

    // Start render loop
    startRenderLoop();

    // Check for deep link to specific texture (e.g., /texture/abc123)
    await checkTextureDeepLink();
  } catch (error) {
    console.error('Error starting application:', error);
  }
}

// Start the app when the page loads
initApp();

// --- UI toggle for drawing mode ---
function setDrawingMode(enableDrawing) {
  // console.log('[Main] setDrawingMode', {
  //   enableDrawing,
  //   drawingManagerActive: !!drawingManager,
  //   controlsEnabled: controls?.enabled
  // });

  // Update the mode state
  isDrawingMode = enableDrawing;
  // Enable/disable orbit controls
  controls.enabled = !enableDrawing;
  // Configure drawing canvas interaction
  drawingManager?.setActive(enableDrawing);
  // Show/hide UI elements
  checkerboardDiv.style.display = enableDrawing ? 'block' : 'none';
  renderer.domElement.style.opacity = enableDrawing ? '0' : '1';
  // Update button style to show active state when in drawing mode
  drawToggleBtn.classList.toggle('active-mode', enableDrawing);

  // Show/hide finish drawing button
  if (finishDrawingBtn) {
    finishDrawingBtn.classList.toggle('visible', enableDrawing);
    finishDrawingBtn.disabled = enableDrawing ? (drawingManager?.getStrokeCount() === 0) : true;
    // Clear countdown when exiting drawing mode
    if (!enableDrawing) {
      finishDrawingBtn.classList.remove('counting');
      if (countdownSecondsSpan) countdownSecondsSpan.textContent = '';
    }
  }

  // console.log('[Main] Drawing mode updated', {
  //   isDrawingMode,
  //   canvasPointerEvents: drawCanvas.style.pointerEvents,
  //   rendererOpacity: renderer.domElement.style.opacity
  // });
}

// Toggle drawing mode on/off with single button
drawToggleBtn.addEventListener('click', () => setDrawingMode(!isDrawingMode));

// --- Multi-stroke drawing UI ---
// Handle stroke count changes from DrawingManager
function handleStrokeCountChange(count) {
  console.log('[Main] Stroke count changed:', count);
  if (finishDrawingBtn) {
    finishDrawingBtn.disabled = count === 0;
  }
}

// Track previous countdown value to avoid restarting animation on every 100ms tick
let lastCountdownSeconds = null;

// Handle auto-finalize countdown updates
function handleAutoFinalizeCountdown(seconds, active) {
  if (finishDrawingBtn && countdownSecondsSpan) {
    finishDrawingBtn.classList.toggle('counting', active);

    if (active) {
      // Only restart animation when the seconds value actually changes
      if (seconds !== lastCountdownSeconds) {
        lastCountdownSeconds = seconds;

        // Remove animating class first
        countdownSecondsSpan.classList.remove('animating');

        // Update the number
        countdownSecondsSpan.textContent = seconds;

        // Force reflow then add animating class to restart animation
        void countdownSecondsSpan.offsetWidth;
        countdownSecondsSpan.classList.add('animating');
      }
    } else {
      lastCountdownSeconds = null;
      countdownSecondsSpan.textContent = '';
      countdownSecondsSpan.classList.remove('animating');
    }
  }
}

// Finish drawing button handler
if (finishDrawingBtn) {
  finishDrawingBtn.addEventListener('click', () => {
    if (!drawingManager) return;

    const strokes = drawingManager.finalizeDrawing();
    if (strokes && strokes.length > 0) {
      handleDrawingComplete(strokes);
    } else {
      console.warn('[Main] No strokes to finalize');
    }
  });
}

// --- Blurred Background ---
/**
 * Set a blurred thumbnail image as the page background
 * @param {string} imageUrl - URL of the thumbnail image
 */
function setBlurredBackground(imageUrl) {
  if (!blurredBackground) {
    console.warn('[App] blurredBackground element not found');
    return;
  }

  if (!imageUrl) {
    // Hide the blurred background if no image
    console.log('[App] Clearing blurred background (no URL provided)');
    blurredBackground.classList.remove('visible');
    blurredBackground.style.backgroundImage = '';
    return;
  }

  console.log('[App] Setting blurred background:', imageUrl);

  // Force browser to reload the image by briefly clearing and re-setting
  // This helps with mobile browser caching issues
  blurredBackground.style.backgroundImage = '';

  // Use requestAnimationFrame to ensure the clear takes effect before setting new image
  requestAnimationFrame(() => {
    blurredBackground.style.backgroundImage = `url('${imageUrl}')`;
    blurredBackground.classList.add('visible');
  });
}

// --- Ribbon builder with animated undulation ---
function updateAnimatedRibbon(time) {
  if (ribbon) {
    // ribbon.update(time);
  }
}

async function initializeRibbon() {
  try {
    // Create the ribbon instance (for drawing - single path)
    ribbon = new Ribbon(scene);
    ribbon.setTileManager(tileManager);

    // Create the ribbon series instance (for SVG - multi-path)
    ribbonSeries = new RibbonSeries(scene);
    ribbonSeries.setTileManager(tileManager);

    // Try to load the SVG path (use multi-path for SVG files)
    const response = await fetch('./spiral.svg');
    const svgText = await response.text();
    const pathsPoints = parseSvgContentMultiPath(svgText, RIBBON_RESOLUTION, 5, 0);

    if (pathsPoints && pathsPoints.length > 0) {
      // Use multi-path normalization to keep paths in shared coordinate space
      const normalizedPaths = normalizePointsMultiPath(pathsPoints);
      // Reset camera before building the initial ribbon series
      resetCamera();
      ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
      // Initialize dual-texture flow materials for smooth conveyor animation
      ribbonSeries.initFlowMaterials();
      console.log(`[App] Loaded SVG with ${pathsPoints.length} path(s), ${ribbonSeries.getTotalSegmentCount()} total segments`);
    } else {
      console.error("Could not extract paths from the SVG file.");
    }
  } catch (error) {
    console.error("Error initializing ribbon from SVG:", error);
  }
}

function resizeCanvas() {

  if (drawingManager) {
    drawingManager.resize(window.innerWidth, window.innerHeight);
  }
  if (renderer && camera) {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

}

// Handle orientation changes with multiple approaches for better mobile support
function handleOrientationChange() {
  // Debug logging for orientation changes (remove in production if needed)
  console.log('Orientation change detected:', {
    orientation: screen.orientation?.angle || 'unknown',
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    visual: window.visualViewport ? `${window.visualViewport.width}x${window.visualViewport.height}` : 'not supported'
  });

  // Use a timeout to account for mobile browser timing issues
  // Some browsers need time to update window dimensions after orientation change
  setTimeout(() => {
    resizeCanvas();

    // Also update slit scanner canvas if it exists
    if (slitScanner && slitScanner.canvas) {
      // The slit scanner may need to adjust its dimensions
      // based on the new orientation
      const videoAspect = slitScanner.canvas.width / slitScanner.canvas.height;
      // Keep the existing width but ensure proper display
      slitScanner.texture?.needsUpdate && (slitScanner.texture.needsUpdate = true);
    }

    // Force a re-render to ensure proper display
    if (ribbon) {
      ribbon.update(performance.now() / 1000);
    }
    renderer.render(scene, camera);
  }, 100);

  // Additional timeout for stubborn mobile browsers
  setTimeout(() => {
    resizeCanvas();
    renderer.render(scene, camera);
  }, 300);

  // Also do an immediate resize attempt
  resizeCanvas();
}

// Standard resize event
window.addEventListener('resize', resizeCanvas);

// Orientation change events (multiple approaches for better compatibility)
// Legacy orientationchange event (still widely supported)
window.addEventListener('orientationchange', handleOrientationChange);

// Modern screen orientation API (when available)
if (screen.orientation) {
  screen.orientation.addEventListener('change', handleOrientationChange);
}

// Visual viewport API for more accurate mobile handling (when available)
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', resizeCanvas);
}

// Initial canvas setup
resizeCanvas();

// --- Drawing callback ---
function handleDrawingComplete(strokesData) {
  // strokesData is now Array<Array<{x,y}>> for multi-stroke
  // Determine if this is multi-stroke data
  const isMultiStroke = Array.isArray(strokesData) && strokesData.length > 0 && Array.isArray(strokesData[0]);

  console.log('[Main] handleDrawingComplete called', {
    isMultiStroke,
    strokeCount: isMultiStroke ? strokesData.length : 1,
    totalPoints: isMultiStroke
      ? strokesData.reduce((sum, s) => sum + s.length, 0)
      : strokesData.length,
    ribbonExists: !!ribbon,
    ribbonSeriesExists: !!ribbonSeries,
    sceneExists: !!scene
  });

  // Reset camera before building the new ribbon(s)
  console.log('[Main] Resetting camera before ribbon creation');
  resetCamera();

  let creationSuccess = false;
  let totalSegments = 0;

  if (isMultiStroke && strokesData.length > 1) {
    // Multi-stroke: use RibbonSeries
    console.log('[Main] Creating ribbon series from', strokesData.length, 'strokes');

    // Clean up existing ribbons
    if (ribbon) ribbon.dispose();
    if (ribbonSeries) ribbonSeries.cleanup();

    // Step 1: Convert all strokes to raw 3D points (NO per-stroke normalization)
    // This preserves the relative spatial arrangement between strokes
    const rawPathsPoints = strokesData.map(stroke =>
      stroke.map(p => new THREE.Vector3(
        p.x,
        -p.y,  // Flip Y to match THREE.js coordinates (screen Y is down, 3D Y is up)
        0
      ))
    ).filter(points => points.length >= 2);

    if (rawPathsPoints.length > 0) {
      // Step 2: Normalize all paths TOGETHER using combined bounding box
      // This preserves relative positions between strokes
      const normalizedPaths = normalizePointsMultiPath(rawPathsPoints);

      // Step 3: Sanitize and smooth each normalized path
      const processedPaths = normalizedPaths.map(points => {
        const sanitized = ribbon.sanitizePoints(points);
        return ribbon.smoothPoints(sanitized, 150);
      }).filter(points => points.length >= 2);

      if (processedPaths.length > 0) {
        // Step 4: Build ribbon series
        ribbonSeries.buildFromMultiplePaths(processedPaths, 1.2);
        // Initialize dual-texture flow materials for smooth conveyor animation
        ribbonSeries.initFlowMaterials();
        totalSegments = ribbonSeries.getTotalSegmentCount();
        creationSuccess = totalSegments > 0;

        console.log('[Main] RibbonSeries creation result:', creationSuccess ? 'success' : 'failed', {
          pathCount: processedPaths.length,
          totalSegments
        });
      }
    }
  } else {
    // Single stroke: use existing Ribbon logic
    const singleStroke = isMultiStroke ? strokesData[0] : strokesData;

    console.log('[Main] Creating single ribbon from', singleStroke.length, 'points');

    // Clean up existing ribbon series
    if (ribbonSeries) ribbonSeries.cleanup();

    const result = ribbon.createRibbonFromDrawing(singleStroke);
    totalSegments = ribbon.meshSegments?.length || 0;
    creationSuccess = totalSegments > 0;

    console.log('[Main] Ribbon creation result:', creationSuccess ? 'success' : 'failed', {
      segmentCount: totalSegments
    });
  }

  // Automatically exit drawing mode
  console.log('[Main] Exiting drawing mode');
  setDrawingMode(false);

  // Force immediate render
  if (renderer && scene && camera) {
    try {
      console.log('[Main] Forcing immediate render after drawing complete');
      renderer.render(scene, camera);
    } catch (e) {
      console.error('[Main] Error during forced render:', e);
    }
  }
}

// --- Render Loop with animated ribbon ---
function startRenderLoop() {
  // let frameCount = 0;
  // const logInterval = 300; // Log every 300 frames (about every 5 seconds at 60fps)

  if (rendererType === 'webgpu') {
    // WebGPU uses setAnimationLoop
    const loopFn = () => {
      const time = performance.now() / 1000;
      // Advance KTX2 layer cycling and tile flow (no-op for JPG mode)
      tileManager?.tick?.(performance.now());
      // Update ribbon materials for tile flow effect (conveyor belt)
      ribbonSeries?.updateFlowMaterials?.();
      updateAnimatedRibbon(time);
      controls.update();
      renderer.render(scene, camera);

      // Periodic logging
      // if (frameCount % logInterval === 0) {
      //   console.log('[Render] Scene state', {
      //     children: scene.children.length,
      //     ribbonSegments: ribbon?.meshSegments?.length || 0,
      //     camera: {
      //       position: camera.position,
      //       rotation: camera.rotation
      //     }
      //   });
      // }
      // frameCount++;
    };
    renderer.setAnimationLoop(loopFn);
    currentRenderLoop = loopFn;
    console.log('[App] WebGPU animation loop started');
  } else {
    // WebGL uses requestAnimationFrame
    function renderLoop() {
      requestAnimationFrame(renderLoop);
      const time = performance.now() / 1000;
      // Advance KTX2 layer cycling and tile flow (no-op for JPG mode)
      tileManager?.tick?.(performance.now());
      // Update ribbon materials for tile flow effect (conveyor belt)
      ribbonSeries?.updateFlowMaterials?.();
      updateAnimatedRibbon(time);
      controls.update();
      renderer.render(scene, camera);

      // Periodic logging
      // if (frameCount % logInterval === 0) {
      //   console.log('[Render] Scene state', {
      //     children: scene.children.length,
      //     ribbonSegments: ribbon?.meshSegments?.length || 0,
      //     camera: {
      //       position: camera.position,
      //       rotation: camera.rotation
      //     }
      //   });
      // }
      // frameCount++;
    }
    currentRenderLoop = renderLoop;
    renderLoop();
    console.log('[App] WebGL animation loop started');
  }
}

// Simple test hook to restart the animation loop manually.
function restartRenderLoop() {
  if (!renderer || !scene || !camera) return;

  console.log('[Main] Restarting render loop');

  if (rendererType === 'webgpu') {
    renderer.setAnimationLoop(null);
  }
  // For WebGL, currentRenderLoop will simply be replaced on next startRenderLoop call.

  startRenderLoop();
}

// Resource Cleanup
window.addEventListener('beforeunload', () => {
  if (drawingManager) {
    drawingManager.dispose();
  }
});

// --- Fullscreen toggle ---
if (fullscreenBtn) {
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      // Enter fullscreen
      document.documentElement.requestFullscreen().catch(err => {
        console.warn('[App] Could not enter fullscreen:', err);
      });
    } else {
      // Exit fullscreen
      document.exitFullscreen().catch(err => {
        console.warn('[App] Could not exit fullscreen:', err);
      });
    }
  });

  // Update button icon when fullscreen state changes
  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement) {
      fullscreenBtn.title = 'Exit fullscreen';
      fullscreenBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>
        </svg>
      `;
    } else {
      fullscreenBtn.title = 'Toggle fullscreen';
      fullscreenBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>
        </svg>
      `;
    }
  });
}

// --- Flow animation toggle ---
if (flowToggleBtn) {
  // Update button appearance based on flow state
  function updateFlowButtonState(enabled) {
    flowToggleBtn.classList.toggle('active', enabled);
    flowToggleBtn.title = enabled ? 'Disable texture flow' : 'Enable texture flow';
  }

  flowToggleBtn.addEventListener('click', () => {
    if (!tileManager) return;
    
    const newState = !tileManager.isFlowEnabled();
    const stateChanged = tileManager.setFlowEnabled(newState);
    
    if (stateChanged && ribbonSeries) {
      // Reinitialize flow materials when state changes
      ribbonSeries.initFlowMaterials();
    }
    
    updateFlowButtonState(newState);
  });

  // Initialize button state (flow is disabled by default)
  updateFlowButtonState(false);
}

if (importSvgBtn && fileInput) {
  // Handle import button click
  importSvgBtn.addEventListener('click', () => {
    fileInput.click();
  });

  // Handle file selection
  fileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const fileName = file.name.toLowerCase();

      try {
        // Check if it's a ZIP file (texture pack) or SVG file (path)
        if (fileName.endsWith('.zip')) {
          // Handle ZIP texture pack upload
          await handleZipTextureUpload(file);
        } else if (fileName.endsWith('.svg')) {
          // Handle SVG path import (existing behavior)
          await handleSvgImport(file);
        } else {
          alert('Please select an SVG or ZIP file.');
        }
      } catch (error) {
        console.error('Error processing file:', error);
        alert('Error processing file: ' + error.message);
      }

      // Reset file input so the same file can be selected again if needed
      fileInput.value = '';
    }
  });
}

// --- Text to SVG Feature ---
async function initializeTextToSvg() {
  if (!textToSvg || !fontSelector) return;

  try {
    // Load available fonts
    const fonts = await textToSvg.loadAvailableFonts();

    // Populate font selector
    fontSelector.innerHTML = '';
    fonts.forEach(fontName => {
      const option = document.createElement('option');
      option.value = fontName;
      // Format display name (replace dashes/underscores with spaces)
      option.textContent = fontName.replace(/[-_]/g, ' ');
      fontSelector.appendChild(option);
    });

    // Load the first font by default
    if (fonts.length > 0) {
      await textToSvg.loadFont(fonts[0]);
    }

    console.log('[App] Text to SVG initialized with', fonts.length, 'fonts');
  } catch (error) {
    console.error('[App] Error initializing text to SVG:', error);
  }
}

// Text to SVG button handler
if (textToSvgBtn && textInputPanel) {
  textToSvgBtn.addEventListener('click', () => {
    textInputPanel.classList.add('visible');
    textInputField?.focus();
  });
}

// Close text panel button handler
if (closeTextPanelBtn && textInputPanel) {
  closeTextPanelBtn.addEventListener('click', () => {
    textInputPanel.classList.remove('visible');
  });
}

// Font selector change handler
if (fontSelector) {
  fontSelector.addEventListener('change', async (e) => {
    const selectedFont = e.target.value;
    if (selectedFont && textToSvg) {
      try {
        generateTextBtn.disabled = true;
        generateTextBtn.textContent = 'Loading font...';
        await textToSvg.loadFont(selectedFont);
        generateTextBtn.disabled = false;
        generateTextBtn.textContent = 'Generate Ribbon';
      } catch (error) {
        console.error('[App] Error loading font:', error);
        generateTextBtn.disabled = false;
        generateTextBtn.textContent = 'Generate Ribbon';
      }
    }
  });
}

// Generate ribbon from text handler
if (generateTextBtn) {
  generateTextBtn.addEventListener('click', async () => {
    const text = textInputField?.value?.trim();
    if (!text) {
      alert('Please enter some text.');
      return;
    }

    if (!textToSvg?.getCurrentFontData()) {
      alert('Please wait for the font to load.');
      return;
    }

    try {
      generateTextBtn.disabled = true;
      generateTextBtn.textContent = 'Generating...';

      // Generate points from text
      const pathsPoints = textToSvg.textToPoints(text, RIBBON_RESOLUTION, {
        alignment: 'center',
        charSpacing: 2,
        lineHeight: 1.2
      });

      if (pathsPoints && pathsPoints.length > 0) {
        // Normalize all paths together to preserve relative positions
        const normalizedPaths = normalizePointsMultiPath(pathsPoints);

        // Reset camera
        resetCamera();

        // Clean up existing single ribbon
        if (ribbon) {
          ribbon.dispose();
        }

        // Build ribbon series from text paths
        ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
        // Initialize dual-texture flow materials for smooth conveyor animation
        ribbonSeries.initFlowMaterials();

        console.log(`[App] Created ribbon from text "${text}" with ${pathsPoints.length} paths, ${ribbonSeries.getTotalSegmentCount()} segments`);

        // Close the panel
        textInputPanel.classList.remove('visible');
      } else {
        alert('Could not generate paths from the text. Some characters may not be supported by this font.');
      }
    } catch (error) {
      console.error('[App] Error generating ribbon from text:', error);
      alert('Error generating ribbon: ' + error.message);
    } finally {
      generateTextBtn.disabled = false;
      generateTextBtn.textContent = 'Generate Ribbon';
    }
  });
}

// --- Texture Browser Button ---
if (browseTexturesBtn) {
  // Initialize texture browser
  textureBrowser = new TextureBrowser({
    onSelect: async (texture) => {
      console.log('[App] Texture selected from browser:', texture.id, texture.name);
      await handleRemoteTextureSelect(texture);
    },
    onClose: () => {
      console.log('[App] Texture browser closed');
    }
  });

  browseTexturesBtn.addEventListener('click', () => {
    textureBrowser.open();
  });
}

// Handle remote texture selection from the browser
async function handleRemoteTextureSelect(texture) {
  console.log(`[App] Loading remote texture: ${texture.name}`);

  // Show loading indicator on the button
  const originalButtonContent = browseTexturesBtn.innerHTML;
  browseTexturesBtn.disabled = true;
  browseTexturesBtn.innerHTML = '<span style="font-size: 11px;">Loading...</span>';

  try {
    // Fetch full texture set with tile URLs
    const textureSet = await fetchTextureSet(texture.id);

    if (!textureSet || !textureSet.tiles || textureSet.tiles.length === 0) {
      throw new Error('No tiles found in texture set');
    }

    // Check if this is a Google Drive texture that requires authentication
    const hasDriveTiles = textureSet.tiles.some(tile => tile.driveFileId);
    if (hasDriveTiles && !isAuthenticated()) {
      // Prompt user to sign in
      const shouldLogin = confirm(
        'This texture is stored on Google Drive and requires you to sign in.\n\n' +
        'Click OK to sign in with Google, or Cancel to go back.'
      );
      if (shouldLogin) {
        login();
      }
      return; // Exit early - login will redirect
    }

    console.log(`[App] Fetched texture set: ${textureSet.tiles.length} tiles`);

    // Load textures from remote URLs
    const success = await tileManager.loadFromRemote(textureSet, (stage, current, total) => {
      if (stage === 'downloading') {
        const pct = Math.round((current / total) * 100);
        browseTexturesBtn.innerHTML = `<span style="font-size: 11px;">DL ${pct}%</span>`;
      } else if (stage === 'building') {
        const pct = Math.round((current / total) * 100);
        browseTexturesBtn.innerHTML = `<span style="font-size: 11px;">Build ${pct}%</span>`;
      }
    });

    if (success) {
      console.log(`[App] Remote texture loaded: ${tileManager.getTileCount()} tiles`);

      // Set blurred background from thumbnail
      console.log('[App] Texture thumbnail_url:', texture.thumbnail_url);
      setBlurredBackground(texture.thumbnail_url);

      // Rebuild existing ribbons with new textures
      rebuildRibbonsWithNewTextures();
    } else {
      alert('Failed to load remote texture set.');
    }
  } catch (error) {
    console.error('[App] Failed to load remote texture:', error);

    // Check if it's an auth error
    if (error.message.includes('Not authenticated') || error.message.includes('Access denied')) {
      const shouldLogin = confirm(
        'Unable to access this texture. You may need to sign in.\n\n' +
        'Click OK to sign in with Google, or Cancel to go back.'
      );
      if (shouldLogin) {
        login();
      }
    } else {
      alert('Failed to load texture: ' + error.message);
    }
  } finally {
    // Restore button
    browseTexturesBtn.disabled = false;
    browseTexturesBtn.innerHTML = originalButtonContent;
  }
}

// --- Deep Link Support ---
// Check URL hash for texture ID and load it automatically (e.g., #abc123)
async function checkTextureDeepLink() {
  const hash = window.location.hash;

  if (!hash || hash.length < 2) {
    return; // No hash or empty hash
  }

  // Remove the # prefix
  const textureId = hash.substring(1);

  // Basic validation - texture IDs are alphanumeric with underscores/hyphens
  if (!/^[a-zA-Z0-9_-]+$/.test(textureId)) {
    return; // Invalid texture ID format
  }

  console.log(`[App] Deep link detected, loading texture: ${textureId}`);

  try {
    // Show loading state
    if (browseTexturesBtn) {
      browseTexturesBtn.disabled = true;
      browseTexturesBtn.innerHTML = '<span style="font-size: 11px;">Loading...</span>';
    }

    // Fetch the texture set
    const textureSet = await fetchTextureSet(textureId);

    if (!textureSet || !textureSet.tiles || textureSet.tiles.length === 0) {
      console.error('[App] Deep link texture not found or has no tiles:', textureId);
      return;
    }

    console.log(`[App] Deep link texture found: ${textureSet.name}`);

    // Load textures from remote URLs
    const success = await tileManager.loadFromRemote(textureSet, (stage, current, total) => {
      if (browseTexturesBtn) {
        if (stage === 'downloading') {
          const pct = Math.round((current / total) * 100);
          browseTexturesBtn.innerHTML = `<span style="font-size: 11px;">DL ${pct}%</span>`;
        } else if (stage === 'building') {
          const pct = Math.round((current / total) * 100);
          browseTexturesBtn.innerHTML = `<span style="font-size: 11px;">Build ${pct}%</span>`;
        }
      }
    });

    if (success) {
      console.log(`[App] Deep link texture loaded: ${tileManager.getTileCount()} tiles`);

      // Set blurred background from thumbnail
      setBlurredBackground(textureSet.thumbnail_url);

      rebuildRibbonsWithNewTextures();
    }
  } catch (error) {
    console.error('[App] Failed to load deep link texture:', error);
  } finally {
    // Restore button
    if (browseTexturesBtn) {
      browseTexturesBtn.disabled = false;
      browseTexturesBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
      </svg>`;
    }
  }
}

// Handle SVG path import
async function handleSvgImport(file) {
  // Read the SVG file content
  const svgText = await file.text();

  // Use multi-path parsing to extract all paths
  const pathsPoints = parseSvgContentMultiPath(svgText, RIBBON_RESOLUTION, 5, 0);

  if (pathsPoints && pathsPoints.length > 0) {
    // Use multi-path normalization to keep paths in shared coordinate space
    const normalizedPaths = normalizePointsMultiPath(pathsPoints);
    resetCamera();

    // Clean up single ribbon if it was used
    if (ribbon) {
      ribbon.dispose();
    }

    // Build ribbon series from all paths
    ribbonSeries.buildFromMultiplePaths(normalizedPaths, 1.2);
    // Initialize dual-texture flow materials for smooth conveyor animation
    ribbonSeries.initFlowMaterials();
    console.log(`[App] Imported SVG with ${pathsPoints.length} path(s), ${ribbonSeries.getTotalSegmentCount()} total segments`);
  } else {
    alert('Could not extract paths from the SVG file.');
  }
}

// Handle ZIP texture pack upload
async function handleZipTextureUpload(file) {
  console.log(`[App] Processing texture pack: ${file.name}`);

  // Show loading indicator
  const originalButtonContent = importSvgBtn.innerHTML;
  importSvgBtn.disabled = true;
  importSvgBtn.innerHTML = '<span style="font-size: 11px;">Loading...</span>';

  try {
    // Read the zip file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();

    // Load textures from the user-provided zip
    const success = await tileManager.loadFromUserZip(arrayBuffer, (stage, current, total) => {
      if (stage === 'extracting') {
        const pct = Math.round((current / total) * 100);
        importSvgBtn.innerHTML = `<span style="font-size: 11px;">Extract ${pct}%</span>`;
      } else if (stage === 'building') {
        const pct = Math.round((current / total) * 100);
        importSvgBtn.innerHTML = `<span style="font-size: 11px;">Build ${pct}%</span>`;
      }
    });

    if (success) {
      console.log(`[App] Texture pack loaded successfully: ${tileManager.getTileCount()} tiles`);

      // Rebuild existing ribbons with new textures
      rebuildRibbonsWithNewTextures();
    } else {
      alert('Failed to load texture pack. Make sure it contains numbered KTX2 files (0.ktx2, 1.ktx2, etc.).');
    }
  } finally {
    // Restore button
    importSvgBtn.disabled = false;
    importSvgBtn.innerHTML = originalButtonContent;
  }
}

// Rebuild existing ribbons after texture change
function rebuildRibbonsWithNewTextures() {
  console.log('[App] Rebuilding ribbons with new textures');

  // Check if we have a ribbon series with paths
  if (ribbonSeries && ribbonSeries.lastPathsPoints && ribbonSeries.lastPathsPoints.length > 0) {
    const pathsPoints = ribbonSeries.lastPathsPoints;
    const width = ribbonSeries.lastWidth || 1.2;

    // Rebuild the ribbon series
    ribbonSeries.buildFromMultiplePaths(pathsPoints, width);
    // Re-initialize dual-texture flow materials with new textures
    ribbonSeries.initFlowMaterials();
    console.log(`[App] Rebuilt ribbon series: ${ribbonSeries.getTotalSegmentCount()} segments`);
    return;
  }

  // Check if we have a single ribbon with points
  if (ribbon && ribbon.lastPoints && ribbon.lastPoints.length >= 2) {
    const points = ribbon.lastPoints;
    const width = ribbon.lastWidth || 1.2;

    // Rebuild the ribbon
    ribbon.buildFromPoints(points, width);
    console.log(`[App] Rebuilt single ribbon: ${ribbon.meshSegments?.length || 0} segments`);
    return;
  }

  console.log('[App] No existing ribbon to rebuild');
}
