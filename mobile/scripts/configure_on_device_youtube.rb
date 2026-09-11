# Idempotent surgical edit of the existing project: no prebuild or regeneration.
require 'xcodeproj'
require 'json'

properties_path = File.expand_path('../ios/Podfile.properties.json', __dir__)
properties = JSON.parse(File.read(properties_path))
# Avoid a CocoaPods configuration that mixes source-built React with precompiled
# Expo frameworks. That combination builds but misses React.framework at runtime.
properties['EXPO_USE_PRECOMPILED_MODULES'] = 'false'
File.write(properties_path, JSON.pretty_generate(properties) + "\n")

path = File.expand_path('../ios/MediaDrop.xcodeproj', __dir__)
project = Xcodeproj::Project.open(path)
target = project.targets.find { |item| item.name == 'MediaDrop' }
raise 'Existing MediaDrop target required' unless target
name = '[MediaDrop] Embed Python for on-device spike'
phase = target.shell_script_build_phases.find { |item| item.name == name }
unless phase
  phase = target.new_shell_script_build_phase(name)
  target.build_phases.delete(phase)
  index = target.build_phases.index { |item| item.display_name == '[CP] Embed Pods Frameworks' }
  target.build_phases.insert(index || target.build_phases.length, phase)
end
phase.shell_path = '/bin/bash'
phase.shell_script = 'bash "$PROJECT_DIR/../scripts/embed_on_device_python.sh"'
phase.always_out_of_date = '1'
project.save
puts 'Configured consistent Pods and Python embedding; signing and bundle ID preserved.'
