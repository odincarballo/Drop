Pod::Spec.new do |s|
  s.name = 'DropLibrary'
  s.version = '0.1.0'
  s.summary = 'Persistent, sandboxed Drop media library'
  s.description = s.summary
  s.license = { :type => 'Private' }
  s.author = 'Drop'
  s.homepage = 'https://github.com/odincarballo/MediaDrop'
  s.source = { :git => 'https://github.com/odincarballo/MediaDrop.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.library = 'sqlite3'
  s.source_files = 'ios/*.swift'
end
