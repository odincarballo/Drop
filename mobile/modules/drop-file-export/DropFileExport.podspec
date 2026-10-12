Pod::Spec.new do |s|
  s.name = 'DropFileExport'
  s.version = '0.1.0'
  s.summary = 'Export completed Drop files through the iOS Files picker'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Drop'
  s.homepage = 'https://github.com/odincarballo/Drop'
  s.source = { :git => 'https://github.com/odincarballo/Drop.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.swift'
end
