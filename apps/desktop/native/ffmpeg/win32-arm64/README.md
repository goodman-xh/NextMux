# Windows ARM64 FFmpeg

The release build runs `scripts/prepare-windows-arm64-ffmpeg.mjs` on a native
Windows ARM64 runner. It downloads one immutable BtbN FFmpeg build, verifies
the archive SHA-256 and PE machine type, and packages the executable together
with its upstream license and generated provenance record.

The binary is intentionally not committed to Git. The pinned build targets
Windows 10 22H2 or newer; older Windows 10 releases are not part of this target.
