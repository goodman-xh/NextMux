#!/usr/bin/env python3
"""Bounded extraction of an untrusted macOS updater ZIP, before code signing checks.

Uses Python's ZIP reader (including its CRC/overlap checks), not a shell unzip.
Regular files are created exclusively; internal symlinks are validated as a
graph and created last. No uploaded code is executed.
"""
import argparse
import os
import posixpath
from pathlib import Path
import stat
import unicodedata
import zipfile


def extract(source, destination, *, max_bytes=12 * 1024**3, max_entries=150000):
    destination = Path(destination)
    if destination.exists():
        raise ValueError("Extraction destination must not already exist")
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > max_entries:
            raise ValueError("ZIP entry limit exceeded")
        names, normalized, links, total = {}, set(), {}, 0
        for entry in entries:
            name = entry.filename.rstrip('/')
            parts = name.split('/')
            if not name or '\\' in name or any(part in ('', '.', '..') for part in parts) or any(ord(c) < 32 for c in name):
                raise ValueError("Unsafe ZIP path")
            if parts[0] not in ('NextMux.app', '__MACOSX'):
                raise ValueError("Unexpected ZIP root")
            folded = unicodedata.normalize('NFC', name).casefold()
            if folded in normalized:
                raise ValueError("Duplicate or ambiguous ZIP path")
            normalized.add(folded)
            mode = entry.external_attr >> 16
            kind = stat.S_IFMT(mode)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK) or entry.flag_bits & 1:
                raise ValueError("Unsupported ZIP entry")
            total += entry.file_size
            if entry.file_size > 4 * 1024**3 or total > max_bytes or entry.file_size > max(1, entry.compress_size) * 1000:
                raise ValueError("ZIP expansion limit exceeded")
            names[name] = entry
            if kind == stat.S_IFLNK:
                if entry.file_size > 4096:
                    raise ValueError("Oversized symlink")
                target = archive.read(entry).decode('utf-8')
                if not target or target.startswith('/') or '\\' in target or '\0' in target:
                    raise ValueError("Unsafe symlink")
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), target))
                if not resolved.startswith('NextMux.app/'):
                    raise ValueError("Symlink escapes application")
                links[name] = (target, resolved)
        for name in names:
            parent = posixpath.dirname(name)
            while parent:
                if parent in links or parent in names and not names[parent].is_dir():
                    raise ValueError("ZIP entry descends through non-directory")
                parent = posixpath.dirname(parent)
        # Resolve links through every path component, rejecting cycles and
        # dangling links before creating anything on disk.
        for name, (_, target) in links.items():
            seen = {name}
            for _ in range(len(links) + 1):
                parts = target.split('/')
                prefix = next(('/'.join(parts[:i]) for i in range(1, len(parts) + 1) if '/'.join(parts[:i]) in links), None)
                if prefix is None:
                    if target not in names and not any(n.startswith(target + '/') for n in names):
                        raise ValueError("Dangling symlink")
                    break
                if prefix in seen:
                    raise ValueError("Cyclic symlink")
                seen.add(prefix)
                target = posixpath.normpath(links[prefix][1] + target[len(prefix):])
                if not target.startswith('NextMux.app/'):
                    raise ValueError("Symlink escapes application")
            else:
                raise ValueError("Cyclic symlink")
        destination.mkdir(mode=0o700, parents=True)
        written = 0
        for name, entry in names.items():
            # AppleDouble metadata is not executable application content.
            if name.startswith('__MACOSX/') or name == '__MACOSX' or name in links:
                continue
            target = destination.joinpath(*name.split('/'))
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as src, target.open('xb') as dst:
                count = 0
                while chunk := src.read(1024 * 1024):
                    count += len(chunk)
                    written += len(chunk)
                    if count > entry.file_size or written > max_bytes:
                        raise ValueError("ZIP expansion limit exceeded")
                    dst.write(chunk)
                if count != entry.file_size:
                    raise ValueError("Truncated ZIP entry")
            os.chmod(target, (entry.external_attr >> 16) & 0o755 or 0o644)
        for name, (target, _) in links.items():
            link = destination.joinpath(*name.split('/'))
            link.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(target, link)
        if not (destination / 'NextMux.app/Contents/MacOS/NextMux').is_file():
            raise ValueError("NextMux executable missing")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('destination')
    args = parser.parse_args()
    extract(args.source, args.destination)
