# Restore the ignored native project before switching back to main.
require 'xcodeproj'
require 'json'

properties_path = File.expand_path('../ios/Podfile.properties.json', __dir__)
properties = JSON.parse(File.read(properties_path))
properties.delete('EXPO_USE_PRECOMPILED_MODULES')
File.write(properties_path, JSON.pretty_generate(properties) + "\n")

path = File.expand_path('../ios/MediaDrop.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
target = project.targets.find { |item| item.name == 'MediaDrop' }
raise 'Existing MediaDrop target required' unless target
name = '[MediaDrop] Embed Python for on-device spike'
target.shell_script_build_phases
  .select { |item| item.name == name }
  .each { |item| target.build_phases.delete(item) }
project.save
puts 'Removed native spike configuration; run pod install after switching branches.'
