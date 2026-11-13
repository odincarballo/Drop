import hashlib
import json
import os
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import evidence
import manifest


class Repository(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='drop-workflow-test-')
        self.root = Path(self.temp.name).resolve() / 'repo'
        self.root.mkdir()
        self.git('init', '-q')
        self.put('source.py', 'value = 1\n')
        self.put('README.md', '# Controlled fixture\n')
        self.put('.gitignore', 'node_modules/\nmobile/ios/\n.env\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Workflow Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture')

    def tearDown(self):
        self.temp.cleanup()  # Only the fixture directory created by this test.

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], stderr=subprocess.DEVNULL)

    def put(self, relative, text):
        p = self.root / relative
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
        return p

    def test_roundtrip_and_tools(self):
        m = manifest.snapshot(self.root, tools=['python'])
        self.assertEqual(m['source_id'], manifest.verify(self.root, m)['source_id'])
        self.assertIn('python', m['tools'])

    def expo_jsi_run(self, mode, *, change_slice=False, alter_input=None, alter_embed=False,
                    stub=False, change_before_start=False):
        product = self.root / manifest.EXPO_JSI_SLICE
        product.parent.mkdir(parents=True)
        arm64_dylib = struct.pack('<IIIIIIII', 0xfeedfacf, 0x100000C, 0, 6, 0, 0, 0, 0)
        before = b'synthetic preparation stub' if stub else arm64_dylib + b'prior'
        after = arm64_dylib + b'new' if change_slice else before
        product.write_bytes(before)
        podfile = self.put('mobile/ios/Podfile', 'fixture')
        lock = self.put('mobile/ios/Podfile.lock', 'fixture')
        workspace = self.put('mobile/ios/Drop.xcworkspace/contents.xcworkspacedata',
                             '<Workspace><FileRef location="group:Pods/Pods.xcodeproj"/></Workspace>')
        pods = self.put('mobile/ios/Pods/Pods.xcodeproj/project.pbxproj', 'fixture')
        includes = [str(p.relative_to(self.root)) for p in (podfile, lock, workspace, pods)]
        for name in manifest.EXPO_JSI_INPUTS:
            self.put(name, 'fixed input')
        for directory in manifest.EXPO_JSI_SOURCE_DIRS:
            self.put(directory + '/source.h', 'fixed source')
        for name in ('jsi.h', 'jsi-inl.h'):
            header = self.root / 'mobile/ios/Pods/Headers/Public/React-jsi/jsi' / name
            header.parent.mkdir(parents=True, exist_ok=True)
            header.symlink_to(self.root / 'mobile/node_modules/react-native/ReactCommon/jsi/jsi' / name)
        config = {'variant': 'production', 'configuration': 'Release', 'platform': 'iphoneos',
                  'architecture': 'arm64', 'bundle_id': 'com.odincarballo.drop.reprotest',
                  'version': '1.8.1', 'build_number': '21', 'signing': 'unsigned'}
        versions = dict.fromkeys(('node', 'ruby', 'bundler', 'xcode', 'swift'), 'fixture')
        out = self.root.parent / 'run'
        derived = self.root / 'mobile/ios/build/fixture'
        app = derived / 'Build/Products/Release-iphoneos/Drop.app'
        inputs = self.root.parent / 'inputs.json'

        def fake_build(command, root, env, log, *args):
            product.write_bytes(after)
            if alter_input:
                self.put(alter_input, 'unexpected change')
            packaged = app / evidence.EXPO_JSI_EMBEDDED
            packaged.parent.mkdir(parents=True)
            packaged.write_bytes(before if alter_embed else after)
            log.write_text(
                r"PhaseScriptExecution [CP-User]\ Build\ ExpoModulesJSI\ xcframework fixture"
                " (in target 'ExpoModulesJSI' from project 'Pods')\n"
                + mode + "\n** BUILD SUCCEEDED **\n"
            )
            return {'exit_code': 0, 'stopped_for_space': False}

        with mock.patch('manifest.tool_versions', return_value=versions):
            record = manifest.snapshot(self.root, includes, config, versions, expo_jsi=True)
            self.assertIn(manifest.EXPO_JSI_PRODUCER, record['files'])
            self.assertNotIn(manifest.EXPO_JSI_SLICE, record['files'])
            manifest.write_new(inputs, record, self.root)
            if change_before_start:
                product.write_bytes(arm64_dylib + b'tampered before launch')
            args = ['evidence.py', '--root', str(self.root), '--manifest', str(inputs),
                    '--out', str(out), '--kind', 'build', '--artifact',
                    str(app.relative_to(self.root)), '--', 'xcodebuild', 'build']
            with mock.patch.object(sys, 'argv', args), \
                 mock.patch.dict(os.environ, {'TMPDIR': str(self.root / 'scratch')}), \
                 mock.patch('evidence.build_command', return_value={'workspace': workspace.parent, 'derived': derived}), \
                 mock.patch('evidence.supervise', side_effect=fake_build), \
                 mock.patch('evidence.inspect_app', return_value={}), \
                 mock.patch('evidence.shutil.disk_usage', return_value=mock.Mock(free=100 * 2**30)):
                evidence.main()
        result = json.loads((out / 'result.json').read_text())
        self.assertEqual(result['status'], 'PASS')
        hashes = [hashlib.sha256(data).hexdigest() for data in (before, after)]
        return result['expo_jsi'], hashes

    def test_expo_jsi_reuse_records_identical_hashes(self):
        result, (before, after) = self.expo_jsi_run('[ExpoModulesJSI] xcframework slices up to date, skipping build')
        self.assertEqual(result['status'], 'reused')
        self.assertEqual((result['before_sha256'], result['after_sha256'], result['embedded_sha256']),
                         (before, after, after))

    def test_expo_jsi_regeneration_matches_the_archived_binary(self):
        mode = ('[ExpoModulesJSI] Building framework slice for iphoneos...\n'
                '[ExpoModulesJSI] Built xcframework successfully in 17s (ios-arm64)')
        result, (before, after) = self.expo_jsi_run(mode, change_slice=True, stub=True)
        self.assertEqual(result['status'], 'regenerated')
        self.assertNotEqual(before, after)
        self.assertEqual((result['before_sha256'], result['after_sha256'], result['embedded_sha256']),
                         (before, after, after))

    def test_expo_jsi_refuses_changed_product_on_reuse(self):
        with self.assertRaisesRegex(ValueError, 'changed despite reported reuse'):
            self.expo_jsi_run('[ExpoModulesJSI] xcframework slices up to date, skipping build', change_slice=True)

    def test_expo_jsi_refuses_drift_in_pinned_inputs(self):
        with self.assertRaisesRegex(ValueError, 'Input mismatch: files'):
            self.expo_jsi_run('[ExpoModulesJSI] xcframework slices up to date, skipping build',
                             alter_input=manifest.EXPO_JSI_INPUTS[0])

    def test_expo_jsi_refuses_change_before_launch(self):
        with self.assertRaisesRegex(ValueError, 'changed before the build'):
            self.expo_jsi_run('', change_before_start=True)
        self.assertFalse((self.root.parent / 'run').exists())

    def test_expo_jsi_requires_a_completed_iphoneos_phase(self):
        for log_message in (
            '[ExpoModulesJSI] Building framework slice for iphoneos...',
            '[ExpoModulesJSI] Building framework slice for iphoneos...\n'
            '[ExpoModulesJSI] Built xcframework successfully in 17s (ios-arm64_x86_64-simulator)',
        ):
            with self.subTest(log_message=log_message):
                log = self.put('command.log', evidence.EXPO_JSI_PHASE + 'fixture '
                               + evidence.EXPO_JSI_TARGET + '\n' + log_message + '\n')
                with self.assertRaisesRegex(ValueError, 'phase evidence'):
                    evidence.expo_jsi_phase_result(log)

    def test_expo_jsi_refuses_different_embedded_bytes(self):
        mode = ('[ExpoModulesJSI] Building framework slice for iphoneos...\n'
                '[ExpoModulesJSI] Built xcframework successfully in 17s (ios-arm64)')
        with self.assertRaisesRegex(ValueError, 'Embedded ExpoModulesJSI does not match'):
            self.expo_jsi_run(mode, change_slice=True, alter_embed=True)

    def test_changed_content_and_permission_refuse_reuse(self):
        m = manifest.snapshot(self.root)
        self.put('source.py', 'value = 2\n')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            manifest.verify(self.root, m)
        self.put('source.py', 'value = 1\n').chmod(0o755)
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            manifest.verify(self.root, m)

    def test_explicit_untracked_and_protected_docs(self):
        self.put('new.py', 'new = True\n')
        self.put('docs/CONTEXTO_TECNICO_DROP.md', 'protected fixture\n')
        with self.assertRaisesRegex(ValueError, 'untracked'):
            manifest.snapshot(self.root)
        m = manifest.snapshot(self.root, ['new.py'])
        self.assertIn('new.py', m['files'])
        self.assertNotIn('docs/CONTEXTO_TECNICO_DROP.md', m['files'])
        with self.assertRaisesRegex(ValueError, 'Protected'):
            manifest.snapshot(self.root, ['new.py', 'docs/CONTEXTO_TECNICO_DROP.md'])

    def test_documentation_test_and_build_identities(self):
        a = manifest.snapshot(self.root)
        self.put('README.md', '# Updated fixture\n')
        b = manifest.snapshot(self.root)
        self.assertNotEqual(a['source_id'], b['source_id'])
        self.assertEqual(a['check_id'], b['check_id'])
        self.assertEqual(a['build_id'], b['build_id'])
        self.put('tests/test_sample.py', 'pass\n')
        c = manifest.snapshot(self.root, ['tests/test_sample.py'])
        self.assertNotEqual(b['check_id'], c['check_id'])
        self.assertEqual(b['build_id'], c['build_id'])
        self.assertNotEqual(c['build_id'], manifest.snapshot(self.root, ['tests/test_sample.py'], {'version': '2'})['build_id'])

    def test_production_file_named_test_is_still_a_build_input(self):
        path = 'mobile/src/test_helpers.ts'
        self.put(path, 'export const value = 1;\n')
        a = manifest.snapshot(self.root, [path])
        self.put(path, 'export const value = 2;\n')
        b = manifest.snapshot(self.root, [path])
        self.assertNotEqual(a['build_id'], b['build_id'])

    def test_secret_paths_traversal_and_links_rejected(self):
        self.put('.env', 'SYNTHETIC=fixture\n')
        with self.assertRaises(ValueError):
            manifest.snapshot(self.root, ['.env'])
        with self.assertRaises(ValueError):
            manifest.relative_file(self.root, '../outside')
        (self.root / 'link.py').symlink_to(self.root / 'missing.py')
        with self.assertRaises(ValueError):
            manifest.snapshot(self.root, ['link.py'])

    def test_durable_outputs_reject_temporary_paths(self):
        with self.assertRaises(ValueError):
            manifest.durable_output(self.root.parent / 'lost.json', self.root)

    def test_tool_or_config_change_invalidates_reuse(self):
        m = manifest.snapshot(self.root, tools=['python'])
        m['tools']['python'] = 'different version'
        with self.assertRaises(ValueError):
            manifest.verify(self.root, m)
        m = manifest.snapshot(self.root)
        m['config'] = {'version': '999'}
        with self.assertRaises(ValueError):
            manifest.verify(self.root, m)

    def test_manifest_output_rejects_dangling_symlink_without_writing_target(self):
        target = self.root.parent / 'outside.json'
        link = self.root.parent / 'linked.json'
        link.symlink_to(target)
        with self.assertRaises((ValueError, FileExistsError)):
            manifest.write_new(link, {}, self.root)
        self.assertFalse(target.exists())

    def test_tool_queries_do_not_inherit_execution_overrides(self):
        with mock.patch.dict(os.environ, {'RUBYOPT': 'synthetic override', 'NODE_OPTIONS': 'synthetic override', 'GIT_DIR': 'synthetic override'}):
            with mock.patch('manifest.subprocess.run', return_value=subprocess.CompletedProcess([], 0, 'fixture version', '')) as run:
                manifest.tool_versions(self.root, ['python'])
                env = run.call_args.kwargs['env']
                self.assertFalse('RUBYOPT' in env, 'RUBYOPT leaked')
                self.assertFalse('NODE_OPTIONS' in env, 'NODE_OPTIONS leaked')
                self.assertFalse('GIT_DIR' in env, 'GIT_DIR leaked')

    def test_unknown_tool_cannot_execute_from_manifest(self):
        m = manifest.snapshot(self.root)
        m['tools']['arbitrary-command'] = 'not executable'
        with self.assertRaisesRegex(ValueError, 'Unsupported tool'):
            manifest.verify(self.root, m)

    def test_production_gate_and_test_identifier(self):
        self.put('mobile/src/panel.ts', 'DROP_UNIT1_FIXTURE_VALIDATION_ONLY\n')
        with self.assertRaisesRegex(ValueError, 'instrumentation'):
            manifest.snapshot(self.root, ['mobile/src/panel.ts'], {'variant': 'production'})
        with self.assertRaises(ValueError):
            manifest.config_values(['variant=instrumentation', 'bundle_id=com.odincarballo.mediadrop'])
        with self.assertRaises(ValueError):
            manifest.config_values(['api_origin=https://user:synthetic@example.invalid'])

    def test_evidence_output_refuses_source_tree_or_overwrite(self):
        with self.assertRaises(ValueError):
            manifest.write_new(self.root / 'inputs.json', {}, self.root)
        path = self.root.parent / 'inputs.json'
        manifest.write_new(path, {}, self.root)
        with self.assertRaises(FileExistsError):
            manifest.write_new(path, {}, self.root)


