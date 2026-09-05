# Mentra Miniapp Quickstart

> **Beta status:** The Miniapp SDK is in beta, so its APIs may change before general availability. Distribution through the Mentra Developer Console and the Mentra Miniapp Store is not yet supported in MentraOS 3.0. Only use the Miniapp SDK if you are comfortable with these limitations.
>
> If you are developing for **Mentra Live**, the [Mentra Bluetooth SDK](https://docs.mentraglass.com/mentra-live/overview) is recommended instead.

## Enable miniapp development

1. Open **Settings** in the Mentra App.
2. Tap the **version number** at the bottom **ten times** to reveal **Debug Settings**.
3. Open **Debug Settings**, turn on **Miniapp Developer Settings**, return to **Settings**, then open **Miniapp Developer Settings**.

## Share feedback

- In-app bug report
- Discord (link in the Mentra App/docs)
- Email: `help@mentra.glass`

## SDK notes

- This Quickstart uses the **Mentra Miniapp SDK** (`@mentra/miniapp`), which builds apps that run on-device.
- If you are building a mobile app that connects directly to glasses over Bluetooth, use the **Mentra Bluetooth SDK Quickstart** instead.
- The older cloud-hosted `@mentra/sdk` approach is now legacy. Legacy docs live at [mentraglass.com/legacy](https://mentraglass.com/legacy).

## Step 1: Install the Mentra App

Install the **Mentra App** on your Android or iPhone from [MentraGlass.com/OS](https://mentraglass.com/OS), sign in, and connect your glasses (if you have them).

## Step 2: Scaffold a project

```bash
bunx create-mentra-miniapp my-miniapp
```

The scaffolder asks for a project name and the kind of glasses you are targeting (display glasses like Even Realities G1/G2 and Vuzix Z100, or camera glasses like Mentra Live), then generates a ready-to-run two-layer project.

```bash
cd my-miniapp
bun install
```

`bun install` pulls in `@mentra/miniapp` (the runtime) and `@mentra/miniapp-cli` (the `mentra-miniapp` tooling) automatically.

## Step 3: Start the dev server

```bash
bun dev
```

This validates your `miniapp.json`, builds both layers, serves them over your LAN, and prints a QR code plus a `miniapp://dev?...` URL. It hot-reloads on save and forwards the miniapp's console logs back to your terminal.

## Step 4: Load it on your phone

1. In the Mentra App, go to **Settings → Miniapp Developer Settings → Scan Miniapp QR Code** and scan the QR from your terminal.
2. If **Miniapp Developer Settings** is hidden, open **Settings → Debug Settings**, enable **Miniapp Developer Settings**, then return to **Settings**.
3. If **Debug Settings** is hidden, tap the version number at the bottom of **Settings** ten times to reveal it.

Your phone and your laptop must be on the same Wi-Fi network. `bun dev` watches for Wi-Fi changes and reprints the QR if your LAN IP moves.

The miniapp installs and starts. In the starter project, pressing a glasses button shows text on the display, and opening the miniapp's UI tile shows a round-trip latency demo between the UI and background layers.

## Understanding the starter

A scaffolded miniapp has two entry points wired together by a shared, typed channel registry:

```
my-miniapp/
├── miniapp.json              # manifest: package name, permissions, hardware, entries
├── build.ts                  # bundles both layers
└── src/
    ├── background/index.ts   # always-on glasses logic; owns the session
    ├── ui/                   # the on-demand WebView (React)
    └── shared/channels.ts    # typed messages between the two layers
```

### Background layer

The background layer owns the session and all glasses logic.

```typescript
// src/background/index.ts
import { registerMiniapp } from "@mentra/miniapp/background";
import "../shared/channels";

registerMiniapp((session) => {
  session.input.onButtonPress(() => {
    // render() replaces the whole frame — a full-canvas text element here.
    // Box coordinates are raw device px from session.capabilities.display.
    const d = session.capabilities?.display;
    session.display.render([
      {
        type: "text",
        id: "hello",
        box: { x: 0, y: 0, w: d?.width ?? 576, h: d?.height ?? 288 },
        text: "Hello from MentraOS",
      },
    ]);
  });

  // Reply to a "ping" from the UI with a "pong".
  session.ui.on("ping", ({ at }) => {
    session.ui.send("pong", { at: Date.now(), roundtripMs: Date.now() - at });
  });
});
```

### UI layer

The UI is a normal React app that talks to the background over `mentra`. It has no direct hardware access.

```tsx
// src/ui/App.tsx
import { useEffect } from "react";

export function App() {
  useEffect(() => {
    return mentra.on("pong", ({ roundtripMs }) => {
      // update UI
    });
  }, []);

  return (
    <button onClick={() => mentra.send("ping", { at: Date.now() })}>
      Ping
    </button>
  );
}
```

### Shared channels

The shared channels file is the single source of truth for messages between UI and background, enforced at compile time.

```typescript
// src/shared/channels.ts
export interface Channels {
  ping: { at: number };                          // UI → background
  pong: { at: number; roundtripMs: number };     // background → UI
}
```

## Next steps

- Two-layer architecture
- The session
- The manifest
- Test a release

For the full reference, see [docs.mentraglass.com](https://docs.mentraglass.com).
