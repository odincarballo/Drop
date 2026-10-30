#!/usr/bin/env python3
"""Supervise an explicit command, preserve logs and archive output. Never generates install or cleanup commands."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import signal
import struct
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import manifest


def supervise(command, root, env, log, monitor, minimum, stop, interval, free=None):
    free = free or (lambda: shutil.disk_usage(root).free / 2**30)
    lowest = free()
    if lowest < minimum:
        raise ValueError('Insufficient space before command: %.2f GiB' % lowest)
    stopped = False
    with log.open('xb') as output:
        process = subprocess.Popen(command, cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                available = free()
                lowest = min(lowest, available)
                with monitor.open('a') as f:
                    f.write(json.dumps({'utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'free_gib': available, 'pid': process.pid}) + '\n')
                if available <= stop:
                    stopped = True
                    break
                time.sleep(interval)
        finally:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
        code = process.wait()
    return {'exit_code': code, 'stopped_for_space': stopped, 'minimum_free_gib': min(lowest, free())}


def archive(source, destination):
    if source.is_symlink() or source.resolve() != source:
        raise ValueError('Linked artifact path refused')
    destination = manifest.output_path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Archive already exists')
    if source.is_dir() and (destination == source or source in destination.parents):
        raise ValueError('Cannot archive inside source')
    if source.is_dir():
        # No external links, devices, FIFO or sockets may be imported into evidence.
        for p in source.rglob('*'):
            if p.is_symlink() and (Path(os.readlink(p)).is_absolute() or not p.exists() or source not in p.resolve().parents):
                raise ValueError('External, absolute or dangling artifact symlink')
            if not (p.is_symlink() or p.is_file() or p.is_dir()):
                raise ValueError('Special file in artifact')
        shutil.copytree(source, destination, symlinks=True)
    elif source.is_file():
        with source.open('rb') as reader, destination.open('xb') as writer:
            shutil.copyfileobj(reader, writer)
        shutil.copystat(source, destination, follow_symlinks=False)
    else:
        raise ValueError('Missing artifact')
    def fingerprints(root):
        paths = root.rglob('*') if root.is_dir() else [root]
        return {str(p.relative_to(root)) if root.is_dir() else '.': {'link': os.readlink(p)} if p.is_symlink() else {'sha256': hashlib.sha256(p.read_bytes()).hexdigest(), 'executable': bool(p.stat().st_mode & 0o111)} for p in paths if p.is_symlink() or p.is_file()}
    original = fingerprints(source)
    if fingerprints(destination) != original:
        raise ValueError('Artifact copy mismatch; evidence retained')
    return original


def build_command(command, config, root=None):
    required = {'variant', 'configuration', 'platform', 'architecture', 'bundle_id', 'version', 'build_number', 'signing'}
    if not required <= config.keys() or config['variant'] != 'production' or config['signing'] != 'unsigned':
        raise ValueError('This supervisor supports only explicit unsigned production builds')
    if config['bundle_id'] == 'com.odincarballo.mediadrop':
        raise ValueError('Use a separate test bundle for unsigned verification')
    actual = shutil.which(command[0], path='/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin')
    expected = shutil.which('xcodebuild', path='/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin')
    if actual is None or expected is None or Path(actual).resolve() != Path(expected).resolve():
        raise ValueError('Command must resolve to the verified Xcode tool')
    if Path(command[0]).name != 'xcodebuild' or 'CODE_SIGNING_ALLOWED=NO' not in command or 'ARCHS=arm64' not in command:
        raise ValueError('Expected explicit unsigned ARM64 xcodebuild command')
    options = {'-workspace', '-scheme', '-configuration', '-sdk', '-destination', '-derivedDataPath', '-jobs'}
    settings = {'ARCHS=arm64', 'CODE_SIGNING_ALLOWED=NO', 'EXPANDED_CODE_SIGN_IDENTITY_NAME=Ad Hoc', 'EXPANDED_CODE_SIGN_IDENTITY=-'}
    seen = {}
    pos = 1
    while pos < len(command):
        arg = command[pos]
        if arg in options:
            if arg in seen or pos + 1 >= len(command):
                raise ValueError('Duplicate/missing build option: ' + arg)
            if not command[pos + 1] or command[pos + 1].startswith('-'):
                raise ValueError('Invalid build option value')
            seen[arg] = command[pos + 1]
            pos += 2
        elif arg in settings or arg == 'build':
            if arg in seen:
                raise ValueError('Duplicate build setting')
            seen[arg] = True
            pos += 1
        else:
            raise ValueError('Unsupported build argument: ' + arg)
    for key, value in [('-jobs', '2'), ('-configuration', 'Release'), ('-sdk', 'iphoneos'), ('-destination', 'generic/platform=iOS')]:
        if seen.get(key) != value:
            raise ValueError('Required build option: ' + key + ' ' + value)
    if not settings <= seen.keys() or 'build' not in seen:
        raise ValueError('Missing explicit build/signing settings')
    if config['configuration'] != 'Release' or config['platform'] != 'iphoneos' or config['architecture'] != 'arm64':
        raise ValueError('Build command/configuration mismatch')

    root = Path(root or Path.cwd()).resolve()
    for option in ['-workspace', '-scheme', '-derivedDataPath']:
        if option not in seen:
            raise ValueError('Missing build option: ' + option)
    def inside(value):
        relative = Path(value)
        if relative.is_absolute() or '..' in relative.parts or str(relative) == '.':
            raise ValueError('Build paths must be checkout-relative')
        path = root / relative
        if path.resolve() != path:
            raise ValueError('Linked build paths are not allowed')
        return path
    workspace = inside(seen['-workspace'])
    derived = inside(seen['-derivedDataPath'])
    if workspace.suffix != '.xcworkspace' or not workspace.is_dir():
        raise ValueError('Missing generated workspace')
    if root / 'mobile/ios/build' not in derived.parents:
        raise ValueError('DerivedData must stay under mobile/ios/build')
    return {'workspace': workspace, 'derived': derived}


def build_inputs(root, record, workspace):
    required = {'mobile/ios/Podfile', 'mobile/ios/Podfile.lock'}
    contents = workspace / 'contents.xcworkspacedata'
    relative = str(contents.relative_to(root))
    manifest.relative_file(root, relative)
    required.add(relative)
    workspace_xml = ET.parse(contents).getroot()
    if list(workspace_xml.iter('Group')):
        raise ValueError('Grouped workspaces require explicit reference review')
    projects = list(workspace_xml.iter('FileRef'))
    if not projects:
        raise ValueError('Workspace must reference generated projects')
    for project in projects:
        kind, sep, value = project.attrib.get('location', '').partition(':')
        if not sep or kind not in {'group', 'container'}:
            raise ValueError('Unsupported workspace reference')
        path = Path(value)
        if path.is_absolute() or '..' in path.parts or path.suffix != '.xcodeproj':
            raise ValueError('External workspace project refused')
        relative = str((workspace.parent / path / 'project.pbxproj').relative_to(root))
        manifest.relative_file(root, relative)
        required.add(relative)
    if not required <= record['files'].keys():
        raise ValueError('Record workspace, projects, Podfile and Podfile.lock as explicit inputs')


def inspect_app(path, config):
    def regular(name):
        file = path / name
        if path.resolve() != path or file.resolve() != file or not file.is_file() or file.is_symlink():
            raise ValueError('Linked/missing app input: ' + name)
        return file
    info = plistlib.loads(regular('Info.plist').read_bytes())
    for key, value in [('CFBundleIdentifier', config['bundle_id']), ('CFBundleShortVersionString', config['version']), ('CFBundleVersion', config['build_number'])]:
        if info.get(key) != value:
            raise ValueError('App metadata mismatch: ' + key)
    if (path / 'embedded.mobileprovision').exists():
        raise ValueError('Unexpected provisioning in unsigned app')
    name = info.get('CFBundleExecutable', '')
    if not isinstance(name, str) or not name or Path(name).name != name or name in {'.', '..'}:
        raise ValueError('Invalid executable name')
    executable = regular(name)
    if executable.resolve() != executable or not executable.is_file():
        raise ValueError('Linked/missing executable')
    data = executable.read_bytes()
    if len(data) < 8 or data[:4] != b'\xcf\xfa\xed\xfe' or struct.unpack('<I', data[4:8])[0] != 0x100000C:
        raise ValueError('Expected thin ARM64 Mach-O')
    if (path / 'main.jsbundle').resolve() != path / 'main.jsbundle':
        raise ValueError('Linked JavaScript bundle')
    js = regular('main.jsbundle').read_bytes()
    if js[:8] != bytes.fromhex('c61fbc03c103191f'):
        raise ValueError('Expected Hermes bytecode')
    for marker in manifest.MARKERS + (b'fixtureValidationEnabled', b'fixtureValidation', b'fixtureMutation'):
        if any(marker in payload or marker.decode().encode('utf-16-le') in payload for payload in [data, js]):
            raise ValueError('Known temporary instrumentation marker in artifact')
    return {'executable_sha256': hashlib.sha256(data).hexdigest(), 'hermes_sha256': hashlib.sha256(js).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--kind', choices=['check', 'build'], default='check')
    parser.add_argument('--artifact', help='Explicit repository-relative output to archive')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    a = parser.parse_args()
    root = a.root.resolve()
    out = manifest.durable_output(a.out, root)
    command = a.command[1:] if a.command[:1] == ['--'] else a.command
    if not command or root == out or root in out.parents or out.exists() or any(p == out or p in out.parents for p in [Path('/tmp').resolve(), Path(os.environ.get('TMPDIR', '/tmp')).resolve()]):
        raise ValueError('Choose a new durable evidence directory outside checkout and temporary storage')
    record = json.loads(a.manifest.read_text())
    manifest.verify(root, record)
    if a.kind == 'build':
        paths = build_command(command, record['config'], root)
        build_inputs(root, record, paths['workspace'])
        if not {'node', 'ruby', 'bundler', 'xcode', 'swift'} <= record['tools'].keys() or not a.artifact:
            raise ValueError('Build requires the complete toolchain and an explicit artifact')
    artifact = None
    if a.artifact:
        candidate = Path(a.artifact)
        if candidate.is_absolute() or '..' in candidate.parts or str(candidate) == '.':
            raise ValueError('Artifact must be repository relative')
        artifact = root / candidate
    if a.kind == 'build' and (artifact is None or artifact.suffix != '.app' or artifact.parent != paths['derived'] / 'Build/Products/Release-iphoneos'):
        raise ValueError('Artifact must belong to the selected DerivedData release products')
    if artifact is not None and artifact.resolve() != artifact:
        raise ValueError('Linked artifact path refused')
    if a.kind == 'build' and artifact.exists():
        raise ValueError('Build artifact already exists; verify/recover it or choose new DerivedData')
    out.mkdir(parents=True)
    shutil.copy2(a.manifest, out / 'inputs.json')
    env = {k: os.environ[k] for k in ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'DEVELOPER_DIR'] if k in os.environ}
    env.update({'PATH': '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin', 'CI': '1', 'EXPO_NO_DOTENV': '1', 'EXPO_USE_PRECOMPILED_MODULES': '0'})
    for key, variable in [('bundle_id', 'DROP_BUNDLE_IDENTIFIER'), ('team', 'DROP_DEVELOPMENT_TEAM'), ('api_origin', 'EXPO_PUBLIC_API_URL')]:
        if key in record['config']:
            env[variable] = record['config'][key]
    if a.kind == 'build':
        env.update({'NODE_ENV': 'production', 'EXPO_PUBLIC_APP_ENV': 'production'})
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGTERM, interrupted)
    result = {'kind': a.kind, 'command': command, 'status': 'RUNNING', 'source_id': record['source_id']}
    def save():
        (out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    save()
    try:
        result.update(supervise(command, root, env, out / 'command.log', out / 'storage.jsonl', 24 if a.kind == 'build' else 1, 15 if a.kind == 'build' else 0.5, 5))
        manifest.verify(root, record)
        if result['exit_code'] or result['stopped_for_space']:
            raise ValueError('Command failed or stopped; no PASS recorded')
        if artifact is not None and artifact.resolve() != artifact:
            raise ValueError('Artifact became linked during command')
        if a.kind == 'build':
            if '** BUILD SUCCEEDED **' not in (out / 'command.log').read_text(errors='replace'):
                raise ValueError('Missing BUILD SUCCEEDED in log')
            result['app'] = inspect_app(artifact, record['config'])
        if artifact:
            if a.kind == 'build':
                size = sum(p.stat().st_size for p in artifact.rglob('*') if p.is_file() and not p.is_symlink())
                if shutil.disk_usage(root).free - size < 15 * 2**30:
                    raise ValueError('Insufficient reserve to archive; build output retained')
            result['artifact_files'] = archive(artifact, out / artifact.name)
        result['status'] = 'PASS'
    except BaseException as error:
        result.update({'status': 'BLOCKED', 'error': str(error)})
        raise
    finally:
        save()
    print(str(out / 'result.json'))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit('BLOCKED: ' + str(error))