class Supervisor(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='drop-supervisor-test-')
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def run_command(self, code, free=lambda: 100):
        return evidence.supervise([sys.executable, '-c', code], self.root, dict(os.environ), self.root / 'command.log', self.root / 'monitor.jsonl', 24, 15, 0.01, free)

    def test_success_and_nonzero_are_distinct(self):
        r = self.run_command('print("controlled check")')
        self.assertEqual(r['exit_code'], 0)
        self.assertIn('controlled check', (self.root / 'command.log').read_text())
        (self.root / 'command.log').rename(self.root / 'first.log')
        self.assertEqual(self.run_command('raise SystemExit(7)')['exit_code'], 7)

    def test_low_space_never_starts_command(self):
        with self.assertRaises(ValueError):
            self.run_command('open("unexpected", "w").write("bad")', lambda: 23)
        self.assertFalse((self.root / 'unexpected').exists())
        self.assertFalse((self.root / 'command.log').exists())

    def test_space_stop_terminates_process_group(self):
        ready = self.root / 'ready'
        unexpected = self.root / 'unexpected'
        child = f'import time; time.sleep(0.8); open({str(unexpected)!r}, "w").write("bad")'
        code = f'import subprocess, sys, time; subprocess.Popen([sys.executable,"-c",{child!r}]); open({str(ready)!r},"w").write("ready"); time.sleep(30)'
        calls = 0
        def free():
            nonlocal calls
            calls += 1
            if calls == 1:
                return 100
            deadline = time.monotonic() + 3
            while not ready.exists() and time.monotonic() < deadline:
                time.sleep(0.01)
            return 14
        r = self.run_command(code, free)
        self.assertTrue(r['stopped_for_space'])
        self.assertNotEqual(r['exit_code'], 0)
        time.sleep(1)
        self.assertFalse(unexpected.exists())

    def test_archive_checks_bytes_links_and_never_overwrites(self):
        source = self.root / 'artifact'
        source.mkdir()
        (source / 'bytes').write_bytes(b'controlled fixture')
        (source / 'alias').symlink_to('bytes')
        target = self.root / 'archive'
        values = evidence.archive(source, target)
        self.assertIn('bytes', values)
        self.assertTrue((target / 'alias').is_symlink())
        with self.assertRaises(ValueError):
            evidence.archive(source, target)
        outside = self.root / 'outside'
        outside.write_text('synthetic outside')
        (source / 'external').symlink_to(outside)
        with self.assertRaises(ValueError):
            evidence.archive(source, self.root / 'rejected')
        self.assertFalse((self.root / 'rejected').exists())

    def test_absolute_internal_and_dangling_archive_links_are_rejected(self):
        for kind in ['absolute', 'dangling']:
            source = self.root / kind
            source.mkdir()
            (source / 'bytes').write_text('synthetic')
            target = source / 'bytes' if kind == 'absolute' else Path('missing')
            (source / 'alias').symlink_to(target)
            with self.assertRaises(ValueError):
                evidence.archive(source, self.root / ('archive-' + kind))

    def test_archive_destination_link_cannot_create_external_file(self):
        source = self.root / 'source.txt'
        source.write_text('synthetic')
        outside = self.root / 'outside.txt'
        destination = self.root / 'destination'
        destination.symlink_to(outside)
        with self.assertRaises((ValueError, FileExistsError)):
            evidence.archive(source, destination)
        self.assertFalse(outside.exists())

    def test_unsigned_build_rejects_overrides_and_original(self):
        cfg = {'variant': 'production', 'configuration': 'Release', 'platform': 'iphoneos', 'architecture': 'arm64', 'bundle_id': 'com.odincarballo.drop.reprotest', 'version': '1.4.0', 'build_number': '7', 'signing': 'unsigned'}
        command = ['xcodebuild', '-workspace', 'mobile/ios/Drop.xcworkspace', '-scheme', 'Drop', '-derivedDataPath', 'mobile/ios/build/verify', '-jobs', '2', '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS', 'ARCHS=arm64', 'CODE_SIGNING_ALLOWED=NO', 'EXPANDED_CODE_SIGN_IDENTITY_NAME=Ad Hoc', 'EXPANDED_CODE_SIGN_IDENTITY=-', 'build']
        workspace = self.root / 'mobile/ios/Drop.xcworkspace'
        workspace.mkdir(parents=True)
        with mock.patch('evidence.Path.cwd', return_value=self.root):
            evidence.build_command(command, cfg)
        for extra in [['-jobs', '8'], ['CODE_SIGNING_ALLOWED=YES'], ['-allowProvisioningUpdates'], ['OTHER_SWIFT_FLAGS=-DTEST']]:
            with self.assertRaises(ValueError):
                evidence.build_command(command + extra, cfg, self.root)
        with self.assertRaises(ValueError):
            evidence.build_command(command, dict(cfg, bundle_id='com.odincarballo.mediadrop'), self.root)
        for flag in ['-workspace', '-derivedDataPath']:
            escaped = command.copy()
            escaped[escaped.index(flag) + 1] = str(self.root.parent / 'outside')
            with self.assertRaises(ValueError):
                evidence.build_command(escaped, cfg, self.root)

    def test_workspace_projects_must_be_recorded_and_internal(self):
        workspace = self.root / 'mobile/ios/Drop.xcworkspace'
        workspace.mkdir(parents=True)
        contents = workspace / 'contents.xcworkspacedata'
        contents.write_text('<Workspace><FileRef location="group:Drop.xcodeproj"/></Workspace>')
        project = workspace.parent / 'Drop.xcodeproj/project.pbxproj'
        project.parent.mkdir()
        project.write_text('synthetic project')
        for name in ['Podfile', 'Podfile.lock']:
            (workspace.parent / name).write_text('synthetic lock')
        with self.assertRaisesRegex(ValueError, 'explicit inputs'):
            evidence.build_inputs(self.root, {'files': {}}, workspace)
        files = {str(p.relative_to(self.root)): {} for p in [contents, project, workspace.parent / 'Podfile', workspace.parent / 'Podfile.lock']}
        evidence.build_inputs(self.root, {'files': files}, workspace)
        contents.write_text('<Workspace><FileRef location="absolute:/outside/Other.xcodeproj"/></Workspace>')
        with self.assertRaises(ValueError):
            evidence.build_inputs(self.root, {'files': files}, workspace)
        contents.write_text('<Workspace><Group location="absolute:/outside"><FileRef location="group:Drop.xcodeproj"/></Group></Workspace>')
        with self.assertRaisesRegex(ValueError, 'Grouped'):
            evidence.build_inputs(self.root, {'files': files}, workspace)

    def test_linked_app_metadata_is_refused_before_parsing(self):
        app = self.root / 'Linked.app'
        app.mkdir()
        outside = self.root / 'outside.plist'
        outside.write_bytes(plistlib.dumps({'synthetic': True}))
        (app / 'Info.plist').symlink_to(outside)
        with mock.patch('evidence.plistlib.loads') as loads:
            with self.assertRaisesRegex(ValueError, 'Linked'):
                evidence.inspect_app(app, {})
            loads.assert_not_called()

    def test_synthetic_app_inspection_is_not_a_release_build(self):
        app = self.root / 'Synthetic.app'
        app.mkdir()
        cfg = {'bundle_id': 'example.fixture', 'version': '1', 'build_number': '1'}
        (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'example.fixture', 'CFBundleShortVersionString': '1', 'CFBundleVersion': '1', 'CFBundleExecutable': 'fixture'}))
        (app / 'fixture').write_bytes(bytes.fromhex('cffaedfe') + struct.pack('<I', 0x100000C) + b'fixture')
        (app / 'main.jsbundle').write_bytes(bytes.fromhex('c61fbc03c103191f') + b'fixture')
        self.assertIn('executable_sha256', evidence.inspect_app(app, cfg))
        (app / 'main.jsbundle').write_bytes(bytes.fromhex('c61fbc03c103191f') + b'withFixtureMutation')
        with self.assertRaises(ValueError):
            evidence.inspect_app(app, cfg)
        with self.assertRaises(ValueError):
            evidence.inspect_app(app, dict(cfg, version='2'))


if __name__ == '__main__':
    unittest.main()
