#!/usr/bin/env python3
"""Content identities for source/check/build reuse; no Git or source mutations."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import struct
import subprocess
import sys
from urllib.parse import urlsplit

PROTECTED_DOCS = {'docs/CONTEXTO_TECNICO_DROP.md', 'docs/manual-queue-v1.4.0-block-b-design.md'}
CONFIG_KEYS = {'variant', 'configuration', 'platform', 'architecture', 'bundle_id', 'version', 'build_number', 'signing', 'team', 'api_origin'}
TOOLS = {'python': [sys.executable, '--version'], 'node': ['node', '--version'], 'ruby': ['/usr/bin/ruby', '--version'], 'bundler': ['/usr/bin/ruby', '-S', 'bundle', '_2.4.22_', '--version'], 'xcode': ['xcodebuild', '-version'], 'swift': ['xcrun', 'swiftc', '--version']}
MARKERS = (b'DROP_UNIT1_FIXTURE_VALIDATION_ONLY', b'DROP_FIXTURE_VALIDATION', b'DropFixtureValidation', b'FixtureValidationPanel', b'withFixtureMutation', b'DropUnit1FixtureHolding')
EXPO_JSI_PACKAGE = 'mobile/node_modules/expo-modules-jsi'
EXPO_JSI_APPLE = EXPO_JSI_PACKAGE + '/apple'
EXPO_JSI_SLICE = EXPO_JSI_APPLE + '/Products/ExpoModulesJSI.xcframework/ios-arm64/ExpoModulesJSI.framework/ExpoModulesJSI'
EXPO_JSI_PRODUCER = EXPO_JSI_APPLE + '/scripts/build-xcframework.sh'
RN_JSI = 'mobile/node_modules/react-native/ReactCommon/jsi/jsi/'
EXPO_JSI_SOURCE_DIRS = tuple(EXPO_JSI_APPLE + '/' + name for name in ('Sources', 'APINotes'))
EXPO_JSI_INPUTS = (
    EXPO_JSI_PRODUCER,
    EXPO_JSI_PACKAGE + '/package.json',
    EXPO_JSI_APPLE + '/Package.swift',
    EXPO_JSI_APPLE + '/ExpoModulesJSI.podspec',
    EXPO_JSI_APPLE + '/scripts/create-stub-xcframework.sh',
    EXPO_JSI_APPLE + '/scripts/generate-modulemap.sh',
    EXPO_JSI_APPLE + '/scripts/xcframework-helpers.sh',
    'mobile/package-lock.json',
    'mobile/ios/Podfile.lock',
    'mobile/ios/Pods/Manifest.lock',
    'mobile/ios/Pods/Local Podspecs/ExpoModulesJSI.podspec.json',
    'mobile/ios/Pods/Local Podspecs/React-Core.podspec.json',
    'mobile/ios/Pods/Target Support Files/ExpoModulesJSI/ExpoModulesJSI-xcframeworks.sh',
    'mobile/ios/Pods/Target Support Files/ExpoModulesJSI/ExpoModulesJSI-xcframeworks-input-files.xcfilelist',
    'mobile/ios/Pods/Target Support Files/ExpoModulesJSI/ExpoModulesJSI-xcframeworks-output-files.xcfilelist',
    'mobile/ios/Pods/Target Support Files/Pods-Drop/Pods-Drop-frameworks.sh',
    RN_JSI + 'jsi.h',
    RN_JSI + 'jsi-inl.h',
)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def relative_file(root, relative):
    p = PurePosixPath(relative)
    if p.is_absolute() or '..' in p.parts or str(p) in ('.', ''):
        raise ValueError('Expected a repository-relative file')
    path = root / str(p)
    if path.resolve() != path or not path.is_file() or path.is_symlink():
        raise ValueError('Missing, linked or non-regular input: ' + relative)
    if (p.name.startswith('.env') and not p.name.endswith('.example')) or p.suffix.lower() in {'.pem', '.key', '.p8', '.p12', '.pfx', '.cer', '.crt', '.der', '.mobileprovision', '.provisionprofile', '.jks', '.keystore', '.sqlite', '.db', '.sqlite-wal', '.sqlite-shm', '.db-wal', '.db-shm'} or p.name in {'credentials.json', '.netrc', '.npmrc'}:
        raise ValueError('Sensitive/data input is not allowed: ' + relative)
    return path


def expo_jsi_inputs(root):
    files = set(EXPO_JSI_INPUTS)
    for directory in EXPO_JSI_SOURCE_DIRS:
        source = root / directory
        if source.resolve() != source or not source.is_dir():
            raise ValueError('Missing or linked ExpoModulesJSI sources: ' + directory)
        entries = list(source.rglob('*'))
        if any(p.is_symlink() for p in entries) or not any(p.is_file() for p in entries):
            raise ValueError('Empty or linked ExpoModulesJSI sources: ' + directory)
        files.update(str(p.relative_to(root)) for p in entries if not p.is_dir())
    for name in ('jsi.h', 'jsi-inl.h'):
        header = root / 'mobile/ios/Pods/Headers/Public/React-jsi/jsi' / name
        if header.resolve() != root / (RN_JSI + name):
            raise ValueError('Unexpected CocoaPods JSI header target: ' + name)
    return files


def expo_jsi_hash(root, relative, *, require_arm64=True):
    data = relative_file(root, relative).read_bytes()
    if require_arm64:
        if len(data) < 32:
            raise ValueError('Truncated ExpoModulesJSI Mach-O header: ' + relative)
        magic, cpu, _, filetype = struct.unpack_from('<IIII', data)
        if (magic, cpu, filetype) != (0xfeedfacf, 0x100000c, 6):
            raise ValueError('Expected a thin ARM64 ExpoModulesJSI dylib: ' + relative)
    return hashlib.sha256(data).hexdigest()


def git(root, *args):
    env = {k: v for k, v in os.environ.items() if not k.startswith('GIT_')}
    env['GIT_OPTIONAL_LOCKS'] = '0'
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-C', str(root), *args], env=env)


def inventory(root, includes):
    tracked = set(filter(None, git(root, 'ls-files', '-z', '--cached').decode().split('\0')))
    others = set(filter(None, git(root, 'ls-files', '-z', '--others', '--exclude-standard').decode().split('\0')))
    unexpected = others - set(includes) - PROTECTED_DOCS
    if unexpected:
        raise ValueError('Review and explicitly include untracked inputs: ' + ', '.join(sorted(unexpected)))
    if set(includes) & PROTECTED_DOCS:
        raise ValueError('Protected local documents cannot be included')
    files = {}
    for relative in sorted(tracked | set(includes)):
        path = relative_file(root, relative)
        kind = 'documentation' if path.suffix == '.md' else 'test' if '/tests/' in '/' + relative else 'build'
        files[relative] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'executable': bool(path.stat().st_mode & 0o111), 'kind': kind}
    return files


def config_values(values):
    result = {}
    for pair in values:
        key, sep, value = pair.partition('=')
        if not sep or key not in CONFIG_KEYS or key in result or not value or len(value) > 160 or any(c in value for c in '\r\n'):
            raise ValueError('Invalid/duplicate explicit configuration key')
        if key == 'api_origin':
            u = urlsplit(value)
            if u.scheme != 'https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('', '/'):
                raise ValueError('api_origin must be a credential-free HTTPS origin')
        result[key] = value
    if result.get('variant') not in (None, 'production', 'instrumentation'):
        raise ValueError('Unknown variant')
    if result.get('variant') == 'instrumentation' and result.get('bundle_id') != 'com.odincarballo.drop.reprotest':
        raise ValueError('Instrumentation requires the authorized test identifier')
    return result


def tool_versions(root, names):
    versions = {}
    for name in sorted(set(names)):
        if name not in TOOLS:
            raise ValueError('Unsupported tool: ' + name)
        env = {k: os.environ[k] for k in ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'DEVELOPER_DIR'] if k in os.environ}
        env['PATH'] = '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin'
        p = subprocess.run(TOOLS[name], cwd=root, env=env, capture_output=True, text=True, timeout=30)
        if p.returncode:
            raise ValueError('Cannot verify tool: ' + name)
        versions[name] = p.stdout.strip()
    return versions


def identities(files, config, tools):
    return {name: digest({'files': {p: v for p, v in files.items() if v['kind'] not in excluded}, 'config': config, 'tools': tools}) for name, excluded in [('source_id', set()), ('check_id', {'documentation'}), ('build_id', {'documentation', 'test'})]}


def snapshot(root, includes=(), config=None, tools=(), *, expo_jsi=False):
    root = Path(root).resolve()
    if Path(git(root, 'rev-parse', '--show-toplevel').decode().strip()).resolve() != root:
        raise ValueError('Root must be the Git checkout root')
    if git(root, 'ls-files', '-u', '-z'):
        raise ValueError('Unresolved Git conflicts')
    config = config_values([str(k) + '=' + str(v) for k, v in (config or {}).items()])
    fixed = set(includes)
    if expo_jsi:
        required = {'variant': 'production', 'configuration': 'Release', 'platform': 'iphoneos',
                    'architecture': 'arm64', 'signing': 'unsigned'}
        if any(config.get(key) != value for key, value in required.items()):
            raise ValueError('ExpoModulesJSI product requires an unsigned production Release for iPhoneOS ARM64')
        fixed.update(expo_jsi_inputs(root))
    files = inventory(root, fixed)
    if expo_jsi and EXPO_JSI_SLICE in files:
        raise ValueError('ExpoModulesJSI slice must not be pinned as an immutable input')
    if config.get('variant') == 'production':
        for relative in files:
            if (relative.startswith(('mobile/src/', 'mobile/modules/')) and '/tests/' not in relative) or relative == 'mobile/app.config.js':
                if any(marker in (root / relative).read_bytes() for marker in MARKERS):
                    raise ValueError('Temporary instrumentation in production input: ' + relative)
    versions = tool_versions(root, tools)
    record = {'schema': 2 if expo_jsi else 1, 'root': str(root), 'head': git(root, 'rev-parse', 'HEAD').decode().strip(), 'created_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'includes': sorted(includes), 'config': config, 'tools': versions, 'files': files, **identities(files, config, versions)}
    if expo_jsi:
        record['expo_jsi'] = {'path': EXPO_JSI_SLICE, 'producer': EXPO_JSI_PRODUCER,
                             'before_sha256': expo_jsi_hash(root, EXPO_JSI_SLICE, require_arm64=False)}
    return record


def verify(root, manifest, *, after_build=False):
    # Recompute identities, inventory and tool versions. Never execute commands supplied by a manifest.
    schema = manifest.get('schema')
    if schema not in (1, 2):
        raise ValueError('Unsupported manifest schema')
    fresh = snapshot(root, manifest['includes'], manifest['config'], manifest['tools'], expo_jsi=schema == 2)
    for key in ['files', 'tools', 'source_id', 'check_id', 'build_id']:
        if fresh[key] != manifest[key]:
            raise ValueError('Input mismatch: ' + key)
    if schema == 2:
        previous = manifest['expo_jsi']
        current = fresh['expo_jsi']
        if any(previous[key] != current[key] for key in ('path', 'producer')):
            raise ValueError('Unexpected ExpoModulesJSI product provenance')
        if not after_build and previous['before_sha256'] != current['before_sha256']:
            raise ValueError('ExpoModulesJSI slice changed before the build')
    return fresh


def output_path(path):
    # Do not resolve an existing link into an unrelated writable destination.
    path = Path(os.path.abspath(Path(path).expanduser()))
    if path.resolve() != path or path.is_symlink():
        raise ValueError('Linked output paths are not allowed')
    return path


def durable_output(path, root):
    path = output_path(path)
    temporary = {Path('/tmp').resolve(), Path(os.environ.get('TMPDIR', '/tmp')).resolve()}
    if path == root or root in path.parents or any(p == path or p in path.parents for p in temporary):
        raise ValueError('Choose durable evidence outside source and temporary storage')
    return path


def write_new(path, value, root):
    path = output_path(path)
    if path == root or root in path.parents:
        raise ValueError('Evidence must be outside the source checkout')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x') as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['create', 'verify'])
    p.add_argument('--root', type=Path, default=Path.cwd())
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--include', action='append', default=[])
    p.add_argument('--config', action='append', default=[])
    p.add_argument('--tool', action='append', default=[])
    p.add_argument('--expo-jsi-product', action='store_true',
                   help='Record the ExpoModulesJSI iPhoneOS slice as a generated build product')
    a = p.parse_args()
    if a.action == 'create':
        value = snapshot(a.root, a.include, config_values(a.config), a.tool, expo_jsi=a.expo_jsi_product)
        write_new(durable_output(a.manifest, a.root.resolve()), value, a.root.resolve())
    else:
        value = verify(a.root, json.loads(a.manifest.read_text()))
    print(json.dumps({k: value[k] for k in ['head', 'source_id', 'check_id', 'build_id']}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit('BLOCKED: ' + str(error))
