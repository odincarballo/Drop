Pod::Spec.new do |s|
  s.name = 'DropPlayback'
  s.version = '0.1.0'
  s.summary = 'Single local-media player for the Drop library'
  s.description = s.summary
  s.license = { :type => 'Private' }
  s.author = 'Drop'
  s.homepage = 'https://github.com/odincarballo/MediaDrop'
  s.source = { :git => 'https://github.com/odincarballo/MediaDrop.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'DropLibrary'
  s.library = 'sqlite3'
  s.frameworks = 'AVFoundation', 'AVKit', 'AVFAudio', 'MediaPlayer', 'ImageIO'
  s.source_files = 'ios/*.swift'
end
