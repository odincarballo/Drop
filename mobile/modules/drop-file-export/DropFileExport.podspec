Pod::Spec.new do |s|
  s.name = 'DropFileExport'
  s.version = '0.1.0'
  s.summary = 'Export completed Drop files through the iOS Files picker'
  s.description = s.summary
  s.license = { :type => 'Private' }
  s.author = 'Drop'
  s.homepage = 'https://github.com/odincarballo/MediaDrop'
  s.source = { :git => 'https://github.com/odincarballo/MediaDrop.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.swift'
end
