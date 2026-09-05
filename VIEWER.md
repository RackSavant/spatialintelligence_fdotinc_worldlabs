# Viewer

The 3D asset viewer is a single HTML file that runs in the browser. It uses Three.js from a CDN and loads the stiletto FBX directly from this repository.

## Live URL

Open the live demo here:

**[https://racksavant.github.io/spatialintelligence_fdotinc_worldlabs/stiletto-viewer.html](https://racksavant.github.io/spatialintelligence_fdotinc_worldlabs/stiletto-viewer.html)**

## Run locally

```bash
git clone https://github.com/RackSavant/spatialintelligence_fdotinc_worldlabs.git
cd spatialintelligence_fdotinc_worldlabs
npx serve
```

Then open:

```
http://localhost:3000/stiletto-viewer.html
```

## Controls

- Drag to rotate
- Scroll to zoom
- Right-click drag to pan

## Files

| File | Description |
|---|---|
| `stiletto-viewer.html` | The Three.js viewer |
| `assets/models/nude-crisscross-stiletto/Nude-Crisscross-Stiletto-Retopo.fbx` | The stiletto model |
| `assets/models/nude-crisscross-stiletto/textures/texture-9091f555a893-9091f555a893.png` | The model texture |
