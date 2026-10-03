#!/usr/bin/env python3
"""Build a deterministic standalone source bundle from a committed Git tree."""

import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parent.parent
OMITTED_DIRECTORIES = {
    ".git", ".idea", ".vscode", ".work", ".runtime", ".tryout",
    "__pycache__", "target", "dist", "node_modules", "coverage", "data",
    "runtime", "test-results", "playwright-report",
}
REQUIRED_FILES = {
    "LICENSE", "pom.xml", "scripts/tryout.py", "scripts/package-tryout.py",
    "docs/TRYOUT.md", "examples/approval-domain/pom.xml",
    "examples/approval-demo/backend/pom.xml",
    "examples/approval-ui/package.json", "examples/approval-ui/package-lock.json",
}


class PackageError(Exception):
    """A problem that can be explained without a traceback."""


def git(*arguments):
    result = subprocess.run(
        ["git", "-C", str(ROOT), *arguments], stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=False,
    )
    if result.returncode:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise PackageError(detail or "Git command failed.")
    return result.stdout


def excluded(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise PackageError("Unsafe archive path: " + name)
    if any(part in OMITTED_DIRECTORIES for part in path.parts):
        return True
    return any(
        part == ".env" or part.startswith(".env.")
        or part.endswith((".class", ".pyc", ".log"))
        for part in path.parts
    )


def source_entries(commit):
    entries = {}
    with tarfile.open(fileobj=io.BytesIO(git("archive", "--format=tar", commit))) as source:
        for member in source:
            name = member.name.rstrip("/")
            if not name or excluded(name):
                continue
            if member.isfile():
                stream = source.extractfile(member)
                if stream is None:
                    raise PackageError("Cannot read archived file: " + name)
                entries[name] = ("file", 0o755 if member.mode & 0o111 else 0o644, stream.read())
            elif member.isdir():
                entries[name] = ("directory", 0o755, b"")
            else:
                # A self-contained source bundle must not dereference files outside it.
                raise PackageError("Unsupported Git archive entry (link/submodule): " + name)
    missing = REQUIRED_FILES - entries.keys()
    if missing:
        raise PackageError("Selected commit lacks tryout sources: " + ", ".join(sorted(missing)))
    return entries


def write_archive(destination, prefix, entries, timestamp):
    # Neither wall-clock time nor the output filename enters the compressed bytes.
    with destination.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as archive:
                members = {prefix: ("directory", 0o755, b"")}
                for name, entry in entries.items():
                    members[prefix + "/" + name] = entry
                for name in sorted(members):
                    kind, mode, contents = members[name]
                    info = tarfile.TarInfo(name)
                    info.mode = mode
                    info.mtime = timestamp
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.type = tarfile.DIRTYPE if kind == "directory" else tarfile.REGTYPE
                    info.size = 0 if kind == "directory" else len(contents)
                    archive.addfile(info, None if kind == "directory" else io.BytesIO(contents))


def package(args):
    if shutil.which("git") is None:
        raise PackageError("Git is required to package committed source. It is not needed to run an extracted bundle.")
    commit = git("rev-parse", "--verify", "--end-of-options", args.ref + "^{commit}").decode().strip()
    head = git("rev-parse", "HEAD").decode().strip()
    if commit == head and git("status", "--porcelain", "--untracked-files=no").strip():
        raise PackageError("HEAD has tracked changes. Commit or stash them before packaging; working-tree edits are never bundled.")
    timestamp = int(git("show", "-s", "--format=%ct", commit).decode().strip())
    entries = source_entries(commit)
    try:
        pom = ET.fromstring(entries["pom.xml"][2])
        version = pom.findtext("{http://maven.apache.org/POM/4.0.0}version")
    except ET.ParseError as error:
        raise PackageError("Cannot read the selected commit's pom.xml: " + str(error)) from error
    if not version or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]{0,99}", version):
        raise PackageError("Root pom.xml needs a literal, filename-safe project version.")
    prefix = "arcflow-tryout-{}-{}-source".format(version, commit[:12])
    manifest = {
        "formatVersion": 1,
        "kind": "standalone-source-tryout",
        "project": "ArcFlow",
        "version": version,
        "commit": commit,
        "commitTimestamp": timestamp,
        "launcher": "python3 scripts/tryout.py",
        "includesPrebuiltBinaries": False,
        "includesDependencies": False,
        "includesRuoYiUpstream": False,
    }
    entries["TRYOUT_BUNDLE.json"] = (
        "file", 0o644, (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8"),
    )
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    archive_path = output_dir / (prefix + ".tar.gz")
    checksum_path = output_dir / (archive_path.name + ".sha256")
    # Build privately on the destination filesystem, then replace complete files.
    with tempfile.TemporaryDirectory(prefix=".arcflow-package-", dir=str(output_dir)) as temporary:
        staged_archive = Path(temporary) / archive_path.name
        write_archive(staged_archive, prefix, entries, timestamp)
        digest = hashlib.sha256(staged_archive.read_bytes()).hexdigest()
        staged_checksum = Path(temporary) / checksum_path.name
        staged_checksum.write_text(digest + "  " + archive_path.name + "\n", encoding="utf-8")
        os.replace(staged_archive, archive_path)
        os.replace(staged_checksum, checksum_path)
    print("Source bundle: " + str(archive_path))
    print("SHA-256 file: " + str(checksum_path))
    print("Version: {} | commit: {}".format(version, commit))
    print("SHA-256: " + digest)
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="Committed Git ref to package (default: HEAD).")
    parser.add_argument(
        "--output-dir", default=str(ROOT / "dist" / "tryout"),
        help="Destination directory (default: repository dist/tryout).",
    )
    args = parser.parse_args()
    if sys.version_info < (3, 9):
        parser.error("Python 3.9 or newer is required.")
    try:
        return package(args)
    except (PackageError, OSError, ValueError, tarfile.TarError) as error:
        print("Packaging failed: " + str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
