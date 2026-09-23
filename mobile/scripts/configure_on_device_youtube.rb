# Idempotent configuration of the Expo-generated iOS application target.
require 'json'
require_relative 'ios_application_project'

properties_path = File.expand_path('../ios/Podfile.properties.json', __dir__)
properties = JSON.parse(File.read(properties_path))
# Avoid a CocoaPods configuration that mixes source-built React with precompiled
# Expo frameworks. That combination builds but misses React.framework at runtime.
properties['EXPO_USE_PRECOMPILED_MODULES'] = 'false'
File.write(properties_path, JSON.pretty_generate(properties) + "\n")

project, target = IOSApplicationProject.open
name = '[Drop] Embed Python for on-device'
phase = IOSApplicationProject.embed_phase(target)
unless phase
  phase = target.new_shell_script_build_phase(name)
  target.build_phases.delete(phase)
  index = target.build_phases.index { |item| item.display_name == '[CP] Embed Pods Frameworks' }
  target.build_phases.insert(index || target.build_phases.length, phase)
end
phase.name = name
phase.shell_path = '/bin/bash'
phase.shell_script = 'bash "$PROJECT_DIR/../scripts/embed_on_device_python.sh"'
phase.always_out_of_date = '1'
project.save
puts 'Configured consistent Pods and Python embedding; signing and bundle ID preserved.'
