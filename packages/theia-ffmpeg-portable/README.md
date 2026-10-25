# Theia FFmpeg portable compatibility layer

This workspace package keeps Eclipse Theia's Electron FFmpeg preparation step
reproducible without requiring every contributor to compile the upstream codec
inspection addon.

It:

- downloads the same official Electron FFmpeg artifact as upstream Theia;
- installs it into Electron's distribution;
- verifies the installed file against the downloaded artifact with SHA-256;
- exposes the small `@theia/ffmpeg` API surface consumed by Theia's build tool.

It is a build-time package only. It does not replace or emulate any runtime AI,
terminal, MCP, Skills, editor, or filesystem capability.
