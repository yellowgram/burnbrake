#!/usr/bin/env bash
# Rebuild burnbrake-<version>.zip from this tree and check its SHA-256.
# Version is package.json (this fence: 0.1.1).
# The digest is checksums/burnbrake-<version>.sha256 (git). It is not inside the zip.
# checksums/burnbrake-0.1.0.* stay historical. This script does not write them.
# Usage: scripts/pack-release.sh [--write]
#   --write  overwrite checksums/burnbrake-<version>.* after a deliberate kit change
#   default  fail if the rebuilt zip does not match the committed digest
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WRITE=0
if [[ "${1:-}" == "--write" ]]; then
  WRITE=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: scripts/pack-release.sh [--write]" >&2
  exit 2
fi

VERSION="$(node -p "require('./package.json').version")"
if [[ "$VERSION" != "0.1.1" ]]; then
  echo "package.json version must be 0.1.1 (got ${VERSION})" >&2
  exit 1
fi

npm ci
npm run build

export BURNBRAKE_PACK_WRITE="$WRITE"
export BURNBRAKE_PACK_VERSION="$VERSION"
python3 - <<'PY'
import hashlib
import os
import sys
import zipfile
from pathlib import Path

root = Path(".").resolve()
version = os.environ["BURNBRAKE_PACK_VERSION"]
if version != "0.1.1":
    sys.exit(f"pack version must be 0.1.1 (got {version})")
prefix = f"burnbrake-{version}"
zip_name = f"{prefix}.zip"
write = os.environ.get("BURNBRAKE_PACK_WRITE") == "1"

fixed = [
    ".dockerignore",
    "CHANGELOG.md",
    "Dockerfile",
    "LICENSE",
    "README.md",
    "config.example.env",
    "docker-compose.yml",
    "package-lock.json",
    "package.json",
    "tsconfig.json",
    "docs/COMMERCIAL_GRANT.md",
    "docs/COMMERCIAL_LOCK.md",
    "docs/DEMO_60S.md",
    "docs/DESIGN_BRAKE_CURVE.md",
    "docs/MINIMUM_SUPPORT.md",
    "docs/MVP_SCOPE.md",
    "docs/OPERATOR.md",
    "docs/OPERATOR_NEEDS.md",
    "docs/START_HERE.md",
    "docs/SUPPORT.md",
    "prices/openai.yaml",
    "scripts/demo-60s.ts",
]

files: list[str] = []
for rel in fixed:
    path = root / rel
    if not path.is_file():
        sys.exit(f"missing kit file: {rel}")
    files.append(rel)

for path in sorted((root / "src").rglob("*")):
    if path.is_file():
        files.append(path.relative_to(root).as_posix())

for path in sorted((root / "prices").glob("*.yaml")):
    rel = path.relative_to(root).as_posix()
    if rel not in files:
        files.append(rel)

dist = root / "dist"
if not dist.is_dir():
    sys.exit("dist/ missing after npm run build")

for path in sorted(dist.rglob("*")):
    if not path.is_file():
        continue
    rel = path.relative_to(root).as_posix()
    if rel.startswith("dist/release/"):
        continue
    if path.name.endswith(".tsbuildinfo"):
        continue
    files.append(rel)

files = sorted(set(files))

forbidden_parts = {".git", "node_modules", "data", "checksums", "test"}
for rel in files:
    parts = Path(rel).parts
    if any(part in forbidden_parts for part in parts):
        sys.exit(f"refusing to pack {rel}")
    name = parts[-1]
    if name == ".env" or name.startswith(".env."):
        sys.exit(f"refusing to pack {rel}")
    if name.endswith((".sqlite", ".sqlite-wal", ".sqlite-shm")):
        sys.exit(f"refusing to pack {rel}")
    if parts[0] == "docs" and (
        name.startswith("CR")
        or name.startswith("DR")
        or name.startswith("LAUNCHGATE")
        or name.startswith("DESIGN_PASS")
        or name == "POLAR_DELIVERABLES.md"
    ):
        sys.exit(f"refusing to pack {rel}")

root_bytes = str(root).encode()
secret_needles = (
    b"BEGIN OPENSSH PRIVATE KEY",
    b"BEGIN RSA PRIVATE KEY",
    b"BEGIN PRIVATE KEY",
    b"sk-proj-",
    b"sk-live-",
    b"AKIA",
)
members: list[tuple[str, bytes]] = []
for rel in files:
    data = (root / rel).read_bytes()
    if root_bytes in data:
        sys.exit(f"{rel} contains the absolute build path; zip would not be reproducible")
    for needle in secret_needles:
        if needle in data:
            sys.exit(f"{rel} matched secret marker {needle.decode()}")
    members.append((f"{prefix}/{rel}", data))

out_dir = root / "dist" / "release"
out_dir.mkdir(parents=True, exist_ok=True)
zip_path = out_dir / zip_name
partial = out_dir / f"{zip_name}.partial"

with zipfile.ZipFile(partial, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=False) as archive:
    for arcname, data in members:
        info = zipfile.ZipInfo(filename=arcname, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (0o100644) << 16
        info.flag_bits |= 0x800
        info.extra = b""
        archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

partial.replace(zip_path)
digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
line = f"{digest}  {zip_name}\n"
manifest = "".join(f"{arcname}\n" for arcname, _data in members)

checksum_path = root / "checksums" / f"burnbrake-{version}.sha256"
manifest_path = root / "checksums" / f"burnbrake-{version}.manifest.txt"
checksum_path.parent.mkdir(parents=True, exist_ok=True)

if write:
    checksum_path.write_text(line)
    manifest_path.write_text(manifest)
    print(f"wrote {checksum_path.relative_to(root)}")
    print(f"wrote {manifest_path.relative_to(root)}")
else:
    if not checksum_path.is_file():
        sys.exit(f"missing {checksum_path}. Run scripts/pack-release.sh --write")
    expected = checksum_path.read_text()
    if expected != line:
        sys.exit(
            "SHA-256 mismatch. The zip does not match checksums/"
            f"burnbrake-{version}.sha256.\n"
            f"committed: {expected.strip()}\n"
            f"rebuilt:   {line.strip()}\n"
            "Stop. Do not publish. Re-run with --write only after an intentional kit change, "
            "then update docs/POLAR_DELIVERABLES.md to the new digest."
        )
    if manifest_path.is_file() and manifest_path.read_text() != manifest:
        sys.exit(f"manifest mismatch: {manifest_path}")
    print(f"SHA-256 matches {checksum_path.relative_to(root)}")

print(f"zip: {zip_path.relative_to(root)}")
print(f"sha256: {digest}")
print(f"files: {len(members)}")
PY
