# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a Vite + React client-side video mockup generator that allows users to create professional device mockup videos. The app runs entirely in the browser using Mediabunny for video processing - no server-side processing or uploads occur.

## Development Commands

Uses Bun as the package manager:

```bash
bun dev           # Start Vite dev server (default http://localhost:5173)
bun run build     # Typecheck and build production bundle to dist/
bun run preview   # Serve the production build locally
bun run lint      # Run ESLint
```

## Architecture

### Client-Side Video Processing Pipeline

The app uses Mediabunny to process videos entirely in the browser:

1. **Video Input**: User uploads or drags a video file into the app
2. **Real-time Preview**: Video is rendered inside a device mockup overlay with adjustable parameters (scale, position, background color, aspect ratio, frame rate)
3. **Mediabunny Processing**: When "Generate Video" is clicked, [useMediabunny.ts](lib/hooks/useMediabunny.ts) orchestrates the video generation:
   - Creates an `Input` from the user's video file using `BlobSource`
   - Sets up an `Output` with MP4 format and `BufferTarget`
   - Configures a `Conversion` with custom video processing using the `process` callback
   - In the `process` callback, composites layers using Canvas API:
     - Base colored background canvas
     - Black rounded rectangle layer (behind video for border effect)
     - User's video scaled and rounded to fit device screen
     - Device mockup PNG overlay
   - Outputs final MP4 with H.264 (AVC) encoding

### Key Technical Details

**Canvas-Based Compositing** ([useMediabunny.ts:123-197](lib/hooks/useMediabunny.ts#L123-L197)):
- Uses `OffscreenCanvas` and `CanvasRenderingContext2D` for frame-by-frame compositing
- Custom `createRoundedRectPath` function creates rounded corners matching device screen
- Layered composition: background → black square → video → mockup PNG
- Precise positioning calculations to align video within device screen bezel
- Supports 30fps and 60fps output

**Client-Side Only Architecture**:
- All processing happens in browser via Mediabunny's WebCodecs-based pipeline
- No server uploads or external API calls for video processing
- Entry: [src/main.tsx](src/main.tsx) mounts [src/App.tsx](src/App.tsx); Mediabunny runs only in the browser bundle
- Mediabunny handles hardware-accelerated encoding/decoding automatically

**State Management**:
- Single-file React component architecture in [src/App.tsx](src/App.tsx)
- useMediabunny hook manages conversion lifecycle and video generation state
- Progress tracking through Mediabunny's `onProgress` callback

### Mediabunny Conversion Flow

The conversion process follows Mediabunny's high-level API:

1. **Input Creation**: `new Input({ source: new BlobSource(videoFile), formats: ALL_FORMATS })`
2. **Output Configuration**: `new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })`
3. **Conversion Setup**: `Conversion.init()` with video processing options:
   - `width` / `height`: Output canvas dimensions
   - `frameRate`: Target frame rate (30 or 60 fps)
   - `codec: 'avc'`: H.264 encoding
   - `bitrate: 'high'`: Quality setting
   - `process`: Custom function that receives each decoded `VideoSample` and returns composited canvas
4. **Execution**: `conversion.execute()` runs the conversion with progress tracking
5. **Output Retrieval**: `output.target.buffer` contains the final MP4 as ArrayBuffer

### File Structure

```
lib/
  hooks/useMediabunny.ts      # Mediabunny integration and video generation logic
  constants/
    mockups.ts                # Device mockup definitions (dimensions, corner radius)
    sizes.ts                  # Output aspect ratios (16:9, 4:3)
    colors.ts                 # Background color palette
src/
  main.tsx                    # React root and Vercel Analytics
  App.tsx                     # Main UI and application logic
  index.css                   # Tailwind entry + global styles
components/
  ui/                         # Radix UI components (slider, select, popover)
```

### Important Constants

**Mockup Definitions** ([lib/constants/mockups.ts](lib/constants/mockups.ts)):
Each mockup has precise dimensions:
- `innerWidth/innerHeight`: Actual screen area dimensions
- `width/height`: Total device dimensions including bezel
- `cornerRadius`: Screen corner radius for rounded rectangle drawing
- Device PNG images located in `/public/images/mockups/iphone/`

**Aspect Ratios** ([lib/constants/sizes.ts](lib/constants/sizes.ts)):
Output canvas sizes - currently supports 16:9 (1920x1080) and 4:3 (1920x1440)

## Development Notes

- The app uses Tailwind CSS with custom configuration
- Path alias `@/` maps to project root (configured in [tsconfig.json](tsconfig.json))
- Vercel Analytics integration included
- Mediabunny uses WebCodecs API for hardware-accelerated encoding/decoding
- Video generation performance depends on input video length, selected framerate, and device capabilities
- Audio is currently discarded from output videos (set via `audio: { discard: true }`)

## Key Differences from FFmpeg Version

This app was migrated from FFmpeg.wasm to Mediabunny:

- **No WASM Loading**: Mediabunny doesn't require loading separate WASM files; it uses native browser WebCodecs
- **Canvas-Based Processing**: Instead of FFmpeg filter complex strings, all compositing is done via Canvas API
- **Simpler API**: Mediabunny's high-level `Conversion` API eliminates manual FFmpeg argument construction
- **Better Performance**: WebCodecs provides hardware-accelerated encoding/decoding when available
- **Smaller Bundle**: Mediabunny is tree-shakable and doesn't include a full FFmpeg build

## Migration Notes

The original FFmpeg implementation used complex filter strings like:
```
geq=lum='p(X,Y)':a='if(gt(abs(W/2-X),W/2-${borderRadius})...'
```

These were replaced with canvas-based drawing:
```typescript
ctx.beginPath();
ctx.quadraticCurveTo(...); // Quadratic curves for rounded corners
ctx.clip();                 // Clip to rounded rect
sample.draw(ctx, x, y, w, h); // Draw video frame
```

All FFmpeg positioning calculations (`overlay=x=...:y=...`) are preserved and translated to canvas coordinates.
