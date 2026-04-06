# AI Coding Agent Instructions for NoGravityWebsite

## Project Overview

**NoGravityWebsite** is a minimal static site featuring a Three.js 3D visualization. The project combines a simple HTML entry point with ES module-based Three.js rendering and responsive CSS styling.

### Key Architecture Points

- **Static Site**: No build process - files served directly via `serve` CLI
- **Three.js Module Import**: Uses ESM import path `/node_modules/three/build/three.module.js` (note the leading slash for static serving)
- **Container-Based Rendering**: 3D scene renders into `#three-container` div (800x600px default)
- **Responsive Design**: Handles window resize events to maintain aspect ratio and pixel density

## Essential Workflows

### Local Development
```bash
npm start
```
Starts a static server on `http://localhost:3000`. Changes to files are immediately visible (no build step).

### Adding 3D Objects
1. Import THREE in [src/three-scene.js](src/three-scene.js)
2. Create geometry and material
3. Add to `scene` object
4. Include in animation loop if animated

### Styling
- CSS variables in [src/styles.css](src/styles.css) define the design system:
  - `--accent: #60a5fa` (blue, used for cube)
  - `--text: #e6eef8` (light gray)
  - `--bg: #0f1724` (dark background)
  - `--card: #0b1220` (slightly lighter dark)

## Project Patterns & Conventions

### Three.js Scene Structure
The scene setup follows a standard pattern:
1. Create scene, camera, renderer in sequence
2. Check for container existence (defensive check at top)
3. Add geometry with MeshStandardMaterial (PBR-based)
4. Include both directional and ambient lighting
5. Register resize listener for responsive sizing
6. Use Clock for frame-independent animation via `getDelta()`

### Animation Loop
- Uses `requestAnimationFrame` for smooth 60fps
- Time-based motion: `rotation += t * speed` (not frame-count based)
- Example: cube rotates at 0.6 rad/s on X-axis, 0.9 rad/s on Y-axis

### File Organization
```
index.html           → Entry point, loads CSS and scripts
src/
  three-scene.js     → All 3D scene setup and animation
  styles.css         → Global CSS variables and styling
```
Note: No separate `script.js` file exists (referenced in HTML but not in workspace - may be legacy or placeholder).

## Critical Implementation Details

- **Container Size**: Scene respects `#three-container` dimensions (not full viewport by default)
- **DPR Handling**: Renderer applies `window.devicePixelRatio` for sharp rendering on high-DPI displays
- **Module Path**: Must use `/node_modules/three/build/three.module.js` with leading slash (static path resolution)
- **Material Choice**: Uses `MeshStandardMaterial` (physically-based rendering) over basic materials

## Common Extension Points

- **Add Animations**: Modify rotation/position calculations in the `animate()` function
- **Change Lighting**: Adjust DirectionalLight intensity/position or add PointLights
- **Interactive Features**: Attach event listeners (mouse, keyboard) to window or renderer.domElement
- **Load Models**: Use THREE.GLTFLoader for external models (requires CORS if model is external)

## Dependencies

- **three** (v0.182.0): 3D graphics library
- **serve** (v14.2.5): Static HTTP server for development
