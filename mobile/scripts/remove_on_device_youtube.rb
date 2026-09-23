# Remove the embedded Python phase from the generated iOS application target.
require 'json'
require_relative 'ios_application_project'

properties_path = File.expand_path('../ios/Podfile.properties.json', __dir__)
properties = JSON.parse(File.read(properties_path))
properties.delete('EXPO_USE_PRECOMPILED_MODULES')
File.write(properties_path, JSON.pretty_generate(properties) + "\n")

project, target = IOSApplicationProject.open
phase = IOSApplicationProject.embed_phase(target)
target.build_phases.delete(phase) if phase
project.save
puts 'Removed native spike configuration; run pod install after switching branches.'
