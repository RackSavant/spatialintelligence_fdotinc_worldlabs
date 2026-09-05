# Spatial Intelligence Hackathon Resources

> A one-day guide for choosing a track, building an interactive project, and preparing a two-minute presentation.

- **Event:** September 5, 2026 · San Francisco
- **Event page:** Luma
- **Wi-Fi**
  - **Name:** `Founders Inc-Guest`
  - **Password:** `fincevents!`

## Schedule

- Hacking begins at 10:00 AM
- Submissions close at 6:00 PM
- Two-minute demos run from 6:00–7:00 PM
- Check Luma for attendance, prize, venue, and schedule updates

## Tracks

### Gaming & Interactive Worlds

Build a playable world, game, multiplayer experience, interactive application, or real-time 3D scene with one complete interaction loop.

### Physical AI & Simulation

Build around robotics, embodied agents, spatial reasoning, digital twins, or simulation with clearly visible state changes.

### Creative 3D & VFX

Build a cinematic experience, virtual production scene, creative tool, or real-time graphics demo with a memorable visual result.

## Pro Tips

1. Pick one track, one user interaction, and one visible outcome.
2. Build the smallest end-to-end version before adding visual detail.
3. Keep setup, loading, and reset steps short.
4. Test on the presentation device and save a fallback recording.

### Two-Minute Demo Checklist

- [ ] State the problem, track, and interaction loop.
- [ ] Show the working experience before explaining the implementation.
- [ ] Identify the role of each event technology you used.
- [ ] Keep one reliable path, visible reset controls, and a fallback recording.

## Sponsors & Tools

### World Labs / Marble

- **Marble:** https://marble.worldlabs.ai
- **Marble Docs:** https://docs.worldlabs.ai
- **API Platform:** https://platform.worldlabs.ai
- **API Docs:** https://docs.worldlabs.ai/api
- **Tutorials:** https://www.youtube.com/@WorldLabsAI
- **Case Studies:** https://www.worldlabs.ai/labs
- **Community Showcase:** https://www.worldlabs.ai/labs/showcase
- 🌍 **Starter Kit:** *(link to be added)*

### Mint

**Mint** is an AI agent that helps you generate 3D models, 3D worlds, 3D asset packs, animations, and materials.

#### Set Up Mint

1. Visit [Mint.gg](https://mint.gg) and create an account or sign in.
2. Open **Account**, find **Redeem credits**, and click **Redeem code**.
3. Enter `SPATIAL`, click **Redeem**, and confirm the credits appear.

#### Resources

- **Mint MCP:** https://mcp.mint.gg
- **Mint WebMCP:** https://mcp.mint.gg
- **Mint Three.js Skills:** https://github.com/mintdotgg/mint-threejs-skills
- **Three.js Examples:** https://play.mint.gg
- **Mint API:** https://platform.mint.gg
- **Mint Docs:** https://docs.mint.gg

#### Mint MCP + 3D Skills for Agents

Mint MCP lets coding agents (Cursor, Claude, Codex) generate 3D models, worlds, materials, asset packs, and audio.

##### Install Mint MCP

```bash
codex mcp add mint --url https://mcp.mint.gg/mcp
```

Authenticate with Mint via OAuth once when prompted.

##### Install Mint 3D Skills

```bash
npx skills add mintdotgg/mint-threejs-skills -a codex -g -y
```

##### What to ask your agent

- **3D model:** `Generate a stylized 3D game character: a forest ranger with leather armor, a glowing lantern staff, and a ready-for-adventure pose.`
- **3D app:** `Build a responsive Three.js product configurator with model variants, material selection, annotations, and camera presets.`
- **Asset pack:** `Generate a game-ready forest campsite prop pack, then fetch the GLB ZIP into this project.`
- **Audio:** `Generate a crisp coin pickup sound effect, then fetch the audio file into this project.`

Mint MCP produces the 3D assets and durable artifacts. Mint 3D Skills guides the app architecture, asset integration, interaction, debugging, and release checks.

### Tripo

**Tripo** is an AI company building foundation models for 3D creation. **Tripo Studio** is an AI-native 3D workspace for generating, editing, and preparing production-ready 3D assets.

#### What Can Tripo Studio Do?

- Generate 3D models from text and images.
- Create high-detail models with up to 2 million polygons for 3D printing and visual art.
- Generate clean-topology meshes for games, web apps, and real-time experiences.
- Segment models into editable parts.
- Retopologize and optimize meshes.
- Generate and edit textures.
- Auto-rig characters for animation.
- Export assets into existing 3D workflows through digital content creation (DCC) integrations.

#### Explore Tripo Models & Workflows

##### High-Detail Model

Generate models with up to **2 million polygons**, designed for high-fidelity 3D printing, visual art, and cinematic-quality assets.

##### Smart Mesh

Generate clean, production-ready 3D assets that are easy to edit, rig, animate, and integrate into downstream workflows.

##### Industry Workflows

- 🖨️ 3D Printing
- 🎮 Game Development
- 🎬 3D Animation & Media Production
- 🏠 Interior Design
- 🛍️ Advertising & E-Commerce

#### Tripo CLI

Install the CLI and verify your setup:

```bash
# Requires Node.js 20 or later
npm install -g tripo-cli

# Sign in (opens browser authorization) and verify auth, network, and balance
tripo login
tripo doctor
```

#### Tripo Image-to-3D API

```python
import requests

url = "https://openapi.tripo3d.ai/v3/generation/image-to-model"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer {api_key}"
}
payload = {
    "input": "https://example.com/image.png",
    "model": "tripo-v3.1",
    "texture": True,
    "pbr": True,
    "texture_quality": "detailed"
}

response = requests.post(url, headers=headers, json=payload)
print(response.json())
```

### Convex

- **Convex Hackathons Guide:** https://convex-dev.notion.site/Convex-Sponsored-Hackathons-Guide-286b57ff32ab80daaa12dc4f8853f621

## World Labs Edit Workflows

There are two ways to edit or reimagine a World Labs world.

### Native edit (edit the picture)

Marble flattens the generated world into one 360° panorama. You inpaint a region of that flat image, and Marble regenerates the 3D world from the edited picture. New objects are depth-guessed from a single view, one region at a time. This is currently app-only and has no public API.

### Omni edit (edit the source footage)

You edit the actual rotation or video footage **before** Marble builds the world. The edit exists from every angle the camera captured, so Marble reconstructs the edited scene with real parallax.

### Why Omni edit is better for interior staging

1. **Real depth and occlusion** — a new object seen from 200° of rotation gets real volume, not a flat cutout with guessed depth.
2. **Whole-scene transformations** — restage the entire room, remove every person, or change every material in one instruction.
3. **Stays grounded in the real capture** — edited footage inherits the room's perspective, scale, and lighting falloff.
4. **Iterate before committing to 3D** — conversational multi-turn edits on video, then one 5-minute Marble generation.
5. **Fully automatable via API** — prompt → edited video → Marble world → Spark viewer. This enables a live "transform my surroundings" demo.

### Integration roadmap

| Phase | Edit mode | Use in our app |
|---|---|---|
| Phase 1 | Omni prompt on video | User records a room video and types "stage this as a modern living room" to get a generated world. |
| Phase 2 | Native pano edit | Touch up the generated world in the Marble app. |
| Phase 3 | Combined pipeline | Omni re-stage → Marble world → drag Tripo/Mint assets → save staging to Convex. |
