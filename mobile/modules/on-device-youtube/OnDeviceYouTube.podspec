Pod::Spec.new do |s|
  s.name = 'OnDeviceYouTube'
  s.version = '0.1.0'
  s.summary = 'Private on-device YouTube metadata feasibility spike'
  s.description = s.summary
  s.license = { :type => 'Private' }
  s.author = 'MediaDrop'
  s.homepage = 'https://github.com/odincarballo/MediaDrop'
  s.source = { :git => 'https://github.com/odincarballo/MediaDrop.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.{h,m,swift}', 'vendor/quickjs/{quickjs,libregexp,libunicode,dtoa}.c'
  s.public_header_files = 'ios/MDPythonBridge.h'
  s.preserve_paths = 'vendor/quickjs/*.h', 'vendor/python/Python.xcframework/**/*'
  s.vendored_frameworks = 'vendor/python/Python.xcframework'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) _GNU_SOURCE',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/vendor/quickjs"',
    'CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER' => 'NO'
  }
end
